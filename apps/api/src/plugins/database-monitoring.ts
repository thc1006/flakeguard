/**
 * Database Monitoring Plugin
 * 
 * Comprehensive database monitoring for FlakeGuard:
 * - Query performance tracking
 * - Connection pool monitoring
 * - Multi-tenant isolation validation
 * - Migration status tracking
 * - Automated health checks
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import { 
  checkDatabaseHealth,
  checkConnectionPool,
  checkMigrationStatus,
  validateTenantIsolation,
  getDatabaseStatistics,
} from '../utils/database-health.js';
import { logger } from '../utils/logger.js';
import { 
  databaseConnectionPool,
  databaseConnections,
} from '../utils/metrics.js';

interface DatabaseMonitoringOptions {
  enabled?: boolean;
  healthCheckInterval?: number; // milliseconds
  performanceThresholds?: {
    slowQueryMs: number;
    connectionUtilizationWarning: number;
    connectionUtilizationCritical: number;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    databaseMonitoring: {
      enabled: boolean;
      getHealthStatus: () => Promise<any>;
      getPerformanceMetrics: () => Promise<any>;
      runDiagnostics: () => Promise<any>;
    };
  }
}

async function databaseMonitoringPlugin(
  fastify: FastifyInstance,
  options: DatabaseMonitoringOptions = {}
) {
  const {
    enabled = true,
    healthCheckInterval = 30000, // 30 seconds
    performanceThresholds = {
      slowQueryMs: 1000,
      connectionUtilizationWarning: 70,
      connectionUtilizationCritical: 85,
    },
  } = options;

  if (!enabled) {
    logger.info('Database monitoring plugin disabled');
    return;
  }

  let healthCheckTimer: NodeJS.Timeout | null = null;
  let lastHealthCheck: any = null;

  // ============================================================================
  // Database Health Monitoring
  // ============================================================================

  async function runHealthCheck() {
    try {
      const [connectivity, connectionPool, migrations, tenantIsolation] = await Promise.allSettled([
        checkDatabaseHealth(fastify),
        checkConnectionPool(fastify),
        checkMigrationStatus(fastify),
        validateTenantIsolation(fastify),
      ]);

      const healthStatus = {
        timestamp: new Date().toISOString(),
        connectivity: connectivity.status === 'fulfilled' ? connectivity.value : { status: 'unhealthy', message: 'Check failed' },
        connectionPool: connectionPool.status === 'fulfilled' ? connectionPool.value : { status: 'unhealthy', message: 'Check failed' },
        migrations: migrations.status === 'fulfilled' ? migrations.value : { status: 'unhealthy', message: 'Check failed' },
        tenantIsolation: tenantIsolation.status === 'fulfilled' ? tenantIsolation.value : { status: 'unhealthy', message: 'Check failed' },
      };

      lastHealthCheck = healthStatus;

      // Update connection metrics based on health check
      if (healthStatus.connectivity.status === 'healthy') {
        databaseConnections.set(1);
      } else {
        databaseConnections.set(0);
      }

      // Log any concerning health status
      const unhealthyComponents = Object.entries(healthStatus)
        .filter(([key, value]) => key !== 'timestamp' && (value as any).status === 'unhealthy')
        .map(([key]) => key);

      if (unhealthyComponents.length > 0) {
        logger.warn({
          unhealthyComponents,
          healthStatus,
        }, 'Database health check detected issues');
      }

      return healthStatus;
    } catch (error) {
      logger.error({ error }, 'Database health check failed');
      databaseConnections.set(0);
      
      const errorStatus = {
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'unhealthy',
      };
      
      lastHealthCheck = errorStatus;
      return errorStatus;
    }
  }

  // ============================================================================
  // Query Performance Monitoring
  // ============================================================================

  // Hook into Prisma queries for performance monitoring
  fastify.addHook('onReady', async () => {
    if (fastify.prisma) {
      // Monitor query performance (this would be expanded based on Prisma events)
      logger.info('Database query performance monitoring enabled');
    }
  });

  // ============================================================================
  // Connection Pool Monitoring
  // ============================================================================

  let activeConnections = 0;

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    // Track database connection usage per request
    activeConnections++;
    databaseConnectionPool.set({ pool_status: 'active' }, activeConnections);
    
    // Add request context for database monitoring
    (request as any).dbMonitoringStart = Date.now();
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    activeConnections = Math.max(0, activeConnections - 1);
    databaseConnectionPool.set({ pool_status: 'active' }, activeConnections);
    
    const startTime = (request as any).dbMonitoringStart;
    if (startTime) {
      const duration = Date.now() - startTime;
      
      // Log slow requests that likely involved slow queries
      if (duration > performanceThresholds.slowQueryMs) {
        logger.warn({
          url: request.url,
          method: request.method,
          duration,
          statusCode: reply.statusCode,
        }, 'Slow request detected - possible slow database query');
      }
    }
  });

  // ============================================================================
  // Plugin API Methods
  // ============================================================================

  const databaseMonitoring = {
    enabled: true,
    
    async getHealthStatus() {
      if (!lastHealthCheck || Date.now() - new Date(lastHealthCheck.timestamp).getTime() > healthCheckInterval) {
        await runHealthCheck();
      }
      return lastHealthCheck;
    },
    
    async getPerformanceMetrics() {
      try {
        const stats = await getDatabaseStatistics(fastify);
        return {
          timestamp: new Date().toISOString(),
          statistics: stats,
          thresholds: performanceThresholds,
        };
      } catch (error) {
        logger.error({ error }, 'Failed to get database performance metrics');
        throw error;
      }
    },
    
    async runDiagnostics() {
      try {
        const [health, performance] = await Promise.all([
          this.getHealthStatus(),
          this.getPerformanceMetrics(),
        ]);
        
        return {
          timestamp: new Date().toISOString(),
          health,
          performance,
          recommendations: generateRecommendations(health, performance),
        };
      } catch (error) {
        logger.error({ error }, 'Database diagnostics failed');
        throw error;
      }
    },
  };

  // Decorate fastify instance
  fastify.decorate('databaseMonitoring', databaseMonitoring);

  // ============================================================================
  // Periodic Health Checks
  // ============================================================================

  // Start periodic health checks
  healthCheckTimer = setInterval(() => {
    runHealthCheck().catch((error) => {
      logger.error({ error }, 'Periodic database health check failed');
    });
  }, healthCheckInterval);

  // Initial health check
  setTimeout(() => {
    runHealthCheck().catch((error) => {
      logger.error({ error }, 'Initial database health check failed');
    });
  }, 5000); // Wait 5 seconds after startup

  // ============================================================================
  // Cleanup
  // ============================================================================

  fastify.addHook('onClose', async () => {
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = null;
    }
    logger.info('Database monitoring plugin stopped');
  });

  logger.info({
    healthCheckInterval: healthCheckInterval / 1000,
    performanceThresholds,
  }, 'Database monitoring plugin initialized');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate recommendations based on health and performance data
 */
function generateRecommendations(health: any, performance: any): string[] {
  const recommendations: string[] = [];
  
  try {
    // Connection pool recommendations
    if (health.connectionPool?.utilization > 85) {
      recommendations.push('Consider increasing database connection pool size or optimizing connection usage');
    }
    
    // Performance recommendations
    if (performance.statistics?.cache_hit_ratio < 95) {
      recommendations.push('Database cache hit ratio is low - consider increasing shared_buffers');
    }
    
    // Migration recommendations
    if (health.migrations?.pending > 0) {
      recommendations.push('Apply pending database migrations to ensure schema consistency');
    }
    
    // Tenant isolation recommendations
    if (health.tenantIsolation?.isolationViolations > 0) {
      recommendations.push('CRITICAL: Investigate tenant isolation violations immediately');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Database is operating within normal parameters');
    }
  } catch (error) {
    logger.error({ error }, 'Error generating database recommendations');
    recommendations.push('Unable to generate recommendations due to monitoring error');
  }
  
  return recommendations;
}

export default fp(databaseMonitoringPlugin, {
  fastify: '4.x',
  name: 'database-monitoring',
  dependencies: ['prisma'],
});