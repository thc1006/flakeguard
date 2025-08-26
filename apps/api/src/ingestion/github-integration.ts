/**
 * GitHub Artifacts API Integration Service
 * 
 * Provides comprehensive integration with GitHub Actions artifacts API including:
 * - Artifact listing with intelligent filtering for test results
 * - Temporary download URL generation with expiration handling
 * - Streaming download management with retry logic
 * - Integration with existing GitHub authentication and helpers
 * - Rate limiting and error handling for production use
 */

import type { Octokit } from '@octokit/rest';
import type { PrismaClient } from '@prisma/client';

import { GitHubAuthManager } from '../github/auth.js';
import { GitHubHelpers } from '../github/helpers.js';
import { logger } from '../utils/logger.js';

import { JUnitIngestionService } from './junit.js';
import type {
  ArtifactSource,
  RepositoryContext,
  IngestionParameters,
  IngestionResult
} from './types.js';
import {
  sanitizeFileName,
  generateCorrelationId
} from './utils.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * GitHub artifact metadata from API
 */
export interface GitHubArtifact {
  readonly id: number;
  readonly name: string;
  readonly size_in_bytes: number;
  readonly url: string;
  readonly archive_download_url: string;
  readonly expired: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly expires_at: string;
  readonly node_id: string;
  readonly workflow_run?: {
    readonly id: number;
    readonly repository_id: number;
    readonly head_repository_id: number;
  };
}

/**
 * Artifact filtering criteria
 */
export interface ArtifactFilter {
  readonly namePatterns?: readonly string[];
  readonly extensions?: readonly string[];
  readonly maxSizeBytes?: number;
  readonly minSizeBytes?: number;
  readonly notExpired?: boolean;
}

/**
 * Workflow artifacts response
 */
export interface WorkflowArtifactsResponse {
  readonly artifacts: readonly GitHubArtifact[];
  readonly totalCount: number;
  readonly hasMore: boolean;
}

/**
 * Download URL with metadata
 */
export interface ArtifactDownloadInfo {
  readonly artifactId: number;
  readonly name: string;
  readonly downloadUrl: string;
  readonly sizeInBytes: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * Ingestion job configuration
 */
export interface IngestionJobConfig {
  readonly workflowRunId: number;
  readonly repository: RepositoryContext;
  readonly installationId: number;
  readonly filter?: ArtifactFilter;
  readonly correlationId?: string;
  readonly priority?: 'low' | 'normal' | 'high' | 'critical';
}

/**
 * Ingestion job result
 */
export interface IngestionJobResult {
  readonly jobId: string;
  readonly success: boolean;
  readonly processedArtifacts: number;
  readonly totalTests: number;
  readonly totalFailures: number;
  readonly totalErrors: number;
  readonly processingTimeMs: number;
  readonly errors: readonly string[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ARTIFACT_FILTER: Required<ArtifactFilter> = {
  namePatterns: ['test-results', 'junit', 'test-report', 'surefire-reports'],
  extensions: ['.xml', '.zip'],
  maxSizeBytes: 100 * 1024 * 1024, // 100MB
  minSizeBytes: 0,
  notExpired: true
} as const;

const GITHUB_API_LIMITS = {
  maxArtifactsPerRequest: 100,
  maxConcurrentDownloads: 5,
  downloadTimeoutMs: 10 * 60 * 1000, // 10 minutes
  retryDelayMs: 1000,
  maxRetries: 3
} as const;

// ============================================================================
// GitHub Artifacts Integration Service
// ============================================================================

export class GitHubArtifactsIntegration {
  private readonly authManager: GitHubAuthManager;
  // @ts-ignore: Unused but may be used in future
  private readonly _helpers: GitHubHelpers;
  private readonly ingestionService: JUnitIngestionService;
  private readonly prisma: PrismaClient;

  constructor(
    authManager: GitHubAuthManager,
    helpers: GitHubHelpers,
    ingestionService: JUnitIngestionService,
    prisma: PrismaClient
  ) {
    this.authManager = authManager;
    this._helpers = helpers;
    this.ingestionService = ingestionService;
    this.prisma = prisma;
  }

  // ==========================================================================
  // Artifact Discovery and Filtering
  // ==========================================================================

  /**
   * List and filter artifacts for a workflow run
   */
  async listWorkflowArtifacts(
    owner: string,
    repo: string,
    workflowRunId: number,
    installationId: number,
    filter: ArtifactFilter = {}
  ): Promise<WorkflowArtifactsResponse> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      logger.info('Listing workflow artifacts', {
        owner,
        repo,
        workflowRunId,
        filter
      });

      // Get all artifacts for the workflow run
      const artifacts = await this.fetchAllArtifacts(
        client,
        owner,
        repo,
        workflowRunId
      );

      // Apply filters
      const filteredArtifacts = this.filterArtifacts(artifacts, {
        ...DEFAULT_ARTIFACT_FILTER,
        ...filter
      });

      logger.info('Artifacts filtered', {
        total: artifacts.length,
        filtered: filteredArtifacts.length,
        workflowRunId
      });

      return {
        artifacts: filteredArtifacts,
        totalCount: filteredArtifacts.length,
        hasMore: false // GitHub API handles pagination internally
      };

    } catch (error: any) {
      logger.error('Failed to list workflow artifacts', {
        owner,
        repo,
        workflowRunId,
        error: error.message
      });
      throw new Error(`Failed to list artifacts: ${error.message}`);
    }
  }

  /**
   * Fetch all artifacts with pagination handling
   */
  private async fetchAllArtifacts(
    client: Octokit,
    owner: string,
    repo: string,
    workflowRunId: number
  ): Promise<GitHubArtifact[]> {
    const artifacts: GitHubArtifact[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data } = await client.rest.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: workflowRunId,
        per_page: GITHUB_API_LIMITS.maxArtifactsPerRequest,
        page
      });

      artifacts.push(...data.artifacts as GitHubArtifact[]);
      
      hasMore = data.artifacts.length === GITHUB_API_LIMITS.maxArtifactsPerRequest;
      page++;
    }

    return artifacts;
  }

  /**
   * Filter artifacts based on criteria
   */
  private filterArtifacts(
    artifacts: GitHubArtifact[],
    filter: Required<ArtifactFilter>
  ): GitHubArtifact[] {
    return artifacts.filter(artifact => {
      // Check if expired
      if (filter.notExpired && artifact.expired) {
        return false;
      }

      // Check size limits
      if (artifact.size_in_bytes < filter.minSizeBytes) {
        return false;
      }
      if (artifact.size_in_bytes > filter.maxSizeBytes) {
        return false;
      }

      // Check name patterns
      const nameMatches = filter.namePatterns.some(pattern => 
        artifact.name.toLowerCase().includes(pattern.toLowerCase())
      );

      // Check extensions
      const extensionMatches = filter.extensions.some(ext => 
        artifact.name.toLowerCase().endsWith(ext.toLowerCase())
      );

      return nameMatches && extensionMatches;
    });
  }

  // ==========================================================================
  // Download URL Management
  // ==========================================================================

  /**
   * Generate temporary download URLs for artifacts
   */
  async generateDownloadUrls(
    owner: string,
    repo: string,
    artifactIds: readonly number[],
    installationId: number
  ): Promise<readonly ArtifactDownloadInfo[]> {
    const downloadInfos: ArtifactDownloadInfo[] = [];

    try {
      const client = await this.authManager.getInstallationClient(installationId);

      // Process artifacts in batches to avoid rate limiting
      const batches = this.createBatches(artifactIds, GITHUB_API_LIMITS.maxConcurrentDownloads);

      for (const batch of batches) {
        const batchPromises = batch.map(async (artifactId) => {
          try {
            const { data: artifact } = await client.rest.actions.getArtifact({
              owner,
              repo,
              artifact_id: artifactId
            });

            if (artifact.expired) {
              logger.warn('Artifact has expired', { artifactId, name: artifact.name });
              return null;
            }

            return {
              artifactId: artifact.id,
              name: artifact.name,
              downloadUrl: artifact.archive_download_url,
              sizeInBytes: artifact.size_in_bytes,
              expiresAt: new Date(artifact.expires_at || Date.now() + 60 * 60 * 1000), // Default to 1 hour if null
              createdAt: new Date(artifact.created_at || Date.now()) // Default to now if null
            } as ArtifactDownloadInfo;
          } catch (error: any) {
            logger.error('Failed to get artifact download URL', {
              artifactId,
              error: error.message
            });
            return null;
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);
        const validResults = batchResults
          .filter((result): result is PromiseFulfilledResult<ArtifactDownloadInfo | null> => 
            result.status === 'fulfilled' && result.value !== null
          )
          .map(result => result.value!);

        downloadInfos.push(...validResults);
      }

      logger.info('Generated download URLs', {
        requested: artifactIds.length,
        generated: downloadInfos.length
      });

      return downloadInfos;

    } catch (error: any) {
      logger.error('Failed to generate download URLs', {
        owner,
        repo,
        artifactIds: artifactIds.length,
        error: error.message
      });
      throw new Error(`Failed to generate download URLs: ${error.message}`);
    }
  }

  /**
   * Create batches from array
   */
  private createBatches<T>(items: readonly T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  // ==========================================================================
  // High-Level Ingestion Methods
  // ==========================================================================

  /**
   * Process workflow run artifacts for JUnit ingestion
   */
  async processWorkflowArtifacts(
    config: IngestionJobConfig
  ): Promise<IngestionJobResult> {
    const startTime = Date.now();
    const correlationId = config.correlationId || generateCorrelationId();
    
    logger.info('Starting workflow artifact processing', {
      correlationId,
      workflowRunId: config.workflowRunId,
      repository: config.repository
    });

    try {
      // List and filter artifacts
      const artifactsResponse = await this.listWorkflowArtifacts(
        config.repository.owner,
        config.repository.repo,
        config.workflowRunId,
        config.installationId,
        config.filter
      );

      if (artifactsResponse.artifacts.length === 0) {
        logger.info('No test artifacts found for workflow run', {
          correlationId,
          workflowRunId: config.workflowRunId
        });

        return {
          jobId: correlationId,
          success: true,
          processedArtifacts: 0,
          totalTests: 0,
          totalFailures: 0,
          totalErrors: 0,
          processingTimeMs: Date.now() - startTime,
          errors: []
        };
      }

      // Generate download URLs
      const downloadInfos = await this.generateDownloadUrls(
        config.repository.owner,
        config.repository.repo,
        artifactsResponse.artifacts.map(a => a.id),
        config.installationId
      );

      if (downloadInfos.length === 0) {
        return {
          jobId: correlationId,
          success: false,
          processedArtifacts: 0,
          totalTests: 0,
          totalFailures: 0,
          totalErrors: 0,
          processingTimeMs: Date.now() - startTime,
          errors: ['No valid download URLs generated']
        };
      }

      // Convert to artifact sources for ingestion
      const artifactSources: ArtifactSource[] = downloadInfos.map(info => ({
        url: info.downloadUrl,
        name: sanitizeFileName(info.name),
        downloadUrl: info.downloadUrl,
        sizeInBytes: info.sizeInBytes,
        expiresAt: info.expiresAt
      }));

      // Perform ingestion
      const ingestionParameters: IngestionParameters = {
        correlationId,
        config: {
          repository: config.repository,
          artifacts: artifactSources,
          maxFileSizeBytes: DEFAULT_ARTIFACT_FILTER.maxSizeBytes,
          timeoutMs: GITHUB_API_LIMITS.downloadTimeoutMs,
          concurrency: GITHUB_API_LIMITS.maxConcurrentDownloads
        }
      };

      const result = await this.ingestionService.ingest(ingestionParameters);

      // Store ingestion record in database
      await this.storeIngestionRecord(config, result);

      const processingTime = Date.now() - startTime;

      logger.info('Workflow artifact processing completed', {
        correlationId,
        success: result.success,
        processedArtifacts: result.results.length,
        totalTests: result.stats.totalTests,
        processingTime
      });

      return {
        jobId: correlationId,
        success: result.success,
        processedArtifacts: result.results.length,
        totalTests: result.stats.totalTests,
        totalFailures: result.stats.totalFailures,
        totalErrors: result.stats.totalErrors,
        processingTimeMs: processingTime,
        errors: result.errors.map(e => e.message)
      };

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      
      logger.error('Workflow artifact processing failed', {
        correlationId,
        workflowRunId: config.workflowRunId,
        error: error.message,
        processingTime
      });

      return {
        jobId: correlationId,
        success: false,
        processedArtifacts: 0,
        totalTests: 0,
        totalFailures: 0,
        totalErrors: 0,
        processingTimeMs: processingTime,
        errors: [error.message]
      };
    }
  }

  /**
   * Quick artifact processing for immediate use
   */
  async quickProcessArtifacts(
    owner: string,
    repo: string,
    workflowRunId: number,
    installationId: number,
    filter?: ArtifactFilter
  ): Promise<IngestionResult> {
    const repository: RepositoryContext = { owner, repo };
    const config: IngestionJobConfig = {
      workflowRunId,
      repository,
      installationId,
      filter,
      priority: 'high'
    };

    const result = await this.processWorkflowArtifacts(config);
    
    // Convert to IngestionResult format
    return {
      success: result.success,
      results: [], // Would need to map from stored data
      stats: {
        totalFiles: result.processedArtifacts,
        processedFiles: result.processedArtifacts,
        failedFiles: result.errors.length,
        totalTests: result.totalTests,
        totalFailures: result.totalFailures,
        totalErrors: result.totalErrors,
        totalSkipped: 0, // Not tracked in job result
        processingTimeMs: result.processingTimeMs,
        downloadTimeMs: 0 // Not tracked separately
      },
      errors: result.errors.map(message => ({
        type: 'PARSING_FAILED' as const,
        message,
        timestamp: new Date()
      })),
      correlationId: result.jobId
    };
  }

  // ==========================================================================
  // Database Operations
  // ==========================================================================

  /**
   * Store ingestion record in database
   */
  private async storeIngestionRecord(
    config: IngestionJobConfig,
    result: IngestionResult
  ): Promise<void> {
    try {
      // Find repository record
      const repository = await this.prisma.repository.findFirst({
        where: {
          owner: config.repository.owner,
          name: config.repository.repo,
          installationId: config.installationId.toString()
        }
      });

      if (!repository) {
        logger.warn('Repository not found for ingestion record', {
          owner: config.repository.owner,
          repo: config.repository.repo
        });
        return;
      }

      // Create ingestion record
      await this.prisma.ingestionJob.create({
        data: {
          id: result.correlationId || generateCorrelationId(),
          repositoryId: repository.id,
          workflowRunId: config.workflowRunId.toString(),
          status: result.success ? 'completed' : 'failed',
          artifactCount: result.results.length,
          testCount: result.stats.totalTests,
          failureCount: result.stats.totalFailures,
          errorCount: result.stats.totalErrors,
          processingTimeMs: result.stats.processingTimeMs,
          metadata: {
            filter: config.filter,
            priority: config.priority,
            errors: result.errors.map(e => e.message)
          } as any,
          createdAt: new Date(),
          completedAt: new Date()
        }
      });

      logger.debug('Stored ingestion record', {
        correlationId: result.correlationId,
        repositoryId: repository.id
      });

    } catch (error: any) {
      logger.error('Failed to store ingestion record', {
        correlationId: result.correlationId,
        error: error.message
      });
      // Don't throw - this is not critical for ingestion success
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create GitHub artifacts integration instance
 */
export function createGitHubArtifactsIntegration(
  authManager: GitHubAuthManager,
  helpers: GitHubHelpers,
  ingestionService: JUnitIngestionService,
  prisma: PrismaClient
): GitHubArtifactsIntegration {
  return new GitHubArtifactsIntegration(
    authManager,
    helpers,
    ingestionService,
    prisma
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create default artifact filter for test results
 */
export function createTestResultsFilter(overrides: Partial<ArtifactFilter> = {}): ArtifactFilter {
  return {
    ...DEFAULT_ARTIFACT_FILTER,
    ...overrides
  };
}

/**
 * Validate artifact filter configuration
 */
export function validateArtifactFilter(filter: ArtifactFilter): string[] {
  const errors: string[] = [];

  if (filter.maxSizeBytes !== undefined && filter.maxSizeBytes <= 0) {
    errors.push('maxSizeBytes must be positive');
  }

  if (filter.minSizeBytes !== undefined && filter.minSizeBytes < 0) {
    errors.push('minSizeBytes must be non-negative');
  }

  if (filter.maxSizeBytes !== undefined && 
      filter.minSizeBytes !== undefined && 
      filter.minSizeBytes >= filter.maxSizeBytes) {
    errors.push('minSizeBytes must be less than maxSizeBytes');
  }

  if (filter.namePatterns && filter.namePatterns.length === 0) {
    errors.push('namePatterns cannot be empty if specified');
  }

  if (filter.extensions && filter.extensions.length === 0) {
    errors.push('extensions cannot be empty if specified');
  }

  return errors;
}