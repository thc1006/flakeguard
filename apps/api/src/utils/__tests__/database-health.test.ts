/**
 * Database Health Check Unit Tests
 * 
 * Comprehensive tests for database monitoring and health check functionality
 */

import { PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

// Mock the config module to avoid environment variable requirements
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the metrics module
vi.mock('../metrics.js', () => ({
  recordDatabaseQuery: vi.fn(),
}));

import {
  checkDatabaseHealth,
  checkConnectionPool,
  checkMigrationStatus,
  validateTenantIsolation,
  checkQueryPerformance,
  getDatabaseStatistics,
  checkDatabaseIssues,
} from '../database-health.js';

// Mock Fastify instance
const mockFastify = mockDeep<FastifyInstance>();

describe('Database Health Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock fastify instance
    mockFastify.prisma = mockDeep<PrismaClient>();
  });

  describe('checkDatabaseHealth', () => {
    it('should return healthy status for responsive database', async () => {
      // Mock successful database queries
      mockFastify.prisma.$queryRaw.mockResolvedValueOnce([{ health_check: 1 }]);
      mockFastify.prisma.user.count.mockResolvedValue(5);

      const result = await checkDatabaseHealth(mockFastify);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('Database responsive');
      expect(result.responseTime).toBeDefined();
      expect(result.responseTime).toBeLessThan(1000);
    });

    it('should return degraded status for slow database', async () => {
      // Mock slow database response
      mockFastify.prisma.$queryRaw.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve([{ health_check: 1 }]), 500))
      );
      mockFastify.prisma.user.count.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(5), 200))
      );

      const result = await checkDatabaseHealth(mockFastify);

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('slow but operational');
      expect(result.responseTime).toBeGreaterThan(100);
    });

    it('should return unhealthy status for database connection failure', async () => {
      // Mock database connection failure
      mockFastify.prisma.$queryRaw.mockRejectedValue(new Error('Connection failed'));

      const result = await checkDatabaseHealth(mockFastify);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Database connection failed');
      expect(result.responseTime).toBeDefined();
    });
  });

  describe('checkConnectionPool', () => {
    it('should return healthy status for normal connection pool usage', async () => {
      // Mock healthy connection pool stats
      mockFastify.prisma.$queryRaw.mockResolvedValue([{
        total_connections: BigInt(10),
        active_connections: BigInt(3),
        idle_connections: BigInt(7),
        waiting_connections: BigInt(0),
        max_connections: BigInt(100),
      }]);

      const result = await checkConnectionPool(mockFastify);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('Connection pool healthy');
      expect(result.active).toBe(3);
      expect(result.idle).toBe(7);
      expect(result.total).toBe(10);
      expect(result.utilization).toBe(10); // 10/100 * 100
    });

    it('should return degraded status for high connection pool usage', async () => {
      // Mock high connection pool usage
      mockFastify.prisma.$queryRaw.mockResolvedValue([{
        total_connections: BigInt(75),
        active_connections: BigInt(50),
        idle_connections: BigInt(25),
        waiting_connections: BigInt(2),
        max_connections: BigInt(100),
      }]);

      const result = await checkConnectionPool(mockFastify);

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('under pressure');
      expect(result.utilization).toBe(75);
    });

    it('should return unhealthy status for connection pool at capacity', async () => {
      // Mock connection pool at capacity
      mockFastify.prisma.$queryRaw.mockResolvedValue([{
        total_connections: BigInt(95),
        active_connections: BigInt(80),
        idle_connections: BigInt(15),
        waiting_connections: BigInt(5),
        max_connections: BigInt(100),
      }]);

      const result = await checkConnectionPool(mockFastify);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('at capacity');
      expect(result.utilization).toBe(95);
    });

    it('should handle connection pool check failure', async () => {
      // Mock connection pool query failure
      mockFastify.prisma.$queryRaw.mockRejectedValue(new Error('Query failed'));

      const result = await checkConnectionPool(mockFastify);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Connection pool check failed');
      expect(result.active).toBe(0);
      expect(result.idle).toBe(0);
    });
  });

  describe('checkMigrationStatus', () => {
    it('should return healthy status for all migrations applied', async () => {
      // Mock migrations table exists
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{
          total: BigInt(10),
          applied: BigInt(10),
          failed: BigInt(0),
        }]);

      const result = await checkMigrationStatus(mockFastify);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('All 10 migrations applied successfully');
      expect(result.applied).toBe(10);
      expect(result.pending).toBe(0);
    });

    it('should return degraded status for pending migrations', async () => {
      // Mock pending migrations
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{
          total: BigInt(12),
          applied: BigInt(10),
          failed: BigInt(0),
        }]);

      const result = await checkMigrationStatus(mockFastify);

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('2 migrations pending');
      expect(result.applied).toBe(10);
      expect(result.pending).toBe(2);
    });

    it('should return unhealthy status for failed migrations', async () => {
      // Mock failed migrations
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{
          total: BigInt(10),
          applied: BigInt(8),
          failed: BigInt(2),
        }]);

      const result = await checkMigrationStatus(mockFastify);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('2 migrations failed');
    });

    it('should return unhealthy status when migrations table does not exist', async () => {
      // Mock migrations table does not exist
      mockFastify.prisma.$queryRaw.mockResolvedValue([{ exists: false }]);

      const result = await checkMigrationStatus(mockFastify);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Migrations table not found');
      expect(result.applied).toBe(0);
      expect(result.pending).toBe(0);
    });
  });

  describe('validateTenantIsolation', () => {
    it('should return healthy status with no isolation violations', async () => {
      // Mock organizations
      mockFastify.prisma.organization.findMany.mockResolvedValue([
        { id: 'org1' },
        { id: 'org2' },
      ] as any);

      // Mock no cross-tenant violations
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No repo violations
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No test violations
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No repo violations for org2
        .mockResolvedValueOnce([{ count: BigInt(0) }]); // No test violations for org2

      const result = await validateTenantIsolation(mockFastify);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('Tenant isolation verified for 2 organizations');
      expect(result.tenantsChecked).toBe(2);
      expect(result.isolationViolations).toBe(0);
    });

    it('should return degraded status with minor isolation violations', async () => {
      // Mock organizations
      mockFastify.prisma.organization.findMany.mockResolvedValue([
        { id: 'org1' },
        { id: 'org2' },
      ] as any);

      // Mock minor violations
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(1) }]) // 1 repo violation
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No test violations
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No repo violations for org2
        .mockResolvedValueOnce([{ count: BigInt(0) }]); // No test violations for org2

      const result = await validateTenantIsolation(mockFastify);

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('1 minor isolation issues found');
      expect(result.isolationViolations).toBe(1);
    });

    it('should return unhealthy status with serious isolation violations', async () => {
      // Mock organizations
      mockFastify.prisma.organization.findMany.mockResolvedValue([
        { id: 'org1' },
        { id: 'org2' },
      ] as any);

      // Mock serious violations (>10% of tenants)
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(5) }]) // 5 repo violations
        .mockResolvedValueOnce([{ count: BigInt(3) }]) // 3 test violations
        .mockResolvedValueOnce([{ count: BigInt(2) }]) // 2 repo violations for org2
        .mockResolvedValueOnce([{ count: BigInt(1) }]); // 1 test violation for org2

      const result = await validateTenantIsolation(mockFastify);

      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('serious isolation violations detected');
      expect(result.isolationViolations).toBe(11); // 5+3+2+1
    });
  });

  describe('checkQueryPerformance', () => {
    it('should return healthy status for good query performance', async () => {
      // Mock good query performance stats
      mockFastify.prisma.$queryRaw.mockResolvedValue([{
        avg_duration: 25.5,
        slow_queries: BigInt(0),
        total_calls: BigInt(1000),
        deadlocks: BigInt(0),
      }]);

      const result = await checkQueryPerformance(mockFastify);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('Query performance healthy');
      expect(result.queryPerformance.avgResponseTime).toBe(25.5);
      expect(result.queryPerformance.slowQueries).toBe(0);
      expect(result.queryPerformance.deadlocks).toBe(0);
    });

    it('should return degraded status for poor query performance', async () => {
      // Mock degraded query performance
      mockFastify.prisma.$queryRaw.mockResolvedValue([{
        avg_duration: 150.0,
        slow_queries: BigInt(25),
        total_calls: BigInt(1000),
        deadlocks: BigInt(2),
      }]);

      const result = await checkQueryPerformance(mockFastify);

      expect(result.status).toBe('degraded');
      expect(result.message).toContain('Query performance degraded');
      expect(result.queryPerformance.avgResponseTime).toBe(150.0);
      expect(result.queryPerformance.slowQueries).toBe(25);
      expect(result.queryPerformance.deadlocks).toBe(2);
    });

    it('should fall back to basic performance check when pg_stat_statements unavailable', async () => {
      // Mock pg_stat_statements not available
      mockFastify.prisma.$queryRaw
        .mockRejectedValueOnce(new Error('pg_stat_statements not enabled'))
        .mockResolvedValueOnce([{ count: BigInt(5) }]); // Fallback query

      const result = await checkQueryPerformance(mockFastify);

      expect(result.status).toBe('healthy');
      expect(result.message).toContain('pg_stat_statements unavailable');
      expect(result.queryPerformance.avgResponseTime).toBeDefined();
    });
  });

  describe('getDatabaseStatistics', () => {
    it('should return comprehensive database statistics', async () => {
      // Mock database statistics query
      mockFastify.prisma.$queryRaw.mockResolvedValue([{
        database_size: '50 MB',
        connections_used: BigInt(15),
        connections_max: BigInt(100),
        cache_hit_ratio: 95.5,
        index_hit_ratio: 98.2,
        active_queries: BigInt(3),
        longest_query_duration: 0.125,
        total_commits: BigInt(10000),
        total_rollbacks: BigInt(5),
      }]);

      const result = await getDatabaseStatistics(mockFastify);

      expect(result.database_size).toBe('50 MB');
      expect(Number(result.connections_used)).toBe(15);
      expect(Number(result.connections_max)).toBe(100);
      expect(result.cache_hit_ratio).toBe(95.5);
      expect(result.index_hit_ratio).toBe(98.2);
      expect(Number(result.active_queries)).toBe(3);
      expect(result.longest_query_duration).toBe(0.125);
      expect(Number(result.total_commits)).toBe(10000);
      expect(Number(result.total_rollbacks)).toBe(5);
    });

    it('should handle database statistics query failure', async () => {
      // Mock query failure
      mockFastify.prisma.$queryRaw.mockRejectedValue(new Error('Statistics query failed'));

      await expect(getDatabaseStatistics(mockFastify)).rejects.toThrow('Statistics query failed');
    });
  });

  describe('checkDatabaseIssues', () => {
    it('should return empty array when no issues detected', async () => {
      // Mock no issues
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No long queries
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No blocked queries
        .mockResolvedValueOnce([{
          used: BigInt(25),
          max: BigInt(100),
          ratio: 25.0,
        }]); // Normal connection usage

      const result = await checkDatabaseIssues(mockFastify);

      expect(result).toEqual([]);
    });

    it('should detect long-running queries', async () => {
      // Mock long-running queries
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(3) }]) // 3 long queries
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No blocked queries
        .mockResolvedValueOnce([{
          used: BigInt(25),
          max: BigInt(100),
          ratio: 25.0,
        }]);

      const result = await checkDatabaseIssues(mockFastify);

      expect(result).toContain('3 queries running longer than 5 minutes');
    });

    it('should detect blocked queries', async () => {
      // Mock blocked queries
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No long queries
        .mockResolvedValueOnce([{ count: BigInt(5) }]) // 5 blocked queries
        .mockResolvedValueOnce([{
          used: BigInt(25),
          max: BigInt(100),
          ratio: 25.0,
        }]);

      const result = await checkDatabaseIssues(mockFastify);

      expect(result).toContain('5 blocked queries detected');
    });

    it('should detect high connection usage', async () => {
      // Mock high connection usage
      mockFastify.prisma.$queryRaw
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No long queries
        .mockResolvedValueOnce([{ count: BigInt(0) }]) // No blocked queries
        .mockResolvedValueOnce([{
          used: BigInt(85),
          max: BigInt(100),
          ratio: 85.0,
        }]); // High connection usage

      const result = await checkDatabaseIssues(mockFastify);

      expect(result).toContain('High connection usage: 85% of max connections');
    });

    it('should handle database issues check failure', async () => {
      // Mock query failure
      mockFastify.prisma.$queryRaw.mockRejectedValue(new Error('Issues check failed'));

      const result = await checkDatabaseIssues(mockFastify);

      expect(result).toContain('Error checking database issues: Issues check failed');
    });
  });
});