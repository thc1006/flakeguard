/**
 * Policy Service
 * 
 * Service layer for policy evaluation and management.
 * Integrates with GitHub authentication and provides
 * high-level policy operations.
 */

import type {
  TestResult,
  PolicyEvaluation,
} from '@flakeguard/shared';
// import type { Octokit } from '@octokit/rest'; // Unused


import { GitHubAuthManager } from '../github/auth.js';
import { logger } from '../utils/logger.js';

import { getPolicyEngine, type PolicyConfig, type PolicyDecision } from './engine.js';

export interface EvaluatePolicyRequest {
  owner: string;
  repo: string;
  tests: TestResult[];
  options?: {
    ref?: string;
    teamContext?: string;
    pullRequestLabels?: string[];
  };
}

export interface EvaluatePolicyResponse {
  success: boolean;
  data?: PolicyEvaluation;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface LoadPolicyRequest {
  owner: string;
  repo: string;
  ref?: string;
}

export interface LoadPolicyResponse {
  success: boolean;
  data?: {
    config: PolicyConfig;
    source: 'file' | 'defaults' | 'env';
    metadata: {
      loadedAt: Date;
      repository: string;
      ref: string;
    };
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Policy service for high-level policy operations
 */
export class PolicyService {
  private readonly authManager: GitHubAuthManager;
  private readonly policyEngine = getPolicyEngine();

  constructor(authManager: GitHubAuthManager) {
    this.authManager = authManager;
  }

  /**
   * Evaluate policy for a set of test results
   */
  async evaluatePolicy(
    request: EvaluatePolicyRequest,
    installationId: number
  ): Promise<EvaluatePolicyResponse> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting policy evaluation', {
        repository: `${request.owner}/${request.repo}`,
        testCount: request.tests.length,
        teamContext: request.options?.teamContext,
        installationId,
      });

      // Get authenticated GitHub client
      const octokit = await this.authManager.getInstallationClient(installationId);
      
      // Validate installation has access to the repository
      const hasAccess = await this.authManager.validateInstallationAccess(
        installationId,
        request.owner,
        request.repo
      );
      
      if (!hasAccess) {
        return {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Installation ${installationId} does not have access to ${request.owner}/${request.repo}`,
          },
        };
      }

      // Load policy configuration
      const policy = await this.policyEngine.loadPolicy(
        octokit,
        request.owner,
        request.repo,
        request.options?.ref
      );

      // Evaluate policy for tests
      const decisions = await this.policyEngine.evaluatePolicy(
        request.tests,
        policy,
        { owner: request.owner, repo: request.repo },
        {
          teamContext: request.options?.teamContext,
          pullRequestLabels: request.options?.pullRequestLabels,
        }
      );

      // Build evaluation summary
      const evaluation: PolicyEvaluation = {
        repositoryId: `${request.owner}/${request.repo}`,
        policySource: 'file', // This would be determined by the engine
        decisions,
        evaluatedAt: new Date(),
        summary: {
          totalTests: decisions.length,
          actionsRecommended: decisions.filter(d => d.action !== 'none').length,
          quarantineCandidates: decisions.filter(d => d.action === 'quarantine').length,
          warnings: decisions.filter(d => d.action === 'warn').length,
        },
      };

      const duration = Date.now() - startTime;
      
      logger.info('Policy evaluation completed successfully', {
        repository: `${request.owner}/${request.repo}`,
        duration,
        ...evaluation.summary,
      });

      return {
        success: true,
        data: evaluation,
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      logger.error('Policy evaluation failed', {
        repository: `${request.owner}/${request.repo}`,
        duration,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: {
          code: this.mapErrorCode(error),
          message: error.message || 'Policy evaluation failed',
          details: {
            duration,
            repository: `${request.owner}/${request.repo}`,
          },
        },
      };
    }
  }

  /**
   * Load policy configuration for a repository
   */
  async loadPolicy(
    request: LoadPolicyRequest,
    installationId: number
  ): Promise<LoadPolicyResponse> {
    try {
      logger.info('Loading policy configuration', {
        repository: `${request.owner}/${request.repo}`,
        ref: request.ref,
        installationId,
      });

      // Get authenticated GitHub client
      const octokit = await this.authManager.getInstallationClient(installationId);
      
      // Validate installation has access to the repository
      const hasAccess = await this.authManager.validateInstallationAccess(
        installationId,
        request.owner,
        request.repo
      );
      
      if (!hasAccess) {
        return {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Installation ${installationId} does not have access to ${request.owner}/${request.repo}`,
          },
        };
      }

      // Load policy configuration
      const config = await this.policyEngine.loadPolicy(
        octokit,
        request.owner,
        request.repo,
        request.ref
      );

      logger.info('Policy configuration loaded successfully', {
        repository: `${request.owner}/${request.repo}`,
        warnThreshold: config.warn_threshold,
        quarantineThreshold: config.flaky_threshold,
      });

      return {
        success: true,
        data: {
          config,
          source: 'file', // This would be determined by the engine
          metadata: {
            loadedAt: new Date(),
            repository: `${request.owner}/${request.repo}`,
            ref: request.ref || 'HEAD',
          },
        },
      };

    } catch (error: any) {
      logger.error('Failed to load policy configuration', {
        repository: `${request.owner}/${request.repo}`,
        error: error.message,
      });

      return {
        success: false,
        error: {
          code: this.mapErrorCode(error),
          message: error.message || 'Failed to load policy configuration',
        },
      };
    }
  }

  /**
   * Invalidate policy cache for a repository
   */
  async invalidatePolicyCache(owner: string, repo: string): Promise<void> {
    logger.info('Invalidating policy cache', { repository: `${owner}/${repo}` });
    this.policyEngine.invalidateCache(owner, repo);
  }

  /**
   * Get policy engine statistics
   */
  getPolicyStats() {
    return this.policyEngine.getCacheStats();
  }

  /**
   * Clean up expired cache entries
   */
  cleanup(): void {
    logger.debug('Cleaning up expired policy cache entries');
    this.policyEngine.clearExpiredCache();
  }

  /**
   * Map error to appropriate error code
   */
  private mapErrorCode(error: any): string {
    if (error.status === 401) {
      return 'UNAUTHORIZED';
    }
    if (error.status === 403) {
      return 'FORBIDDEN';
    }
    if (error.status === 404) {
      return 'NOT_FOUND';
    }
    if (error.status === 422) {
      return 'VALIDATION_ERROR';
    }
    if (error.status >= 500) {
      return 'GITHUB_API_ERROR';
    }
    if (error.name === 'ValidationError' || error.name === 'ZodError') {
      return 'VALIDATION_ERROR';
    }
    return 'INTERNAL_ERROR';
  }
}

/**
 * Create policy service instance
 */
export function createPolicyService(authManager: GitHubAuthManager): PolicyService {
  return new PolicyService(authManager);
}
