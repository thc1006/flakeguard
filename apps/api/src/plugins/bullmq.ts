/**
 * BullMQ Fastify Plugin - P1 Implementation Support
 * 
 * Provides BullMQ queue integration for Fastify to support the P1 GitHub webhook requirements.
 * This plugin adds queue functionality to the Fastify instance so webhook routes can enqueue jobs.
 */

import { Queue, QueueEvents } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';

import { logger } from '../utils/logger.js';

// Queue configuration
export interface BullMQPluginOptions {
  redisUrl?: string;
  redisOptions?: RedisOptions;
  queues: {
    githubEvents: {
      name: string;
      defaultJobOptions?: any;
    };
  };
  enabled?: boolean;
}

// Default configuration
const DEFAULT_OPTIONS: BullMQPluginOptions = {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  queues: {
    githubEvents: {
      name: 'github-events',
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    },
  },
  enabled: process.env.NODE_ENV !== 'test',
};

declare module 'fastify' {
  interface FastifyInstance {
    queue: Queue;
    ingestionQueue: Queue;
    redis: Redis;
  }
}

async function bullmqPlugin(
  fastify: FastifyInstance,
  options: Partial<BullMQPluginOptions> = {}
) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  if (!config.enabled) {
    logger.debug('BullMQ plugin disabled');
    
    // Provide mock implementations for testing
    const mockQueue = {
      add: async () => ({ id: 'mock-job-id' }),
      close: async () => {},
    } as any;

    fastify.decorate('queue', mockQueue);
    fastify.decorate('ingestionQueue', mockQueue);
    fastify.decorate('redis', {} as any);
    
    return;
  }

  // Use imported logger instead of fastify.log

  try {
    // Create Redis connection
    const redis = new Redis(config.redisUrl!, {
      ...config.redisOptions,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableAutoPipelining: true,
    });

    // Wait for Redis connection
    await redis.connect();
    
    logger.debug({ redisUrl: config.redisUrl }, 'Connected to Redis for BullMQ');

    // Create GitHub events queue
    const githubEventsQueue = new Queue(
      config.queues.githubEvents.name,
      {
        connection: redis,
        defaultJobOptions: config.queues.githubEvents.defaultJobOptions,
      }
    );

    // Create queue events for monitoring
    const queueEvents = new QueueEvents(config.queues.githubEvents.name, {
      connection: redis,
    });

    // Set up queue event logging
    queueEvents.on('completed', ({ jobId, returnvalue }) => {
      logger.debug({ jobId, returnvalue }, 'GitHub webhook job completed');
    });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error({ jobId, failedReason }, 'GitHub webhook job failed');
    });

    queueEvents.on('stalled', ({ jobId }) => {
      logger.warn({ jobId }, 'GitHub webhook job stalled');
    });

    // Create ingestion queue as well
    const ingestionQueue = new Queue('ingestion-jobs', {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 25,
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    // Decorate Fastify instance with queues and Redis connection
    fastify.decorate('queue', githubEventsQueue);
    fastify.decorate('ingestionQueue', ingestionQueue);
    fastify.decorate('redis', redis);

    // Add graceful shutdown
    fastify.addHook('onClose', async () => {
      logger.debug('Closing BullMQ connections...');
      
      try {
        await githubEventsQueue.close();
        await ingestionQueue.close();
        await queueEvents.close();
        await redis.disconnect();
        logger.debug('BullMQ connections closed successfully');
      } catch (error) {
        logger.error({ error }, 'Error closing BullMQ connections');
      }
    });

    logger.debug({
      queueName: config.queues.githubEvents.name,
      defaultJobOptions: config.queues.githubEvents.defaultJobOptions,
    }, 'BullMQ plugin registered successfully');

  } catch (error) {
    logger.error({ error }, 'Failed to initialize BullMQ plugin');
    throw error;
  }
}

export default fp(bullmqPlugin, {
  name: 'bullmq',
  dependencies: [],
});

export { bullmqPlugin };