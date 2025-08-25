import { PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { logger } from '../utils/logger.js';
import { databaseConnections, databaseConnectionPool } from '../utils/metrics.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    checkDatabaseHealth: () => Promise<{
      status: 'healthy' | 'unhealthy';
      responseTime?: number;
      error?: string;
      timestamp: string;
    }>;
  }
}

async function prismaPlugin(fastify: FastifyInstance) {
  // Configure Prisma with connection pooling and monitoring
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'info' },
          { emit: 'event', level: 'warn' },
        ]
      : [
          { emit: 'event', level: 'error' },
          { emit: 'event', level: 'warn' },
        ],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  // Set up event listeners for monitoring
  if (process.env.NODE_ENV === 'development') {
    prisma.$on('query', (e) => {
      if (e.duration > 1000) { // Log slow queries (>1s)
        logger.warn({
          query: e.query.slice(0, 200) + (e.query.length > 200 ? '...' : ''),
          duration: e.duration,
          params: e.params,
        }, 'Slow database query detected');
      }
    });
  }

  prisma.$on('error', (e) => {
    logger.error({ error: e }, 'Prisma database error');
  });

  prisma.$on('warn', (e) => {
    logger.warn({ message: e.message }, 'Prisma warning');
  });

  prisma.$on('info', (e) => {
    logger.info({ message: e.message }, 'Prisma info');
  });

  // Connect to database
  await prisma.$connect();
  
  logger.info('Prisma connected to database with connection pool monitoring');

  // Update connection metrics
  databaseConnections.set(1);

  // Decorate fastify instance
  fastify.decorate('prisma', prisma);

  // Set up periodic connection pool monitoring
  const monitoringInterval = setInterval(async () => {
    try {
      // Test database connectivity
      await prisma.$queryRaw`SELECT 1`;
      databaseConnections.set(1);
    } catch (error) {
      logger.error({ error }, 'Database connection health check failed');
      databaseConnections.set(0);
    }
  }, 30000); // Check every 30 seconds

  // Add middleware to track active connections
  fastify.addHook('onRequest', async () => {
    databaseConnectionPool.inc({ pool_status: 'active' });
  });

  fastify.addHook('onResponse', async () => {
    databaseConnectionPool.dec({ pool_status: 'active' });
  });

  // Cleanup on server shutdown
  fastify.addHook('onClose', async (server) => {
    clearInterval(monitoringInterval);
    databaseConnections.set(0);
    await server.prisma.$disconnect();
    logger.info('Prisma disconnected from database');
  });

  // Add database health check method
  fastify.decorate('checkDatabaseHealth', async () => {
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1 as health`;
      const duration = Date.now() - start;
      
      return {
        status: 'healthy',
        responseTime: duration,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  });
}

export default fp(prismaPlugin, {
  name: 'prisma',
});