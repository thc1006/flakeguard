/**
 * Organization Management Routes
 * 
 * Tenant-scoped routes for managing organization settings,
 * users, repositories, and configurations.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createTenantManagementService } from '../services/tenant-management.js';
import { createOrgSyncService } from '../services/org-sync.js';
import { logger } from '../utils/logger.js';

// Organization request schemas
const updateSettingsSchema = z.object({
  defaultFlakeThreshold: z.number().min(0).max(1).optional(),
  autoQuarantineEnabled: z.boolean().optional(),
  slackIntegration: z.object({
    enabled: z.boolean(),
    channelId: z.string().optional(),
    notificationTypes: z.array(z.string()),
  }).optional(),
  notifications: z.object({
    email: z.boolean(),
    slack: z.boolean(),
    webhook: z.string().url().optional(),
  }).optional(),
  policies: z.object({
    excludePaths: z.array(z.string()),
    includeOnly: z.array(z.string()),
    quarantineRules: z.array(z.object({
      threshold: z.number().min(0).max(1),
      minOccurrences: z.number().min(1),
      timeWindow: z.string(),
    })),
  }).optional(),
});

const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
  name: z.string().optional(),
});

const updateUserRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

const syncRepositoriesSchema = z.object({
  fullSync: z.boolean().default(false),
  enabledOnly: z.boolean().default(true),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
});

/**
 * Organization middleware to ensure tenant access and role permissions
 */
async function requireOrgAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: 'viewer' | 'member' | 'admin' | 'owner' = 'viewer'
) {
  const tenant = request.tenant;
  
  if (!tenant?.orgId || !tenant?.userId) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Organization context required',
    });
  }

  const orgUser = await request.server.prisma.organizationUser.findUnique({
    where: {
      orgId_userId: {
        orgId: tenant.orgId,
        userId: tenant.userId,
      },
      status: 'active',
    },
  });

  if (!orgUser) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'Not a member of this organization',
    });
  }

  // Role hierarchy check
  const roleHierarchy = ['viewer', 'member', 'admin', 'owner'];
  const userRoleLevel = roleHierarchy.indexOf(orgUser.role);
  const requiredRoleLevel = roleHierarchy.indexOf(requiredRole);

  if (userRoleLevel < requiredRoleLevel) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: `${requiredRole} role required`,
    });
  }

  // Add user role to request context
  request.userRole = orgUser.role;
}

/**
 * Organization management routes
 */
export async function organizationRoutes(fastify: FastifyInstance) {
  const tenantService = createTenantManagementService(fastify.prisma);
  const orgSyncService = createOrgSyncService(fastify.prisma, fastify.githubAuth);

  // Get current organization details
  fastify.get('/v1/organization', {
    schema: {
      tags: ['Organizations'],
      summary: 'Get current organization details',
      response: {
        200: {
          type: 'object',
          properties: {
            organization: { type: 'object' },
            userRole: { type: 'string' },
            usage: { type: 'object' },
            quotas: { type: 'object' },
          },
        },
      },
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'viewer');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;

      const [organization, usage] = await Promise.all([
        fastify.prisma.organization.findUnique({
          where: { id: orgId },
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
        tenantService.getOrganizationUsage(orgId),
      ]);

      if (!organization) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Organization not found',
        });
      }

      return reply.send({
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          githubLogin: organization.githubLogin,
          domain: organization.domain,
          plan: organization.plan,
          status: organization.status,
          settings: organization.settings,
          userCount: organization._count.users,
          repositoryCount: organization._count.repositories,
          installationCount: organization._count.installations,
          subscription: organization.subscriptions[0] || null,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
        },
        userRole: request.userRole,
        usage,
        quotas: usage.quotas,
      });

    } catch (error: any) {
      logger.error('Failed to get organization details', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch organization details',
      });
    }
  });

  // Update organization settings
  fastify.put('/v1/organization/settings', {
    schema: {
      tags: ['Organizations'],
      summary: 'Update organization settings',
      body: updateSettingsSchema,
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'admin');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const settings = request.body as z.infer<typeof updateSettingsSchema>;

      await tenantService.updateOrganizationSettings(
        orgId,
        settings,
        request.tenant.userId!
      );

      logger.info('Organization settings updated', {
        orgId,
        userId: request.tenant.userId,
        changes: Object.keys(settings),
      });

      return reply.send({ success: true });

    } catch (error: any) {
      logger.error('Failed to update organization settings', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update settings',
      });
    }
  });

  // List organization members
  fastify.get('/v1/organization/members', {
    schema: {
      tags: ['Organizations'],
      summary: 'List organization members',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          role: { type: 'string', enum: ['owner', 'admin', 'member', 'viewer'] },
        },
      },
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'member');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const { page = 1, limit = 20, role } = request.query as any;
      const offset = (page - 1) * limit;

      const where: any = { orgId, status: 'active' };
      if (role) where.role = role;

      const [members, total] = await Promise.all([
        fastify.prisma.organizationUser.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { joinedAt: 'asc' },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
                lastLoginAt: true,
              },
            },
          },
        }),
        fastify.prisma.organizationUser.count({ where }),
      ]);

      return reply.send({
        members: members.map(member => ({
          id: member.id,
          role: member.role,
          status: member.status,
          joinedAt: member.joinedAt,
          user: member.user,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });

    } catch (error: any) {
      logger.error('Failed to list organization members', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch members',
      });
    }
  });

  // Invite user to organization
  fastify.post('/v1/organization/members/invite', {
    schema: {
      tags: ['Organizations'],
      summary: 'Invite user to organization',
      body: inviteUserSchema,
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'admin');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const invitation = request.body as z.infer<typeof inviteUserSchema>;

      const result = await tenantService.inviteUser(
        orgId,
        invitation,
        request.tenant.userId!
      );

      if (result.success) {
        logger.info('User invited to organization', {
          orgId,
          invitedEmail: invitation.email,
          invitedBy: request.tenant.userId,
        });

        return reply.code(201).send({
          success: true,
          userId: result.userId,
        });
      } else {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Failed to invite user',
        });
      }

    } catch (error: any) {
      logger.error('Failed to invite user', { error });
      
      if (error.message.includes('already a member')) {
        return reply.code(409).send({
          error: 'Conflict',
          message: error.message,
        });
      }

      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to send invitation',
      });
    }
  });

  // Update member role
  fastify.put('/v1/organization/members/:userId/role', {
    schema: {
      tags: ['Organizations'],
      summary: 'Update member role',
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
        },
        required: ['userId'],
      },
      body: updateUserRoleSchema,
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'admin');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const { userId } = request.params as { userId: string };
      const { role } = request.body as z.infer<typeof updateUserRoleSchema>;

      // Prevent users from changing their own role
      if (userId === request.tenant.userId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Cannot change your own role',
        });
      }

      // Prevent non-owners from assigning owner role
      if (role === 'owner' && request.userRole !== 'owner') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only owners can assign owner role',
        });
      }

      const updated = await fastify.prisma.organizationUser.update({
        where: {
          orgId_userId: { orgId, userId },
        },
        data: {
          role,
          updatedAt: new Date(),
        },
        include: {
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
      });

      // Create audit log
      await fastify.prisma.auditLog.create({
        data: {
          orgId,
          userId: request.tenant.userId!,
          action: 'member_role_updated',
          resource: 'organization_user',
          resourceId: updated.id,
          details: {
            targetUserId: userId,
            newRole: role,
            targetUserEmail: updated.user.email,
          },
        },
      });

      logger.info('Member role updated', {
        orgId,
        targetUserId: userId,
        newRole: role,
        updatedBy: request.tenant.userId,
      });

      return reply.send({ success: true });

    } catch (error: any) {
      logger.error('Failed to update member role', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update role',
      });
    }
  });

  // Remove member from organization
  fastify.delete('/v1/organization/members/:userId', {
    schema: {
      tags: ['Organizations'],
      summary: 'Remove member from organization',
      params: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
        },
        required: ['userId'],
      },
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'admin');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const { userId } = request.params as { userId: string };

      // Prevent users from removing themselves
      if (userId === request.tenant.userId) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Cannot remove yourself from organization',
        });
      }

      await tenantService.removeUser(orgId, userId, request.tenant.userId!);

      logger.info('Member removed from organization', {
        orgId,
        removedUserId: userId,
        removedBy: request.tenant.userId,
      });

      return reply.send({ success: true });

    } catch (error: any) {
      logger.error('Failed to remove member', { error });
      
      if (error.message.includes('last owner')) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: error.message,
        });
      }

      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to remove member',
      });
    }
  });

  // Get repositories
  fastify.get('/v1/organization/repositories', {
    schema: {
      tags: ['Organizations'],
      summary: 'List organization repositories',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          active: { type: 'boolean' },
          hasActions: { type: 'boolean' },
          search: { type: 'string' },
        },
      },
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'viewer');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const { page = 1, limit = 20, active, hasActions, search } = request.query as any;
      const offset = (page - 1) * limit;

      const where: any = { orgId };
      if (active !== undefined) where.isActive = active;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { fullName: { contains: search, mode: 'insensitive' } },
          { owner: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Filter by Actions if specified
      if (hasActions !== undefined) {
        where.settings = {
          path: ['hasActions'],
          equals: hasActions,
        };
      }

      const [repositories, total] = await Promise.all([
        fastify.prisma.repository.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { updatedAt: 'desc' },
          include: {
            _count: {
              select: {
                checkRuns: true,
                workflowRuns: true,
                testResults: true,
              },
            },
            installation: {
              select: {
                accountLogin: true,
                syncStatus: true,
                lastSyncAt: true,
              },
            },
          },
        }),
        fastify.prisma.repository.count({ where }),
      ]);

      return reply.send({
        repositories: repositories.map(repo => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.fullName,
          owner: repo.owner,
          private: repo.private,
          defaultBranch: repo.defaultBranch,
          isActive: repo.isActive,
          settings: repo.settings,
          checkRunCount: repo._count.checkRuns,
          workflowRunCount: repo._count.workflowRuns,
          testResultCount: repo._count.testResults,
          installation: repo.installation,
          createdAt: repo.createdAt,
          updatedAt: repo.updatedAt,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });

    } catch (error: any) {
      logger.error('Failed to list repositories', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch repositories',
      });
    }
  });

  // Sync repositories
  fastify.post('/v1/organization/repositories/sync', {
    schema: {
      tags: ['Organizations'],
      summary: 'Sync organization repositories',
      body: syncRepositoriesSchema,
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'admin');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const options = request.body as z.infer<typeof syncRepositoriesSchema>;

      // Get organization installations
      const installations = await fastify.prisma.installation.findMany({
        where: { orgId, suspendedAt: null },
      });

      if (installations.length === 0) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'No active installations found',
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

      logger.info('Repository sync triggered', {
        orgId,
        userId: request.tenant.userId,
        installationCount: installations.length,
      });

      return reply.send({ results });

    } catch (error: any) {
      logger.error('Failed to sync repositories', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to sync repositories',
      });
    }
  });

  // Get usage metrics
  fastify.get('/v1/organization/usage', {
    schema: {
      tags: ['Organizations'],
      summary: 'Get organization usage metrics',
      querystring: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['daily', 'monthly'], default: 'monthly' },
        },
      },
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'member');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const { period = 'monthly' } = request.query as any;

      const [usage, quotaStatus] = await Promise.all([
        tenantService.getOrganizationUsage(orgId, period as any),
        tenantService.checkQuotaLimits(orgId),
      ]);

      return reply.send({
        usage,
        quotaStatus,
      });

    } catch (error: any) {
      logger.error('Failed to get usage metrics', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch usage metrics',
      });
    }
  });

  // Get audit logs
  fastify.get('/v1/organization/audit-logs', {
    schema: {
      tags: ['Organizations'],
      summary: 'Get organization audit logs',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          action: { type: 'string' },
          resource: { type: 'string' },
          userId: { type: 'string' },
        },
      },
    },
    preHandler: async (request, reply) => {
      await requireOrgAccess(request, reply, 'admin');
    },
  }, async (request, reply) => {
    try {
      const orgId = request.tenant.orgId;
      const { page = 1, limit = 50, action, resource, userId } = request.query as any;
      const offset = (page - 1) * limit;

      const where: any = { orgId };
      if (action) where.action = { contains: action, mode: 'insensitive' };
      if (resource) where.resource = resource;
      if (userId) where.userId = userId;

      const [logs, total] = await Promise.all([
        fastify.prisma.auditLog.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                email: true,
                name: true,
              },
            },
          },
        }),
        fastify.prisma.auditLog.count({ where }),
      ]);

      return reply.send({
        logs: logs.map(log => ({
          id: log.id,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          details: log.details,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          createdAt: log.createdAt,
          user: log.user,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });

    } catch (error: any) {
      logger.error('Failed to get audit logs', { error });
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch audit logs',
      });
    }
  });

  // Add userRole to FastifyRequest type
  fastify.decorateRequest('userRole', '');
}

declare module 'fastify' {
  interface FastifyRequest {
    userRole?: string;
  }
}

export default organizationRoutes;