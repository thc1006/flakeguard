/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-redundant-type-constituents */

import Redis, { Cluster, type ClusterOptions, type RedisOptions } from 'ioredis';

import { config } from '../config/index.js';

import { logger } from './logger.js';

/**
 * Create Redis connection with clustering support
 */
function createRedisConnection(): Redis | Cluster {
  const baseOptions: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // retryDelayOnFailover: 100, // Invalid option
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 10000,
    commandTimeout: 5000,
    // Connection pool settings
    keepAlive: 30000,
    // Memory optimization
    maxMemoryPolicy: 'allkeys-lru',
  };

  if (config.redisClusterEnabled && config.redisClusterNodes) {
    // Redis Cluster configuration
    const clusterNodes = config.redisClusterNodes.split(',').map(node => {
      const [host, port] = node.trim().split(':');
      return { host, port: parseInt(port, 10) || 6379 };
    });

    const clusterOptions: ClusterOptions = {
      ...baseOptions,
      enableReadyCheck: false,
      redisOptions: baseOptions,
      retryDelayOnFailover: 100,
      scaleReads: 'slave',
      maxRedirections: 16,
    };

    logger.info({ nodes: clusterNodes }, 'Connecting to Redis Cluster');
    return new Cluster(clusterNodes, clusterOptions);
  } else {
    // Single Redis instance
    logger.info({ url: config.redisUrl }, 'Connecting to Redis');
    return new Redis(config.redisUrl || 'redis://localhost:6379', baseOptions);
  }
}

export const connection = createRedisConnection();

// Enhanced connection event handling
connection.on('connect', () => {
  logger.info({
    cluster: config.redisClusterEnabled,
    mode: connection instanceof Cluster ? 'cluster' : 'standalone'
  }, 'Connected to Redis');
});

connection.on('ready', () => {
  logger.info('Redis connection ready');
});

connection.on('error', (error: Error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Redis connection error');
});

connection.on('close', () => {
  logger.warn('Redis connection closed');
});

connection.on('reconnecting', () => {
  logger.info('Reconnecting to Redis');
});

if (connection instanceof Cluster) {
  connection.on('node error', (error: Error, node: { host: string; port: number }) => {
    logger.error({
      error: error.message,
      node: `${node.host}:${node.port}`
    }, 'Redis cluster node error');
  });

  connection.on('+node', (node: { host: string; port: number }) => {
    logger.info({ node: `${node.host}:${node.port}` }, 'Redis cluster node added');
  });

  connection.on('-node', (node: { host: string; port: number }) => {
    logger.warn({ node: `${node.host}:${node.port}` }, 'Redis cluster node removed');
  });

  connection.on('node end', (node: { host: string; port: number }) => {
    logger.warn({ node: `${node.host}:${node.port}` }, 'Redis cluster node disconnected');
  });
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  try {
    logger.info('Closing Redis connection');
    await (connection as Redis).quit();
    logger.info('Redis connection closed successfully');
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error closing Redis connection');
    // Force disconnect if graceful close fails
    (connection as Redis).disconnect();
  }
}

/**
 * Get Redis connection health status
 */
export function getRedisHealth(): {
  status: string;
  cluster: boolean;
  nodes: number;
} {
  return {
    status: (connection as Redis).status,
    cluster: connection instanceof Cluster,
    nodes: connection instanceof Cluster ? connection.nodes().length : 1,
  };
}