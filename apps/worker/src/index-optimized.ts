/**
 * Optimized FlakeGuard Worker with Enhanced Performance
 */
import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { connection } from './utils/redis.js';
import { emailProcessor } from './processors/email.processor.js';
import { taskProcessor } from './processors/task.processor.js';
import { reportProcessor } from './processors/report.processor.js';
import { ingestionProcessor } from './processors/ingestion.processor.js';
import { QueueNames } from '@flakeguard/shared';
import { OptimizedWorkerManager } from '../../api/src/performance/worker-optimizations.js';

const prisma = new PrismaClient({
  log: ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL + (
        process.env.DATABASE_URL?.includes('?') ? '&' : '?'
      ) + 'connection_limit=20&pool_timeout=20',
    },
  },
});

const workerManager = new OptimizedWorkerManager();

async function start() {
  try {
    await prisma.$connect();
    logger.info('Connected to database with optimized settings');

    // Enhanced worker configurations
    const workerConfigs = {
      [QueueNames.EMAIL]: {
        concurrency: Math.min(config.workerConcurrency, 10),
        stalledInterval: 30000,
        maxStalledCount: 1,
      },
      [QueueNames.TASK]: {
        concurrency: Math.min(config.workerConcurrency, 8),
        stalledInterval: 30000,
        maxStalledCount: 1,
      },
      [QueueNames.REPORT]: {
        concurrency: Math.min(Math.floor(config.workerConcurrency / 2), 4),
        stalledInterval: 60000,
        maxStalledCount: 2,
      },
      [QueueNames.INGESTION]: {
        concurrency: Math.min(Math.floor(config.workerConcurrency / 3), 3), // Most resource-intensive
        stalledInterval: 120000, // 2 minutes
        maxStalledCount: 1,
      },
    };

    // Create optimized workers
    const emailWorker = workerManager.createOptimizedWorker(
      QueueNames.EMAIL,
      emailProcessor(prisma),
      workerConfigs[QueueNames.EMAIL]
    );

    const taskWorker = workerManager.createOptimizedWorker(
      QueueNames.TASK,
      taskProcessor(prisma),
      workerConfigs[QueueNames.TASK]
    );

    const reportWorker = workerManager.createOptimizedWorker(
      QueueNames.REPORT,
      reportProcessor(prisma),
      workerConfigs[QueueNames.REPORT]
    );

    const ingestionWorker = workerManager.createOptimizedWorker(
      QueueNames.INGESTION,
      ingestionProcessor(prisma),
      workerConfigs[QueueNames.INGESTION]
    );

    const workers = [emailWorker, taskWorker, reportWorker, ingestionWorker];

    // Enhanced event handlers
    workers.forEach((worker, index) => {
      const queueName = [QueueNames.EMAIL, QueueNames.TASK, QueueNames.REPORT, QueueNames.INGESTION][index];
      
      worker.on('completed', (job) => {
        logger.info('Job completed successfully', {
          jobId: job.id,
          queue: queueName,
          processingTime: Date.now() - job.processedOn!,
        });
      });

      worker.on('failed', (job, err) => {
        logger.error('Job failed', {
          jobId: job?.id,
          queue: queueName,
          error: err.message,
          failedReason: job?.failedReason,
          attemptsMade: job?.attemptsMade,
        });
      });

      worker.on('stalled', (jobId) => {
        logger.warn('Job stalled', { jobId, queue: queueName });
      });

      worker.on('error', (err) => {
        logger.error('Worker error', { queue: queueName, error: err.message });
      });
    });

    // Performance monitoring
    setInterval(() => {
      const metrics = Object.entries(workerConfigs).map(([queueName]) => {
        const workerMetrics = workerManager.getWorkerMetrics(queueName);
        return {
          queue: queueName,
          ...workerMetrics,
        };
      });
      
      logger.debug('Worker performance metrics', { metrics });
    }, 60000); // Every minute

    // Memory monitoring
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const memoryMB = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
      };
      
      // Log warning if memory usage is high
      if (memoryMB.heapUsed > 512) {
        logger.warn('High memory usage detected', memoryMB);
      }
      
      // Force garbage collection if available and memory is very high
      if (memoryMB.heapUsed > 1024 && global.gc) {
        logger.info('Forcing garbage collection due to high memory usage');
        global.gc();
      }
    }, 30000); // Every 30 seconds

    logger.info('Optimized workers started successfully', {
      workers: Object.keys(workerConfigs),
      totalConcurrency: Object.values(workerConfigs).reduce((sum, config) => sum + config.concurrency, 0),
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      
      const shutdownPromises = workers.map(worker => worker.close());
      await Promise.all(shutdownPromises);
      
      await prisma.$disconnect();
      await connection.quit();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error(error, 'Failed to start optimized workers');
    process.exit(1);
  }
}

start();
