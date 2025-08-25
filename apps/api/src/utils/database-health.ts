/**
 * Database Health Check Utilities
 * 
 * Comprehensive database monitoring for FlakeGuard multi-tenant architecture:
 * - Connection pool monitoring
 * - Migration status validation  
 * - Multi-tenant data isolation checks
 * - Query performance monitoring
 * - Deadlock and slow query detection
 */

import { FastifyInstance } from 'fastify';

import { logger } from './logger.js';
import { recordDatabaseQuery } from './metrics.js';

// ============================================================================
// Health Check Interfaces
// ============================================================================

interface DatabaseHealthResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  responseTime?: number;
  details?: Record<string, unknown>;
}

interface ConnectionPoolResult extends DatabaseHealthResult {
  active: number;
  idle: number;
  total: number;
  utilization: number;
}

interface MigrationResult extends DatabaseHealthResult {
  applied: number;
  pending: number;
}

interface TenantIsolationResult extends DatabaseHealthResult {
  tenantsChecked: number;
  isolationViolations: number;
}

interface QueryPerformanceResult extends DatabaseHealthResult {
  queryPerformance: {
    avgResponseTime: number;
    slowQueries: number;
    deadlocks: number;
  };
}

// ============================================================================
// Core Database Health Checks
// ============================================================================

/**
 * Check basic database connectivity and response time
 */
export async function checkDatabaseHealth(fastify: FastifyInstance): Promise<DatabaseHealthResult> {
  const startTime = Date.now();
  
  try {
    // Test basic connectivity
    await fastify.prisma.$queryRaw`SELECT 1 as health_check`;
    
    // Test query performance with a simple count
    await fastify.prisma.user.count();
    
    const responseTime = Date.now() - startTime;
    
    // Record metrics
    recordDatabaseQuery('health_check', 'system', 'success', responseTime);
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    let message: string;
    
    if (responseTime < 100) {
      status = 'healthy';
      message = `Database responsive (${responseTime}ms)`;
    } else if (responseTime < 1000) {
      status = 'degraded';
      message = `Database slow but operational (${responseTime}ms)`;
    } else {
      status = 'unhealthy';
      message = `Database very slow (${responseTime}ms)`;
    }
    
    return {
      status,
      message,
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    recordDatabaseQuery('health_check', 'system', 'failure', responseTime);
    
    logger.error({ error }, 'Database health check failed');
    
    return {
      status: 'unhealthy',
      message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      responseTime,
    };
  }
}

/**
 * Check database connection pool health and utilization
 */
export async function checkConnectionPool(fastify: FastifyInstance): Promise<ConnectionPoolResult> {
  try {
    // Query PostgreSQL connection stats
    const connectionStats = await fastify.prisma.$queryRaw<[{
      total_connections: bigint;
      active_connections: bigint;
      idle_connections: bigint;
      waiting_connections: bigint;
      max_connections: bigint;
    }]>`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections,
        count(*) FILTER (WHERE state = 'idle in transaction') as waiting_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `;
    
    const stats = connectionStats[0];
    const total = Number(stats.total_connections);
    const active = Number(stats.active_connections);
    const idle = Number(stats.idle_connections);
    const maxConnections = Number(stats.max_connections);
    const utilization = Math.round((total / maxConnections) * 100);
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    let message: string;
    
    if (utilization < 70) {
      status = 'healthy';
      message = `Connection pool healthy (${utilization}% utilization)`;
    } else if (utilization < 85) {
      status = 'degraded';
      message = `Connection pool under pressure (${utilization}% utilization)`;
    } else {
      status = 'unhealthy';
      message = `Connection pool at capacity (${utilization}% utilization)`;
    }
    
    return {
      status,
      message,
      active,
      idle,
      total,
      utilization,
      details: {
        maxConnections,
        waiting: Number(stats.waiting_connections),
      },
    };
  } catch (error) {
    logger.error({ error }, 'Connection pool health check failed');
    
    return {
      status: 'unhealthy',
      message: `Connection pool check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      active: 0,
      idle: 0,
      total: 0,
      utilization: 0,
    };
  }
}

/**
 * Check migration status and ensure database schema is up to date
 */
export async function checkMigrationStatus(fastify: FastifyInstance): Promise<MigrationResult> {
  try {
    // Check if migrations table exists
    const migrationTableExists = await fastify.prisma.$queryRaw<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '_prisma_migrations'
      ) as exists
    `;
    
    if (!migrationTableExists[0]?.exists) {
      return {
        status: 'unhealthy',
        message: 'Migrations table not found - database not initialized',
        applied: 0,
        pending: 0,
      };
    }
    
    // Get migration status
    const migrationStats = await fastify.prisma.$queryRaw<[{
      total: bigint;
      applied: bigint;
      failed: bigint;
    }]>`
      SELECT 
        count(*) as total,
        count(*) FILTER (WHERE finished_at IS NOT NULL) as applied,
        count(*) FILTER (WHERE finished_at IS NULL AND started_at IS NOT NULL) as failed
      FROM _prisma_migrations
    `;
    
    const stats = migrationStats[0];
    const totalMigrations = Number(stats.total);
    const appliedMigrations = Number(stats.applied);
    const failedMigrations = Number(stats.failed);
    const pendingMigrations = totalMigrations - appliedMigrations - failedMigrations;
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    let message: string;
    
    if (failedMigrations > 0) {
      status = 'unhealthy';
      message = `${failedMigrations} migrations failed`;
    } else if (pendingMigrations > 0) {
      status = 'degraded';
      message = `${pendingMigrations} migrations pending`;
    } else {
      status = 'healthy';
      message = `All ${appliedMigrations} migrations applied successfully`;
    }
    
    return {
      status,
      message,
      applied: appliedMigrations,
      pending: pendingMigrations,
      details: {
        total: totalMigrations,
        failed: failedMigrations,
      },
    };
  } catch (error) {
    logger.error({ error }, 'Migration status check failed');
    
    return {
      status: 'unhealthy',
      message: `Migration check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      applied: 0,
      pending: 0,
    };
  }
}

/**
 * Validate multi-tenant data isolation
 */
export async function validateTenantIsolation(fastify: FastifyInstance): Promise<TenantIsolationResult> {
  try {
    // Get sample of organizations to test
    const organizations = await fastify.prisma.organization.findMany({
      select: { id: true },
      take: 10,
    });
    
    let isolationViolations = 0;
    const tenantsChecked = organizations.length;
    
    // Check for cross-tenant data leakage in key tables
    for (const org of organizations) {
      try {
        // Check FGRepository isolation
        const crossTenantRepos = await fastify.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT count(*) as count
          FROM \"FGRepository\" r1
          JOIN \"FGRepository\" r2 ON r1.id = r2.id 
          WHERE r1.\"orgId\" = ${org.id}
          AND r2.\"orgId\" != ${org.id}
        `;
        
        // Check FGTestCase isolation
        const crossTenantTests = await fastify.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT count(*) as count
          FROM \"FGTestCase\" t1
          JOIN \"FGTestCase\" t2 ON t1.id = t2.id
          WHERE t1.\"orgId\" = ${org.id}
          AND t2.\"orgId\" != ${org.id}
        `;
        
        const repoViolations = Number(crossTenantRepos[0]?.count || 0);
        const testViolations = Number(crossTenantTests[0]?.count || 0);
        
        isolationViolations += repoViolations + testViolations;
      } catch (error) {
        logger.warn({ error, orgId: org.id }, 'Failed to check tenant isolation for organization');
        isolationViolations++;
      }
    }
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    let message: string;
    
    if (isolationViolations === 0) {
      status = 'healthy';
      message = `Tenant isolation verified for ${tenantsChecked} organizations`;
    } else if (isolationViolations < tenantsChecked * 0.1) {
      status = 'degraded';
      message = `${isolationViolations} minor isolation issues found`;
    } else {
      status = 'unhealthy';  
      message = `${isolationViolations} serious isolation violations detected`;
    }
    
    return {
      status,
      message,
      tenantsChecked,
      isolationViolations,
    };
  } catch (error) {
    logger.error({ error }, 'Tenant isolation check failed');
    
    return {
      status: 'unhealthy',
      message: `Tenant isolation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      tenantsChecked: 0,
      isolationViolations: 0,
    };
  }
}

/**
 * Check query performance and identify issues
 */
export async function checkQueryPerformance(fastify: FastifyInstance): Promise<QueryPerformanceResult> {
  try {
    // Get query performance statistics
    const performanceStats = await fastify.prisma.$queryRaw<[{
      avg_duration: number;
      slow_queries: bigint;
      total_calls: bigint;
      deadlocks: bigint;
    }]>`
      SELECT 
        COALESCE(round(avg(mean_exec_time)::numeric, 2), 0) as avg_duration,
        COALESCE(count(*) FILTER (WHERE mean_exec_time > 1000), 0) as slow_queries,
        COALESCE(sum(calls), 0) as total_calls,
        COALESCE((SELECT sum(deadlocks) FROM pg_stat_database WHERE datname = current_database()), 0) as deadlocks
      FROM pg_stat_statements 
      WHERE query NOT LIKE '%pg_stat%'
      AND query NOT LIKE '%information_schema%'
    `;
    
    const stats = performanceStats[0];
    const avgResponseTime = stats?.avg_duration || 0;
    const slowQueries = Number(stats?.slow_queries || 0);
    const totalCalls = Number(stats?.total_calls || 0);
    const deadlocks = Number(stats?.deadlocks || 0);
    
    let status: 'healthy' | 'degraded' | 'unhealthy';
    let message: string;
    
    // Determine status based on multiple factors
    const slowQueryRatio = totalCalls > 0 ? (slowQueries / totalCalls) * 100 : 0;
    
    if (avgResponseTime < 50 && slowQueryRatio < 1 && deadlocks === 0) {
      status = 'healthy';
      message = `Query performance healthy (avg: ${avgResponseTime}ms)`;
    } else if (avgResponseTime < 200 && slowQueryRatio < 5 && deadlocks < 10) {
      status = 'degraded';
      message = `Query performance degraded (avg: ${avgResponseTime}ms, ${slowQueryRatio.toFixed(1)}% slow)`;
    } else {
      status = 'unhealthy';
      message = `Query performance poor (avg: ${avgResponseTime}ms, ${slowQueries} slow queries, ${deadlocks} deadlocks)`;
    }
    
    return {
      status,
      message,
      queryPerformance: {
        avgResponseTime,
        slowQueries,
        deadlocks,
      },
      details: {
        totalCalls,
        slowQueryRatio,
      },
    };
  } catch (error) {
    logger.warn({ error }, 'Query performance check failed - pg_stat_statements may not be enabled');
    
    // Fall back to basic performance check
    try {
      const startTime = Date.now();
      await fastify.prisma.$queryRaw`SELECT count(*) FROM "User"`;
      const responseTime = Date.now() - startTime;
      
      return {
        status: responseTime < 100 ? 'healthy' : responseTime < 500 ? 'degraded' : 'unhealthy',
        message: `Basic query performance: ${responseTime}ms (pg_stat_statements unavailable)`,
        queryPerformance: {
          avgResponseTime: responseTime,
          slowQueries: 0,
          deadlocks: 0,
        },
      };
    } catch (fallbackError) {
      logger.error({ error: fallbackError }, 'Fallback query performance check failed');
      
      return {
        status: 'unhealthy',
        message: `Query performance check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        queryPerformance: {
          avgResponseTime: 0,
          slowQueries: 0,
          deadlocks: 0,
        },
      };
    }
  }
}

// ============================================================================
// Advanced Database Monitoring
// ============================================================================

/**
 * Get detailed database statistics for monitoring dashboards
 */
export async function getDatabaseStatistics(fastify: FastifyInstance) {
  try {
    // Get comprehensive database statistics
    const stats = await fastify.prisma.$queryRaw<[{
      database_size: string;
      connections_used: bigint;
      connections_max: bigint;
      cache_hit_ratio: number;
      index_hit_ratio: number;
      active_queries: bigint;
      longest_query_duration: number;
      total_commits: bigint;
      total_rollbacks: bigint;
    }]>`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as database_size,
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) as connections_used,
        (SELECT setting::bigint FROM pg_settings WHERE name = 'max_connections') as connections_max,
        COALESCE(round((sum(blks_hit) * 100.0 / sum(blks_hit + blks_read))::numeric, 2), 0) as cache_hit_ratio,
        COALESCE(round((sum(idx_blks_hit) * 100.0 / sum(idx_blks_hit + idx_blks_read))::numeric, 2), 0) as index_hit_ratio,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND datname = current_database()) as active_queries,
        COALESCE((SELECT max(extract(epoch from now() - query_start)) FROM pg_stat_activity WHERE state = 'active' AND datname = current_database()), 0) as longest_query_duration,
        COALESCE(sum(xact_commit), 0) as total_commits,
        COALESCE(sum(xact_rollback), 0) as total_rollbacks
      FROM pg_stat_database 
      WHERE datname = current_database()
    `;
    
    return stats[0];
  } catch (error) {
    logger.error({ error }, 'Failed to collect database statistics');
    throw error;
  }
}

/**
 * Check for common database issues
 */
export async function checkDatabaseIssues(fastify: FastifyInstance) {
  const issues: string[] = [];
  
  try {
    // Check for long-running queries
    const longQueries = await fastify.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*) as count
      FROM pg_stat_activity
      WHERE state = 'active'
      AND datname = current_database()
      AND extract(epoch from now() - query_start) > 300
    `;
    
    if (Number(longQueries[0]?.count || 0) > 0) {
      issues.push(`${longQueries[0].count} queries running longer than 5 minutes`);
    }
    
    // Check for blocked queries
    const blockedQueries = await fastify.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*) as count
      FROM pg_stat_activity
      WHERE wait_event_type IS NOT NULL
      AND state = 'active'
      AND datname = current_database()
    `;
    
    if (Number(blockedQueries[0]?.count || 0) > 0) {
      issues.push(`${blockedQueries[0].count} blocked queries detected`);
    }
    
    // Check for high connection usage
    const connectionStats = await fastify.prisma.$queryRaw<[{
      used: bigint;
      max: bigint;
      ratio: number;
    }]>`
      SELECT 
        count(*) as used,
        (SELECT setting::bigint FROM pg_settings WHERE name = 'max_connections') as max,
        round((count(*) * 100.0 / (SELECT setting::bigint FROM pg_settings WHERE name = 'max_connections'))::numeric, 2) as ratio
      FROM pg_stat_activity
      WHERE datname = current_database()
    `;
    
    const connRatio = connectionStats[0]?.ratio || 0;
    if (connRatio > 80) {
      issues.push(`High connection usage: ${connRatio}% of max connections`);
    }
    
    return issues;
  } catch (error) {
    logger.error({ error }, 'Failed to check database issues');
    return [`Error checking database issues: ${error instanceof Error ? error.message : 'Unknown error'}`];
  }
}