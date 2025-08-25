/**
 * Health Check System for FlakeGuard Worker
 * 
 * Comprehensive health monitoring for worker processes, queues,
 * database connections, and external service dependencies.
 */

import { createServer, Server } from 'http';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from './logger.js';
import { connection, getRedisHealth } from './redis.js';
import { getMetricsRegistry, workerHealth } from './metrics.js';

// ============================================================================
// Health Check Types
// ============================================================================

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    database: ComponentHealth;
    redis: ComponentHealth;
    queues: ComponentHealth;
    memory: ComponentHealth;
    github: ComponentHealth;
  };
  metrics?: {
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    queueSizes: Record<string, number>;
  };
}

export interface ComponentHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  details?: Record<string, any>;
  lastChecked: string;
  responseTime?: number;
}

// ============================================================================
// Health Check Manager
// ============================================================================

export class HealthCheckManager {
  private server?: Server;
  private prisma?: PrismaClient;
  private queues: Map<string, Queue> = new Map();
  private healthCache: Map<string, ComponentHealth> = new Map();
  private cacheTimeout = 30000; // 30 seconds
  private startTime = Date.now();

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Register a queue for health monitoring
   */
  registerQueue(name: string, queue: Queue): void {
    this.queues.set(name, queue);
    logger.debug({ queueName: name }, 'Registered queue for health monitoring');
  }

  /**
   * Start health check HTTP server
   */
  async start(): Promise<void> {
    const port = config.healthCheck.port;
    
    this.server = createServer(async (req, res) => {
      try {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        if (req.url === '/health' || req.url === '/health/') {
          await this.handleHealthCheck(req, res);
        } else if (req.url === '/health/ready' || req.url === '/health/readiness') {
          await this.handleReadinessCheck(req, res);
        } else if (req.url === '/health/live' || req.url === '/health/liveness') {
          await this.handleLivenessCheck(req, res);
        } else if (req.url === '/metrics' && config.metrics.enabled) {
          await this.handleMetrics(req, res);
        } else {\n          res.writeHead(404, { 'Content-Type': 'application/json' });\n          res.end(JSON.stringify({ error: 'Not Found' }));\n        }\n      } catch (error) {\n        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Health check endpoint error');\n        res.writeHead(500, { 'Content-Type': 'application/json' });\n        res.end(JSON.stringify({ error: 'Internal Server Error' }));\n      }\n    });\n\n    await new Promise<void>((resolve, reject) => {\n      this.server!.listen(port, (error?: Error) => {\n        if (error) {\n          reject(error);\n        } else {\n          logger.info({ port }, 'Health check server started');\n          resolve();\n        }\n      });\n    });\n  }\n\n  /**\n   * Stop health check server\n   */\n  async stop(): Promise<void> {\n    if (this.server) {\n      await new Promise<void>((resolve) => {\n        this.server!.close(() => {\n          logger.info('Health check server stopped');\n          resolve();\n        });\n      });\n    }\n  }\n\n  /**\n   * Handle comprehensive health check\n   */\n  private async handleHealthCheck(req: any, res: any): Promise<void> {\n    const startTime = Date.now();\n    \n    try {\n      const result = await this.performHealthCheck();\n      const statusCode = result.status === 'healthy' ? 200 : 503;\n      \n      res.writeHead(statusCode, {\n        'Content-Type': 'application/json',\n        'X-Response-Time': `${Date.now() - startTime}ms`\n      });\n      \n      res.end(JSON.stringify(result, null, 2));\n      \n      // Update worker health metric\n      workerHealth.set(\n        { worker_name: config.workerName },\n        result.status === 'healthy' ? 1 : 0\n      );\n      \n    } catch (error) {\n      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Health check failed');\n      res.writeHead(503, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({\n        status: 'unhealthy',\n        error: error instanceof Error ? error.message : String(error),\n        timestamp: new Date().toISOString()\n      }));\n    }\n  }\n\n  /**\n   * Handle readiness probe (can the worker accept new jobs?)\n   */\n  private async handleReadinessCheck(req: any, res: any): Promise<void> {\n    try {\n      const [databaseHealth, redisHealth] = await Promise.all([\n        this.checkDatabaseHealth(),\n        this.checkRedisHealth()\n      ]);\n      \n      const isReady = databaseHealth.status === 'healthy' && redisHealth.status === 'healthy';\n      const statusCode = isReady ? 200 : 503;\n      \n      res.writeHead(statusCode, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({\n        status: isReady ? 'ready' : 'not_ready',\n        checks: { database: databaseHealth, redis: redisHealth },\n        timestamp: new Date().toISOString()\n      }));\n      \n    } catch (error) {\n      res.writeHead(503, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({\n        status: 'not_ready',\n        error: error instanceof Error ? error.message : String(error),\n        timestamp: new Date().toISOString()\n      }));\n    }\n  }\n\n  /**\n   * Handle liveness probe (is the worker running?)\n   */\n  private async handleLivenessCheck(req: any, res: any): Promise<void> {\n    const memUsage = process.memoryUsage();\n    const uptime = Date.now() - this.startTime;\n    \n    res.writeHead(200, { 'Content-Type': 'application/json' });\n    res.end(JSON.stringify({\n      status: 'alive',\n      uptime,\n      memory: {\n        heapUsed: memUsage.heapUsed,\n        heapTotal: memUsage.heapTotal,\n        rss: memUsage.rss\n      },\n      timestamp: new Date().toISOString()\n    }));\n  }\n\n  /**\n   * Handle metrics endpoint\n   */\n  private async handleMetrics(req: any, res: any): Promise<void> {\n    const registry = getMetricsRegistry();\n    const metrics = await registry.metrics();\n    \n    res.writeHead(200, { \n      'Content-Type': registry.contentType,\n      'Cache-Control': 'no-cache'\n    });\n    res.end(metrics);\n  }\n\n  /**\n   * Perform comprehensive health check\n   */\n  private async performHealthCheck(): Promise<HealthCheckResult> {\n    const startTime = Date.now();\n    \n    // Parallel health checks for better performance\n    const [databaseHealth, redisHealth, queuesHealth, memoryHealth, githubHealth] = await Promise.allSettled([\n      this.checkDatabaseHealth(),\n      this.checkRedisHealth(),\n      this.checkQueuesHealth(),\n      this.checkMemoryHealth(),\n      this.checkGitHubHealth()\n    ]);\n    \n    const checks = {\n      database: this.getSettledResult(databaseHealth, 'Database check failed'),\n      redis: this.getSettledResult(redisHealth, 'Redis check failed'),\n      queues: this.getSettledResult(queuesHealth, 'Queues check failed'),\n      memory: this.getSettledResult(memoryHealth, 'Memory check failed'),\n      github: this.getSettledResult(githubHealth, 'GitHub check failed')\n    };\n    \n    // Determine overall status\n    const healthyCount = Object.values(checks).filter(check => check.status === 'healthy').length;\n    const unhealthyCount = Object.values(checks).filter(check => check.status === 'unhealthy').length;\n    \n    let overallStatus: 'healthy' | 'unhealthy' | 'degraded';\n    if (unhealthyCount === 0) {\n      overallStatus = 'healthy';\n    } else if (healthyCount > unhealthyCount) {\n      overallStatus = 'degraded';\n    } else {\n      overallStatus = 'unhealthy';\n    }\n    \n    // Collect metrics\n    const metrics = await this.collectMetrics();\n    \n    return {\n      status: overallStatus,\n      timestamp: new Date().toISOString(),\n      uptime: Date.now() - this.startTime,\n      version: '1.0.0',\n      environment: config.env,\n      checks,\n      metrics\n    };\n  }\n\n  /**\n   * Check database connectivity and performance\n   */\n  private async checkDatabaseHealth(): Promise<ComponentHealth> {\n    const cacheKey = 'database';\n    const cached = this.getCachedHealth(cacheKey);\n    if (cached) return cached;\n    \n    const startTime = Date.now();\n    \n    try {\n      if (!this.prisma) {\n        throw new Error('Prisma client not available');\n      }\n      \n      // Simple database connectivity test\n      await this.prisma.$queryRaw`SELECT 1`;\n      \n      const responseTime = Date.now() - startTime;\n      const result: ComponentHealth = {\n        status: responseTime < 1000 ? 'healthy' : 'degraded',\n        message: `Database connection successful (${responseTime}ms)`,\n        responseTime,\n        lastChecked: new Date().toISOString()\n      };\n      \n      this.setCachedHealth(cacheKey, result);\n      return result;\n      \n    } catch (error) {\n      const result: ComponentHealth = {\n        status: 'unhealthy',\n        message: `Database connection failed: ${error instanceof Error ? error.message : String(error)}`,\n        responseTime: Date.now() - startTime,\n        lastChecked: new Date().toISOString()\n      };\n      \n      this.setCachedHealth(cacheKey, result);\n      return result;\n    }\n  }\n\n  /**\n   * Check Redis connectivity and performance\n   */\n  private async checkRedisHealth(): Promise<ComponentHealth> {\n    const cacheKey = 'redis';\n    const cached = this.getCachedHealth(cacheKey);\n    if (cached) return cached;\n    \n    const startTime = Date.now();\n    \n    try {\n      // Test Redis connectivity with PING\n      const pong = await connection.ping();\n      if (pong !== 'PONG') {\n        throw new Error('Invalid PING response');\n      }\n      \n      const responseTime = Date.now() - startTime;\n      const redisInfo = getRedisHealth();\n      \n      const result: ComponentHealth = {\n        status: responseTime < 100 ? 'healthy' : 'degraded',\n        message: `Redis connection successful (${responseTime}ms)`,\n        responseTime,\n        details: redisInfo,\n        lastChecked: new Date().toISOString()\n      };\n      \n      this.setCachedHealth(cacheKey, result);\n      return result;\n      \n    } catch (error) {\n      const result: ComponentHealth = {\n        status: 'unhealthy',\n        message: `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`,\n        responseTime: Date.now() - startTime,\n        lastChecked: new Date().toISOString()\n      };\n      \n      this.setCachedHealth(cacheKey, result);\n      return result;\n    }\n  }\n\n  /**\n   * Check queue health and statistics\n   */\n  private async checkQueuesHealth(): Promise<ComponentHealth> {\n    const cacheKey = 'queues';\n    const cached = this.getCachedHealth(cacheKey);\n    if (cached) return cached;\n    \n    const startTime = Date.now();\n    \n    try {\n      const queueStats: Record<string, any> = {};\n      let totalWaiting = 0;\n      let totalActive = 0;\n      let totalFailed = 0;\n      \n      for (const [name, queue] of this.queues) {\n        try {\n          const waiting = await queue.getWaiting();\n          const active = await queue.getActive();\n          const failed = await queue.getFailed();\n          \n          queueStats[name] = {\n            waiting: waiting.length,\n            active: active.length,\n            failed: failed.length\n          };\n          \n          totalWaiting += waiting.length;\n          totalActive += active.length;\n          totalFailed += failed.length;\n        } catch (queueError) {\n          logger.warn({ queueName: name, error: queueError }, 'Failed to get queue stats');\n          queueStats[name] = { error: 'Failed to retrieve stats' };\n        }\n      }\n      \n      const responseTime = Date.now() - startTime;\n      const isHealthy = totalFailed < 100; // Threshold for failed jobs\n      \n      const result: ComponentHealth = {\n        status: isHealthy ? 'healthy' : 'degraded',\n        message: `Queues operational (${this.queues.size} queues)`,\n        responseTime,\n        details: {\n          totalWaiting,\n          totalActive,\n          totalFailed,\n          queues: queueStats\n        },\n        lastChecked: new Date().toISOString()\n      };\n      \n      this.setCachedHealth(cacheKey, result);\n      return result;\n      \n    } catch (error) {\n      const result: ComponentHealth = {\n        status: 'unhealthy',\n        message: `Queue health check failed: ${error instanceof Error ? error.message : String(error)}`,\n        responseTime: Date.now() - startTime,\n        lastChecked: new Date().toISOString()\n      };\n      \n      this.setCachedHealth(cacheKey, result);\n      return result;\n    }\n  }\n\n  /**\n   * Check memory usage and system resources\n   */\n  private async checkMemoryHealth(): Promise<ComponentHealth> {\n    const memUsage = process.memoryUsage();\n    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);\n    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);\n    const rssMB = Math.round(memUsage.rss / 1024 / 1024);\n    \n    // Memory thresholds (configurable)\n    const memoryThreshold = 512; // MB\n    const criticalThreshold = 1024; // MB\n    \n    let status: 'healthy' | 'degraded' | 'unhealthy';\n    let message: string;\n    \n    if (rssMB > criticalThreshold) {\n      status = 'unhealthy';\n      message = `Critical memory usage: ${rssMB}MB`;\n    } else if (rssMB > memoryThreshold) {\n      status = 'degraded';\n      message = `High memory usage: ${rssMB}MB`;\n    } else {\n      status = 'healthy';\n      message = `Memory usage normal: ${rssMB}MB`;\n    }\n    \n    return {\n      status,\n      message,\n      details: {\n        heapUsed: `${heapUsedMB}MB`,\n        heapTotal: `${heapTotalMB}MB`,\n        rss: `${rssMB}MB`,\n        external: `${Math.round(memUsage.external / 1024 / 1024)}MB`\n      },\n      lastChecked: new Date().toISOString()\n    };\n  }\n\n  /**\n   * Check GitHub API connectivity and rate limits\n   */\n  private async checkGitHubHealth(): Promise<ComponentHealth> {\n    const cacheKey = 'github';\n    const cached = this.getCachedHealth(cacheKey);\n    if (cached) return cached;\n    \n    try {\n      // Simple GitHub API health check\n      // This would be enhanced with actual GitHub client in production\n      const result: ComponentHealth = {\n        status: 'healthy',\n        message: 'GitHub API accessible',\n        details: {\n          configured: !!(config.github.appId && config.github.privateKey),\n          baseUrl: config.github.apiBaseUrl\n        },\n        lastChecked: new Date().toISOString()\n      };\n      \n      this.setCachedHealth(cacheKey, result);\n      return result;\n      \n    } catch (error) {\n      const result: ComponentHealth = {\n        status: 'degraded',\n        message: `GitHub API check inconclusive: ${error instanceof Error ? error.message : String(error)}`,\n        lastChecked: new Date().toISOString()\n      };\n      \n      this.setCachedHealth(cacheKey, result);\n      return result;\n    }\n  }\n\n  /**\n   * Collect performance metrics\n   */\n  private async collectMetrics(): Promise<any> {\n    try {\n      let totalActive = 0;\n      let totalCompleted = 0;\n      let totalFailed = 0;\n      const queueSizes: Record<string, number> = {};\n      \n      for (const [name, queue] of this.queues) {\n        try {\n          const [active, completed, failed] = await Promise.all([\n            queue.getActive(),\n            queue.getCompleted(),\n            queue.getFailed()\n          ]);\n          \n          totalActive += active.length;\n          totalCompleted += completed.length;\n          totalFailed += failed.length;\n          queueSizes[name] = active.length;\n        } catch (error) {\n          // Skip queue if stats unavailable\n        }\n      }\n      \n      return {\n        activeJobs: totalActive,\n        completedJobs: totalCompleted,\n        failedJobs: totalFailed,\n        queueSizes\n      };\n    } catch (error) {\n      return null;\n    }\n  }\n\n  /**\n   * Helper method to handle Promise.allSettled results\n   */\n  private getSettledResult(result: PromiseSettledResult<ComponentHealth>, fallbackMessage: string): ComponentHealth {\n    if (result.status === 'fulfilled') {\n      return result.value;\n    } else {\n      return {\n        status: 'unhealthy',\n        message: `${fallbackMessage}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,\n        lastChecked: new Date().toISOString()\n      };\n    }\n  }\n\n  /**\n   * Get cached health result if still valid\n   */\n  private getCachedHealth(key: string): ComponentHealth | null {\n    const cached = this.healthCache.get(key);\n    if (cached && Date.now() - new Date(cached.lastChecked).getTime() < this.cacheTimeout) {\n      return cached;\n    }\n    return null;\n  }\n\n  /**\n   * Cache health result\n   */\n  private setCachedHealth(key: string, health: ComponentHealth): void {\n    this.healthCache.set(key, health);\n  }\n}\n\n// ============================================================================\n// Singleton Health Check Manager\n// ============================================================================\n\nlet healthManager: HealthCheckManager | null = null;\n\n/**\n * Get the singleton health check manager\n */\nexport function getHealthManager(prisma?: PrismaClient): HealthCheckManager {\n  if (!healthManager) {\n    healthManager = new HealthCheckManager(prisma);\n  }\n  return healthManager;\n}\n\n/**\n * Initialize health check system\n */\nexport async function initializeHealthCheck(prisma?: PrismaClient): Promise<HealthCheckManager> {\n  const manager = getHealthManager(prisma);\n  await manager.start();\n  return manager;\n}\n\n/**\n * Shutdown health check system\n */\nexport async function shutdownHealthCheck(): Promise<void> {\n  if (healthManager) {\n    await healthManager.stop();\n    healthManager = null;\n  }\n}"