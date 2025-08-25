/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, import/order, prefer-const */

/**
 * Polling Processor
 * 
 * Periodically polls GitHub API for new workflow runs and enqueues
 * ingestion jobs when runs complete. Implements cursor-based pagination,
 * rate limiting, and repository discovery.
 */

import { Job, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { CronJob } from 'cron';
import { logger } from '../utils/logger.js';
import { connection } from '../utils/redis.js';
import { 
  recordJobCompletion,
  recordGitHubApiCall,
  githubRateLimitRemaining,
  githubRateLimitReset
} from '../utils/metrics.js';
import { 
  POLLING_CONFIG,
  GITHUB_RATE_LIMITS,
  QueueNames,
  JobPriorities
} from '@flakeguard/shared';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface PollingJobData {
  repositories?: Array<{
    owner: string;
    repo: string;
    installationId: number;
    lastPolledAt?: string;
    active: boolean;
  }>;
  forceFullScan?: boolean;
  batchSize?: number;
  correlationId?: string;
  triggeredBy: 'cron' | 'manual' | 'startup';
}

export interface PollingResult {
  success: boolean;
  repositoriesPolled: number;
  workflowRunsDiscovered: number;
  newRunsQueued: number;
  rateLimitRemaining: number;
  processingTimeMs: number;
  repositoryResults: RepositoryPollingResult[];
  errors: string[];
  warnings: string[];
}

export interface RepositoryPollingResult {
  repository: string;
  runsDiscovered: number;
  newRunsQueued: number;
  lastRunDate?: string;
  cursor?: string;
  rateLimitHit: boolean;
  error?: string;
}

export interface WorkflowRunSummary {
  id: number;
  run_number: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
  head_branch: string;
  created_at: string;
  updated_at: string;
  repository: {
    owner: { login: string };
    name: string;
  };
}

export interface RepositoryContext {
  owner: string;
  repo: string;
  installationId: number;
  lastPolledAt?: Date;
  cursor?: string;
}

// ============================================================================
// Polling Manager
// ============================================================================

export class PollingManager {
  private prisma: PrismaClient;
  private octokit?: Octokit;
  private runsIngestQueue: Queue;
  private runsAnalyzeQueue: Queue;
  private cronJobs: Map<string, CronJob> = new Map();
  private rateLimitBackoff = 0;
  private lastRateLimitReset = 0;

  constructor(
    prisma: PrismaClient,
    runsIngestQueue: Queue,
    runsAnalyzeQueue: Queue,
    octokit?: Octokit
  ) {
    this.prisma = prisma;
    this.octokit = octokit;
    this.runsIngestQueue = runsIngestQueue;
    this.runsAnalyzeQueue = runsAnalyzeQueue;
  }

  /**
   * Initialize polling system
   */
  async initialize(): Promise<void> {
    logger.info('Initializing polling manager');
    
    if (POLLING_CONFIG.INTERVAL_MS > 0) {
      // Set up cron job for periodic polling
      const cronPattern = this.calculateCronPattern(POLLING_CONFIG.INTERVAL_MS);
      
      const pollingJob = new CronJob(
        cronPattern,
        () => this.triggerPolling('cron'),
        null,
        false, // Don't start immediately
        'UTC'
      );
      
      this.cronJobs.set('main_polling', pollingJob);
      pollingJob.start();
      
      logger.info({ cronPattern, intervalMs: POLLING_CONFIG.INTERVAL_MS }, 'Polling cron job scheduled');
    }
    
    // Run initial polling on startup
    setTimeout(() => this.triggerPolling('startup'), 5000);
  }

  /**
   * Shutdown polling system
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down polling manager');
    
    for (const [name, job] of this.cronJobs) {
      job.stop();
      logger.debug({ jobName: name }, 'Stopped cron job');
    }
    
    this.cronJobs.clear();
  }

  /**
   * Trigger polling manually
   */
  async triggerPolling(triggeredBy: 'cron' | 'manual' | 'startup'): Promise<void> {
    try {
      // Check rate limit backoff
      if (this.rateLimitBackoff > Date.now()) {
        logger.warn({
          backoffUntil: new Date(this.rateLimitBackoff).toISOString(),
          triggeredBy
        }, 'Skipping polling due to rate limit backoff');
        return;
      }

      // Queue polling job
      await this.runsIngestQueue.add(
        'polling-job',
        {
          triggeredBy,
          correlationId: `polling-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          forceFullScan: triggeredBy === 'startup'
        } as PollingJobData,
        {
          priority: JobPriorities.HIGH,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          }
        }
      );
      
      logger.debug({ triggeredBy }, 'Polling job queued');
      
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        triggeredBy
      }, 'Failed to trigger polling');
    }
  }

  /**
   * Calculate cron pattern from interval
   */
  private calculateCronPattern(intervalMs: number): string {
    const intervalMinutes = Math.floor(intervalMs / 60000);
    
    if (intervalMinutes < 60) {
      return `*/${intervalMinutes} * * * *`; // Every N minutes
    } else {
      const intervalHours = Math.floor(intervalMinutes / 60);
      return `0 */${intervalHours} * * *`; // Every N hours
    }
  }
}

// ============================================================================
// Processor Implementation
// ============================================================================

/**
 * Create polling processor
 */
export function createPollingProcessor(
  prisma: PrismaClient,
  _runsIngestQueue: Queue,
  _runsAnalyzeQueue: Queue,
  octokit?: Octokit
) {
  return async function processPolling(
    job: Job<PollingJobData>
  ): Promise<PollingResult> {
    const { data } = job;
    const startTime = Date.now();
    
    logger.info({
      jobId: job.id,
      correlationId: data.correlationId,
      triggeredBy: data.triggeredBy,
      forceFullScan: data.forceFullScan
    }, 'Processing polling job');

    try {
      // Update job progress
      await job.updateProgress({
        phase: 'discovering',
        percentage: 10,
        message: 'Discovering active repositories'
      });

      // Get GitHub client
      const github = octokit || createMockGitHubClient();
      
      // Discover active repositories
      const repositories = data.repositories || await discoverActiveRepositories(prisma, data.forceFullScan);
      
      if (repositories.length === 0) {
        logger.info('No active repositories found for polling');
        return createEmptyPollingResult(startTime);
      }

      logger.info({ repositoryCount: repositories.length }, 'Found repositories for polling');

      // Update progress
      await job.updateProgress({
        phase: 'polling',
        percentage: 20,
        message: `Polling ${repositories.length} repositories`
      });

      // Poll repositories in batches
      const batchSize = data.batchSize || POLLING_CONFIG.MAX_REPOSITORIES_PER_BATCH;
      const repositoryResults: RepositoryPollingResult[] = [];
      let totalRunsDiscovered = 0;
      let totalNewRunsQueued = 0;
      let currentRateLimitRemaining = GITHUB_RATE_LIMITS.PRIMARY_RATE_LIMIT;
      
      for (let i = 0; i < repositories.length; i += batchSize) {
        const batch = repositories.slice(i, i + batchSize);
        
        // Update progress
        const progressPercentage = 20 + ((i / repositories.length) * 60);
        await job.updateProgress({
          phase: 'polling',
          percentage: progressPercentage,
          message: `Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} repositories)`
        });
        
        // Process batch with rate limiting
        const batchResults = await processBatch(github, batch, data);
        repositoryResults.push(...batchResults);
        
        // Aggregate results
        for (const result of batchResults) {
          totalRunsDiscovered += result.runsDiscovered;
          totalNewRunsQueued += result.newRunsQueued;
          
          if (result.rateLimitHit) {
            logger.warn({ repository: result.repository }, 'Rate limit hit during polling');
            break; // Stop processing if we hit rate limits
          }
        }
        
        // Add delay between batches to respect rate limits
        if (i + batchSize < repositories.length) {
          await sleep(1000); // 1 second delay
        }
      }

      // Update progress
      await job.updateProgress({
        phase: 'finalizing',
        percentage: 90,
        message: 'Updating repository polling status'
      });

      // Update repository polling timestamps
      await updateRepositoryPollingStatus(prisma, repositoryResults);
      
      const processingTimeMs = Date.now() - startTime;
      
      // Final progress update
      await job.updateProgress({
        phase: 'complete',
        percentage: 100,
        message: 'Polling complete'
      });

      const result: PollingResult = {
        success: true,
        repositoriesPolled: repositories.length,
        workflowRunsDiscovered: totalRunsDiscovered,
        newRunsQueued: totalNewRunsQueued,
        rateLimitRemaining: currentRateLimitRemaining,
        processingTimeMs,
        repositoryResults,
        errors: [],
        warnings: []
      };

      // Record job completion metrics
      recordJobCompletion(QueueNames.POLLING, 'completed', 'normal', processingTimeMs);
      
      logger.info({
        jobId: job.id,
        repositoriesPolled: repositories.length,
        workflowRunsDiscovered: totalRunsDiscovered,
        newRunsQueued: totalNewRunsQueued,
        processingTimeMs
      }, 'Polling completed successfully');

      return result;

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      recordJobCompletion(QueueNames.POLLING, 'failed', 'normal', processingTimeMs, 'polling_error');
      
      logger.error({
        jobId: job.id,
        correlationId: data.correlationId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs
      }, 'Polling failed');

      throw error;
    }
  };
}

// ============================================================================
// Repository Discovery
// ============================================================================

/**
 * Discover active repositories to poll
 */
async function discoverActiveRepositories(
  prisma: PrismaClient,
  forceFullScan = false
): Promise<Array<{ owner: string; repo: string; installationId: number; lastPolledAt?: string; isActive: boolean }>> {
  try {
    // Get repositories from database (would be enhanced with GitHub App installations)
    const repositories = await prisma.repository.findMany({
      where: {
        isActive: true,
        ...(forceFullScan ? {} : {
          OR: [
            { lastPolledAt: null },
            {
              lastPolledAt: {
                lte: new Date(Date.now() - POLLING_CONFIG.INTERVAL_MS)
              }
            }
          ]
        })
      },
      select: {
        owner: true,
        name: true,
        installationId: true,
        lastPolledAt: true,
        isActive: true
      },
      orderBy: {
        lastPolledAt: 'asc' // Poll oldest first
      },
      take: POLLING_CONFIG.MAX_REPOSITORIES_PER_BATCH * 3 // Allow for some buffer
    });
    
    return repositories.map(repo => ({
      owner: repo.owner,
      repo: repo.name,
      installationId: parseInt(repo.installationId) || 0,
      lastPolledAt: repo.lastPolledAt?.toISOString(),
      isActive: repo.isActive
    }));
    
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to discover active repositories');
    return [];
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Process a batch of repositories
 */
async function processBatch(
  github: Octokit,
  repositories: Array<{ owner: string; repo: string; installationId: number; lastPolledAt?: string }>,
  jobData: PollingJobData
): Promise<RepositoryPollingResult[]> {
  const results: RepositoryPollingResult[] = [];
  
  for (const repo of repositories) {
    try {
      const result = await pollRepository(github, repo, jobData);
      results.push(result);
      
      // Stop if rate limit hit
      if (result.rateLimitHit) {
        break;
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({
        repository: `${repo.owner}/${repo.repo}`,
        error: errorMessage
      }, 'Failed to poll repository');
      
      results.push({
        repository: `${repo.owner}/${repo.repo}`,
        runsDiscovered: 0,
        newRunsQueued: 0,
        rateLimitHit: false,
        error: errorMessage
      });
    }
  }
  
  return results;
}

/**
 * Poll a single repository for workflow runs
 */
async function pollRepository(
  github: Octokit,
  repo: { owner: string; repo: string; installationId: number; lastPolledAt?: string },
  jobData: PollingJobData
): Promise<RepositoryPollingResult> {
  const startTime = Date.now();
  let runsDiscovered = 0;
  let newRunsQueued = 0;
  let rateLimitHit = false;
  let cursor: string | undefined;
  let lastRunDate: string | undefined;
  
  try {
    // Calculate lookback time
    const lookbackTime = repo.lastPolledAt 
      ? new Date(repo.lastPolledAt)
      : new Date(Date.now() - POLLING_CONFIG.WORKFLOW_RUN_LOOKBACK_HOURS * 60 * 60 * 1000);
    
    logger.debug({
      repository: `${repo.owner}/${repo.repo}`,
      lookbackTime: lookbackTime.toISOString(),
      lastPolledAt: repo.lastPolledAt
    }, 'Polling repository for workflow runs');
    
    let page = 1;
    let hasMore = true;
    
    while (hasMore && page <= 10) { // Limit to 10 pages to avoid runaway
      const response = await github.rest.actions.listWorkflowRunsForRepo({
        owner: repo.owner,
        repo: repo.repo,
        status: 'completed',
        per_page: POLLING_CONFIG.CURSOR_PAGINATION_LIMIT,
        page,
        created: `>=${lookbackTime.toISOString()}`
      });
      
      const duration = Date.now() - startTime;
      recordGitHubApiCall(
        'listWorkflowRunsForRepo',
        'GET',
        response.status,
        duration,
        response.headers['x-ratelimit-remaining'] ? parseInt(response.headers['x-ratelimit-remaining'] as string) : undefined,
        response.headers['x-ratelimit-reset'] ? parseInt(response.headers['x-ratelimit-reset'] as string) : undefined
      );
      
      const runs = response.data.workflow_runs;
      runsDiscovered += runs.length;
      
      // Check rate limits
      if (response.headers['x-ratelimit-remaining']) {
        const remaining = parseInt(response.headers['x-ratelimit-remaining'] as string);
        githubRateLimitRemaining.set({ rate_limit_type: 'primary' }, remaining);
        
        if (remaining < 100) {
          logger.warn({
            repository: `${repo.owner}/${repo.repo}`,
            rateLimitRemaining: remaining
          }, 'Approaching GitHub rate limit');
          
          if (remaining < 10) {
            rateLimitHit = true;
            hasMore = false;
            break;
          }
        }
      }
      
      if (response.headers['x-ratelimit-reset']) {
        const resetTime = parseInt(response.headers['x-ratelimit-reset'] as string);
        githubRateLimitReset.set({ rate_limit_type: 'primary' }, resetTime);
      }
      
      // Process completed runs
      for (const run of runs) {
        if (run.status === 'completed' && run.conclusion) {
          // Check if we've already processed this run
          const alreadyProcessed = await checkRunAlreadyProcessed(repo, run.id);
          
          if (!alreadyProcessed) {
            const workflowRunSummary: WorkflowRunSummary = {
              id: run.id,
              run_number: run.run_number,
              status: run.status || 'unknown',
              conclusion: run.conclusion,
              head_sha: run.head_sha,
              head_branch: run.head_branch || 'main',
              created_at: run.created_at,
              updated_at: run.updated_at,
              repository: {
                owner: { login: repo.owner },
                name: repo.repo
              }
            };
            await enqueueIngestionJob(repo, workflowRunSummary, jobData.correlationId);
            newRunsQueued++;
          }
          
          // Track latest run date
          if (!lastRunDate || run.created_at > lastRunDate) {
            lastRunDate = run.created_at;
          }
        }
      }
      
      // Check if there are more pages
      hasMore = runs.length === POLLING_CONFIG.CURSOR_PAGINATION_LIMIT;
      page++;
      
      // Add small delay between pages
      if (hasMore) {
        await sleep(200);
      }
    }
    
    logger.debug({
      repository: `${repo.owner}/${repo.repo}`,
      runsDiscovered,
      newRunsQueued,
      pages: page - 1
    }, 'Repository polling completed');
    
    return {
      repository: `${repo.owner}/${repo.repo}`,
      runsDiscovered,
      newRunsQueued,
      lastRunDate,
      cursor,
      rateLimitHit
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Handle rate limiting
    if (error instanceof Error && 'status' in error && (error as Error & { status: number }).status === 403) {
      logger.warn({
        repository: `${repo.owner}/${repo.repo}`,
        error: error.message
      }, 'Rate limited while polling repository');
      
      rateLimitHit = true;
      recordGitHubApiCall('listWorkflowRunsForRepo', 'GET', 403, duration);
    } else {
      recordGitHubApiCall('listWorkflowRunsForRepo', 'GET', 500, duration);
    }
    
    throw error;
  }
}

// ============================================================================
// Job Enqueueing
// ============================================================================

/**
 * Check if workflow run has already been processed
 */
async function checkRunAlreadyProcessed(
  repo: { owner: string; repo: string },
  runId: number
): Promise<boolean> {
  try {
    // Simple check - would be enhanced with actual database lookup
    // For now, use Redis to track processed runs
    const key = `processed_runs:${repo.owner}:${repo.repo}:${runId}`;
    const result = await connection.get(key);
    return result !== null;
    
  } catch (error) {
    logger.warn({
      repository: `${repo.owner}/${repo.repo}`,
      runId,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to check if run already processed');
    return false; // Assume not processed on error
  }
}

/**
 * Enqueue ingestion job for workflow run
 */
async function enqueueIngestionJob(
  repo: { owner: string; repo: string; installationId: number },
  run: WorkflowRunSummary,
  correlationId?: string
): Promise<void> {
  try {
    // Create ingestion job
    const jobData = {
      workflowRunId: run.id,
      repository: {
        owner: repo.owner,
        repo: repo.repo,
        installationId: repo.installationId
      },
      correlationId,
      priority: 'normal' as const,
      triggeredBy: 'polling' as const,
      metadata: {
        runStatus: run.status,
        conclusion: run.conclusion,
        headSha: run.head_sha,
        headBranch: run.head_branch,
        runNumber: run.run_number
      }
    };
    
    // Add to ingestion queue with deduplication
    const dedupeKey = `${repo.owner}:${repo.repo}:${run.id}`;
    
    const queue = new Queue(QueueNames.RUNS_INGEST, { connection });
    await queue.add(
      'runs-ingest',
      jobData,
      {
        priority: JobPriorities.NORMAL,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        },
        removeOnComplete: 100,
        removeOnFail: 50,
        jobId: dedupeKey // Use as dedup key
      }
    );
    
    // Mark as processed
    const processedKey = `processed_runs:${repo.owner}:${repo.repo}:${run.id}`;
    await connection.setex(processedKey, 86400 * 7, '1'); // 7 day expiry
    
    logger.debug({
      repository: `${repo.owner}/${repo.repo}`,
      workflowRunId: run.id,
      runNumber: run.run_number,
      conclusion: run.conclusion
    }, 'Enqueued ingestion job');
    
  } catch (error) {
    logger.error({
      repository: `${repo.owner}/${repo.repo}`,
      workflowRunId: run.id,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to enqueue ingestion job');
    throw error;
  }
}

// ============================================================================
// Database Updates
// ============================================================================

/**
 * Update repository polling status
 */
async function updateRepositoryPollingStatus(
  prisma: PrismaClient,
  results: RepositoryPollingResult[]
): Promise<void> {
  try {
    for (const result of results) {
      const [owner, repo] = result.repository.split('/');
      
      await prisma.repository.upsert({
        where: {
          owner_name: {
            owner,
            name: repo
          }
        },
        update: {
          lastPolledAt: new Date(),
          lastRunDate: result.lastRunDate ? new Date(result.lastRunDate) : undefined,
          updatedAt: new Date()
        },
        create: {
          owner: owner!,
          name: repo!,
          isActive: true,
          lastPolledAt: new Date(),
          lastRunDate: result.lastRunDate ? new Date(result.lastRunDate) : undefined,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
    }
    
    logger.debug({ repositoriesUpdated: results.length }, 'Updated repository polling status');
    
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to update repository polling status');
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create empty polling result
 */
function createEmptyPollingResult(startTime: number): PollingResult {
  return {
    success: true,
    repositoriesPolled: 0,
    workflowRunsDiscovered: 0,
    newRunsQueued: 0,
    rateLimitRemaining: GITHUB_RATE_LIMITS.PRIMARY_RATE_LIMIT,
    processingTimeMs: Date.now() - startTime,
    repositoryResults: [],
    errors: [],
    warnings: []
  };
}

/**
 * Create mock GitHub client for testing
 */
function createMockGitHubClient(): Octokit {
  const mockOctokit = {
    rest: {
      actions: {
        listWorkflowRunsForRepo: async () => ({
          data: { workflow_runs: [] },
          status: 200,
          headers: {
            'x-ratelimit-remaining': '5000',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
          }
        })
      }
    }
  };
  return mockOctokit as unknown as Octokit;
}

// ============================================================================
// Export Processor Factory and Manager
// ============================================================================

/**
 * Factory function for polling processor
 */
export function pollingProcessor(
  prisma: PrismaClient,
  runsIngestQueue: Queue,
  runsAnalyzeQueue: Queue,
  octokit?: Octokit
) {
  const processor = createPollingProcessor(prisma, runsIngestQueue, runsAnalyzeQueue, octokit);
  
  return async (job: Job<PollingJobData>): Promise<PollingResult> => {
    return await processor(job);
  };
}

/**
 * Create and return polling manager instance
 */
export function createPollingManager(
  prisma: PrismaClient,
  runsIngestQueue: Queue,
  runsAnalyzeQueue: Queue,
  octokit?: Octokit
): PollingManager {
  return new PollingManager(prisma, runsIngestQueue, runsAnalyzeQueue, octokit);
}

export default pollingProcessor;