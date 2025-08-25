import IORedis, { Cluster, ClusterOptions, RedisOptions } from 'ioredis';

import { config } from '../config/index.js';

import { logger } from './logger.js';

/**
 * Create Redis connection with clustering support
 */
function createRedisConnection(): IORedis | Cluster {
  const baseOptions: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryDelayOnFailover: 100,
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
      clusterRetryDelayOnFailover: 100,
      scaleReads: 'slave',
      maxRedirections: 16,
    };

    logger.info({ nodes: clusterNodes }, 'Connecting to Redis Cluster');
    return new Cluster(clusterNodes, clusterOptions);
  } else {
    // Single Redis instance
    logger.info({ url: config.redisUrl }, 'Connecting to Redis');
    return new IORedis(config.redisUrl, baseOptions);
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

connection.on('error', (error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Redis connection error');
});

connection.on('close', () => {
  logger.warn('Redis connection closed');
});

connection.on('reconnecting', () => {
  logger.info('Reconnecting to Redis');
});

if (connection instanceof Cluster) {
  connection.on('node error', (error, node) => {
    logger.error({
      error: error.message,
      node: `${node.host}:${node.port}`
    }, 'Redis cluster node error');
  });

  connection.on('+node', (node) => {
    logger.info({ node: `${node.host}:${node.port}` }, 'Redis cluster node added');
  });

  connection.on('-node', (node) => {
    logger.warn({ node: `${node.host}:${node.port}` }, 'Redis cluster node removed');
  });

  connection.on('node end', (node) => {
    logger.warn({ node: `${node.host}:${node.port}` }, 'Redis cluster node disconnected');
  });
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  try {
    logger.info('Closing Redis connection');
    await connection.quit();
    logger.info('Redis connection closed successfully');
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error closing Redis connection');
    // Force disconnect if graceful close fails
    connection.disconnect();
  }
}

/**
 * Get Redis connection health status
 */
export function getRedisHealth() {
  return {
    status: connection.status,
    cluster: connection instanceof Cluster,
    nodes: connection instanceof Cluster ? connection.nodes().length : 1,
  };
}