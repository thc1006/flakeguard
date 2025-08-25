#!/usr/bin/env node

/**
 * Load Testing Script for FlakeGuard Worker System
 * 
 * Generates realistic workloads to test worker performance,
 * queue throughput, and system stability under load.
 */

import { faker } from '@faker-js/faker';
import { Queue } from 'bullmq';
import { program } from 'commander';
import IORedis from 'ioredis';
import pino from 'pino';

// ============================================================================
// Configuration
// ============================================================================

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'HH:MM:ss Z',
    },
  },
});

const QUEUE_NAMES = {
  RUNS_INGEST: 'runs:ingest',
  RUNS_ANALYZE: 'runs:analyze',
  TESTS_RECOMPUTE: 'tests:recompute',
  POLLING: 'polling',
};

const JOB_PRIORITIES = ['low', 'normal', 'high', 'critical'];
const TEST_FRAMEWORKS = ['jest', 'mocha', 'junit', 'pytest', 'rspec'];
const REPOSITORY_PATTERNS = [
  { owner: 'facebook', repo: 'react' },
  { owner: 'microsoft', repo: 'typescript' },
  { owner: 'nodejs', repo: 'node' },
  { owner: 'kubernetes', repo: 'kubernetes' },
  { owner: 'docker', repo: 'docker' },
  { owner: 'prometheus', repo: 'prometheus' },
  { owner: 'grafana', repo: 'grafana' },
  { owner: 'elastic', repo: 'elasticsearch' },
];

// ============================================================================
// Load Test Runner
// ============================================================================

class LoadTestRunner {
  constructor(options) {
    this.options = options;
    this.redis = new IORedis(options.redisUrl);
    this.queues = {};
    this.stats = {
      jobsEnqueued: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      startTime: Date.now(),
      errors: [],
    };
    
    // Initialize queues
    for (const [name, queueName] of Object.entries(QUEUE_NAMES)) {
      this.queues[name] = new Queue(queueName, { connection: this.redis });
    }
  }

  /**
   * Run the load test
   */
  async run() {
    logger.info({
      jobs: this.options.jobs,
      concurrency: this.options.concurrency,
      duration: this.options.duration,
      scenario: this.options.scenario,
    }, 'Starting load test');

    // Set up monitoring
    this.startMonitoring();

    // Run the test scenario
    try {
      await this.runScenario();
    } catch (error) {
      logger.error({ error: error.message }, 'Load test failed');
      this.stats.errors.push(error.message);
    }

    // Wait for jobs to complete
    await this.waitForCompletion();

    // Print final statistics
    this.printStats();

    // Cleanup
    await this.cleanup();
  }

  /**
   * Run specific test scenario
   */
  async runScenario() {
    switch (this.options.scenario) {
      case 'ingestion':
        await this.runIngestionScenario();
        break;
      case 'analysis':
        await this.runAnalysisScenario();
        break;
      case 'recompute':
        await this.runRecomputeScenario();
        break;
      case 'mixed':
        await this.runMixedScenario();
        break;
      case 'burst':
        await this.runBurstScenario();
        break;
      case 'sustained':
        await this.runSustainedScenario();
        break;
      default:
        throw new Error(`Unknown scenario: ${this.options.scenario}`);
    }
  }

  /**
   * Ingestion load test - simulates workflow run processing
   */
  async runIngestionScenario() {
    logger.info('Running ingestion load test scenario');

    const jobs = Array.from({ length: this.options.jobs }, () => ({
      name: 'runs-ingest-load-test',
      data: this.generateRunsIngestJob(),
      opts: {
        priority: this.getRandomPriority(),
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    }));

    await this.enqueueJobsWithConcurrency(this.queues.RUNS_INGEST, jobs);
  }

  /**
   * Analysis load test - simulates flakiness analysis
   */
  async runAnalysisScenario() {
    logger.info('Running analysis load test scenario');

    const jobs = Array.from({ length: this.options.jobs }, () => ({
      name: 'runs-analyze-load-test',
      data: this.generateRunsAnalyzeJob(),
      opts: {
        priority: this.getRandomPriority(),
        attempts: 3,
        removeOnComplete: false,
        removeOnFail: false,
      },
    }));

    await this.enqueueJobsWithConcurrency(this.queues.RUNS_ANALYZE, jobs);
  }

  /**
   * Recompute load test - simulates batch recomputation
   */
  async runRecomputeScenario() {
    logger.info('Running recompute load test scenario');

    const jobs = Array.from({ length: Math.min(this.options.jobs, 50) }, () => ({
      name: 'tests-recompute-load-test',
      data: this.generateTestsRecomputeJob(),
      opts: {
        priority: this.getRandomPriority(),
        attempts: 2,
        removeOnComplete: false,
        removeOnFail: false,
      },
    }));

    await this.enqueueJobsWithConcurrency(this.queues.TESTS_RECOMPUTE, jobs);
  }

  /**
   * Mixed workload - realistic production scenario
   */
  async runMixedScenario() {
    logger.info('Running mixed workload scenario');

    const distribution = {
      ingestion: 0.5,
      analysis: 0.3,
      recompute: 0.1,
      polling: 0.1,
    };

    const jobs = Array.from({ length: this.options.jobs }, () => {
      const rand = Math.random();
      let jobType;

      if (rand < distribution.ingestion) {
        jobType = 'ingestion';
      } else if (rand < distribution.ingestion + distribution.analysis) {
        jobType = 'analysis';
      } else if (rand < distribution.ingestion + distribution.analysis + distribution.recompute) {
        jobType = 'recompute';
      } else {
        jobType = 'polling';
      }

      return this.createJobForType(jobType);
    });

    // Group jobs by type and enqueue
    const jobsByType = jobs.reduce((acc, job) => {
      if (!acc[job.type]) {acc[job.type] = [];}
      acc[job.type].push(job);
      return acc;
    }, {});

    const promises = Object.entries(jobsByType).map(([type, typeJobs]) => {
      const queue = this.getQueueForType(type);
      return this.enqueueJobsWithConcurrency(queue, typeJobs);
    });

    await Promise.all(promises);
  }

  /**
   * Burst scenario - sudden spike in job volume
   */
  async runBurstScenario() {
    logger.info('Running burst load test scenario');

    // Normal load for 30 seconds
    await this.runContinuousLoad(this.options.jobs * 0.2, 30000);

    // Burst load for 60 seconds
    logger.info('Starting burst phase');
    await this.runContinuousLoad(this.options.jobs * 0.8, 60000);

    // Cool down for 30 seconds
    logger.info('Starting cool down phase');
    await this.runContinuousLoad(this.options.jobs * 0.1, 30000);
  }

  /**
   * Sustained load scenario - constant rate over time
   */
  async runSustainedScenario() {
    logger.info('Running sustained load test scenario');

    const duration = this.options.duration || 300000; // 5 minutes
    const jobsPerSecond = this.options.jobs / (duration / 1000);
    const interval = 1000 / jobsPerSecond;

    let jobsEnqueued = 0;
    const startTime = Date.now();

    while (Date.now() - startTime < duration && jobsEnqueued < this.options.jobs) {
      const job = this.createJobForType('mixed');
      const queue = this.getQueueForType(job.type);
      
      await queue.add(job.name, job.data, job.opts);
      jobsEnqueued++;
      this.stats.jobsEnqueued++;

      if (interval > 0) {
        await this.sleep(interval);
      }
    }
  }

  /**
   * Run continuous load for specified duration
   */
  async runContinuousLoad(jobCount, duration) {
    const startTime = Date.now();
    const jobsPerMs = jobCount / duration;
    let jobsEnqueued = 0;

    while (Date.now() - startTime < duration && jobsEnqueued < jobCount) {
      const job = this.createJobForType('mixed');
      const queue = this.getQueueForType(job.type);
      
      await queue.add(job.name, job.data, job.opts);
      jobsEnqueued++;
      this.stats.jobsEnqueued++;

      const elapsed = Date.now() - startTime;
      const expectedJobs = Math.floor(elapsed * jobsPerMs);
      const delay = Math.max(0, (expectedJobs - jobsEnqueued) * (1 / jobsPerMs));
      
      if (delay > 0) {
        await this.sleep(delay);
      }
    }
  }

  /**
   * Enqueue jobs with concurrency control
   */
  async enqueueJobsWithConcurrency(queue, jobs) {
    const concurrency = this.options.concurrency || 10;
    const chunks = this.chunkArray(jobs, concurrency);

    for (const chunk of chunks) {
      const promises = chunk.map(async (job) => {
        try {
          await queue.add(job.name, job.data, job.opts);
          this.stats.jobsEnqueued++;
        } catch (error) {
          logger.error({ error: error.message, job: job.name }, 'Failed to enqueue job');
          this.stats.errors.push(error.message);
        }
      });

      await Promise.all(promises);

      // Small delay between chunks to avoid overwhelming the system
      await this.sleep(100);
    }
  }

  /**
   * Generate realistic runs ingestion job data
   */
  generateRunsIngestJob() {
    const repo = faker.helpers.arrayElement(REPOSITORY_PATTERNS);
    
    return {
      workflowRunId: faker.number.int({ min: 100000, max: 999999 }),
      repository: {
        owner: repo.owner,
        repo: repo.repo,
        installationId: faker.number.int({ min: 1000, max: 9999 }),
      },
      correlationId: `load-test-${faker.string.uuid()}`,
      priority: this.getRandomPriority(),
      triggeredBy: 'load-test',
      metadata: {
        runStatus: 'completed',
        conclusion: faker.helpers.arrayElement(['success', 'failure', 'cancelled']),
        headSha: faker.git.commitSha(),
        headBranch: faker.helpers.arrayElement(['main', 'develop', 'feature/test', 'fix/bug']),
        runNumber: faker.number.int({ min: 1, max: 1000 }),
      },
    };
  }

  /**
   * Generate realistic runs analysis job data
   */
  generateRunsAnalyzeJob() {
    const repo = faker.helpers.arrayElement(REPOSITORY_PATTERNS);
    
    return {
      workflowRunId: faker.number.int({ min: 100000, max: 999999 }),
      repository: {
        owner: repo.owner,
        repo: repo.repo,
        installationId: faker.number.int({ min: 1000, max: 9999 }),
      },
      correlationId: `load-test-${faker.string.uuid()}`,
      priority: this.getRandomPriority(),
      forceRecompute: faker.datatype.boolean(),
      analysisConfig: {
        lookbackDays: faker.helpers.arrayElement([7, 14, 30]),
        minRunsThreshold: faker.helpers.arrayElement([5, 10, 15]),
      },
    };
  }

  /**
   * Generate realistic tests recompute job data
   */
  generateTestsRecomputeJob() {
    const repo = faker.helpers.arrayElement(REPOSITORY_PATTERNS);
    const scopeType = faker.helpers.arrayElement(['all', 'test_pattern', 'class_pattern']);
    
    return {
      repository: {
        owner: repo.owner,
        repo: repo.repo,
      },
      recomputeScope: {
        type: scopeType,
        patterns: scopeType !== 'all' ? [
          faker.helpers.arrayElement(['Test', 'Spec', 'Integration', 'Unit'])
        ] : undefined,
        lookbackDays: faker.helpers.arrayElement([30, 60, 90]),
        minRunsThreshold: faker.helpers.arrayElement([5, 10, 20]),
      },
      correlationId: `load-test-${faker.string.uuid()}`,
      priority: this.getRandomPriority(),
      triggeredBy: 'load-test',
      options: {
        batchSize: faker.helpers.arrayElement([25, 50, 100]),
        updateQuarantineStatus: faker.datatype.boolean(),
      },
    };
  }

  /**
   * Create job for specific type
   */
  createJobForType(type) {
    const baseJob = {
      name: `${type}-load-test`,
      opts: {
        priority: this.getRandomPriority(),
        attempts: 3,
        removeOnComplete: false,
        removeOnFail: false,
      },
    };

    switch (type) {
      case 'ingestion':
        return {
          ...baseJob,
          type: 'ingestion',
          data: this.generateRunsIngestJob(),
        };
      case 'analysis':
        return {
          ...baseJob,
          type: 'analysis',
          data: this.generateRunsAnalyzeJob(),
        };
      case 'recompute':
        return {
          ...baseJob,
          type: 'recompute',
          data: this.generateTestsRecomputeJob(),
        };
      case 'mixed':
        const randomType = faker.helpers.arrayElement(['ingestion', 'analysis', 'recompute']);
        return this.createJobForType(randomType);
      default:
        return this.createJobForType('ingestion');
    }
  }

  /**
   * Get queue for job type
   */
  getQueueForType(type) {
    switch (type) {
      case 'ingestion':
        return this.queues.RUNS_INGEST;
      case 'analysis':
        return this.queues.RUNS_ANALYZE;
      case 'recompute':
        return this.queues.TESTS_RECOMPUTE;
      default:
        return this.queues.RUNS_INGEST;
    }
  }

  /**
   * Get random priority
   */
  getRandomPriority() {
    return faker.helpers.arrayElement(JOB_PRIORITIES);
  }

  /**
   * Start monitoring job completion
   */
  startMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        const queueStats = await this.getQueueStats();
        const totalCompleted = Object.values(queueStats).reduce((sum, stats) => sum + stats.completed, 0);
        const totalFailed = Object.values(queueStats).reduce((sum, stats) => sum + stats.failed, 0);
        
        this.stats.jobsCompleted = totalCompleted;
        this.stats.jobsFailed = totalFailed;

        const elapsed = Date.now() - this.stats.startTime;
        const throughput = totalCompleted / (elapsed / 1000);

        logger.info({
          enqueued: this.stats.jobsEnqueued,
          completed: totalCompleted,
          failed: totalFailed,
          throughput: `${throughput.toFixed(2)} jobs/sec`,
          elapsed: `${(elapsed / 1000).toFixed(1)}s`,
          queueStats,
        }, 'Load test progress');
      } catch (error) {
        logger.warn({ error: error.message }, 'Monitoring error');
      }
    }, 5000);
  }

  /**
   * Get statistics for all queues
   */
  async getQueueStats() {
    const stats = {};

    for (const [name, queue] of Object.entries(this.queues)) {
      try {
        const [waiting, active, completed, failed] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed(),
        ]);

        stats[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
        };
      } catch (error) {
        stats[name] = { error: error.message };
      }
    }

    return stats;
  }

  /**
   * Wait for jobs to complete
   */
  async waitForCompletion() {
    logger.info('Waiting for jobs to complete...');

    const maxWaitTime = 300000; // 5 minutes
    const startWait = Date.now();

    while (Date.now() - startWait < maxWaitTime) {
      const queueStats = await this.getQueueStats();
      const totalActive = Object.values(queueStats).reduce((sum, stats) => sum + (stats.active || 0), 0);
      const totalWaiting = Object.values(queueStats).reduce((sum, stats) => sum + (stats.waiting || 0), 0);

      if (totalActive === 0 && totalWaiting === 0) {
        logger.info('All jobs completed');
        break;
      }

      logger.debug({ totalActive, totalWaiting }, 'Waiting for jobs to complete');
      await this.sleep(2000);
    }
  }

  /**
   * Print final statistics
   */
  printStats() {
    const elapsed = Date.now() - this.stats.startTime;
    const throughput = this.stats.jobsCompleted / (elapsed / 1000);
    const errorRate = (this.stats.jobsFailed / this.stats.jobsEnqueued) * 100;

    logger.info({
      summary: {
        jobsEnqueued: this.stats.jobsEnqueued,
        jobsCompleted: this.stats.jobsCompleted,
        jobsFailed: this.stats.jobsFailed,
        throughput: `${throughput.toFixed(2)} jobs/sec`,
        errorRate: `${errorRate.toFixed(2)}%`,
        totalTime: `${(elapsed / 1000).toFixed(1)}s`,
      },
      errors: this.stats.errors,
    }, 'Load test completed');
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    for (const queue of Object.values(this.queues)) {
      await queue.close();
    }

    await this.redis.quit();
  }

  /**
   * Utility functions
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

program
  .name('load-test')
  .description('Load testing tool for FlakeGuard Worker System')
  .version('1.0.0');

program
  .option('-j, --jobs <number>', 'Number of jobs to enqueue', '100')
  .option('-c, --concurrency <number>', 'Concurrency level', '10')
  .option('-s, --scenario <type>', 'Test scenario', 'mixed')
  .option('-d, --duration <ms>', 'Duration for sustained tests', '300000')
  .option('-r, --redis-url <url>', 'Redis connection URL', 'redis://localhost:6379')
  .option('--clean', 'Clean queues before starting', false);

program.parse();

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const options = program.opts();
  
  // Parse numeric options
  options.jobs = parseInt(options.jobs, 10);
  options.concurrency = parseInt(options.concurrency, 10);
  options.duration = parseInt(options.duration, 10);

  // Validate options
  if (options.jobs <= 0 || options.concurrency <= 0) {
    logger.error('Jobs and concurrency must be positive numbers');
    process.exit(1);
  }

  const validScenarios = ['ingestion', 'analysis', 'recompute', 'mixed', 'burst', 'sustained'];
  if (!validScenarios.includes(options.scenario)) {
    logger.error(`Invalid scenario. Must be one of: ${validScenarios.join(', ')}`);
    process.exit(1);
  }

  // Clean queues if requested
  if (options.clean) {
    logger.info('Cleaning queues before starting load test');
    const redis = new IORedis(options.redisUrl);
    
    for (const queueName of Object.values(QUEUE_NAMES)) {
      const queue = new Queue(queueName, { connection: redis });
      await queue.obliterate({ force: true });
      await queue.close();
    }
    
    await redis.quit();
    logger.info('Queues cleaned');
  }

  // Run load test
  const runner = new LoadTestRunner(options);
  
  try {
    await runner.run();
    process.exit(0);
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Load test failed');
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

main();