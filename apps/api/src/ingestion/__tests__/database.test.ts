/**
 * Database Repository Tests for JUnit Test Ingestion
 * 
 * Comprehensive test suite covering:
 * - Unit tests for TestIngestionRepository with test containers
 * - Batch insertion and upsert functionality testing
 * - Database constraint testing (uniqueness, foreign keys)
 * - Transaction rollback testing
 * - Query performance validation
 * - Concurrent write handling
 * - Data integrity and consistency validation
 */

import { PrismaClient } from '@prisma/client';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

import {
  TestIngestionRepository,
  createTestIngestionRepository,
} from '../database.js';
import type {
  TestSuiteInput,
  TestResultInput,
  BatchIngestionInput,
  TestHistoryQueryOptions,
} from '../database.js';
import type {
  RepositoryContext
} from '../types.js';

// Mock Prisma for unit tests without actual database
const mockPrisma = {
  testSuite: {
    create: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn()
  },
  testResult: {
    create: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    groupBy: vi.fn(),
    aggregate: vi.fn()
  },
  repository: {
    findFirst: vi.fn(),
    create: vi.fn()
  },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  $disconnect: vi.fn()
} as unknown as PrismaClient;

// Test container setup for integration tests
let testContainer: any = null;
let prismaClient: PrismaClient | null = null;
const useTestContainers = process.env.USE_TEST_CONTAINERS === 'true';

// ============================================================================
// Test Setup and Helpers
// ============================================================================

describe('TestIngestionRepository', () => {
  let repository: TestIngestionRepository;
  let testRepositoryId: string;
  let testRunId: string;

  beforeAll(async () => {
    if (useTestContainers) {
      // Setup test containers for integration tests
      const { PostgreSqlContainer } = await import('testcontainers');
      
      testContainer = await new PostgreSqlContainer('postgres:15')
        .withDatabase('flakeguard_test')
        .withUsername('test')
        .withPassword('test')
        .withExposedPorts(5432)
        .start();

      const connectionUrl = testContainer.getConnectionUri();
      prismaClient = new PrismaClient({
        datasources: {
          db: {
            url: connectionUrl
          }
        }
      });

      // Run migrations
      const { execSync } = await import('child_process');
      process.env.DATABASE_URL = connectionUrl;
      execSync('npx prisma migrate deploy', { cwd: process.cwd() });
    }
  });

  beforeEach(async () => {
    const client = useTestContainers ? prismaClient! : mockPrisma;
    repository = new TestIngestionRepository(client);
    
    testRepositoryId = 'test-repo-id';
    testRunId = 'test-run-id';

    if (useTestContainers) {
      // Clean up test data
      await client.testResult.deleteMany({});
      await client.testSuite.deleteMany({});
      
      // Create test repository
      await client.repository.upsert({
        where: { id: testRepositoryId },
        create: {
          id: testRepositoryId,
          owner: 'test-owner',
          name: 'test-repo',
          fullName: 'test-owner/test-repo'
        },
        update: {}
      });
    }

    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (useTestContainers && prismaClient) {
      await prismaClient.testResult.deleteMany({});
      await prismaClient.testSuite.deleteMany({});
    }
  });

  afterAll(async () => {
    if (useTestContainers) {
      await prismaClient?.$disconnect();
      await testContainer?.stop();
    }
  });

  // ============================================================================
  // Constructor and Basic Operations
  // ============================================================================

  describe('Constructor and Basic Operations', () => {
    it('should create repository with Prisma client', () => {
      expect(repository).toBeInstanceOf(TestIngestionRepository);
    });

    it('should create repository with factory function', () => {
      const factoryRepo = createTestIngestionRepository(mockPrisma);
      expect(factoryRepo).toBeInstanceOf(TestIngestionRepository);
    });
  });

  // ============================================================================
  // Test Suite Operations
  // ============================================================================

  describe('Test Suite Operations', () => {
    const sampleTestSuiteInput: TestSuiteInput = {
      name: 'com.example.TestSuite',
      package: 'com.example',
      hostname: 'localhost',
      tests: 10,
      failures: 2,
      errors: 1,
      skipped: 1,
      time: 15.5,
      timestamp: '2023-01-01T12:00:00Z',
      runId: testRunId,
      jobName: 'test-job',
      repositoryId: testRepositoryId,
      checkRunId: 'check-123',
      workflowJobId: 'job-456',
      systemOut: 'Suite system output',
      systemErr: 'Suite system error',
      properties: {
        'java.version': '17.0.1',
        'os.name': 'Linux'
      }
    };

    it('should insert single test suite', async () => {
      if (useTestContainers) {
        const result = await repository.insertTestSuite(sampleTestSuiteInput);
        
        expect(result).toBeDefined();
        expect(result.name).toBe(sampleTestSuiteInput.name);
        expect(result.tests).toBe(sampleTestSuiteInput.tests);
        expect(result.failures).toBe(sampleTestSuiteInput.failures);
        expect(result.repositoryId).toBe(testRepositoryId);
      } else {
        // Mock test
        const mockResult = { id: 'suite-1', ...sampleTestSuiteInput };
        vi.mocked(mockPrisma.testSuite.create).mockResolvedValue(mockResult as any);

        const result = await repository.insertTestSuite(sampleTestSuiteInput);
        
        expect(mockPrisma.testSuite.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            name: sampleTestSuiteInput.name,
            tests: sampleTestSuiteInput.tests,
            repositoryId: testRepositoryId
          })
        });
        expect(result).toEqual(mockResult);
      }
    });

    it('should batch insert test suites', async () => {
      const testSuites: TestSuiteInput[] = [
        { ...sampleTestSuiteInput, name: 'Suite1' },
        { ...sampleTestSuiteInput, name: 'Suite2' },
        { ...sampleTestSuiteInput, name: 'Suite3' }
      ];

      if (useTestContainers) {
        const result = await repository.batchInsertTestSuites(testSuites);
        
        expect(result).toBeDefined();
        expect(result.count).toBe(3);
        
        // Verify insertion
        const insertedSuites = await prismaClient!.testSuite.findMany({
          where: { repositoryId: testRepositoryId }
        });
        expect(insertedSuites).toHaveLength(3);
        expect(insertedSuites.map(s => s.name).sort()).toEqual(['Suite1', 'Suite2', 'Suite3']);
      } else {
        // Mock test
        vi.mocked(mockPrisma.testSuite.createMany).mockResolvedValue({ count: 3 });

        const result = await repository.batchInsertTestSuites(testSuites);
        
        expect(mockPrisma.testSuite.createMany).toHaveBeenCalledWith({
          data: expect.arrayContaining([
            expect.objectContaining({ name: 'Suite1' }),
            expect.objectContaining({ name: 'Suite2' }),
            expect.objectContaining({ name: 'Suite3' })
          ]),
          skipDuplicates: false
        });
        expect(result.count).toBe(3);
      }
    });

    it('should handle duplicate test suite names with upsert', async () => {
      const duplicateTestSuite = {
        ...sampleTestSuiteInput,
        name: 'DuplicateSuite'
      };

      if (useTestContainers) {
        // Insert first time
        await repository.insertTestSuite(duplicateTestSuite);
        
        // Insert again with different stats
        const updatedSuite = {
          ...duplicateTestSuite,
          tests: 15,
          failures: 3
        };
        
        const result = await repository.upsertTestSuite(updatedSuite, {
          where: {
            name_runId_repositoryId: {
              name: updatedSuite.name,
              runId: updatedSuite.runId!,
              repositoryId: updatedSuite.repositoryId
            }
          }
        });
        
        expect(result.tests).toBe(15);
        expect(result.failures).toBe(3);
      } else {
        // Mock test
        const mockResult = { id: 'suite-1', ...duplicateTestSuite, tests: 15 };
        vi.mocked(mockPrisma.testSuite.upsert).mockResolvedValue(mockResult as any);

        const result = await repository.upsertTestSuite(duplicateTestSuite, {});
        
        expect(mockPrisma.testSuite.upsert).toHaveBeenCalled();
        expect(result).toEqual(mockResult);
      }
    });

    it('should validate required test suite fields', async () => {
      const invalidSuite: Partial<TestSuiteInput> = {
        name: '',
        repositoryId: testRepositoryId
        // Missing required fields
      };

      if (useTestContainers) {
        await expect(repository.insertTestSuite(invalidSuite as TestSuiteInput))
          .rejects.toThrow();
      } else {
        vi.mocked(mockPrisma.testSuite.create).mockRejectedValue(
          new Error('Required field validation failed')
        );

        await expect(repository.insertTestSuite(invalidSuite as TestSuiteInput))
          .rejects.toThrow('Required field validation failed');
      }
    });
  });

  // ============================================================================
  // Test Result Operations
  // ============================================================================

  describe('Test Result Operations', () => {
    let testSuiteId: string;
    
    const sampleTestResultInput: TestResultInput = {
      name: 'testMethod1',
      suite: 'com.example.TestClass',
      class: 'com.example.TestClass',
      testFullName: 'com.example.TestClass.testMethod1',
      file: 'TestClass.java',
      status: 'passed',
      time: 0.123,
      duration: 123,
      message: null,
      stack: null,
      errorMessage: null,
      stackTrace: null,
      attempt: 1,
      runId: testRunId,
      jobName: 'test-job',
      repositoryId: testRepositoryId,
      checkRunId: 'check-123',
      workflowJobId: 'job-456'
    };

    beforeEach(async () => {
      if (useTestContainers) {
        // Create a test suite first
        const suite = await repository.insertTestSuite({
          name: 'TestSuite',
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          repositoryId: testRepositoryId,
          runId: testRunId
        });
        testSuiteId = suite.id;
      } else {
        testSuiteId = 'mock-suite-id';
      }
    });

    it('should insert single test result', async () => {
      const testResult = { ...sampleTestResultInput, testSuiteId };

      if (useTestContainers) {
        const result = await repository.insertTestResult(testResult);
        
        expect(result).toBeDefined();
        expect(result.name).toBe(testResult.name);
        expect(result.status).toBe(testResult.status);
        expect(result.testSuiteId).toBe(testSuiteId);
      } else {
        const mockResult = { id: 'result-1', ...testResult };
        vi.mocked(mockPrisma.testResult.create).mockResolvedValue(mockResult as any);

        const result = await repository.insertTestResult(testResult);
        
        expect(mockPrisma.testResult.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            name: testResult.name,
            status: testResult.status,
            testSuiteId
          })
        });
        expect(result).toEqual(mockResult);
      }
    });

    it('should batch insert test results', async () => {
      const testResults: TestResultInput[] = [
        { ...sampleTestResultInput, name: 'test1', status: 'passed' },
        { ...sampleTestResultInput, name: 'test2', status: 'failed', errorMessage: 'Assertion failed' },
        { ...sampleTestResultInput, name: 'test3', status: 'skipped', message: 'Test disabled' }
      ].map(tr => ({ ...tr, testSuiteId }));

      if (useTestContainers) {
        const result = await repository.batchInsertTestResults(testResults);
        
        expect(result.count).toBe(3);
        
        // Verify insertion
        const insertedResults = await prismaClient!.testResult.findMany({
          where: { testSuiteId }
        });
        expect(insertedResults).toHaveLength(3);
        expect(insertedResults.map(r => r.status)).toEqual(['passed', 'failed', 'skipped']);
      } else {
        vi.mocked(mockPrisma.testResult.createMany).mockResolvedValue({ count: 3 });

        const result = await repository.batchInsertTestResults(testResults);
        
        expect(mockPrisma.testResult.createMany).toHaveBeenCalledWith({
          data: expect.arrayContaining([
            expect.objectContaining({ name: 'test1', status: 'passed' }),
            expect.objectContaining({ name: 'test2', status: 'failed' }),
            expect.objectContaining({ name: 'test3', status: 'skipped' })
          ]),
          skipDuplicates: false
        });
        expect(result.count).toBe(3);
      }
    });

    it('should handle test result upserts for retries', async () => {
      const originalResult = {
        ...sampleTestResultInput,
        testSuiteId,
        status: 'failed',
        attempt: 1,
        errorMessage: 'First attempt failed'
      };

      if (useTestContainers) {
        // Insert original result
        await repository.insertTestResult(originalResult);
        
        // Retry with success
        const retryResult = {
          ...originalResult,
          status: 'passed',
          attempt: 2,
          errorMessage: null
        };
        
        const result = await repository.upsertTestResult(retryResult, {
          where: {
            testFullName_runId_repositoryId: {
              testFullName: retryResult.testFullName,
              runId: retryResult.runId!,
              repositoryId: retryResult.repositoryId
            }
          }
        });
        
        expect(result.status).toBe('passed');
        expect(result.attempt).toBe(2);
        expect(result.errorMessage).toBeNull();
      } else {
        const mockResult = { id: 'result-1', ...originalResult, status: 'passed', attempt: 2 };
        vi.mocked(mockPrisma.testResult.upsert).mockResolvedValue(mockResult as any);

        const result = await repository.upsertTestResult(originalResult, {});
        
        expect(mockPrisma.testResult.upsert).toHaveBeenCalled();
        expect(result).toEqual(mockResult);
      }
    });

    it('should validate foreign key constraints', async () => {
      const invalidResult: TestResultInput = {
        ...sampleTestResultInput,
        testSuiteId: 'non-existent-suite-id'
      };

      if (useTestContainers) {
        await expect(repository.insertTestResult(invalidResult))
          .rejects.toThrow();
      } else {
        vi.mocked(mockPrisma.testResult.create).mockRejectedValue(
          new Error('Foreign key constraint failed')
        );

        await expect(repository.insertTestResult(invalidResult))
          .rejects.toThrow('Foreign key constraint failed');
      }
    });
  });

  // ============================================================================
  // Batch Operations and Transactions
  // ============================================================================

  describe('Batch Operations and Transactions', () => {
    const repositoryContext: RepositoryContext = {
      owner: 'test-owner',
      repo: 'test-repo'
    };

    const sampleBatchInput: BatchIngestionInput = {
      testSuites: [
        {
          name: 'Suite1',
          tests: 3,
          failures: 1,
          errors: 0,
          skipped: 1,
          repositoryId: testRepositoryId,
          runId: testRunId
        },
        {
          name: 'Suite2',
          tests: 2,
          failures: 0,
          errors: 1,
          skipped: 0,
          repositoryId: testRepositoryId,
          runId: testRunId
        }
      ],
      testResults: [
        {
          name: 'test1',
          suite: 'Suite1',
          class: 'TestClass1',
          testFullName: 'TestClass1.test1',
          status: 'passed',
          repositoryId: testRepositoryId,
          runId: testRunId
        },
        {
          name: 'test2',
          suite: 'Suite1',
          class: 'TestClass1',
          testFullName: 'TestClass1.test2',
          status: 'failed',
          errorMessage: 'Assertion failed',
          repositoryId: testRepositoryId,
          runId: testRunId
        },
        {
          name: 'test3',
          suite: 'Suite2',
          class: 'TestClass2',
          testFullName: 'TestClass2.test3',
          status: 'error',
          errorMessage: 'Runtime exception',
          repositoryId: testRepositoryId,
          runId: testRunId
        }
      ],
      repositoryContext
    };

    it('should perform batch ingestion with transaction', async () => {
      if (useTestContainers) {
        const result = await repository.batchIngest(sampleBatchInput);
        
        expect(result).toBeDefined();
        expect(result.testSuitesInserted).toBe(2);
        expect(result.testResultsInserted).toBe(3);
        
        // Verify all data was inserted
        const suites = await prismaClient!.testSuite.findMany({
          where: { repositoryId: testRepositoryId }
        });
        const results = await prismaClient!.testResult.findMany({
          where: { repositoryId: testRepositoryId }
        });
        
        expect(suites).toHaveLength(2);
        expect(results).toHaveLength(3);
      } else {
        // Mock transaction
        vi.mocked(mockPrisma.$transaction).mockImplementation(async (fn) => {
          return await fn(mockPrisma);
        });
        
        vi.mocked(mockPrisma.testSuite.createMany).mockResolvedValue({ count: 2 });
        vi.mocked(mockPrisma.testResult.createMany).mockResolvedValue({ count: 3 });

        const result = await repository.batchIngest(sampleBatchInput);
        
        expect(mockPrisma.$transaction).toHaveBeenCalled();
        expect(result.testSuitesInserted).toBe(2);
        expect(result.testResultsInserted).toBe(3);
      }
    });

    it('should rollback transaction on failure', async () => {
      const invalidBatchInput: BatchIngestionInput = {
        ...sampleBatchInput,
        testSuites: [
          {
            ...sampleBatchInput.testSuites[0],
            name: '' // Invalid name
          }
        ]
      };

      if (useTestContainers) {
        await expect(repository.batchIngest(invalidBatchInput))
          .rejects.toThrow();
        
        // Verify no data was inserted
        const suites = await prismaClient!.testSuite.findMany({
          where: { repositoryId: testRepositoryId }
        });
        expect(suites).toHaveLength(0);
      } else {
        vi.mocked(mockPrisma.$transaction).mockRejectedValue(
          new Error('Transaction failed')
        );

        await expect(repository.batchIngest(invalidBatchInput))
          .rejects.toThrow('Transaction failed');
      }
    });

    it('should handle large batch operations efficiently', async () => {
      const largeBatch: BatchIngestionInput = {
        testSuites: Array.from({ length: 100 }, (_, i) => ({
          name: `Suite${i}`,
          tests: 10,
          failures: Math.floor(Math.random() * 3),
          errors: Math.floor(Math.random() * 2),
          skipped: Math.floor(Math.random() * 2),
          repositoryId: testRepositoryId,
          runId: testRunId
        })),
        testResults: Array.from({ length: 1000 }, (_, i) => ({
          name: `test${i}`,
          suite: `Suite${Math.floor(i / 10)}`,
          class: `TestClass${Math.floor(i / 10)}`,
          testFullName: `TestClass${Math.floor(i / 10)}.test${i}`,
          status: Math.random() > 0.8 ? 'failed' : 'passed',
          repositoryId: testRepositoryId,
          runId: testRunId
        })),
        repositoryContext
      };

      if (useTestContainers) {
        const startTime = Date.now();
        const result = await repository.batchIngest(largeBatch);
        const endTime = Date.now();
        
        expect(result.testSuitesInserted).toBe(100);
        expect(result.testResultsInserted).toBe(1000);
        expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      } else {
        vi.mocked(mockPrisma.$transaction).mockImplementation(async (fn) => {
          return await fn(mockPrisma);
        });
        vi.mocked(mockPrisma.testSuite.createMany).mockResolvedValue({ count: 100 });
        vi.mocked(mockPrisma.testResult.createMany).mockResolvedValue({ count: 1000 });

        const result = await repository.batchIngest(largeBatch);
        
        expect(result.testSuitesInserted).toBe(100);
        expect(result.testResultsInserted).toBe(1000);
      }
    });
  });

  // ============================================================================
  // Query Operations
  // ============================================================================

  describe('Query Operations', () => {
    beforeEach(async () => {
      if (useTestContainers) {
        // Insert test data
        await repository.batchIngest({
          testSuites: [{
            name: 'QueryTestSuite',
            tests: 3,
            failures: 1,
            errors: 0,
            skipped: 1,
            repositoryId: testRepositoryId,
            runId: testRunId
          }],
          testResults: [
            {
              name: 'test1',
              suite: 'QueryTestSuite',
              class: 'QueryTestClass',
              testFullName: 'QueryTestClass.test1',
              status: 'passed',
              repositoryId: testRepositoryId,
              runId: testRunId
            },
            {
              name: 'test2',
              suite: 'QueryTestSuite',
              class: 'QueryTestClass',
              testFullName: 'QueryTestClass.test2',
              status: 'failed',
              errorMessage: 'Test failed',
              repositoryId: testRepositoryId,
              runId: testRunId
            },
            {
              name: 'test3',
              suite: 'QueryTestSuite',
              class: 'QueryTestClass',
              testFullName: 'QueryTestClass.test3',
              status: 'skipped',
              repositoryId: testRepositoryId,
              runId: testRunId
            }
          ],
          repositoryContext: { owner: 'test', repo: 'test' }
        });
      }
    });

    it('should query test history with filters', async () => {
      const queryOptions: TestHistoryQueryOptions = {
        repositoryId: testRepositoryId,
        testName: 'test1',
        status: 'passed',
        limit: 10,
        orderBy: 'createdAt',
        orderDirection: 'desc'
      };

      if (useTestContainers) {
        const results = await repository.getTestHistory(queryOptions);
        
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('test1');
        expect(results[0].status).toBe('passed');
      } else {
        const mockResults = [
          { id: 'result-1', name: 'test1', status: 'passed', createdAt: new Date() }
        ];
        vi.mocked(mockPrisma.testResult.findMany).mockResolvedValue(mockResults as any);

        const results = await repository.getTestHistory(queryOptions);
        
        expect(mockPrisma.testResult.findMany).toHaveBeenCalledWith({
          where: expect.objectContaining({
            repositoryId: testRepositoryId,
            name: 'test1',
            status: 'passed'
          }),
          take: 10,
          orderBy: { createdAt: 'desc' }
        });
        expect(results).toEqual(mockResults);
      }
    });

    it('should get execution statistics', async () => {
      if (useTestContainers) {
        const stats = await repository.getTestExecutionStats(testRepositoryId, {
          runId: testRunId
        });
        
        expect(stats).toBeDefined();
        expect(stats.totalTests).toBe(3);
        expect(stats.passedTests).toBe(1);
        expect(stats.failedTests).toBe(1);
        expect(stats.skippedTests).toBe(1);
      } else {
        const mockStats = {
          totalTests: 3,
          passedTests: 1,
          failedTests: 1,
          errorTests: 0,
          skippedTests: 1,
          averageDuration: 100,
          totalDuration: 300
        };
        vi.mocked(mockPrisma.testResult.aggregate).mockResolvedValue({
          _count: { _all: 3 },
          _avg: { duration: 100 },
          _sum: { duration: 300 }
        } as any);
        vi.mocked(mockPrisma.testResult.groupBy).mockResolvedValue([
          { status: 'passed', _count: { status: 1 } },
          { status: 'failed', _count: { status: 1 } },
          { status: 'skipped', _count: { status: 1 } }
        ] as any);

        const stats = await repository.getTestExecutionStats(testRepositoryId);
        
        expect(stats.totalTests).toBe(3);
        expect(stats.passedTests).toBe(1);
        expect(stats.failedTests).toBe(1);
      }
    });

    it('should detect flaky tests', async () => {
      if (useTestContainers) {
        // Insert multiple runs of the same test with different outcomes
        const flakyTestData = [
          { status: 'passed', runId: 'run1' },
          { status: 'failed', runId: 'run2' },
          { status: 'passed', runId: 'run3' },
          { status: 'failed', runId: 'run4' }
        ].map(data => ({
          name: 'flakyTest',
          suite: 'FlakyTestSuite',
          class: 'FlakyTestClass',
          testFullName: 'FlakyTestClass.flakyTest',
          status: data.status,
          repositoryId: testRepositoryId,
          runId: data.runId
        }));

        for (const testData of flakyTestData) {
          await repository.insertTestResult(testData);
        }

        const flakyTests = await repository.detectFlakyTests(testRepositoryId, {
          minRuns: 3,
          flakinessThreshold: 0.3
        });
        
        expect(flakyTests.length).toBeGreaterThan(0);
        expect(flakyTests[0].testName).toBe('flakyTest');
        expect(flakyTests[0].flakinessScore).toBeGreaterThan(0.3);
      } else {
        const mockFlakyTests = [
          {
            testName: 'flakyTest',
            testClass: 'FlakyTestClass',
            totalRuns: 4,
            passedRuns: 2,
            failedRuns: 2,
            flakinessScore: 0.5,
            lastSeen: new Date()
          }
        ];
        vi.mocked(mockPrisma.$queryRaw).mockResolvedValue(mockFlakyTests);

        const flakyTests = await repository.detectFlakyTests(testRepositoryId);
        
        expect(flakyTests).toEqual(mockFlakyTests);
      }
    });

    it('should handle pagination correctly', async () => {
      const queryOptions: TestHistoryQueryOptions = {
        repositoryId: testRepositoryId,
        limit: 2,
        offset: 1,
        orderBy: 'name',
        orderDirection: 'asc'
      };

      if (useTestContainers) {
        const results = await repository.getTestHistory(queryOptions);
        
        expect(results.length).toBeLessThanOrEqual(2);
      } else {
        const mockResults = [
          { id: 'result-2', name: 'test2' },
          { id: 'result-3', name: 'test3' }
        ];
        vi.mocked(mockPrisma.testResult.findMany).mockResolvedValue(mockResults as any);

        const results = await repository.getTestHistory(queryOptions);
        
        expect(mockPrisma.testResult.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            take: 2,
            skip: 1,
            orderBy: { name: 'asc' }
          })
        );
        expect(results).toEqual(mockResults);
      }
    });
  });

  // ============================================================================
  // Performance and Constraint Tests
  // ============================================================================

  describe('Performance and Constraints', () => {
    it('should handle concurrent writes safely', async () => {
      const concurrentWrites = Array.from({ length: 10 }, (_, i) => ({
        name: `ConcurrentTest${i}`,
        suite: 'ConcurrentSuite',
        class: 'ConcurrentClass',
        testFullName: `ConcurrentClass.ConcurrentTest${i}`,
        status: 'passed',
        repositoryId: testRepositoryId,
        runId: `concurrent-run-${i}`
      }));

      if (useTestContainers) {
        const promises = concurrentWrites.map(testResult => 
          repository.insertTestResult(testResult)
        );

        const results = await Promise.allSettled(promises);
        
        // All should succeed
        const successful = results.filter(r => r.status === 'fulfilled');
        expect(successful.length).toBe(10);
        
        // Verify all were inserted
        const insertedResults = await prismaClient!.testResult.findMany({
          where: { class: 'ConcurrentClass' }
        });
        expect(insertedResults.length).toBe(10);
      } else {
        // Mock concurrent writes
        vi.mocked(mockPrisma.testResult.create).mockImplementation(async (args) => ({
          id: `result-${Math.random()}`,
          ...args.data
        } as any));

        const promises = concurrentWrites.map(testResult => 
          repository.insertTestResult(testResult)
        );

        const results = await Promise.allSettled(promises);
        expect(results.filter(r => r.status === 'fulfilled').length).toBe(10);
      }
    });

    it('should enforce uniqueness constraints', async () => {
      const testResult: TestResultInput = {
        name: 'uniqueTest',
        suite: 'UniqueSuite',
        class: 'UniqueClass',
        testFullName: 'UniqueClass.uniqueTest',
        status: 'passed',
        repositoryId: testRepositoryId,
        runId: testRunId
      };

      if (useTestContainers) {
        // Insert first time - should succeed
        await repository.insertTestResult(testResult);
        
        // Insert duplicate - should fail
        await expect(repository.insertTestResult(testResult))
          .rejects.toThrow();
      } else {
        vi.mocked(mockPrisma.testResult.create)
          .mockResolvedValueOnce({ id: 'result-1', ...testResult } as any)
          .mockRejectedValueOnce(new Error('Unique constraint failed'));

        // First insert succeeds
        await expect(repository.insertTestResult(testResult)).resolves.toBeDefined();
        
        // Second insert fails
        await expect(repository.insertTestResult(testResult))
          .rejects.toThrow('Unique constraint failed');
      }
    });

    it('should perform well with large datasets', async () => {
      const startTime = Date.now();
      
      if (useTestContainers) {
        // Query with large dataset
        const queryOptions: TestHistoryQueryOptions = {
          repositoryId: testRepositoryId,
          limit: 1000,
          orderBy: 'createdAt',
          orderDirection: 'desc'
        };

        const results = await repository.getTestHistory(queryOptions);
        
        const endTime = Date.now();
        expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
      } else {
        // Mock performance test
        const mockResults = Array.from({ length: 1000 }, (_, i) => ({
          id: `result-${i}`,
          name: `test${i}`,
          createdAt: new Date()
        }));
        
        vi.mocked(mockPrisma.testResult.findMany).mockResolvedValue(mockResults as any);

        const queryOptions: TestHistoryQueryOptions = {
          repositoryId: testRepositoryId,
          limit: 1000
        };

        const results = await repository.getTestHistory(queryOptions);
        
        const endTime = Date.now();
        expect(results.length).toBe(1000);
        expect(endTime - startTime).toBeLessThan(100); // Mock should be very fast
      }
    });

    it('should handle database connection errors gracefully', async () => {
      if (!useTestContainers) {
        // Mock database connection error
        vi.mocked(mockPrisma.testResult.create).mockRejectedValue(
          new Error('Connection lost')
        );

        const testResult: TestResultInput = {
          name: 'testConnectionError',
          suite: 'ErrorSuite',
          class: 'ErrorClass',
          testFullName: 'ErrorClass.testConnectionError',
          status: 'passed',
          repositoryId: testRepositoryId
        };

        await expect(repository.insertTestResult(testResult))
          .rejects.toThrow('Connection lost');
      }
    });
  });

  // ============================================================================
  // Data Integrity Tests
  // ============================================================================

  describe('Data Integrity', () => {
    it('should maintain referential integrity between suites and results', async () => {
      if (useTestContainers) {
        // Insert test suite
        const suite = await repository.insertTestSuite({
          name: 'IntegrityTestSuite',
          tests: 1,
          failures: 0,
          errors: 0,
          skipped: 0,
          repositoryId: testRepositoryId,
          runId: testRunId
        });

        // Insert test result
        const result = await repository.insertTestResult({
          name: 'integrityTest',
          suite: 'IntegrityTestSuite',
          class: 'IntegrityTestClass',
          testFullName: 'IntegrityTestClass.integrityTest',
          status: 'passed',
          repositoryId: testRepositoryId,
          runId: testRunId,
          testSuiteId: suite.id
        });

        expect(result.testSuiteId).toBe(suite.id);

        // Try to delete suite with results - should fail
        await expect(prismaClient!.testSuite.delete({ where: { id: suite.id } }))
          .rejects.toThrow();
      }
    });

    it('should validate data consistency after batch operations', async () => {
      const batchInput: BatchIngestionInput = {
        testSuites: [{
          name: 'ConsistencyTestSuite',
          tests: 2,
          failures: 1,
          errors: 0,
          skipped: 0,
          repositoryId: testRepositoryId,
          runId: testRunId
        }],
        testResults: [
          {
            name: 'test1',
            suite: 'ConsistencyTestSuite',
            class: 'ConsistencyTestClass',
            testFullName: 'ConsistencyTestClass.test1',
            status: 'passed',
            repositoryId: testRepositoryId,
            runId: testRunId
          },
          {
            name: 'test2',
            suite: 'ConsistencyTestSuite',
            class: 'ConsistencyTestClass',
            testFullName: 'ConsistencyTestClass.test2',
            status: 'failed',
            repositoryId: testRepositoryId,
            runId: testRunId
          }
        ],
        repositoryContext: { owner: 'test', repo: 'test' }
      };

      if (useTestContainers) {
        await repository.batchIngest(batchInput);

        // Verify suite counts match actual test results
        const suite = await prismaClient!.testSuite.findFirst({
          where: { name: 'ConsistencyTestSuite' },
          include: { testResults: true }
        });

        expect(suite).toBeDefined();
        expect(suite!.tests).toBe(2);
        expect(suite!.testResults.length).toBe(2);
        
        const passedCount = suite!.testResults.filter(r => r.status === 'passed').length;
        const failedCount = suite!.testResults.filter(r => r.status === 'failed').length;
        
        expect(passedCount).toBe(1);
        expect(failedCount).toBe(1);
        expect(suite!.failures).toBe(failedCount);
      }
    });
  });
});