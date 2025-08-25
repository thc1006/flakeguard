/**
 * Multi-Tenant Isolation Middleware
 * 
 * Enforces row-level security and tenant isolation across all API routes.
 * Ensures users can only access data within their organization's scope.
 */

import { PrismaClient } from '@prisma/client';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import { logger } from '../utils/logger.js';

// Tenant context interface
interface TenantContext {
  orgId: string;
  userId?: string;
  role: string;
  installationId?: string;
}

// Extended FastifyRequest with tenant context
declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantContext;
  }
}

// Configuration options for tenant isolation
interface TenantIsolationOptions {
  enabled?: boolean;
  bypassRoutes?: string[];
  requireInstallationId?: boolean;
  adminRoles?: string[];
}

/**
 * Extract tenant context from request
 */
async function extractTenantContext(
  request: FastifyRequest,
  prisma: PrismaClient
): Promise<TenantContext | null> {
  try {
    // Check for installation ID in headers (GitHub webhook context)
    const githubInstallationId = request.headers['x-github-installation-id'];
    if (githubInstallationId) {
      const installation = await prisma.installation.findUnique({
        where: { githubInstallationId: parseInt(githubInstallationId as string) },
        include: { organization: true },
      });
      
      if (installation) {
        return {
          orgId: installation.orgId,
          role: 'system',
          installationId: installation.id,
        };
      }
    }

    // Check for authenticated user context
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      // Extract user from JWT token (assuming auth middleware runs before this)
      const userId = request.user?.id;
      if (userId) {
        // Get user's organization membership
        const orgUser = await prisma.organizationUser.findFirst({
          where: { 
            userId,
            status: 'active',
          },
          include: { 
            organization: { where: { status: 'active' } },
            user: true,
          },
          orderBy: { joinedAt: 'desc' }, // Most recent org if multiple
        });

        if (orgUser?.organization) {
          return {
            orgId: orgUser.organization.id,
            userId,
            role: orgUser.role,
          };
        }
      }
    }

    // Check for API key context
    const apiKey = request.headers['x-api-key'];
    if (apiKey) {
      // For API keys, we need to validate and extract org context
      // This would typically involve checking against a stored API key table
      logger.warn('API key authentication not fully implemented for multi-tenant context');
    }

    return null;
  } catch (error) {
    logger.error('Failed to extract tenant context', { error });
    return null;
  }
}

/**
 * Check if route should bypass tenant isolation
 */
function shouldBypassTenant(path: string, bypassRoutes: string[]): boolean {
  return bypassRoutes.some(route => {
    if (route.includes('*')) {
      const pattern = route.replace(/\*/g, '.*');
      return new RegExp(`^${pattern}$`).test(path);
    }
    return path.startsWith(route);
  });
}

/**
 * Validate tenant access permissions
 */
async function validateTenantAccess(
  tenant: TenantContext,
  prisma: PrismaClient
): Promise<boolean> {
  try {
    // Check if organization is active
    const org = await prisma.organization.findUnique({
      where: { 
        id: tenant.orgId,
        status: 'active',
      },
    });

    if (!org) {
      logger.warn('Tenant access denied: inactive or non-existent organization', {
        orgId: tenant.orgId,
      });
      return false;
    }

    // Additional role-based validation if needed
    if (tenant.userId) {
      const orgUser = await prisma.organizationUser.findUnique({
        where: {
          orgId_userId: {
            orgId: tenant.orgId,
            userId: tenant.userId,
          },
          status: 'active',
        },
      });

      if (!orgUser) {
        logger.warn('Tenant access denied: user not member of organization', {
          orgId: tenant.orgId,
          userId: tenant.userId,
        });
        return false;
      }
    }

    return true;
  } catch (error) {
    logger.error('Failed to validate tenant access', { error, tenant });
    return false;
  }
}

/**
 * Create tenant-aware Prisma client wrapper
 */
function createTenantPrismaWrapper(
  prisma: PrismaClient,
  tenant: TenantContext
): PrismaClient {
  // Create a proxy that automatically adds tenant filtering
  return new Proxy(prisma, {
    get(target, prop) {
      const originalMethod = target[prop as keyof PrismaClient];
      
      if (typeof originalMethod === 'object' && originalMethod !== null) {
        // This is a model (like prisma.user)
        return new Proxy(originalMethod, {
          get(modelTarget, modelProp) {
            const originalModelMethod = modelTarget[modelProp as keyof typeof modelTarget];
            
            if (typeof originalModelMethod === 'function') {
              return function (this: any, ...args: any[]) {
                // Auto-inject orgId filtering for queries
                if (modelProp === 'findMany' || modelProp === 'findFirst' || 
                    modelProp === 'findUnique' || modelProp === 'count') {
                  const [queryArgs = {}] = args;
                  
                  // Add orgId filter if the model has an orgId field
                  if (queryArgs.where) {
                    queryArgs.where.orgId = tenant.orgId;
                  } else {
                    queryArgs.where = { orgId: tenant.orgId };
                  }
                  
                  args[0] = queryArgs;
                }
                
                // Auto-inject orgId for creates
                if (modelProp === 'create') {
                  const [createArgs] = args;
                  if (createArgs.data) {
                    createArgs.data.orgId = tenant.orgId;
                  }
                  args[0] = createArgs;
                }
                
                // Auto-inject orgId for updates
                if (modelProp === 'update' || modelProp === 'updateMany') {
                  const [updateArgs] = args;
                  if (updateArgs.where) {
                    updateArgs.where.orgId = tenant.orgId;
                  } else {
                    updateArgs.where = { orgId: tenant.orgId };
                  }
                  args[0] = updateArgs;
                }
                
                return originalModelMethod.apply(modelTarget, args);
              };
            }
            
            return originalModelMethod;
          },
        });
      }
      
      return originalMethod;
    },
  });
}

/**
 * Main tenant isolation plugin
 */
async function tenantIsolationPlugin(
  fastify: FastifyInstance,
  options: TenantIsolationOptions = {}
) {
  const {
    enabled = true,
    bypassRoutes = ['/health', '/metrics', '/documentation', '/api/auth'],
    requireInstallationId = false,
    adminRoles = ['super_admin'],
  } = options;

  if (!enabled) {
    logger.info('Tenant isolation is disabled');
    return;
  }

  // Add pre-handler to extract and validate tenant context
  fastify.addHook('preHandler', async (request, reply) => {
    const path = request.url;
    
    // Skip tenant isolation for bypass routes
    if (shouldBypassTenant(path, bypassRoutes)) {
      return;
    }

    // Extract tenant context
    const tenant = await extractTenantContext(request, fastify.prisma);
    
    if (!tenant) {
      if (requireInstallationId || !path.startsWith('/api/public')) {
        logger.warn('Request rejected: no valid tenant context', {
          path,
          headers: request.headers,
        });
        
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Invalid or missing tenant context',
          code: 'TENANT_CONTEXT_REQUIRED',
        });
      }
      return;
    }

    // Validate tenant access
    const hasAccess = await validateTenantAccess(tenant, fastify.prisma);
    if (!hasAccess) {
      logger.warn('Request rejected: tenant access denied', {
        path,
        tenant,
      });
      
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Access denied for organization',
        code: 'TENANT_ACCESS_DENIED',
      });
    }

    // Attach tenant context to request
    request.tenant = tenant;
    
    // Create tenant-aware Prisma wrapper
    request.tenantPrisma = createTenantPrismaWrapper(fastify.prisma, tenant);

    // Audit logging for sensitive operations
    if (request.method !== 'GET') {
      await fastify.prisma.auditLog.create({
        data: {
          orgId: tenant.orgId,
          userId: tenant.userId || null,
          action: `${request.method.toLowerCase()}_request`,
          resource: 'api_request',
          details: {
            path: request.url,
            method: request.method,
            userAgent: request.headers['user-agent'],
          },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });
    }

    logger.debug('Tenant context established', {
      path,
      orgId: tenant.orgId,
      role: tenant.role,
      userId: tenant.userId,
    });
  });

  // Add utility decorators
  fastify.decorate('getTenantContext', function (request: FastifyRequest) {
    return request.tenant;
  });

  fastify.decorate('requireTenantRole', function (
    request: FastifyRequest,
    requiredRoles: string[]
  ) {
    const tenant = request.tenant;
    if (!tenant || !requiredRoles.includes(tenant.role)) {
      throw new Error(`Insufficient permissions. Required roles: ${requiredRoles.join(', ')}`);
    }
  });

  // Organization usage tracking
  fastify.addHook('onResponse', async (request, reply) => {
    if (!request.tenant || request.method === 'GET') {return;}

    try {
      // Track API usage metrics
      await fastify.prisma.usageMetric.upsert({
        where: {
          orgId_metricType_period_date: {
            orgId: request.tenant.orgId,
            metricType: 'api_calls',
            period: 'daily',
            date: new Date(new Date().toISOString().split('T')[0]),
          },
        },
        create: {
          orgId: request.tenant.orgId,
          metricType: 'api_calls',
          period: 'daily',
          date: new Date(new Date().toISOString().split('T')[0]),
          value: 1,
        },
        update: {
          value: { increment: 1 },
        },
      });
    } catch (error) {
      logger.error('Failed to track usage metrics', { error });
    }
  });

  logger.info('Tenant isolation plugin registered', {
    enabled,
    bypassRoutes,
    requireInstallationId,
  });
}

export default fp(tenantIsolationPlugin, {
  name: 'tenant-isolation',
  dependencies: ['prisma'],
});

export type { TenantContext, TenantIsolationOptions };