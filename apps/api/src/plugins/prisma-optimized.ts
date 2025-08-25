import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { createOptimizedPrismaClient } from '../performance/database-pool.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

async function optimizedPrismaPlugin(fastify: FastifyInstance) {
  // Use optimized client with connection pooling
  const prisma = createOptimizedPrismaClient({
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '30'),
    minConnections: parseInt(process.env.DB_MIN_CONNECTIONS || '5'),
    queryTimeoutMs: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '30000'),
  });

  await prisma.$connect();
  
  logger.info('Optimized Prisma connected to database', {
    maxConnections: process.env.DB_MAX_CONNECTIONS || '30',
    queryTimeout: process.env.DB_QUERY_TIMEOUT_MS || '30000',
  });

  fastify.decorate('prisma', prisma);

  // Add performance monitoring
  fastify.addHook('onRequest', async (request) => {
    (request as any).dbStartTime = Date.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - ((request as any).dbStartTime || Date.now());
    if (duration > 1000) { // Log slow requests
      logger.warn('Slow database operation detected', {
        method: request.method,
        url: request.url,
        duration: duration,
        statusCode: reply.statusCode,
      });
    }
  });

  fastify.addHook('onClose', async (server) => {
    await server.prisma.$disconnect();
    logger.info('Optimized Prisma disconnected from database');
  });
}

export default fp(optimizedPrismaPlugin, {
  name: 'prisma-optimized',
});
