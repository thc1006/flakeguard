/**
 * Ingestion Background Job Queue
 * 
 * Provides robust background job processing for JUnit artifact ingestion using BullMQ:
 * - Scalable job queue with Redis backing
 * - Priority-based processing with retry logic
 * - Progress tracking and status updates
 * - Integration with existing worker infrastructure
 * - Comprehensive error handling and monitoring
 * - Job lifecycle management and cleanup
 */

import { QueueNames, JobPriorities } from '@flakeguard/shared';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker, Job, QueueEvents, JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { JobState } from 'bullmq';
import type { SafeQueueStats, BullMQJobState } from '@flakeguard/shared';

import { GitHubAuthManager } from '../github/auth.js';
import { GitHubHelpers } from '../github/helpers.js';
import { logger } from '../utils/logger.js';

import {
  GitHubArtifactsIntegration,
  createGitHubArtifactsIntegration,
  IngestionJobConfig,
  IngestionJobResult
} from './github-integration.js';
import { JUnitIngestionService } from './junit.js';



// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Job data for ingestion processing
 */
export interface IngestionJobData extends IngestionJobConfig {
  readonly type: 'process-artifacts';
  readonly retryCount?: number;
}

/**
 * Job progress information
 */
export interface IngestionJobProgress {
  readonly phase: 'download' | 'extract' | 'parse' | 'complete';
  readonly processed: number;
  readonly total: number;
  readonly currentFileName?: string;
  readonly percentage: number;
}

/**
 * Queue configuration options
 */
export interface IngestionQueueConfig {
  readonly redis: Redis;
  readonly concurrency?: number;
  readonly rateLimiter?: {
    readonly max: number;
    readonly duration: number;
  };
  readonly cleanup?: {
    readonly maxAge: number; // in milliseconds
    readonly maxCompletedJobs: number;
    readonly maxFailedJobs: number;
  };
}

/**
 * Worker dependencies
 */
export interface WorkerDependencies {
  readonly prisma: PrismaClient;
  readonly authManager: GitHubAuthManager;
  readonly helpers: GitHubHelpers;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG = {
  concurrency: 3,
  rateLimiter: {
    max: 20,
    duration: 60 * 1000 // 20 jobs per minute
  },
  cleanup: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    maxCompletedJobs: 100,
    maxFailedJobs: 50
  }
} as const;

const JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 10000
  },
  removeOnComplete: 100,
  removeOnFail: 50
} as const;

// ============================================================================
// Ingestion Queue Manager
// ============================================================================

export class IngestionQueueManager {
  private readonly queue: Queue<IngestionJobData>;
  private readonly worker: Worker<IngestionJobData>;
  private readonly events: QueueEvents;
  private readonly artifactsIntegration: GitHubArtifactsIntegration;
  private readonly prisma: PrismaClient;
  private readonly config: Required<IngestionQueueConfig>;

  constructor(
    queueConfig: IngestionQueueConfig,
    dependencies: WorkerDependencies
  ) {
    this.config = { ...DEFAULT_CONFIG, ...queueConfig };
    this.prisma = dependencies.prisma;

    // Create artifacts integration
    const ingestionService = new JUnitIngestionService();
    this.artifactsIntegration = createGitHubArtifactsIntegration(
      dependencies.authManager,
      dependencies.helpers,
      ingestionService,
      dependencies.prisma
    );

    // Initialize queue
    this.queue = new Queue<IngestionJobData>(QueueNames.INGESTION, {
      connection: this.config.redis,
      defaultJobOptions: JOB_OPTIONS
    });

    // Initialize worker
    this.worker = new Worker<IngestionJobData>(
      QueueNames.INGESTION,
      this.processJob.bind(this),
      {
        connection: this.config.redis,
        concurrency: this.config.concurrency,
        limiter: this.config.rateLimiter
      }
    );

    // Initialize events
    this.events = new QueueEvents(QueueNames.INGESTION, {
      connection: this.config.redis
    });

    this.setupEventHandlers();
    this.setupCleanupSchedule();

    logger.info('Ingestion queue manager initialized', {
      concurrency: this.config.concurrency,
      rateLimiter: this.config.rateLimiter
    });
  }

  // ==========================================================================
  // Public Queue Operations
  // ==========================================================================

  /**
   * Add ingestion job to queue
   */
  async addJob(
    jobData: IngestionJobData,
    options?: JobsOptions
  ): Promise<Job<IngestionJobData>> {
    const jobOptions = {
      ...JOB_OPTIONS,
      ...options,
      jobId: jobData.correlationId
    };

    // Set priority based on job configuration
    if (jobData.priority) {
      jobOptions.priority = this.getPriorityValue(jobData.priority);
    }

    logger.info('Adding ingestion job to queue', {
      correlationId: jobData.correlationId,
      workflowRunId: jobData.workflowRunId,
      priority: jobData.priority
    });

    const job = await this.queue.add('process-artifacts', jobData, jobOptions);

    // Update database status
    await this.updateJobStatus(jobData.correlationId!, 'queued');

    return job;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job<IngestionJobData> | undefined> {
    return this.queue.getJob(jobId);
  }

  /**
   * Get job status and progress
   */
  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress?: IngestionJobProgress;
    result?: IngestionJobResult;
  }> {
    const job = await this.getJob(jobId);
    
    if (!job) {
      // Check database for completed jobs
      const dbJob = await this.prisma.ingestionJob.findUnique({
        where: { id: jobId }
      });

      if (dbJob) {
        return {
          status: dbJob.status,
          result: dbJob.status === 'completed' || dbJob.status === 'failed' ? {
            jobId: dbJob.id,
            success: dbJob.status === 'completed',
            processedArtifacts: dbJob.artifactCount || 0,
            totalTests: dbJob.testCount || 0,
            totalFailures: dbJob.failureCount || 0,
            totalErrors: dbJob.errorCount || 0,
            processingTimeMs: dbJob.processingTimeMs || 0,
            errors: (dbJob.metadata as any)?.errors || []
          } : undefined
        };
      }

      throw new Error(`Job not found: ${jobId}`);
    }

    const status = await job.getState();
    const progress = job.progress as IngestionJobProgress | undefined;

    return {
      status,
      progress,
      result: job.returnvalue as IngestionJobResult | undefined
    };
  }

  /**
   * Cancel job
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.remove();
      await this.updateJobStatus(jobId, 'cancelled');
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaiting(),
        this.queue.getActive(),
        this.queue.getCompleted(0, -1, true), // start, end, asc - safe BullMQ call
        this.queue.getFailed(0, -1, true), // start, end, asc - safe BullMQ call
        this.queue.getDelayed()
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length
      };
    } catch (error) {
      logger.error('Failed to get queue statistics', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return safe defaults on error
      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0
      };
    }
  }

  // ==========================================================================
  // Job Processing
  // ==========================================================================

  /**
   * Main job processor
   */
  private async processJob(job: Job<IngestionJobData>): Promise<IngestionJobResult> {
    const { data } = job;
    const startTime = Date.now();

    logger.info('Processing ingestion job', {
      jobId: job.id,
      correlationId: data.correlationId,
      workflowRunId: data.workflowRunId
    });

    try {
      // Update status to processing
      await this.updateJobStatus(job.id, 'processing', { startedAt: new Date() });

      // Set up progress tracking
      const progressTracker = this.createProgressTracker(job);

      // Process the artifacts
      const result = await this.artifactsIntegration.processWorkflowArtifacts(data);

      // Update final status
      await this.updateJobStatus(
        job.id,
        result.success ? 'completed' : 'failed',
        {
          completedAt: new Date(),
          testCount: result.totalTests,
          failureCount: result.totalFailures,
          errorCount: result.totalErrors,
          processingTimeMs: result.processingTimeMs,
          metadata: {
            ...((await this.getJobMetadata(job.id)) || {}),
            errors: result.errors,
            result
          }
        }
      );

      // Final progress update
      await job.updateProgress({
        phase: 'complete',
        processed: result.processedArtifacts,
        total: result.processedArtifacts,
        percentage: 100
      });

      logger.info('Ingestion job completed', {
        jobId: job.id,
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
        processingTime
      });

      // Update status to failed
      await this.updateJobStatus(
        job.id,
        'failed',
        {
          completedAt: new Date(),
          processingTimeMs: processingTime,
          errorMessage,
          metadata: {
            ...((await this.getJobMetadata(job.id)) || {}),
            error: errorMessage
          }
        }
      );

      // Return failed result
      const failedResult: IngestionJobResult = {
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
  }

  /**
   * Create progress tracker for job
   */
  private createProgressTracker(job: Job<IngestionJobData>) {
    return {
      updateProgress: async (progress: Partial<IngestionJobProgress>) => {
        const fullProgress: IngestionJobProgress = {
          phase: progress.phase || 'download',
          processed: progress.processed || 0,
          total: progress.total || 1,
          currentFileName: progress.currentFileName,
          percentage: Math.round(((progress.processed || 0) / (progress.total || 1)) * 100)
        };

        await job.updateProgress(fullProgress);
        
        logger.debug('Job progress updated', {
          jobId: job.id,
          ...fullProgress
        });
      }
    };
  }

  // ==========================================================================
  // Database Operations
  // ==========================================================================

  /**
   * Update job status in database
   */
  private async updateJobStatus(
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
      await this.prisma.ingestionJob.update({
        where: { id: jobId },
        data: {
          status,
          ...updates,
          updatedAt: new Date()
        }
      });
    } catch (error) {
      logger.error('Failed to update job status', {
        jobId,
        status,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get job metadata from database
   */
  private async getJobMetadata(jobId: string): Promise<any> {
    try {
      const job = await this.prisma.ingestionJob.findUnique({
        where: { id: jobId },
        select: { metadata: true }
      });
      return job?.metadata || {};
    } catch {
      return {};
    }
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Set up queue event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on('completed', (job: Job, result: IngestionJobResult) => {
      logger.info('Ingestion job completed', {
        jobId: job.id,
        success: result.success,
        processedArtifacts: result.processedArtifacts
      });
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      logger.error('Ingestion job failed', {
        jobId: job?.id,
        error: error.message
      });
    });

    this.worker.on('stalled', (jobId: string) => {
      logger.warn('Ingestion job stalled', { jobId });
    });

    this.worker.on('progress', (job: Job, progress: IngestionJobProgress) => {
      logger.debug('Ingestion job progress', {
        jobId: job.id,
        phase: progress.phase,
        percentage: progress.percentage
      });
    });

    this.events.on('completed', ({ jobId, returnvalue }) => {
      logger.debug('Job completed event', { jobId });
    });

    this.events.on('failed', ({ jobId, failedReason }) => {
      logger.debug('Job failed event', { jobId, reason: failedReason });
    });
  }

  /**
   * Set up periodic cleanup
   */
  private setupCleanupSchedule(): void {
    // Clean up old jobs every hour
    setInterval(async () => {
      try {
        await this.cleanupOldJobs();
      } catch (error) {
        logger.error('Failed to cleanup old jobs', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * Clean up old completed and failed jobs
   */
  private async cleanupOldJobs(): Promise<void> {
    const { maxAge, maxCompletedJobs, maxFailedJobs } = this.config.cleanup;

    try {
      const [completedCleaned, failedCleaned] = await Promise.all([
        this.safeCleanOldJobs(maxAge, maxCompletedJobs, 'completed'),
        this.safeCleanOldJobs(maxAge, maxFailedJobs, 'failed')
      ]);

      logger.debug('Cleaned up old jobs', {
        maxAge: `${maxAge}ms`,
        maxCompleted: maxCompletedJobs,
        maxFailed: maxFailedJobs,
        completedCleaned,
        failedCleaned
      });
    } catch (error) {
      logger.error('Failed to cleanup old jobs', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // ==========================================================================
  // Safe BullMQ Operations
  // ==========================================================================

  /**
   * Safely get jobs by state with error handling and pagination
   */
  private async safeGetJobsByState(
    state: BullMQJobState,
    start: number = 0,
    end: number = -1
  ): Promise<Job<IngestionJobData>[]> {
    try {
      switch (state) {
        case 'completed':
          return await this.queue.getCompleted(start, end, true);
        case 'failed':
          return await this.queue.getFailed(start, end, true);
        case 'waiting':
          return await this.queue.getWaiting(start, end);
        case 'active':
          return await this.queue.getActive(start, end);
        case 'delayed':
          return await this.queue.getDelayed(start, end);
        case 'paused':
          return await this.queue.getPaused(start, end);
        default:
          logger.warn(`Unsupported job state: ${state}`);
          return [];
      }
    } catch (error) {
      logger.error(`Failed to get ${state} jobs`, {
        error: error instanceof Error ? error.message : String(error),
        state,
        start,
        end
      });
      return [];
    }
  }

  /**
   * Safely clean old jobs with error handling
   */
  private async safeCleanOldJobs(
    maxAge: number,
    limit: number,
    type: 'completed' | 'failed'
  ): Promise<number> {
    try {
      const result = await this.queue.clean(maxAge, limit, type);
      return Array.isArray(result) ? result.length : 0;
    } catch (error) {
      logger.error(`Failed to clean ${type} jobs`, {
        error: error instanceof Error ? error.message : String(error),
        maxAge,
        limit,
        type
      });
      return 0;
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Convert priority to numeric value
   */
  private getPriorityValue(priority: string): number {
    switch (priority) {
      case 'critical':
        return JobPriorities.CRITICAL;
      case 'high':
        return JobPriorities.HIGH;
      case 'normal':
        return JobPriorities.NORMAL;
      case 'low':
        return JobPriorities.LOW;
      default:
        return JobPriorities.NORMAL;
    }
  }

  // ==========================================================================
  // Lifecycle Management
  // ==========================================================================

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    logger.info('Shutting down ingestion queue manager...');

    await Promise.all([
      this.worker.close(),
      this.queue.close(),
      this.events.close()
    ]);

    logger.info('Ingestion queue manager shut down');
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create ingestion queue manager
 */
export function createIngestionQueueManager(
  config: IngestionQueueConfig,
  dependencies: WorkerDependencies
): IngestionQueueManager {
  return new IngestionQueueManager(config, dependencies);
}

/**
 * Create simple ingestion queue (for basic use cases)
 */
export function createIngestionQueue(redis: Redis): Queue<IngestionJobData> {
  return new Queue<IngestionJobData>(QueueNames.INGESTION, {
    connection: redis,
    defaultJobOptions: JOB_OPTIONS
  });
}

// ============================================================================
// Worker Integration
// ============================================================================

/**
 * Create standalone ingestion worker (for distributed processing)
 */
export function createIngestionWorker(
  redis: Redis,
  dependencies: WorkerDependencies,
  options: {
    concurrency?: number;
    rateLimiter?: { max: number; duration: number };
  } = {}
): Worker<IngestionJobData> {
  const ingestionService = new JUnitIngestionService();
  const artifactsIntegration = createGitHubArtifactsIntegration(
    dependencies.authManager,
    dependencies.helpers,
    ingestionService,
    dependencies.prisma
  );

  return new Worker<IngestionJobData>(
    QueueNames.INGESTION,
    async (job: Job<IngestionJobData>) => {
      const result = await artifactsIntegration.processWorkflowArtifacts(job.data);
      return result;
    },
    {
      connection: redis,
      concurrency: options.concurrency || DEFAULT_CONFIG.concurrency,
      limiter: options.rateLimiter || DEFAULT_CONFIG.rateLimiter
    }
  );
}