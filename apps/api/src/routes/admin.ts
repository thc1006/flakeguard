/**
 * Admin Dashboard Routes
 * 
 * Super-admin routes for tenant management, system monitoring,
 * and organizational oversight.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { createOrgSyncService } from '../services/org-sync.js';
import { createTenantManagementService } from '../services/tenant-management.js';
import { logger } from '../utils/logger.js';

// Admin request schemas
const createOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(50),
  githubLogin: z.string().optional(),
  domain: z.string().optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).default('free'),
  ownerEmail: z.string().email(),
  ownerName: z.string().optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  settings: z.record(z.any()).optional(),
});

// const _inviteUserSchema = z.object({
//   email: z.string().email(),
//   role: z.enum(['owner', 'admin', 'member', 'viewer']),
//   name: z.string().optional(),
// });

const syncRepoSchema = z.object({
  fullSync: z.boolean().default(false),
  enabledOnly: z.boolean().default(true),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
});

/**
 * Admin middleware to ensure super-admin access
 */
async function requireSuperAdmin(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const tenant = request.tenant;
  
  if (!tenant?.userId) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  const user = await request.server.prisma.user.findUnique({
    where: { id: tenant.userId },
  });

  if (!user || user.role !== 'super_admin') {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'Super admin access required',
    });
  }
}

/**
 * Admin routes for multi-tenant management
 */
export async function adminRoutes(fastify: FastifyInstance) {
  const tenantService = createTenantManagementService(fastify.prisma);
  const orgSyncService = createOrgSyncService(fastify.prisma, fastify.githubAuth);

  // Add admin middleware to all routes
  fastify.addHook('preHandler', requireSuperAdmin);

  // Dashboard overview
  fastify.get('/admin/dashboard', {
    schema: {
      tags: ['Admin'],
      summary: 'Get admin dashboard overview',
      response: {
        200: {
          type: 'object',
          properties: {
            overview: {
              type: 'object',
              properties: {
                totalOrganizations: { type: 'number' },
                activeOrganizations: { type: 'number' },
                totalUsers: { type: 'number' },
                totalRepositories: { type: 'number' },
                totalTestRuns: { type: 'number' },
              },
            },
            recentActivity: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  action: { type: 'string' },
                  resource: { type: 'string' },
                  timestamp: { type: 'string' },
                  details: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    try {
      // Get system overview
      const [
        totalOrgs,
        activeOrgs,
        totalUsers,
        totalRepos,
        recentActivity,
      ] = await Promise.all([
        fastify.prisma.organization.count(),
        fastify.prisma.organization.count({ where: { status: 'active' } }),
        fastify.prisma.user.count({ where: { status: 'active' } }),
        fastify.prisma.repository.count({ where: { isActive: true } }),
        fastify.prisma.auditLog.findMany({
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { name: true, email: true } },
            organization: { select: { name: true, slug: true } },
          },
        }),
      ]);

      // Get test run count from usage metrics
      const testRunMetrics = await fastify.prisma.usageMetric.aggregate({
        where: {
          metricType: 'test_runs',
          date: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
        _sum: { value: true },
      });

      const overview = {
        totalOrganizations: totalOrgs,
        activeOrganizations: activeOrgs,
        totalUsers,
        totalRepositories: totalRepos,
        totalTestRuns: testRunMetrics._sum.value || 0,
      };

      const activity = recentActivity.map(log => ({
        id: log.id,
        action: log.action,
        resource: log.resource,
        timestamp: log.createdAt.toISOString(),
        user: log.user?.name || log.user?.email,
        organization: log.organization.name,
        details: log.details,
      }));

      return reply.send({
        overview,
        recentActivity: activity,
      });

    } catch (error: any) {
      logger.error('Failed to get admin dashboard', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to load dashboard data',
      });
    }
  });

  // List organizations
  fastify.get('/admin/organizations', {
    schema: {
      tags: ['Admin'],
      summary: 'List all organizations',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['active', 'suspended', 'deleted'] },
          plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
          search: { type: 'string' },
        },
      },
    },
  }, async (_request, reply) => {
    try {
      const { page = 1, limit = 20, status, plan, search } = _request.query as any;
      const offset = (page - 1) * limit;

      const where: any = {};
      if (status) {where.status = status;}
      if (plan) {where.plan = plan;}
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
          { githubLogin: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [organizations, total] = await Promise.all([
        fastify.prisma.organization.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: {
              select: {
                users: { where: { status: 'active' } },
                repositories: { where: { isActive: true } },
                installations: true,
              },
            },
            subscriptions: {
              where: { status: 'active' },
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        }),
        fastify.prisma.organization.count({ where }),
      ]);

      return reply.send({
        organizations: organizations.map(org => ({
          id: org.id,
          name: org.name,
          slug: org.slug,
          githubLogin: org.githubLogin,
          plan: org.plan,
          status: org.status,
          userCount: org._count.users,
          repositoryCount: org._count.repositories,
          installationCount: org._count.installations,
          subscription: org.subscriptions[0] || null,
          createdAt: org.createdAt.toISOString(),
          updatedAt: org.updatedAt.toISOString(),
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });

    } catch (error: any) {
      logger.error('Failed to list organizations', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch organizations',
      });
    }
  });

  // Create organization
  fastify.post('/admin/organizations', {
    schema: {
      tags: ['Admin'],
      summary: 'Create new organization',
      body: createOrgSchema,
    },
  }, async (_request, reply) => {
    try {
      const data = _request.body as z.infer<typeof createOrgSchema>;

      // Find or create owner user
      let ownerUser = await fastify.prisma.user.findUnique({
        where: { email: data.ownerEmail },
      });

      if (!ownerUser) {
        ownerUser = await fastify.prisma.user.create({
          data: {
            email: data.ownerEmail,
            name: data.ownerName,
            status: 'active',
          },
        });
      }

      // Create organization
      const result = await tenantService.createOrganization({
        name: data.name,
        slug: data.slug,
        githubLogin: data.githubLogin,
        domain: data.domain,
        plan: data.plan,
      }, {
        ...ownerUser,
        name: ownerUser.name || 'Unknown User'
      });

      logger.info('Organization created by admin', {
        orgId: result.organization.id,
        adminId: _request.tenant?.userId,
      });

      return reply.code(201).send({
        organization: result.organization,
        owner: ownerUser,
      });

    } catch (error: any) {
      logger.error('Failed to create organization', { error });
      
      if (error.message.includes('already taken')) {
        return reply.code(409).send({
          error: 'Conflict',
          message: error.message,
        });
      }

      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create organization',
      });
    }
  });

  // Update organization
  fastify.put('/admin/organizations/:orgId', {
    schema: {
      tags: ['Admin'],
      summary: 'Update organization',
      params: {
        type: 'object',
        properties: {
          orgId: { type: 'string' },
        },
        required: ['orgId'],
      },
      body: updateOrgSchema,
    },
  }, async (_request, reply) => {
    try {
      const { orgId } = _request.params as { orgId: string };
      const data = _request.body as z.infer<typeof updateOrgSchema>;

      const organization = await fastify.prisma.organization.findUnique({
        where: { id: orgId },
      });

      if (!organization) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Organization not found',
        });
      }

      const updated = await fastify.prisma.organization.update({
        where: { id: orgId },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });

      // Create audit log
      await fastify.prisma.auditLog.create({
        data: {
          orgId,
          userId: _request.tenant.userId!,
          action: 'organization_updated_by_admin',
          resource: 'organization',
          resourceId: orgId,
          details: {
            changes: data,
            adminId: _request.tenant?.userId,
          },
        },
      });

      logger.info('Organization updated by admin', {
        orgId,
        adminId: _request.tenant?.userId,
        changes: Object.keys(data),
      });

      return reply.send({ organization: updated });

    } catch (error: any) {
      logger.error('Failed to update organization', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update organization',
      });
    }
  });

  // Get organization details
  fastify.get('/admin/organizations/:orgId', {
    schema: {
      tags: ['Admin'],
      summary: 'Get organization details',
      params: {
        type: 'object',
        properties: {
          orgId: { type: 'string' },
        },
        required: ['orgId'],
      },
    },
  }, async (_request, reply) => {
    try {
      const { orgId } = _request.params as { orgId: string };

      const organization = await fastify.prisma.organization.findUnique({
        where: { id: orgId },
        include: {
          users: {
            include: { user: true },
            where: { status: 'active' },
            orderBy: { joinedAt: 'asc' },
          },
          installations: {
            include: {
              _count: { select: { repositories: true } },
            },
          },
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: {
            select: {
              repositories: { where: { isActive: true } },
              auditLogs: true,
            },
          },
        },
      });

      if (!organization) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Organization not found',
        });
      }

      // Get usage metrics
      const usage = await tenantService.getOrganizationUsage(orgId);

      return reply.send({
        organization: {
          ...organization,
          userCount: organization.users.length,
          repositoryCount: organization._count.repositories,
          auditLogCount: organization._count.auditLogs,
        },
        users: organization.users.map(orgUser => ({
          ...orgUser.user,
          role: orgUser.role,
          joinedAt: orgUser.joinedAt,
        })),
        installations: organization.installations,
        subscription: organization.subscriptions[0] || null,
        usage,
      });

    } catch (error: any) {
      logger.error('Failed to get organization details', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch organization details',
      });
    }
  });

  // Trigger organization sync
  fastify.post('/admin/organizations/:orgId/sync', {
    schema: {
      tags: ['Admin'],
      summary: 'Trigger organization repository sync',
      params: {
        type: 'object',
        properties: {
          orgId: { type: 'string' },
        },
        required: ['orgId'],
      },
      body: syncRepoSchema,
    },
  }, async (_request, reply) => {
    try {
      const { orgId } = _request.params as { orgId: string };
      const options = _request.body as z.infer<typeof syncRepoSchema>;

      // Get organization installations
      const installations = await fastify.prisma.installation.findMany({
        where: { orgId, suspendedAt: null },
      });

      if (installations.length === 0) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'No active installations found for organization',
        });
      }

      const results = [];

      // Sync each installation
      for (const installation of installations) {
        const result = await orgSyncService.syncOrganization({
          orgId,
          installationId: installation.id,
          ...options,
        });
        results.push({
          installationId: installation.id,
          accountLogin: installation.accountLogin,
          result,
        });
      }

      // Create audit log
      await fastify.prisma.auditLog.create({
        data: {
          orgId,
          userId: _request.tenant.userId!,
          action: 'organization_sync_triggered',
          resource: 'organization',
          resourceId: orgId,
          details: {
            options,
            results: results.map(r => ({
              installationId: r.installationId,
              success: r.result.success,
              discovered: r.result.discovered,
              registered: r.result.registered,
            })),
          },
        },
      });

      logger.info('Organization sync triggered by admin', {
        orgId,
        adminId: _request.tenant?.userId,
        installationCount: installations.length,
      });

      return reply.send({ results });

    } catch (error: any) {
      logger.error('Failed to trigger organization sync', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to trigger sync',
      });
    }
  });

  // Get system health metrics
  fastify.get('/admin/health', {
    schema: {
      tags: ['Admin'],
      summary: 'Get system health metrics',
    },
  }, async (_request, reply) => {
    try {
      // Get database connection info
      const dbResult = await fastify.prisma.$queryRaw`SELECT version()`;
      
      // Get recent error rates
      const errorLogs = await fastify.prisma.auditLog.count({
        where: {
          action: { contains: 'error' },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
      });

      // Get sync status
      const syncStatus = await fastify.prisma.installation.groupBy({
        by: ['syncStatus'],
        _count: { syncStatus: true },
      });

      const health = {
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          version: (dbResult as any[])[0]?.version || 'unknown',
        },
        errors: {
          last24h: errorLogs,
        },
        sync: {
          status: syncStatus.reduce((acc, s) => {
            acc[s.syncStatus] = s._count.syncStatus;
            return acc;
          }, {} as Record<string, number>),
        },
      };

      return reply.send(health);

    } catch (error: any) {
      logger.error('Failed to get system health', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get health metrics',
      });
    }
  });
}

export default adminRoutes;