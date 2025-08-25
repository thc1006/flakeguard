/**
 * Tenant Management Service
 * 
 * Handles organization onboarding, configuration, user management,
 * and tenant-specific settings and policies.
 */

import { PrismaClient } from '@prisma/client';

import { logger } from '../utils/logger.js';

interface OrganizationConfig {
  name: string;
  slug: string;
  githubLogin?: string;
  domain?: string;
  plan?: 'free' | 'pro' | 'enterprise';
  settings?: Record<string, any>;
}

interface UserInvitation {
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  name?: string;
}

interface TenantQuotas {
  maxRepositories: number;
  maxTestRuns: number;
  maxApiCalls: number;
  maxStorageMB: number;
  retentionDays: number;
}

interface TenantSettings {
  defaultFlakeThreshold: number;
  autoQuarantineEnabled: boolean;
  slackIntegration?: {
    enabled: boolean;
    channelId?: string;
    notificationTypes: string[];
  };
  notifications: {
    email: boolean;
    slack: boolean;
    webhook?: string;
  };
  policies: {
    excludePaths: string[];
    includeOnly: string[];
    quarantineRules: Array<{
      threshold: number;
      minOccurrences: number;
      timeWindow: string;
    }>;
  };
}

/**
 * Tenant management service for multi-tenant operations
 */
export class TenantManagementService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create new organization tenant
   */
  async createOrganization(
    config: OrganizationConfig,
    ownerUser: { id: string; email: string; name?: string }
  ): Promise<{
    organization: any;
    installation?: any;
  }> {
    try {
      logger.info('Creating new organization', {
        slug: config.slug,
        ownerId: ownerUser.id,
      });

      // Check if slug is available
      const existingOrg = await this.prisma.organization.findUnique({
        where: { slug: config.slug },
      });

      if (existingOrg) {
        throw new Error(`Organization slug '${config.slug}' is already taken`);
      }

      // Get default quotas for plan
      const quotas = this.getDefaultQuotas(config.plan || 'free');
      const settings = this.getDefaultSettings();

      const result = await this.prisma.$transaction(async (tx) => {
        // Create organization
        const organization = await tx.organization.create({
          data: {
            name: config.name,
            slug: config.slug,
            githubLogin: config.githubLogin,
            domain: config.domain,
            plan: config.plan || 'free',
            settings: {
              ...settings,
              ...config.settings,
              quotas,
            },
            status: 'active',
          },
        });

        // Add owner to organization
        await tx.organizationUser.create({
          data: {
            orgId: organization.id,
            userId: ownerUser.id,
            role: 'owner',
            status: 'active',
          },
        });

        // Create initial subscription record
        await tx.subscription.create({
          data: {
            orgId: organization.id,
            plan: config.plan || 'free',
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            orgId: organization.id,
            userId: ownerUser.id,
            action: 'organization_created',
            resource: 'organization',
            resourceId: organization.id,
            details: {
              name: config.name,
              slug: config.slug,
              plan: config.plan,
            },
          },
        });

        return { organization };
      });

      logger.info('Organization created successfully', {
        orgId: result.organization.id,
        slug: config.slug,
      });

      return result;

    } catch (error: any) {
      logger.error('Failed to create organization', {
        error: error.message,
        config,
      });
      throw error;
    }
  }

  /**
   * Update organization settings
   */
  async updateOrganizationSettings(
    orgId: string,
    settings: Partial<TenantSettings>,
    updatedBy: string
  ): Promise<void> {
    try {
      const organization = await this.prisma.organization.findUnique({
        where: { id: orgId },
      });

      if (!organization) {
        throw new Error('Organization not found');
      }

      const currentSettings = organization.settings as any;
      const newSettings = {
        ...currentSettings,
        ...settings,
      };

      await this.prisma.$transaction(async (tx) => {
        // Update organization settings
        await tx.organization.update({
          where: { id: orgId },
          data: {
            settings: newSettings,
            updatedAt: new Date(),
          },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            orgId,
            userId: updatedBy,
            action: 'organization_settings_updated',
            resource: 'organization',
            resourceId: orgId,
            details: {
              changes: settings,
              previous: currentSettings,
            },
          },
        });
      });

      logger.info('Organization settings updated', {
        orgId,
        updatedBy,
        changes: Object.keys(settings),
      });

    } catch (error: any) {
      logger.error('Failed to update organization settings', {
        error: error.message,
        orgId,
      });
      throw error;
    }
  }

  /**
   * Invite user to organization
   */
  async inviteUser(
    orgId: string,
    invitation: UserInvitation,
    invitedBy: string
  ): Promise<{ success: boolean; userId?: string }> {
    try {
      logger.info('Inviting user to organization', {
        orgId,
        email: invitation.email,
        role: invitation.role,
      });

      // Check if user already exists
      let user = await this.prisma.user.findUnique({
        where: { email: invitation.email },
      });

      await this.prisma.$transaction(async (tx) => {
        // Create user if doesn't exist
        if (!user) {
          user = await tx.user.create({
            data: {
              email: invitation.email,
              name: invitation.name,
              status: 'active',
            },
          });
        }

        // Check if already a member
        const existingMembership = await tx.organizationUser.findUnique({
          where: {
            orgId_userId: {
              orgId,
              userId: user.id,
            },
          },
        });

        if (existingMembership) {
          if (existingMembership.status === 'active') {
            throw new Error('User is already a member of this organization');
          }
          
          // Reactivate if previously suspended
          await tx.organizationUser.update({
            where: {
              orgId_userId: {
                orgId,
                userId: user.id,
              },
            },
            data: {
              role: invitation.role,
              status: 'active',
            },
          });
        } else {
          // Create new membership
          await tx.organizationUser.create({
            data: {
              orgId,
              userId: user.id,
              role: invitation.role,
              status: 'active',
            },
          });
        }

        // Create audit log
        await tx.auditLog.create({
          data: {
            orgId,
            userId: invitedBy,
            action: 'user_invited',
            resource: 'organization_user',
            details: {
              invitedUserId: user.id,
              email: invitation.email,
              role: invitation.role,
            },
          },
        });
      });

      logger.info('User invited successfully', {
        orgId,
        userId: user.id,
        email: invitation.email,
      });

      return { success: true, userId: user.id };

    } catch (error: any) {
      logger.error('Failed to invite user', {
        error: error.message,
        orgId,
        email: invitation.email,
      });
      return { success: false };
    }
  }

  /**
   * Remove user from organization
   */
  async removeUser(
    orgId: string,
    userId: string,
    removedBy: string
  ): Promise<void> {
    try {
      // Verify user is not the last owner
      const owners = await this.prisma.organizationUser.count({
        where: {
          orgId,
          role: 'owner',
          status: 'active',
        },
      });

      const userToRemove = await this.prisma.organizationUser.findUnique({
        where: {
          orgId_userId: { orgId, userId },
        },
      });

      if (userToRemove?.role === 'owner' && owners <= 1) {
        throw new Error('Cannot remove the last owner from organization');
      }

      await this.prisma.$transaction(async (tx) => {
        // Update user status to suspended
        await tx.organizationUser.update({
          where: {
            orgId_userId: { orgId, userId },
          },
          data: {
            status: 'suspended',
            updatedAt: new Date(),
          },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            orgId,
            userId: removedBy,
            action: 'user_removed',
            resource: 'organization_user',
            details: {
              removedUserId: userId,
            },
          },
        });
      });

      logger.info('User removed from organization', {
        orgId,
        userId,
        removedBy,
      });

    } catch (error: any) {
      logger.error('Failed to remove user', {
        error: error.message,
        orgId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Get organization usage metrics
   */
  async getOrganizationUsage(
    orgId: string,
    period: 'daily' | 'monthly' = 'monthly'
  ): Promise<{
    repositories: number;
    testRuns: number;
    apiCalls: number;
    storage: number;
    quotas: TenantQuotas;
    usage: Array<{
      metricType: string;
      value: number;
      date: Date;
    }>;
  }> {
    try {
      const organization = await this.prisma.organization.findUnique({
        where: { id: orgId },
      });

      if (!organization) {
        throw new Error('Organization not found');
      }

      const quotas = (organization.settings as any)?.quotas || this.getDefaultQuotas('free');

      // Get current usage
      const repositories = await this.prisma.repository.count({
        where: { orgId, isActive: true },
      });

      // Get usage metrics for the current period
      const currentDate = new Date();
      const startDate = period === 'daily' 
        ? new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
        : new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

      const usageMetrics = await this.prisma.usageMetric.findMany({
        where: {
          orgId,
          period,
          date: {
            gte: startDate,
          },
        },
        orderBy: { date: 'desc' },
      });

      // Calculate totals
      const testRuns = usageMetrics
        .filter(m => m.metricType === 'test_runs')
        .reduce((sum, m) => sum + m.value, 0);

      const apiCalls = usageMetrics
        .filter(m => m.metricType === 'api_calls')
        .reduce((sum, m) => sum + m.value, 0);

      const storage = usageMetrics
        .filter(m => m.metricType === 'storage_mb')
        .reduce((sum, m) => Math.max(sum, m.value), 0);

      return {
        repositories,
        testRuns,
        apiCalls,
        storage,
        quotas,
        usage: usageMetrics.map(m => ({
          metricType: m.metricType,
          value: m.value,
          date: m.date,
        })),
      };

    } catch (error: any) {
      logger.error('Failed to get organization usage', {
        error: error.message,
        orgId,
      });
      throw error;
    }
  }

  /**
   * Check if organization has exceeded quotas
   */
  async checkQuotaLimits(orgId: string): Promise<{
    exceeded: boolean;
    violations: Array<{
      metric: string;
      current: number;
      limit: number;
      percentage: number;
    }>;
  }> {
    try {
      const usage = await this.getOrganizationUsage(orgId);
      const violations = [];

      // Check repository limit
      if (usage.repositories > usage.quotas.maxRepositories) {
        violations.push({
          metric: 'repositories',
          current: usage.repositories,
          limit: usage.quotas.maxRepositories,
          percentage: (usage.repositories / usage.quotas.maxRepositories) * 100,
        });
      }

      // Check test runs limit
      if (usage.testRuns > usage.quotas.maxTestRuns) {
        violations.push({
          metric: 'test_runs',
          current: usage.testRuns,
          limit: usage.quotas.maxTestRuns,
          percentage: (usage.testRuns / usage.quotas.maxTestRuns) * 100,
        });
      }

      // Check API calls limit
      if (usage.apiCalls > usage.quotas.maxApiCalls) {
        violations.push({
          metric: 'api_calls',
          current: usage.apiCalls,
          limit: usage.quotas.maxApiCalls,
          percentage: (usage.apiCalls / usage.quotas.maxApiCalls) * 100,
        });
      }

      // Check storage limit
      if (usage.storage > usage.quotas.maxStorageMB) {
        violations.push({
          metric: 'storage',
          current: usage.storage,
          limit: usage.quotas.maxStorageMB,
          percentage: (usage.storage / usage.quotas.maxStorageMB) * 100,
        });
      }

      return {
        exceeded: violations.length > 0,
        violations,
      };

    } catch (error: any) {
      logger.error('Failed to check quota limits', {
        error: error.message,
        orgId,
      });
      throw error;
    }
  }

  /**
   * Get default quotas for plan
   */
  private getDefaultQuotas(plan: string): TenantQuotas {
    const quotas = {
      free: {
        maxRepositories: 5,
        maxTestRuns: 1000,
        maxApiCalls: 10000,
        maxStorageMB: 100,
        retentionDays: 30,
      },
      pro: {
        maxRepositories: 50,
        maxTestRuns: 10000,
        maxApiCalls: 100000,
        maxStorageMB: 1000,
        retentionDays: 90,
      },
      enterprise: {
        maxRepositories: -1, // Unlimited
        maxTestRuns: -1,
        maxApiCalls: -1,
        maxStorageMB: -1,
        retentionDays: 365,
      },
    };

    return quotas[plan as keyof typeof quotas] || quotas.free;
  }

  /**
   * Get default settings for new organization
   */
  private getDefaultSettings(): TenantSettings {
    return {
      defaultFlakeThreshold: 0.3,
      autoQuarantineEnabled: false,
      notifications: {
        email: true,
        slack: false,
      },
      policies: {
        excludePaths: [
          '**/node_modules/**',
          '**/vendor/**',
          '**/.git/**',
        ],
        includeOnly: [],
        quarantineRules: [
          {
            threshold: 0.6,
            minOccurrences: 3,
            timeWindow: '7d',
          },
        ],
      },
    };
  }
}

/**
 * Create tenant management service
 */
export function createTenantManagementService(
  prisma: PrismaClient
): TenantManagementService {
  return new TenantManagementService(prisma);
}

export type { 
  OrganizationConfig, 
  UserInvitation, 
  TenantQuotas, 
  TenantSettings 
};