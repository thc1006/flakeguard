/**
 * Ingestion Job Processor
 * 
 * Background job processor for JUnit artifact ingestion with:
 * - Integration with GitHub artifacts API
 * - Progress tracking and status updates
 * - Comprehensive error handling and recovery
 * - Database persistence of results
 * - Monitoring and logging capabilities
 */

import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { 
  GitHubArtifactsIntegration, 
  createGitHubArtifactsIntegration,
  IngestionJobConfig
} from '../../../api/src/ingestion/github-integration.js';
import { JUnitIngestionService } from '../../../api/src/ingestion/junit.js';
import { GitHubAuthManager } from '../../../api/src/github/auth.js';
import { GitHubHelpers } from '../../../api/src/github/helpers.js';
import { 
  IngestionQueueJobData, 
  JobExecutionResult,
  JobProgressInfo
} from '@flakeguard/shared';
import { logger } from '../utils/logger.js';

// ============================================================================
// Job Processor Interface
// ============================================================================

export interface IngestionJobProcessor {
  (job: Job<IngestionQueueJobData>): Promise<JobExecutionResult>;
}

// ============================================================================
// Create Ingestion Processor
// ============================================================================

/**
 * Create ingestion job processor with proper dependencies
 */
export function createIngestionProcessor(
  prisma: PrismaClient,
  authManager?: GitHubAuthManager,
  helpers?: GitHubHelpers
): IngestionJobProcessor {
  
  // If GitHub dependencies are not provided, create mock implementations
  const effectiveAuthManager = authManager || createMockAuthManager();
  const effectiveHelpers = helpers || createMockHelpers();
  
  // Create artifacts integration
  const ingestionService = new JUnitIngestionService();
  const artifactsIntegration = createGitHubArtifactsIntegration(
    effectiveAuthManager,
    effectiveHelpers,
    ingestionService,
    prisma
  );

  return async function processIngestionJob(
    job: Job<IngestionQueueJobData>
  ): Promise<JobExecutionResult> {
    const { data } = job;
    const startTime = Date.now();
    
    logger.info('Processing ingestion job', {
      jobId: job.id,
      correlationId: data.correlationId,
      workflowRunId: data.workflowRunId,
      repository: `${data.repository.owner}/${data.repository.repo}`,
      priority: data.priority,
      automatic: data.automatic,
      triggeredBy: data.triggeredBy
    });

    try {
      // Update job status to processing in database
      await updateJobStatus(prisma, job.id!, 'processing', {
        startedAt: new Date(),
        metadata: {
          ...data.metadata,
          workerStarted: new Date().toISOString()
        }
      });

      // Set up progress tracking
      const progressTracker = createProgressTracker(job, prisma);

      // Initial progress
      await progressTracker.updateProgress({
        phase: 'download',
        processed: 0,
        total: 1,
        percentage: 0
      });

      // Process the workflow artifacts
      const result = await artifactsIntegration.processWorkflowArtifacts(data);

      // Final progress update
      await progressTracker.updateProgress({
        phase: 'complete',
        processed: result.processedArtifacts,
        total: result.processedArtifacts,
        percentage: 100
      });

      // Update job status in database
      await updateJobStatus(prisma, job.id!, 'completed', {
        completedAt: new Date(),
        testCount: result.totalTests,
        failureCount: result.totalFailures,
        errorCount: result.totalErrors,
        processingTimeMs: Date.now() - startTime,
        metadata: {
          ...data.metadata,
          workerCompleted: new Date().toISOString(),
          result: {
            success: result.success,
            processedArtifacts: result.processedArtifacts,
            errors: result.errors
          }
        }
      });

      logger.info('Ingestion job completed successfully', {
        jobId: job.id,
        correlationId: data.correlationId,
        success: result.success,
        processedArtifacts: result.processedArtifacts,
        totalTests: result.totalTests,
        processingTime: Date.now() - startTime
      });

      return result;

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error.message || String(error);

      logger.error('Ingestion job failed', {
        jobId: job.id,
        correlationId: data.correlationId,
        error: errorMessage,
        stack: error.stack,
        processingTime
      });

      // Update job status to failed in database
      await updateJobStatus(prisma, job.id!, 'failed', {
        completedAt: new Date(),
        processingTimeMs: processingTime,
        errorMessage,
        metadata: {
          ...data.metadata,
          workerFailed: new Date().toISOString(),
          error: {
            message: errorMessage,
            stack: error.stack,
            type: error.constructor.name
          }
        }
      });

      // Return failed result
      const failedResult: JobExecutionResult = {
        jobId: job.id!,
        success: false,
        processedArtifacts: 0,
        totalTests: 0,
        totalFailures: 0,
        totalErrors: 0,
        processingTimeMs: processingTime,
        errors: [errorMessage]
      };

      return failedResult;
    }
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create progress tracker for job updates
 */
function createProgressTracker(job: Job<IngestionQueueJobData>, prisma: PrismaClient) {
  return {
    updateProgress: async (progress: Partial<JobProgressInfo>) => {
      const fullProgress: JobProgressInfo = {
        phase: progress.phase || 'download',
        processed: progress.processed || 0,
        total: progress.total || 1,
        percentage: progress.percentage || 0,
        currentFileName: progress.currentFileName,
        estimatedTimeRemaining: progress.estimatedTimeRemaining
      };

      // Update BullMQ job progress
      await job.updateProgress(fullProgress);

      // Update database with progress information
      try {
        await prisma.ingestionJob.update({
          where: { id: job.id! },
          data: {
            metadata: {
              ...(job.data.metadata || {}),
              progress: fullProgress,
              lastProgressUpdate: new Date().toISOString()
            }
          }
        });
      } catch (error) {
        logger.warn('Failed to update progress in database', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      logger.debug('Job progress updated', {
        jobId: job.id,
        ...fullProgress
      });
    }
  };
}

/**
 * Update job status in database
 */
async function updateJobStatus(
  prisma: PrismaClient,
  jobId: string,
  status: string,
  updates: {
    startedAt?: Date;
    completedAt?: Date;
    testCount?: number;
    failureCount?: number;
    errorCount?: number;
    processingTimeMs?: number;
    errorMessage?: string;
    metadata?: any;
  } = {}
): Promise<void> {
  try {
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        status,
        ...updates,
        updatedAt: new Date()
      }
    });

    logger.debug('Job status updated in database', {
      jobId,
      status,
      updates: Object.keys(updates)
    });

  } catch (error) {
    logger.error('Failed to update job status in database', {
      jobId,
      status,
      error: error instanceof Error ? error.message : String(error)
    });
    // Don't throw - this shouldn't break job processing
  }
}

// ============================================================================
// Mock Implementations (for environments without GitHub integration)
// ============================================================================

/**
 * Create mock auth manager for testing or environments without GitHub
 */
function createMockAuthManager(): GitHubAuthManager {
  const mockClient = {
    rest: {
      actions: {
        getWorkflowRun: async () => ({ data: { id: 1, status: 'completed' } }),
        listWorkflowRunArtifacts: async () => ({ data: { artifacts: [] } }),
        getArtifact: async () => ({ 
          data: { 
            id: 1, 
            name: 'test-artifact',
            archive_download_url: 'https://example.com/download',
            size_in_bytes: 1024,
            expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            expired: false
          } 
        })
      }
    }
  };

  return {
    getInstallationClient: async () => mockClient as any,
    initialize: async () => {},
    isInitialized: () => true
  } as any;
}

/**
 * Create mock helpers for testing or environments without GitHub
 */
function createMockHelpers(): GitHubHelpers {
  return {
    listArtifacts: async () => [],
    generateArtifactDownloadUrl: async () => ({
      downloadUrl: 'https://example.com/download',
      expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
      sizeInBytes: 1024
    }),
    getWorkflowJobs: async () => []
  } as any;
}

// ============================================================================
// Export Default Processor Factory
// ============================================================================

/**
 * Default ingestion processor factory for use in worker
 */
export function ingestionProcessor(
  prisma: PrismaClient,
  authManager?: GitHubAuthManager,
  helpers?: GitHubHelpers
) {
  const processor = createIngestionProcessor(prisma, authManager, helpers);
  
  return async (job: Job<IngestionQueueJobData>): Promise<JobExecutionResult> => {
    return processor(job);
  };
}

export default ingestionProcessor;