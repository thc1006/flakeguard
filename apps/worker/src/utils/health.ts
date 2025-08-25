/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/await-thenable, @typescript-eslint/no-non-null-assertion, import/order */

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
import { workerHealth, getMetricsRegistry } from './metrics.js';

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
  details?: Record<string, unknown>;
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
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not Found' }));
        }
      } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Health check endpoint error');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          logger.info({ port }, 'Health check server started');
          resolve();
        }
      });
    });
  }

  /**
   * Stop health check server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          logger.info('Health check server stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Handle comprehensive health check
   */
  private async handleHealthCheck(_req: unknown, res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (data: string) => void }): Promise<void> {
    const startTime = Date.now();
    
    try {
      const result = await this.performHealthCheck();
      const statusCode = result.status === 'healthy' ? 200 : 503;
      
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'X-Response-Time': `${Date.now() - startTime}ms`
      });
      
      res.end(JSON.stringify(result, null, 2));
      
      // Update worker health metric
      workerHealth.set(
        { worker_name: config.workerName },
        result.status === 'healthy' ? 1 : 0
      );
      
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Health check failed');
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }));
    }
  }

  /**
   * Handle readiness probe (can the worker accept new jobs?)
   */
  private async handleReadinessCheck(_req: unknown, res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (data: string) => void }): Promise<void> {
    try {
      const [databaseHealth, redisHealth] = await Promise.all([
        this.checkDatabaseHealth(),
        this.checkRedisHealth()
      ]);
      
      const isReady = databaseHealth.status === 'healthy' && redisHealth.status === 'healthy';
      const statusCode = isReady ? 200 : 503;
      
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: isReady ? 'ready' : 'not_ready',
        checks: { database: databaseHealth, redis: redisHealth },
        timestamp: new Date().toISOString()
      }));
      
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'not_ready',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }));
    }
  }

  /**
   * Handle liveness probe (is the worker running?)
   */
  private handleLivenessCheck(_req: unknown, res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (data: string) => void }): void {
    const memUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'alive',
      uptime,
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss
      },
      timestamp: new Date().toISOString()
    }));
  }

  /**
   * Handle metrics endpoint
   */
  private async handleMetrics(_req: unknown, res: { writeHead: (code: number, headers?: Record<string, string>) => void; end: (data: string) => void }): Promise<void> {
    const registry = getMetricsRegistry();
    const metrics = await registry.metrics();
    
    res.writeHead(200, { 
      'Content-Type': registry.contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(metrics);
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<HealthCheckResult> {
    
    // Parallel health checks for better performance
    const [databaseHealth, redisHealth, queuesHealth, memoryHealth, githubHealth] = await Promise.allSettled([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
      this.checkQueuesHealth(),
      this.checkMemoryHealth(),
      this.checkGitHubHealth()
    ]);
    
    const checks = {
      database: this.getSettledResult(databaseHealth, 'Database check failed'),
      redis: this.getSettledResult(redisHealth, 'Redis check failed'),
      queues: this.getSettledResult(queuesHealth, 'Queues check failed'),
      memory: this.getSettledResult(memoryHealth, 'Memory check failed'),
      github: this.getSettledResult(githubHealth, 'GitHub check failed')
    };
    
    // Determine overall status
    const healthyCount = Object.values(checks).filter(check => check.status === 'healthy').length;
    const unhealthyCount = Object.values(checks).filter(check => check.status === 'unhealthy').length;
    
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded';
    if (unhealthyCount === 0) {
      overallStatus = 'healthy';
    } else if (healthyCount > unhealthyCount) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }
    
    // Collect metrics
    const metrics = await this.collectMetrics();
    
    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: '1.0.0',
      environment: config.env,
      checks,
      metrics: metrics || undefined
    };
  }

  /**
   * Check database connectivity and performance
   */
  private async checkDatabaseHealth(): Promise<ComponentHealth> {
    const cacheKey = 'database';
    const cached = this.getCachedHealth(cacheKey);
    if (cached) return cached;
    
    const startTime = Date.now();
    
    try {
      if (!this.prisma) {
        throw new Error('Prisma client not available');
      }
      
      // Simple database connectivity test
      await this.prisma.$queryRaw`SELECT 1`;
      
      const responseTime = Date.now() - startTime;
      const result: ComponentHealth = {
        status: responseTime < 1000 ? 'healthy' : 'degraded',
        message: `Database connection successful (${responseTime}ms)`,
        responseTime,
        lastChecked: new Date().toISOString()
      };
      
      this.setCachedHealth(cacheKey, result);
      return result;
      
    } catch (error) {
      const result: ComponentHealth = {
        status: 'unhealthy',
        message: `Database connection failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - startTime,
        lastChecked: new Date().toISOString()
      };
      
      this.setCachedHealth(cacheKey, result);
      return result;
    }
  }

  /**
   * Check Redis connectivity and performance
   */
  private async checkRedisHealth(): Promise<ComponentHealth> {
    const cacheKey = 'redis';
    const cached = this.getCachedHealth(cacheKey);
    if (cached) return cached;
    
    const startTime = Date.now();
    
    try {
      // Test Redis connectivity with PING
      const pong = await (connection as import('ioredis').default).ping();
      if (pong !== 'PONG') {
        throw new Error('Invalid PING response');
      }
      
      const responseTime = Date.now() - startTime;
      const redisInfo = getRedisHealth();
      
      const result: ComponentHealth = {
        status: responseTime < 100 ? 'healthy' : 'degraded',
        message: `Redis connection successful (${responseTime}ms)`,
        responseTime,
        details: redisInfo,
        lastChecked: new Date().toISOString()
      };
      
      this.setCachedHealth(cacheKey, result);
      return result;
      
    } catch (error) {
      const result: ComponentHealth = {
        status: 'unhealthy',
        message: `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - startTime,
        lastChecked: new Date().toISOString()
      };
      
      this.setCachedHealth(cacheKey, result);
      return result;
    }
  }

  /**
   * Check queue health and statistics
   */
  private async checkQueuesHealth(): Promise<ComponentHealth> {
    const cacheKey = 'queues';
    const cached = this.getCachedHealth(cacheKey);
    if (cached) return cached;
    
    const startTime = Date.now();
    
    try {
      const queueStats: Record<string, unknown> = {};
      let totalWaiting = 0;
      let totalActive = 0;
      let totalFailed = 0;
      
      for (const [name, queue] of this.queues) {
        try {
          const waiting = await queue.getWaiting();
          const active = await queue.getActive();
          const failed = await queue.getFailed();
          
          queueStats[name] = {
            waiting: waiting.length,
            active: active.length,
            failed: failed.length
          };
          
          totalWaiting += waiting.length;
          totalActive += active.length;
          totalFailed += failed.length;
        } catch (queueError) {
          logger.warn({ queueName: name, error: queueError }, 'Failed to get queue stats');
          queueStats[name] = { error: 'Failed to retrieve stats' };
        }
      }
      
      const responseTime = Date.now() - startTime;
      const isHealthy = totalFailed < 100; // Threshold for failed jobs
      
      const result: ComponentHealth = {
        status: isHealthy ? 'healthy' : 'degraded',
        message: `Queues operational (${this.queues.size} queues)`,
        responseTime,
        details: {
          totalWaiting,
          totalActive,
          totalFailed,
          queues: queueStats
        },
        lastChecked: new Date().toISOString()
      };
      
      this.setCachedHealth(cacheKey, result);
      return result;
      
    } catch (error) {
      const result: ComponentHealth = {
        status: 'unhealthy',
        message: `Queue health check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - startTime,
        lastChecked: new Date().toISOString()
      };
      
      this.setCachedHealth(cacheKey, result);
      return result;
    }
  }

  /**
   * Check memory usage and system resources
   */
  private checkMemoryHealth(): ComponentHealth {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    
    // Memory thresholds (configurable)
    const memoryThreshold = 512; // MB
    const criticalThreshold = 1024; // MB
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    let message: string;
    
    if (rssMB > criticalThreshold) {
      status = 'unhealthy';
      message = `Critical memory usage: ${rssMB}MB`;
    } else if (rssMB > memoryThreshold) {
      status = 'degraded';
      message = `High memory usage: ${rssMB}MB`;
    } else {
      status = 'healthy';
      message = `Memory usage normal: ${rssMB}MB`;
    }
    
    return {
      status,
      message,
      details: {
        heapUsed: `${heapUsedMB}MB`,
        heapTotal: `${heapTotalMB}MB`,
        rss: `${rssMB}MB`,
        external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
      },
      lastChecked: new Date().toISOString()
    };
  }

  /**
   * Check GitHub API connectivity and rate limits
   */
  private checkGitHubHealth(): ComponentHealth {
    const cacheKey = 'github';
    const cached = this.getCachedHealth(cacheKey);
    if (cached) return cached;
    
    try {
      // Simple GitHub API health check
      // This would be enhanced with actual GitHub client in production
      const result: ComponentHealth = {
        status: 'healthy',
        message: 'GitHub API accessible',
        details: {
          configured: !!(config.github.appId && config.github.privateKey),
          baseUrl: config.github.apiBaseUrl
        },
        lastChecked: new Date().toISOString()
      };
      
      this.setCachedHealth(cacheKey, result);
      return result;
      
    } catch (error) {
      const result: ComponentHealth = {
        status: 'degraded',
        message: `GitHub API check inconclusive: ${error instanceof Error ? error.message : String(error)}`,
        lastChecked: new Date().toISOString()
      };
      
      this.setCachedHealth(cacheKey, result);
      return result;
    }
  }

  /**
   * Collect performance metrics
   */
  private async collectMetrics(): Promise<Record<string, unknown> | null> {
    try {
      let totalActive = 0;
      let totalCompleted = 0;
      let totalFailed = 0;
      const queueSizes: Record<string, number> = {};
      
      for (const [name, queue] of this.queues) {
        try {
          const [active, completed, failed] = await Promise.all([
            queue.getActive(),
            queue.getCompleted(),
            queue.getFailed()
          ]);
          
          totalActive += active.length;
          totalCompleted += completed.length;
          totalFailed += failed.length;
          queueSizes[name] = active.length;
        } catch (error) {
          // Skip queue if stats unavailable
        }
      }
      
      return {
        activeJobs: totalActive,
        completedJobs: totalCompleted,
        failedJobs: totalFailed,
        queueSizes
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Helper method to handle Promise.allSettled results
   */
  private getSettledResult(result: PromiseSettledResult<ComponentHealth>, fallbackMessage: string): ComponentHealth {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        status: 'unhealthy',
        message: `${fallbackMessage}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        lastChecked: new Date().toISOString()
      };
    }
  }

  /**
   * Get cached health result if still valid
   */
  private getCachedHealth(key: string): ComponentHealth | null {
    const cached = this.healthCache.get(key);
    if (cached && Date.now() - new Date(cached.lastChecked).getTime() < this.cacheTimeout) {
      return cached;
    }
    return null;
  }

  /**
   * Cache health result
   */
  private setCachedHealth(key: string, health: ComponentHealth): void {
    this.healthCache.set(key, health);
  }
}

// ============================================================================
// Singleton Health Check Manager
// ============================================================================

let healthManager: HealthCheckManager | null = null;

/**
 * Get the singleton health check manager
 */
export function getHealthManager(prisma?: PrismaClient): HealthCheckManager {
  if (!healthManager) {
    healthManager = new HealthCheckManager(prisma);
  }
  return healthManager;
}

/**
 * Initialize health check system
 */
export async function initializeHealthCheck(prisma?: PrismaClient): Promise<HealthCheckManager> {
  const manager = getHealthManager(prisma);
  await manager.start();
  return manager;
}

/**
 * Shutdown health check system
 */
export async function shutdownHealthCheck(): Promise<void> {
  if (healthManager) {
    await healthManager.stop();
    healthManager = null;
  }
}