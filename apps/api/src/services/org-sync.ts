/**
 * Organization Sync Service
 * 
 * Automated discovery and registration of repositories with GitHub Actions enabled.
 * Handles org-wide sync jobs, webhook management, and repository lifecycle.
 */

import { Octokit } from '@octokit/rest';
import { PrismaClient } from '@prisma/client';
import { minimatch } from 'minimatch';

import { GitHubAuthManager } from '../github/auth.js';
import { logger } from '../utils/logger.js';

interface SyncOptions {
  installationId: string;
  orgId: string;
  fullSync?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  enabledOnly?: boolean;
}

interface RepositoryDiscovery {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  hasActions: boolean;
  isActive: boolean;
  lastActivity?: Date;
  workflowFiles: string[];
}

interface SyncResult {
  success: boolean;
  discovered: number;
  registered: number;
  updated: number;
  deactivated: number;
  errors: string[];
  duration: number;
}

/**
 * Organization repository synchronization service
 */
export class OrganizationSyncService {
  constructor(
    private prisma: PrismaClient,
    private authManager: GitHubAuthManager
  ) {}

  /**
   * Perform full organization sync
   */
  async syncOrganization(options: SyncOptions): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      discovered: 0,
      registered: 0,
      updated: 0,
      deactivated: 0,
      errors: [],
      duration: 0,
    };

    try {
      logger.info('Starting organization sync', options);

      // Validate installation and organization
      const installation = await this.validateInstallation(options.installationId, options.orgId);
      if (!installation) {
        result.errors.push('Invalid installation or organization');
        return result;
      }

      // Get GitHub client for installation
      const octokit = await this.authManager.getInstallationClient(
        installation.githubInstallationId
      );

      // Discover repositories
      const repositories = await this.discoverRepositories(
        octokit,
        installation,
        options
      );
      result.discovered = repositories.length;

      // Process discovered repositories
      const processed = await this.processRepositories(
        repositories,
        options.orgId,
        options.installationId
      );

      result.registered = processed.registered;
      result.updated = processed.updated;

      // Deactivate repositories that are no longer accessible
      if (options.fullSync) {
        result.deactivated = await this.deactivateRemovedRepositories(
          options.orgId,
          options.installationId,
          repositories.map(r => r.id)
        );
      }

      // Update installation sync status
      await this.updateInstallationSyncStatus(options.installationId, 'active');

      result.success = true;
      logger.info('Organization sync completed successfully', {
        ...options,
        result,
      });

    } catch (error: any) {
      logger.error('Organization sync failed', {
        error: error.message,
        stack: error.stack,
        options,
      });
      result.errors.push(error.message);
    } finally {
      result.duration = Date.now() - startTime;
    }

    return result;
  }

  /**
   * Validate installation and organization
   */
  private async validateInstallation(installationId: string, orgId: string) {
    try {
      const installation = await this.prisma.installation.findUnique({
        where: { 
          id: installationId,
          orgId,
          suspendedAt: null,
        },
        include: { organization: true },
      });

      if (!installation) {
        logger.error('Installation not found or suspended', {
          installationId,
          orgId,
        });
        return null;
      }

      if (installation.organization.status !== 'active') {
        logger.error('Organization is not active', {
          orgId,
          status: installation.organization.status,
        });
        return null;
      }

      return installation;
    } catch (error) {
      logger.error('Failed to validate installation', { error });
      return null;
    }
  }

  /**
   * Discover repositories with GitHub Actions
   */
  private async discoverRepositories(
    octokit: Octokit,
    installation: any,
    options: SyncOptions
  ): Promise<RepositoryDiscovery[]> {
    const repositories: RepositoryDiscovery[] = [];

    try {
      // Get installation repositories
      const { data: installationRepos } = await octokit.rest.apps.listReposAccessibleToInstallation();

      for (const repo of installationRepos.repositories || []) {
        try {
          // Check include/exclude patterns
          if (!this.shouldIncludeRepository(repo.full_name, options)) {
            logger.debug('Repository excluded by patterns', {
              repo: repo.full_name,
            });
            continue;
          }

          // Check if repository has GitHub Actions enabled
          const hasActions = await this.checkActionsEnabled(octokit, repo.owner.login, repo.name);
          
          if (options.enabledOnly && !hasActions) {
            logger.debug('Repository skipped: Actions not enabled', {
              repo: repo.full_name,
            });
            continue;
          }

          // Get workflow files
          const workflowFiles = hasActions 
            ? await this.getWorkflowFiles(octokit, repo.owner.login, repo.name)
            : [];

          repositories.push({
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            owner: repo.owner.login,
            private: repo.private,
            defaultBranch: repo.default_branch,
            hasActions,
            isActive: !repo.archived && !repo.disabled,
            lastActivity: repo.pushed_at ? new Date(repo.pushed_at) : undefined,
            workflowFiles,
          });

        } catch (error: any) {
          logger.warn('Failed to process repository', {
            repo: repo.full_name,
            error: error.message,
          });
        }
      }

      logger.info('Repository discovery completed', {
        total: installationRepos.repositories?.length || 0,
        discovered: repositories.length,
        installation: installation.id,
      });

    } catch (error: any) {
      logger.error('Failed to discover repositories', {
        error: error.message,
        installation: installation.id,
      });
      throw error;
    }

    return repositories;
  }

  /**
   * Check if repository should be included based on patterns
   */
  private shouldIncludeRepository(repoFullName: string, options: SyncOptions): boolean {
    const { includePatterns = ['*'], excludePatterns = [] } = options;

    // Check exclude patterns first
    for (const pattern of excludePatterns) {
      if (minimatch(repoFullName, pattern)) {
        return false;
      }
    }

    // Check include patterns
    for (const pattern of includePatterns) {
      if (minimatch(repoFullName, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if repository has GitHub Actions enabled
   */
  private async checkActionsEnabled(
    octokit: Octokit,
    owner: string,
    repo: string
  ): Promise<boolean> {
    try {
      // Try to access Actions API
      await octokit.rest.actions.listRepoWorkflows({
        owner,
        repo,
        per_page: 1,
      });
      return true;
    } catch (error: any) {
      if (error.status === 404) {
        return false; // Actions not enabled
      }
      logger.warn('Failed to check Actions status', {
        repo: `${owner}/${repo}`,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Get workflow files in repository
   */
  private async getWorkflowFiles(
    octokit: Octokit,
    owner: string,
    repo: string
  ): Promise<string[]> {
    try {
      const { data } = await octokit.rest.actions.listRepoWorkflows({
        owner,
        repo,
      });

      return data.workflows.map(workflow => workflow.path);
    } catch (error) {
      logger.warn('Failed to get workflow files', {
        repo: `${owner}/${repo}`,
        error,
      });
      return [];
    }
  }

  /**
   * Process discovered repositories
   */
  private async processRepositories(
    repositories: RepositoryDiscovery[],
    orgId: string,
    installationId: string
  ): Promise<{ registered: number; updated: number }> {
    let registered = 0;
    let updated = 0;

    for (const repo of repositories) {
      try {
        const existingRepo = await this.prisma.repository.findUnique({
          where: { githubId: repo.id },
        });

        if (existingRepo) {
          // Update existing repository
          await this.prisma.repository.update({
            where: { id: existingRepo.id },
            data: {
              name: repo.name,
              fullName: repo.fullName,
              owner: repo.owner,
              private: repo.private,
              defaultBranch: repo.defaultBranch,
              isActive: repo.isActive,
              settings: {
                hasActions: repo.hasActions,
                workflowFiles: repo.workflowFiles,
                lastActivity: repo.lastActivity?.toISOString(),
              },
              updatedAt: new Date(),
            },
          });
          updated++;
        } else {
          // Register new repository
          await this.prisma.repository.create({
            data: {
              orgId,
              githubId: repo.id,
              nodeId: `repo_${repo.id}`, // Placeholder
              name: repo.name,
              fullName: repo.fullName,
              owner: repo.owner,
              private: repo.private,
              defaultBranch: repo.defaultBranch,
              installationId,
              isActive: repo.isActive,
              settings: {
                hasActions: repo.hasActions,
                workflowFiles: repo.workflowFiles,
                lastActivity: repo.lastActivity?.toISOString(),
              },
            },
          });
          registered++;
        }

        // Create audit log entry
        await this.prisma.auditLog.create({
          data: {
            orgId,
            action: existingRepo ? 'repository_updated' : 'repository_registered',
            resource: 'repository',
            resourceId: existingRepo?.id,
            details: {
              githubId: repo.id,
              fullName: repo.fullName,
              hasActions: repo.hasActions,
              workflowCount: repo.workflowFiles.length,
            },
          },
        });

      } catch (error: any) {
        logger.error('Failed to process repository', {
          repo: repo.fullName,
          error: error.message,
        });
      }
    }

    return { registered, updated };
  }

  /**
   * Deactivate repositories that are no longer accessible
   */
  private async deactivateRemovedRepositories(
    orgId: string,
    installationId: string,
    activeRepoIds: number[]
  ): Promise<number> {
    try {
      const result = await this.prisma.repository.updateMany({
        where: {
          orgId,
          installationId,
          githubId: {
            notIn: activeRepoIds,
          },
          isActive: true,
        },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      if (result.count > 0) {
        await this.prisma.auditLog.create({
          data: {
            orgId,
            action: 'repositories_deactivated',
            resource: 'repository',
            details: {
              count: result.count,
              reason: 'no_longer_accessible',
            },
          },
        });
      }

      return result.count;
    } catch (error) {
      logger.error('Failed to deactivate removed repositories', { error });
      return 0;
    }
  }

  /**
   * Update installation sync status
   */
  private async updateInstallationSyncStatus(
    installationId: string,
    status: string
  ) {
    try {
      await this.prisma.installation.update({
        where: { id: installationId },
        data: {
          syncStatus: status,
          lastSyncAt: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to update installation sync status', {
        installationId,
        error,
      });
    }
  }

  /**
   * Schedule periodic sync for organization
   */
  async schedulePeriodicSync(
    orgId: string,
    installationId: string,
    intervalHours = 6
  ) {
    // This would typically integrate with a job queue like BullMQ
    // For now, we'll log the intent
    logger.info('Periodic sync scheduled', {
      orgId,
      installationId,
      intervalHours,
    });

    // TODO: Implement with job queue
    // await this.jobQueue.add('org-sync', {
    //   orgId,
    //   installationId,
    //   fullSync: false,
    //   enabledOnly: true,
    // }, {
    //   repeat: { every: intervalHours * 60 * 60 * 1000 },
    //   removeOnComplete: 10,
    //   removeOnFail: 5,
    // });
  }

  /**
   * Get sync status for organization
   */
  async getSyncStatus(orgId: string): Promise<{
    installations: Array<{
      id: string;
      accountLogin: string;
      syncStatus: string;
      lastSyncAt?: Date;
      repositoryCount: number;
    }>;
    totalRepositories: number;
    activeRepositories: number;
  }> {
    const installations = await this.prisma.installation.findMany({
      where: { orgId },
      include: {
        _count: {
          select: { repositories: true },
        },
      },
    });

    const totalRepositories = await this.prisma.repository.count({
      where: { orgId },
    });

    const activeRepositories = await this.prisma.repository.count({
      where: { 
        orgId,
        isActive: true,
      },
    });

    return {
      installations: installations.map(inst => ({
        id: inst.id,
        accountLogin: inst.accountLogin,
        syncStatus: inst.syncStatus,
        lastSyncAt: inst.lastSyncAt || undefined,
        repositoryCount: inst._count.repositories,
      })),
      totalRepositories,
      activeRepositories,
    };
  }

  /**
   * Trigger manual sync for specific installation
   */
  async triggerManualSync(
    orgId: string,
    installationId: string,
    options: Partial<SyncOptions> = {}
  ): Promise<SyncResult> {
    return this.syncOrganization({
      orgId,
      installationId,
      fullSync: true,
      enabledOnly: true,
      ...options,
    });
  }
}

/**
 * Create organization sync service instance
 */
export function createOrgSyncService(
  prisma: PrismaClient,
  authManager: GitHubAuthManager
): OrganizationSyncService {
  return new OrganizationSyncService(prisma, authManager);
}

export type { SyncOptions, RepositoryDiscovery, SyncResult };