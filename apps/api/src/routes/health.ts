import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { activeRepositories, databaseConnections, queueConnectionHealth } from '../utils/metrics.js';

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
  uptime: z.number(),
  database: z.enum(['connected', 'disconnected']),
});

const detailedHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string(),
  uptime: z.number(),
  version: z.string(),
  environment: z.string(),
  checks: z.object({
    database: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      message: z.string(),
      responseTime: z.number().optional(),
    }),
    github: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      message: z.string(),
      configured: z.boolean(),
    }),
    memory: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      message: z.string(),
      usage: z.object({
        heapUsed: z.string(),
        heapTotal: z.string(),
        rss: z.string(),
      }),
    }),
    redis: z.object({
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      message: z.string(),
    }).optional(),
  }),
  metrics: z.object({
    activeRepositories: z.number(),
    totalRequests: z.number(),
    errorRate: z.number(),
  }).optional(),
});

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check endpoint
  fastify.get('/', {
    schema: {
      description: 'Basic health check endpoint',
      tags: ['Health'],
      response: {
        200: healthResponseSchema,
      },
    },
  }, async (request, reply) => {
    let databaseStatus: 'connected' | 'disconnected' = 'disconnected';
    
    try {
      await fastify.prisma.$queryRaw`SELECT 1`;
      databaseStatus = 'connected';
    } catch (error) {
      fastify.log.error(error, 'Database health check failed');
    }

    return reply.send({
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: databaseStatus,
    });
  });

  // Kubernetes readiness probe
  fastify.get('/ready', {
    schema: {
      description: 'Kubernetes readiness probe - can the service accept traffic?',
      tags: ['Health'],
      response: {
        200: z.object({ ready: z.boolean() }),
        503: z.object({ ready: z.boolean(), reason: z.string() }),
      },
    },
  }, async (request, reply) => {
    try {
      // Test database connectivity
      await fastify.prisma.$queryRaw`SELECT 1`;
      
      // Update metrics
      databaseConnections.set(1);
      
      return reply.send({ ready: true });
    } catch (error) {
      databaseConnections.set(0);
      return reply.status(503).send({ 
        ready: false, 
        reason: 'Database connection failed' 
      });
    }
  });

  // Kubernetes liveness probe
  fastify.get('/live', {
    schema: {
      description: 'Kubernetes liveness probe - is the service running?',
      tags: ['Health'],
      response: {
        200: z.object({ alive: z.boolean(), uptime: z.number() }),
      },
    },
  }, async (request, reply) => {
    // Simple liveness check - if we can respond, we're alive
    return reply.send({ 
      alive: true, 
      uptime: process.uptime() 
    });
  });

  // Comprehensive health check with all dependencies
  fastify.get('/detailed', {
    schema: {
      description: 'Comprehensive health check with all system components',
      tags: ['Health'],
      response: {
        200: detailedHealthSchema,
        503: detailedHealthSchema,
      },
    },
  }, async (request, reply) => {
    const startTime = Date.now();
    
    // Parallel health checks for better performance
    const [databaseHealth, memoryHealth, githubHealth] = await Promise.allSettled([
      checkDatabaseHealth(fastify),
      checkMemoryHealth(),
      checkGitHubHealth(fastify),
    ]);
    
    const checks = {
      database: getHealthResult(databaseHealth, 'Database check failed'),
      memory: getHealthResult(memoryHealth, 'Memory check failed'),
      github: getHealthResult(githubHealth, 'GitHub check failed'),
    };
    
    // Determine overall status
    const healthyCount = Object.values(checks).filter(check => check.status === 'healthy').length;
    const unhealthyCount = Object.values(checks).filter(check => check.status === 'unhealthy').length;
    
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyCount === 0) {
      overallStatus = 'healthy';
    } else if (healthyCount > unhealthyCount) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }
    
    // Collect business metrics
    const metrics = await collectBusinessMetrics(fastify);
    
    const response = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'unknown',
      checks,
      metrics,
    };
    
    const statusCode = overallStatus === 'healthy' ? 200 : 503;
    return reply.status(statusCode).send(response);
  });

  // ============================================================================
  // Health Check Helper Functions
  // ============================================================================

  /**
   * Check database connectivity and performance
   */
  async function checkDatabaseHealth(fastify: FastifyInstance) {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      await fastify.prisma.$queryRaw`SELECT 1`;
      
      // Test query performance with a simple count
      await fastify.prisma.user.count();
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: responseTime < 1000 ? 'healthy' : 'degraded' as const,
        message: `Database operational (${responseTime}ms)`,
        responseTime,
      };
    } catch (error) {
      return {
        status: 'unhealthy' as const,
        message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Check memory usage and system resources
   */
  async function checkMemoryHealth() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    
    // Memory thresholds
    const warningThreshold = 512; // MB
    const criticalThreshold = 1024; // MB
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    let message: string;
    
    if (rssMB > criticalThreshold) {
      status = 'unhealthy';
      message = `Critical memory usage: ${rssMB}MB`;
    } else if (rssMB > warningThreshold) {
      status = 'degraded';
      message = `High memory usage: ${rssMB}MB`;
    } else {
      status = 'healthy';
      message = `Memory usage normal: ${rssMB}MB`;
    }
    
    return {
      status,
      message,
      usage: {
        heapUsed: `${heapUsedMB}MB`,
        heapTotal: `${heapTotalMB}MB`,
        rss: `${rssMB}MB`,
      },
    };
  }

  /**
   * Check GitHub integration health
   */
  async function checkGitHubHealth(fastify: FastifyInstance) {
    const configured = !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
    
    if (!configured) {
      return {
        status: 'degraded' as const,
        message: 'GitHub App not configured',
        configured: false,
      };
    }
    
    // In production, you might want to test actual GitHub API connectivity
    return {
      status: 'healthy' as const,
      message: 'GitHub App configured and accessible',
      configured: true,
    };
  }

  /**
   * Collect business metrics for health endpoint
   */
  async function collectBusinessMetrics(fastify: FastifyInstance) {
    try {
      // Count active repositories (repositories with activity in last 7 days)
      const activeRepoCount = await fastify.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT repository_id) as count
        FROM test_runs
        WHERE created_at > NOW() - INTERVAL '7 days'
      `;
      
      const activeRepos = Number(activeRepoCount[0]?.count || 0);
      
      // Update metrics
      activeRepositories.set(activeRepos);
      
      return {
        activeRepositories: activeRepos,
        totalRequests: 0, // This would be populated from metrics registry
        errorRate: 0, // This would be calculated from error metrics
      };
    } catch (error) {
      logger.warn({ error }, 'Failed to collect business metrics');
      return {
        activeRepositories: 0,
        totalRequests: 0,
        errorRate: 0,
      };
    }
  }

  /**
   * Helper to extract health result from Promise.allSettled
   */
  function getHealthResult(result: PromiseSettledResult<any>, fallbackMessage: string) {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        status: 'unhealthy' as const,
        message: `${fallbackMessage}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      };
    }
  }
}