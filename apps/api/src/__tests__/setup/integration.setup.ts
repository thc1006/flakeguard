/**
 * Integration Test Setup for FlakeGuard API
 * 
 * Configures test environment with real external dependencies
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;
let prisma: PrismaClient;
let redis: Redis;

// Global setup - start containers
beforeAll(async () => {
  if (process.env.USE_TEST_CONTAINERS === 'true') {
    console.log('Starting test containers...');
    
    // Start PostgreSQL container
    postgresContainer = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('flakeguard_test')
      .withUsername('test')
      .withPassword('test')
      .withExposedPorts(5432)
      .start();

    // Start Redis container
    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .start();

    // Set environment variables
    process.env.DATABASE_URL = postgresContainer.getConnectionUri();
    process.env.REDIS_URL = `redis://localhost:${redisContainer.getMappedPort(6379)}`;
    
    console.log('Test containers started successfully');
  } else {
    console.log('Using local services for integration tests');
  }

  // Initialize database connection
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  // Initialize Redis connection
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
  });

  // Run database migrations
  const { execSync } = await import('child_process');
  try {
    execSync('npx prisma migrate deploy', { 
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    });
    console.log('Database migrations completed');
  } catch (error) {
    console.error('Database migration failed:', error);
    throw error;
  }
}, 120000); // 2 minutes timeout for container startup

// Global teardown - stop containers
afterAll(async () => {
  console.log('Cleaning up test environment...');
  
  // Close database connections
  if (prisma) {
    await prisma.$disconnect();
  }
  
  // Close Redis connection
  if (redis) {
    redis.disconnect();
  }
  
  // Stop containers if they were started
  if (process.env.USE_TEST_CONTAINERS === 'true') {
    if (postgresContainer) {
      await postgresContainer.stop();
    }
    if (redisContainer) {
      await redisContainer.stop();
    }
    console.log('Test containers stopped');
  }
}, 30000);

// Per-test setup
beforeEach(async () => {
  // Clean database state
  if (prisma) {
    await prisma.$transaction([
      prisma.testCase.deleteMany(),
      prisma.testRun.deleteMany(),
      prisma.repository.deleteMany(),
      // Add other models as needed
    ]);
  }
  
  // Clean Redis state
  if (redis) {
    await redis.flushdb();
  }
});

afterEach(async () => {
  // Additional cleanup if needed
});

// Export utilities for tests
export const testDb = {
  get prisma() {
    return prisma;
  },
  
  async seedRepository(data: any = {}) {
    return prisma.repository.create({
      data: {
        name: 'test-repo',
        fullName: 'test-org/test-repo',
        owner: 'test-org',
        installationId: 12345,
        isActive: true,
        ...data,
      },
    });
  },

  async seedTestRun(repositoryId: string, data: any = {}) {
    return prisma.testRun.create({
      data: {
        repositoryId,
        workflowRunId: 12345,
        runAttempt: 1,
        status: 'completed',
        conclusion: 'success',
        startedAt: new Date(),
        completedAt: new Date(),
        ...data,
      },
    });
  },

  async seedTestCase(testRunId: string, data: any = {}) {
    return prisma.testCase.create({
      data: {
        testRunId,
        name: 'should pass',
        className: 'TestClass',
        fileName: 'test.spec.ts',
        status: 'passed',
        duration: 1000,
        ...data,
      },
    });
  },
};

export const testRedis = {
  get client() {
    return redis;
  },
  
  async set(key: string, value: any, ttl?: number) {
    const serialized = JSON.stringify(value);
    if (ttl) {
      return redis.setex(key, ttl, serialized);
    }
    return redis.set(key, serialized);
  },
  
  async get(key: string) {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  },
  
  async flushAll() {
    return redis.flushdb();
  },
};

// Export containers for direct access if needed
export const containers = {
  get postgres() {
    return postgresContainer;
  },
  
  get redis() {
    return redisContainer;
  },
};