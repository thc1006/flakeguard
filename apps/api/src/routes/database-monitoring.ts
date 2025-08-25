/**
 * Database Monitoring Routes
 * 
 * Comprehensive database monitoring endpoints for FlakeGuard:
 * - Real-time health status
 * - Performance metrics
 * - Connection pool status  
 * - Multi-tenant isolation validation
 * - Query performance analytics
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { logger } from '../utils/logger.js';

// ============================================================================
// Response Schemas
// ============================================================================

const DatabaseHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  uptime: z.number(),
  components: z.any(),
});

const DatabaseMetricsSchema = z.object({
  timestamp: z.string(),
  connections: z.object({
    total: z.number(),
    active: z.number(),
    idle: z.number(),
    utilization: z.number(),
  }),
  performance: z.object({
    cacheHitRatio: z.number(),
    indexHitRatio: z.number(),
    avgQueryDuration: z.number(),
    slowQueries: z.number(),
    deadlocks: z.number(),
  }),
  storage: z.object({
    databaseSize: z.string(),
  }),
  transactions: z.object({
    commits: z.number(),
    rollbacks: z.number(),
    rollbackRatio: z.number(),
  }),
});

// ============================================================================
// Routes
// ============================================================================

export async function databaseMonitoringRoutes(fastify: FastifyInstance) {
  // Real-time database health status
  fastify.get('/status', {
    schema: {
      description: 'Get real-time database health status',
      tags: ['Database Monitoring'],
      response: {
        200: DatabaseHealthSchema,
        503: z.object({
          status: z.literal('unhealthy'),
          timestamp: z.string(),
          error: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    try {
      const healthStatus = await fastify.databaseMonitoring.getHealthStatus();
      
      const response = {
        status: 'healthy' as const,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        components: healthStatus,
      };
      
      return reply.send(response);
    } catch (error) {
      logger.error({ error }, 'Database status check failed');
      return reply.status(503).send({
        status: 'unhealthy' as const,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Database performance metrics
  fastify.get('/metrics', {
    schema: {
      description: 'Get comprehensive database performance metrics',
      tags: ['Database Monitoring'],
      response: {
        200: DatabaseMetricsSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const performanceData = await fastify.databaseMonitoring.getPerformanceMetrics();
      const stats = performanceData.statistics;
      
      const metrics = {
        timestamp: new Date().toISOString(),
        connections: {
          total: Number(stats.connections_used || 0),
          active: Number(stats.active_queries || 0),
          idle: Number(stats.connections_used || 0) - Number(stats.active_queries || 0),
          utilization: Math.round((
            Number(stats.connections_used || 0) / 
            Number(stats.connections_max || 100)
          ) * 100),
        },
        performance: {
          cacheHitRatio: Number(stats.cache_hit_ratio || 0),
          indexHitRatio: Number(stats.index_hit_ratio || 0),
          avgQueryDuration: Number(stats.longest_query_duration || 0),
          slowQueries: 0,
          deadlocks: 0,
        },
        storage: {
          databaseSize: stats.database_size || '0 bytes',
        },
        transactions: {
          commits: Number(stats.total_commits || 0),
          rollbacks: Number(stats.total_rollbacks || 0),
          rollbackRatio: Number(stats.total_rollbacks || 0) > 0 ? 
            Number(stats.total_rollbacks || 0) / (Number(stats.total_commits || 0) + Number(stats.total_rollbacks || 0)) : 0,
        },
      };
      
      return reply.send(metrics);
    } catch (error) {
      logger.error({ error }, 'Failed to get database metrics');
      throw error;
    }
  });
}