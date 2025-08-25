/**
 * FlakeGuard Enhanced Background Worker System (P7)
 * 
 * Comprehensive background worker implementation with BullMQ featuring:
 * - Three core queues: runs:ingest, runs:analyze, tests:recompute
 * - Repeatable polling job for GitHub workflow runs
 * - Idempotency and reliability with exponential backoff
 * - Prometheus metrics and health checks
 * - Graceful shutdown and resource management
 * - Production-ready observability and monitoring
 */

import { 
  QueueNames, 
  WORKER_CONFIG,
  POLLING_CONFIG 
} from '@flakeguard/shared';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { PrismaClient } from '@prisma/client';
import { Worker, Queue, QueueEvents } from 'bullmq';

import { config } from './config/index.js';
import { emailProcessor } from './processors/email.processor.js';
import { githubWebhookProcessor } from './processors/github-webhook.processor.js';
import { ingestionProcessor } from './processors/ingestion.processor.js';
import { pollingProcessor, createPollingManager } from './processors/polling.processor.js';
import { reportProcessor } from './processors/report.processor.js';
import { runsAnalyzeProcessor } from './processors/runs-analyze.processor.js';
import { runsIngestProcessor } from './processors/runs-ingest.processor.js';
import { taskProcessor } from './processors/task.processor.js';
import { testsRecomputeProcessor } from './processors/tests-recompute.processor.js';
import { initializeHealthCheck, getHealthManager } from './utils/health.js';
import { logger } from './utils/logger.js';
import { initializeMetricsCollection, workerHealth, updateQueueMetrics } from './utils/metrics.js';
import { connection, closeRedisConnection } from './utils/redis.js';

// Import processors


// ============================================================================
// Global State
// ============================================================================

const prisma = new PrismaClient({
  log: config.env === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

let workers: Worker[] = [];
let queues: Queue[] = [];
let queueEvents: QueueEvents[] = [];
let pollingManager: any;
let healthManager: any;
let octokit: Octokit | undefined;

// ============================================================================
// GitHub Client Setup
// ============================================================================

/**
 * Initialize GitHub client with App authentication
 */
async function initializeGitHubClient(): Promise<Octokit | undefined> {
  if (!config.github.appId || !config.github.privateKey) {
    logger.warn('GitHub App credentials not configured, using mock client');
    return undefined;
  }
  
  try {
    const app = new App({
      appId: config.github.appId,
      privateKey: config.github.privateKey,
    });
    
    // Get installation access token (would be enhanced for multiple installations)
    const installations = await app.octokit.rest.apps.listInstallations();
    
    if (installations.data.length === 0) {
      logger.warn('No GitHub App installations found');
      return undefined;
    }
    
    const installationId = installations.data[0].id;
    const installationOctokit = await app.getInstallationOctokit(installationId);
    
    logger.info({ installationId }, 'GitHub client initialized');
    return installationOctokit;
    
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to initialize GitHub client');
    return undefined;
  }
}

// ============================================================================
// Queue Setup
// ============================================================================

/**
 * Create and configure all queues
 */
async function setupQueues(): Promise<{
  workers: Worker[];
  queues: Queue[];
  queueEvents: QueueEvents[];
}> {
  const workers: Worker[] = [];
  const queues: Queue[] = [];
  const queueEvents: QueueEvents[] = [];
  
  const defaultWorkerOptions = {
    connection,
    removeOnComplete: WORKER_CONFIG.REMOVE_ON_COMPLETE,
    removeOnFail: WORKER_CONFIG.REMOVE_ON_FAIL,
    stalledJobTimeout: WORKER_CONFIG.STALLED_JOB_TIMEOUT_MS,
    maxStalledCount: 3,
  };
  
  // Enhanced Background Worker Queues (P7)
  
  // 1. Runs Ingestion Queue
  const runsIngestQueue = new Queue(QueueNames.RUNS_INGEST, { connection });
  const runsIngestWorker = new Worker(
    QueueNames.RUNS_INGEST,
    runsIngestProcessor(prisma, octokit),
    {
      ...defaultWorkerOptions,
      concurrency: WORKER_CONFIG.HIGH_PRIORITY_CONCURRENCY,
    }
  );
  
  queues.push(runsIngestQueue);
  workers.push(runsIngestWorker);
  
  // 2. Runs Analysis Queue
  const runsAnalyzeQueue = new Queue(QueueNames.RUNS_ANALYZE, { connection });
  const runsAnalyzeWorker = new Worker(
    QueueNames.RUNS_ANALYZE,
    runsAnalyzeProcessor(prisma, octokit),
    {
      ...defaultWorkerOptions,
      concurrency: WORKER_CONFIG.HIGH_PRIORITY_CONCURRENCY,
    }
  );
  
  queues.push(runsAnalyzeQueue);
  workers.push(runsAnalyzeWorker);
  
  // 3. Tests Recompute Queue  
  const testsRecomputeQueue = new Queue(QueueNames.TESTS_RECOMPUTE, { connection });
  const testsRecomputeWorker = new Worker(
    QueueNames.TESTS_RECOMPUTE,
    testsRecomputeProcessor(prisma),
    {
      ...defaultWorkerOptions,
      concurrency: 2, // Lower concurrency for resource-intensive recompute
    }
  );
  
  queues.push(testsRecomputeQueue);
  workers.push(testsRecomputeWorker);
  
  // 4. Polling Queue (for periodic discovery)
  const pollingQueue = new Queue(QueueNames.POLLING, { connection });
  const pollingWorker = new Worker(
    QueueNames.POLLING,
    pollingProcessor(prisma, runsIngestQueue, runsAnalyzeQueue, octokit),
    {
      ...defaultWorkerOptions,
      concurrency: 1, // Single polling worker
    }
  );
  
  queues.push(pollingQueue);
  workers.push(pollingWorker);
  
  // Legacy queues (maintained for backward compatibility)
  
  // Email Worker
  const emailWorker = new Worker(
    QueueNames.EMAIL,
    emailProcessor(prisma),
    {
      ...defaultWorkerOptions,
      concurrency: config.workerConcurrency,
    }
  );
  workers.push(emailWorker);
  
  // Task Worker
  const taskWorker = new Worker(
    QueueNames.TASK,
    taskProcessor(prisma),
    {
      ...defaultWorkerOptions,
      concurrency: config.workerConcurrency,
    }
  );
  workers.push(taskWorker);
  
  // Report Worker
  const reportWorker = new Worker(
    QueueNames.REPORT,
    reportProcessor(prisma),
    {
      ...defaultWorkerOptions,
      concurrency: Math.floor(config.workerConcurrency / 2),
    }
  );
  workers.push(reportWorker);
  
  // Ingestion Worker (legacy)
  const ingestionWorker = new Worker(
    QueueNames.INGESTION,
    ingestionProcessor(prisma),
    {
      ...defaultWorkerOptions,
      concurrency: Math.floor(config.workerConcurrency / 2),
    }
  );
  workers.push(ingestionWorker);
  
  // GitHub Webhook Events Queue (P1 integration)
  const githubEventsQueue = new Queue('github-events', { connection });
  const githubWebhookWorker = new Worker(
    'github-events',
    githubWebhookProcessor(prisma),
    {
      ...defaultWorkerOptions,
      concurrency: WORKER_CONFIG.MEDIUM_PRIORITY_CONCURRENCY,
    }
  );
  queues.push(githubEventsQueue);
  workers.push(githubWebhookWorker);
  
  // Create Queue Events listeners for metrics
  for (const queue of queues) {
    const events = new QueueEvents(queue.name, { connection });
    queueEvents.push(events);
    
    // Set up metrics collection for each queue
    events.on('completed', () => {
      updateQueueMetricsForQueue(queue.name);
    });
    
    events.on('failed', () => {
      updateQueueMetricsForQueue(queue.name);
    });
  }
  
  logger.info({
    workersCreated: workers.length,
    queuesCreated: queues.length,
    enhancedQueues: [QueueNames.RUNS_INGEST, QueueNames.RUNS_ANALYZE, QueueNames.TESTS_RECOMPUTE, QueueNames.POLLING]
  }, 'All queues and workers created');
  
  return { workers, queues, queueEvents };
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Set up comprehensive event handlers for all workers
 */
function setupEventHandlers(workers: Worker[]): void {
  workers.forEach((worker) => {
    const queueName = worker.name;
    
    worker.on('ready', () => {
      logger.info({ queue: queueName }, 'Worker ready');
      workerHealth.set({ worker_name: `${config.workerName}-${queueName}` }, 1);
    });
    
    worker.on('completed', (job) => {
      logger.debug({
        jobId: job.id,
        queue: queueName,
        processingTime: job.processedOn ? Date.now() - job.processedOn : 0
      }, 'Job completed successfully');
    });
    
    worker.on('failed', (job, err) => {
      logger.error({
        jobId: job?.id,
        queue: queueName,
        error: err.message,
        stack: err.stack,
        attemptsMade: job?.attemptsMade,
        maxAttempts: job?.opts.attempts
      }, 'Job failed');
    });
    
    worker.on('error', (err) => {
      logger.error({
        queue: queueName,
        error: err.message,
        stack: err.stack
      }, 'Worker error');
      
      workerHealth.set({ worker_name: `${config.workerName}-${queueName}` }, 0);
    });
    
    worker.on('stalled', (jobId) => {
      logger.warn({ jobId, queue: queueName }, 'Job stalled');
    });
    
    worker.on('progress', (job, progress) => {
      logger.debug({
        jobId: job.id,
        queue: queueName,
        progress
      }, 'Job progress update');
    });
  });
  
  logger.info({ workers: workers.length }, 'Event handlers set up for all workers');
}

// ============================================================================
// Metrics Collection
// ============================================================================

/**
 * Update queue metrics for a specific queue
 */
async function updateQueueMetricsForQueue(queueName: string): Promise<void> {
  try {
    const queue = queues.find(q => q.name === queueName);
    if (!queue) return;
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(), 
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed()
    ]);
    
    updateQueueMetrics(
      queueName,
      waiting.length,
      active.length,
      completed.length,
      failed.length,
      delayed.length
    );
  } catch (error) {
    logger.warn({
      queueName,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to update queue metrics');
  }
}

/**
 * Set up periodic metrics collection
 */
function setupMetricsCollection(): void {
  // Update queue metrics every 30 seconds
  setInterval(async () => {
    try {
      await Promise.all(
        queues.map(queue => updateQueueMetricsForQueue(queue.name))
      );
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Metrics collection error');
    }
  }, 30000);
}

// ============================================================================
// Main Application
// ============================================================================

/**
 * Main application startup
 */
async function start(): Promise<void> {
  try {
    logger.info({ 
      version: '1.0.0',
      environment: config.env,
      workerName: config.workerName,
      concurrency: config.workerConcurrency
    }, 'Starting FlakeGuard Enhanced Worker System');
    
    // Initialize metrics collection
    initializeMetricsCollection();
    
    // Initialize health check system
    healthManager = await initializeHealthCheck(prisma);
    
    // Connect to database
    await prisma.$connect();
    logger.info('Connected to database');
    
    // Initialize GitHub client
    octokit = await initializeGitHubClient();
    
    // Set up queues and workers
    const queueSetup = await setupQueues();
    workers = queueSetup.workers;
    queues = queueSetup.queues;
    queueEvents = queueSetup.queueEvents;
    
    // Register queues with health manager
    for (const queue of queues) {
      healthManager.registerQueue(queue.name, queue);
    }
    
    // Set up event handlers
    setupEventHandlers(workers);
    
    // Set up metrics collection
    setupMetricsCollection();
    
    // Initialize polling manager if enabled
    if (config.polling.enabled) {
      const runsIngestQueue = queues.find(q => q.name === QueueNames.RUNS_INGEST)!;
      const runsAnalyzeQueue = queues.find(q => q.name === QueueNames.RUNS_ANALYZE)!;
      
      pollingManager = createPollingManager(prisma, runsIngestQueue, runsAnalyzeQueue, octokit);
      await pollingManager.initialize();
      
      logger.info('Polling manager initialized');
    }
    
    // Log successful startup
    logger.info({
      workers: workers.map(w => w.name),
      queues: queues.map(q => q.name),
      pollingEnabled: config.polling.enabled,
      metricsEnabled: config.metrics.enabled,
      healthCheckPort: config.healthCheck.port
    }, 'FlakeGuard Enhanced Worker System started successfully');
    
    // Set overall system health
    workerHealth.set({ worker_name: config.workerName }, 1);
    
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, 'Failed to start FlakeGuard Worker System');
    
    // Set unhealthy status
    workerHealth.set({ worker_name: config.workerName }, 0);
    
    process.exit(1);
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

/**
 * Comprehensive graceful shutdown handling
 */
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  // Set unhealthy status
  workerHealth.set({ worker_name: config.workerName }, 0);
  
  const shutdownTimeout = 30000; // 30 seconds
  const shutdownPromise = performShutdown();
  
  // Race shutdown against timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Shutdown timeout')), shutdownTimeout);
  });
  
  try {
    await Promise.race([shutdownPromise, timeoutPromise]);
    logger.info('Graceful shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Shutdown timeout, forcing exit');
    process.exit(1);
  }
}

/**
 * Perform the actual shutdown sequence
 */
async function performShutdown(): Promise<void> {
  const shutdownSteps: Array<{ name: string; fn: () => Promise<void> }> = [];
  
  // 1. Stop polling manager
  if (pollingManager) {
    shutdownSteps.push({
      name: 'polling manager',
      fn: () => pollingManager.shutdown()
    });
  }
  
  // 2. Stop accepting new jobs (pause workers)
  shutdownSteps.push({
    name: 'pause workers',
    fn: async () => {
      await Promise.all(workers.map(worker => worker.pause()));
      logger.debug('All workers paused');
    }
  });
  
  // 3. Wait for active jobs to complete and close workers
  shutdownSteps.push({
    name: 'close workers',
    fn: async () => {
      await Promise.all(workers.map(worker => worker.close()));
      logger.debug('All workers closed');
    }
  });
  
  // 4. Close queue events
  shutdownSteps.push({
    name: 'close queue events',
    fn: async () => {
      await Promise.all(queueEvents.map(events => events.close()));
      logger.debug('All queue events closed');
    }
  });
  
  // 5. Close queues
  shutdownSteps.push({
    name: 'close queues',
    fn: async () => {
      await Promise.all(queues.map(queue => queue.close()));
      logger.debug('All queues closed');
    }
  });
  
  // 6. Stop health check server
  if (healthManager) {
    shutdownSteps.push({
      name: 'health check server',
      fn: () => healthManager.stop()
    });
  }
  
  // 7. Close database connection
  shutdownSteps.push({
    name: 'database connection',
    fn: () => prisma.$disconnect()
  });
  
  // 8. Close Redis connection
  shutdownSteps.push({
    name: 'Redis connection',
    fn: () => closeRedisConnection()
  });
  
  // Execute shutdown steps
  for (const step of shutdownSteps) {
    try {
      logger.debug(`Shutting down ${step.name}...`);
      await step.fn();
      logger.debug(`${step.name} shutdown complete`);
    } catch (error) {
      logger.error({
        step: step.name,
        error: error instanceof Error ? error.message : String(error)
      }, `Error during ${step.name} shutdown`);
    }
  }
}

// ============================================================================
// Signal Handlers
// ============================================================================

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal({
    error: error.message,
    stack: error.stack
  }, 'Uncaught exception, shutting down');
  
  workerHealth.set({ worker_name: config.workerName }, 0);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({
    reason,
    promise
  }, 'Unhandled promise rejection, shutting down');
  
  workerHealth.set({ worker_name: config.workerName }, 0);
  process.exit(1);
});

// ============================================================================
// Application Entry Point
// ============================================================================

// Start the application
start().catch((error) => {
  logger.fatal({
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  }, 'Failed to start application');
  
  process.exit(1);
});
import { slackProcessor } from './processors/slack.processor.js';

// Update worker initialization to include Slack processor
async function createWorkers() {
  // ... existing worker creation code ...
  
  // Add Slack notification worker
  const slackWorker = new Worker(
    QueueNames.SLACK,
    slackProcessor(prisma),
    {
      connection,
      concurrency: 5, // High concurrency for notifications
    }
  );

  workers.push(slackWorker);
  
  // Set up Slack worker event handlers
  slackWorker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, type: job.data.type, repository: job.data.repository },
      'Slack notification sent successfully'
    );
  });

  slackWorker.on('failed', (job, err) => {
    logger.error(
      { 
        jobId: job?.id, 
        type: job?.data?.type,
        repository: job?.data?.repository,
        error: err.message 
      },
      'Slack notification failed'
    );
  });
}
