/**
 * Database Mock Data and Utilities for Testing
 * 
 * Provides realistic mock database responses and utilities for testing
 * database operations without requiring an actual database connection.
 */

import type { TestResult, TestSuite, Repository, IngestionJob } from '@prisma/client';
import { vi } from 'vitest';

// ============================================================================
// Mock Database Records
// ============================================================================

export const MOCK_REPOSITORY = {
  id: 'repo-test-123',
  orgId: 'org-test-123',
  githubId: 12345678,
  nodeId: 'MDEwOlJlcG9zaXRvcnkxMjM0NTY3OA==',
  owner: 'test-org',
  name: 'test-repo',
  fullName: 'test-org/test-repo',
  defaultBranch: 'main',
  private: false,
  installationId: '12345678',
  isActive: true,
  settings: {},
  createdAt: new Date('2023-01-01T00:00:00Z'),
  updatedAt: new Date('2023-12-01T10:00:00Z')
} satisfies Repository;

export const MOCK_TEST_SUITES: TestSuite[] = [
  {
    id: 'suite-1',
    name: 'com.example.service.UserServiceTest',
    package: 'com.example.service',
    hostname: 'localhost',
    tests: 5,
    failures: 0,
    errors: 0,
    skipped: 0,
    time: 2.543,
    timestamp: '2023-12-01T10:30:15Z',
    runId: 'run-test-123',
    jobName: 'test-job',
    repositoryId: MOCK_REPOSITORY.id,
    orgId: 'org-test-123',
    checkRunId: 'check-123',
    workflowJobId: 'job-456',
    systemOut: 'System output content',
    systemErr: '',
    properties: {
      'java.version': '17.0.5',
      'maven.version': '3.9.4'
    },
    createdAt: new Date('2023-12-01T10:30:00Z'),
    updatedAt: new Date('2023-12-01T10:30:00Z')
  },
  {
    id: 'suite-2',
    name: 'com.example.integration.DatabaseIntegrationTest',
    package: 'com.example.integration',
    hostname: 'ci-runner-01',
    tests: 8,
    failures: 2,
    errors: 1,
    skipped: 1,
    time: 15.832,
    timestamp: '2023-12-01T10:32:48Z',
    runId: 'run-test-123',
    jobName: 'test-job',
    repositoryId: MOCK_REPOSITORY.id,
    orgId: 'org-test-123',
    checkRunId: 'check-123',
    workflowJobId: 'job-456',
    systemOut: 'Integration test output',
    systemErr: 'Warning messages',
    properties: {
      'java.version': '17.0.5',
      'spring.profiles.active': 'test'
    },
    createdAt: new Date('2023-12-01T10:32:00Z'),
    updatedAt: new Date('2023-12-01T10:32:00Z')
  }
];

export const MOCK_TEST_RESULTS: TestResult[] = [
  {
    id: 'result-1',
    name: 'testCreateUser',
    suite: 'com.example.service.UserServiceTest',
    class: 'com.example.service.UserServiceTest',
    testFullName: 'com.example.service.UserServiceTest.testCreateUser',
    file: 'UserServiceTest.java',
    status: 'passed',
    time: 0.521,
    message: null,
    stack: null,
    attempt: 1,
    runId: 'run-test-123',
    jobName: 'test-job',
    repositoryId: MOCK_REPOSITORY.id,
    orgId: 'org-test-123',
    testSuiteId: 'suite-1',
    checkRunId: 'check-123',
    workflowJobId: 'job-456',
    createdAt: new Date('2023-12-01T10:30:10Z'),
    updatedAt: new Date('2023-12-01T10:30:10Z')
  },
  {
    id: 'result-2',
    name: 'testFindUserById',
    suite: 'com.example.service.UserServiceTest',
    class: 'com.example.service.UserServiceTest',
    testFullName: 'com.example.service.UserServiceTest.testFindUserById',
    file: 'UserServiceTest.java',
    status: 'passed',
    time: 0.425,
    message: null,
    stack: null,
    attempt: 1,
    runId: 'run-test-123',
    jobName: 'test-job',
    repositoryId: MOCK_REPOSITORY.id,
    orgId: 'org-test-123',
    testSuiteId: 'suite-1',
    checkRunId: 'check-123',
    workflowJobId: 'job-456',
    createdAt: new Date('2023-12-01T10:30:15Z'),
    updatedAt: new Date('2023-12-01T10:30:15Z')
  },
  {
    id: 'result-3',
    name: 'testInsertRecord',
    suite: 'com.example.integration.DatabaseIntegrationTest',
    class: 'com.example.integration.DatabaseIntegrationTest',
    testFullName: 'com.example.integration.DatabaseIntegrationTest.testInsertRecord',
    file: 'DatabaseIntegrationTest.java',
    status: 'failed',
    time: 2.134,
    message: 'Assertion failed: Expected 1 record, but found 0',
    stack: 'org.opentest4j.AssertionFailedError: Assertion failed\n\tat DatabaseIntegrationTest.testInsertRecord(DatabaseIntegrationTest.java:58)',
    attempt: 1,
    runId: 'run-test-123',
    jobName: 'test-job',
    repositoryId: MOCK_REPOSITORY.id,
    orgId: 'org-test-123',
    testSuiteId: 'suite-2',
    checkRunId: 'check-123',
    workflowJobId: 'job-456',
    createdAt: new Date('2023-12-01T10:32:20Z'),
    updatedAt: new Date('2023-12-01T10:32:20Z')
  },
  {
    id: 'result-4',
    name: 'testTransactionRollback',
    suite: 'com.example.integration.DatabaseIntegrationTest',
    class: 'com.example.integration.DatabaseIntegrationTest',
    testFullName: 'com.example.integration.DatabaseIntegrationTest.testTransactionRollback',
    file: 'DatabaseIntegrationTest.java',
    status: 'error',
    time: 3.421,
    message: 'Connection timeout after 5000ms',
    stack: 'java.sql.SQLTimeoutException: Connection timeout after 5000ms\n\tat DatabaseIntegrationTest.testTransactionRollback(DatabaseIntegrationTest.java:95)',
    attempt: 1,
    runId: 'run-test-123',
    jobName: 'test-job',
    repositoryId: MOCK_REPOSITORY.id,
    orgId: 'org-test-123',
    testSuiteId: 'suite-2',
    checkRunId: 'check-123',
    workflowJobId: 'job-456',
    createdAt: new Date('2023-12-01T10:32:30Z'),
    updatedAt: new Date('2023-12-01T10:32:30Z')
  },
  {
    id: 'result-5',
    name: 'testConnectionPooling',
    suite: 'com.example.integration.DatabaseIntegrationTest',
    class: 'com.example.integration.DatabaseIntegrationTest',
    testFullName: 'com.example.integration.DatabaseIntegrationTest.testConnectionPooling',
    file: 'DatabaseIntegrationTest.java',
    status: 'skipped',
    time: 0,
    message: 'Database connection pooling test disabled in CI environment',
    stack: null,
    attempt: 1,
    runId: 'run-test-123',
    jobName: 'test-job',
    repositoryId: MOCK_REPOSITORY.id,
    orgId: 'org-test-123',
    testSuiteId: 'suite-2',
    checkRunId: 'check-123',
    workflowJobId: 'job-456',
    createdAt: new Date('2023-12-01T10:32:40Z'),
    updatedAt: new Date('2023-12-01T10:32:40Z')
  }
];

export const MOCK_INGESTION_JOBS: any[] = [
  {
    id: 'job-completed-123',
    status: 'completed',
    repositoryId: MOCK_REPOSITORY.id,
    workflowRunId: '987654321',
    installationId: '12345678',
    correlationId: 'correlation-123',
    priority: 'normal',
    attempts: 1,
    maxAttempts: 3,
    processingTimeMs: 15000,
    artifactCount: 2,
    processedArtifactCount: 2,
    result: {
      success: true,
      stats: {
        totalFiles: 2,
        processedFiles: 2,
        totalTests: 13,
        totalFailures: 2,
        totalErrors: 1,
        totalSkipped: 1
      }
    },
    error: null,
    createdAt: new Date('2023-12-01T10:25:00Z'),
    updatedAt: new Date('2023-12-01T10:40:00Z'),
    startedAt: new Date('2023-12-01T10:25:05Z'),
    completedAt: new Date('2023-12-01T10:40:00Z')
  },
  {
    id: 'job-failed-456',
    status: 'failed',
    repositoryId: MOCK_REPOSITORY.id,
    workflowRunId: '987654322',
    installationId: '12345678',
    correlationId: 'correlation-456',
    priority: 'normal',
    attempts: 3,
    maxAttempts: 3,
    processingTimeMs: null,
    artifactCount: 1,
    processedArtifactCount: 0,
    result: null,
    error: 'Download failed: Network timeout',
    createdAt: new Date('2023-12-01T11:00:00Z'),
    updatedAt: new Date('2023-12-01T11:05:00Z'),
    startedAt: new Date('2023-12-01T11:00:05Z'),
    completedAt: null
  },
  {
    id: 'job-active-789',
    status: 'active',
    repositoryId: MOCK_REPOSITORY.id,
    workflowRunId: '987654323',
    installationId: '12345678',
    correlationId: 'correlation-789',
    priority: 'high',
    attempts: 1,
    maxAttempts: 3,
    processingTimeMs: null,
    artifactCount: 3,
    processedArtifactCount: 1,
    result: null,
    error: null,
    createdAt: new Date('2023-12-01T12:00:00Z'),
    updatedAt: new Date('2023-12-01T12:05:00Z'),
    startedAt: new Date('2023-12-01T12:00:10Z'),
    completedAt: null
  }
];

// ============================================================================
// Mock Prisma Client
// ============================================================================

export interface MockPrismaClient extends Partial<any> {
  repository: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  testSuite: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  testResult: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  ingestionJob: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  $disconnect: ReturnType<typeof vi.fn>;
}

export function createMockPrismaClient(): MockPrismaClient {
  return {
    repository: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn()
    },
    testSuite: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn()
    },
    testResult: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn()
    },
    ingestionJob: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn()
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $disconnect: vi.fn()
  };
}

// ============================================================================
// Mock Response Builders
// ============================================================================

export function setupSuccessfulMocks(mockPrisma: MockPrismaClient) {
  // Repository mocks
  mockPrisma.repository.findFirst.mockResolvedValue(MOCK_REPOSITORY);
  mockPrisma.repository.create.mockImplementation(async (args) => ({
    id: `repo-${Date.now()}`,
    ...args.data,
    createdAt: new Date(),
    updatedAt: new Date()
  }));

  // Test suite mocks
  mockPrisma.testSuite.create.mockImplementation(async (args) => ({
    id: `suite-${Date.now()}`,
    ...args.data,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  
  mockPrisma.testSuite.createMany.mockImplementation(async (args) => ({
    count: Array.isArray(args.data) ? args.data.length : 0
  }));
  
  mockPrisma.testSuite.findMany.mockResolvedValue(MOCK_TEST_SUITES);
  mockPrisma.testSuite.count.mockResolvedValue(MOCK_TEST_SUITES.length);

  // Test result mocks
  mockPrisma.testResult.create.mockImplementation(async (args) => ({
    id: `result-${Date.now()}`,
    ...args.data,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  
  mockPrisma.testResult.createMany.mockImplementation(async (args) => ({
    count: Array.isArray(args.data) ? args.data.length : 0
  }));
  
  mockPrisma.testResult.findMany.mockResolvedValue(MOCK_TEST_RESULTS);
  mockPrisma.testResult.count.mockResolvedValue(MOCK_TEST_RESULTS.length);
  
  mockPrisma.testResult.aggregate.mockResolvedValue({
    _count: { _all: MOCK_TEST_RESULTS.length },
    _avg: { duration: 1200 },
    _sum: { duration: 6501 }
  });
  
  mockPrisma.testResult.groupBy.mockResolvedValue([
    { status: 'passed', _count: { status: 2 } },
    { status: 'failed', _count: { status: 1 } },
    { status: 'error', _count: { status: 1 } },
    { status: 'skipped', _count: { status: 1 } }
  ]);

  // Ingestion job mocks
  mockPrisma.ingestionJob.create.mockImplementation(async (args) => ({
    id: `job-${Date.now()}`,
    ...args.data,
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  
  mockPrisma.ingestionJob.findUnique.mockImplementation(async (args) => {
    const id = args.where.id;
    return MOCK_INGESTION_JOBS.find(job => job.id === id) || null;
  });
  
  mockPrisma.ingestionJob.findMany.mockResolvedValue(MOCK_INGESTION_JOBS);
  mockPrisma.ingestionJob.count.mockResolvedValue(MOCK_INGESTION_JOBS.length);

  // Transaction mock
  mockPrisma.$transaction.mockImplementation(async (fn) => {
    if (typeof fn === 'function') {
      return await fn(mockPrisma as any);
    }
    return Promise.resolve(fn);
  });

  // Disconnect mock
  mockPrisma.$disconnect.mockResolvedValue(undefined);
}

export function setupFailureMocks(mockPrisma: MockPrismaClient) {
  // Repository not found
  mockPrisma.repository.findFirst.mockResolvedValue(null);
  
  // Database connection errors
  const connectionError = new Error('Connection lost');
  mockPrisma.testSuite.create.mockRejectedValue(connectionError);
  mockPrisma.testResult.create.mockRejectedValue(connectionError);
  
  // Constraint violations
  const constraintError = new Error('Unique constraint failed');
  mockPrisma.testSuite.createMany.mockRejectedValue(constraintError);
  
  // Transaction failures
  mockPrisma.$transaction.mockRejectedValue(new Error('Transaction failed'));
}

export function setupRateLimitMocks(mockPrisma: MockPrismaClient) {
  let requestCount = 0;
  const maxRequests = 10;
  
  const rateLimitChecker = () => {
    requestCount++;
    if (requestCount > maxRequests) {
      throw new Error('Database rate limit exceeded');
    }
  };
  
  mockPrisma.repository.findFirst.mockImplementation(async (..._args) => {
    rateLimitChecker();
    return MOCK_REPOSITORY;
  });
  
  mockPrisma.testSuite.create.mockImplementation(async (..._args) => {
    rateLimitChecker();
    return {
      id: `suite-${Date.now()}`,
      ..._args[0].data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  });
  
  mockPrisma.testResult.create.mockImplementation(async (...args) => {
    rateLimitChecker();
    return {
      id: `result-${Date.now()}`,
      ...args[0].data,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  });
}

// ============================================================================
// Query Result Builders
// ============================================================================

export function createMockQueryResults(options: {
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  errorTests?: number;
  skippedTests?: number;
  averageDuration?: number;
  totalDuration?: number;
} = {}) {
  const {
    totalTests = 100,
    passedTests = 80,
    failedTests = 15,
    errorTests = 3,
    skippedTests = 2,
    averageDuration = 1500,
    totalDuration = 150000
  } = options;

  return {
    aggregate: {
      _count: { _all: totalTests },
      _avg: { duration: averageDuration },
      _sum: { duration: totalDuration }
    },
    groupBy: [
      { status: 'passed', _count: { status: passedTests } },
      { status: 'failed', _count: { status: failedTests } },
      { status: 'error', _count: { status: errorTests } },
      { status: 'skipped', _count: { status: skippedTests } }
    ],
    findMany: Array.from({ length: totalTests }, (_, i) => ({
      id: `result-${i + 1}`,
      name: `test${i + 1}`,
      status: i < passedTests ? 'passed' : 
              i < passedTests + failedTests ? 'failed' :
              i < passedTests + failedTests + errorTests ? 'error' : 'skipped',
      duration: Math.floor(Math.random() * 3000),
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
    }))
  };
}

export function createMockFlakeDetectionResults() {
  return [
    {
      testName: 'testFlakyNetwork',
      testClass: 'com.example.NetworkTest',
      totalRuns: 20,
      passedRuns: 12,
      failedRuns: 8,
      flakinessScore: 0.4,
      lastSeen: new Date('2023-12-01T10:00:00Z'),
      firstSeen: new Date('2023-11-01T10:00:00Z')
    },
    {
      testName: 'testTimingDependentLogic',
      testClass: 'com.example.TimingTest',
      totalRuns: 15,
      passedRuns: 10,
      failedRuns: 5,
      flakinessScore: 0.33,
      lastSeen: new Date('2023-12-01T09:00:00Z'),
      firstSeen: new Date('2023-11-15T10:00:00Z')
    }
  ];
}

// ============================================================================
// Database State Management
// ============================================================================

export class MockDatabaseState {
  private repositories: Repository[] = [MOCK_REPOSITORY];
  private testSuites: TestSuite[] = [...MOCK_TEST_SUITES];
  private testResults: TestResult[] = [...MOCK_TEST_RESULTS];
  private ingestionJobs: IngestionJob[] = [...MOCK_INGESTION_JOBS];

  constructor(private mockPrisma: MockPrismaClient) {
    this.setupDynamicMocks();
  }

  reset() {
    this.repositories = [MOCK_REPOSITORY];
    this.testSuites = [...MOCK_TEST_SUITES];
    this.testResults = [...MOCK_TEST_RESULTS];
    this.ingestionJobs = [...MOCK_INGESTION_JOBS];
  }

  addRepository(repo: Partial<Repository>) {
    const newRepo = {
      id: `repo-${Date.now()}`,
      owner: 'test-owner',
      name: 'test-repo',
      fullName: 'test-owner/test-repo',
      private: false,
      installationId: '12345678',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...repo
    };
    this.repositories.push(newRepo);
    return newRepo;
  }

  addTestSuite(suite: Partial<TestSuite>) {
    const newSuite: TestSuite = {
      id: `suite-${Date.now()}`,
      name: 'TestSuite',
      package: null,
      hostname: null,
      tests: 1,
      failures: 0,
      errors: 0,
      skipped: 0,
      time: null,
      timestamp: null,
      runId: null,
      jobName: null,
      repositoryId: this.repositories[0].id,
      checkRunId: null,
      workflowJobId: null,
      systemOut: null,
      systemErr: null,
      properties: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...suite
    };
    this.testSuites.push(newSuite);
    return newSuite;
  }

  addTestResult(result: Partial<TestResult>) {
    const newResult: TestResult = {
      id: `result-${Date.now()}`,
      name: 'testMethod',
      suite: 'TestSuite',
      class: 'TestClass',
      testFullName: 'TestClass.testMethod',
      file: null,
      status: 'passed',
      time: null,
      duration: null,
      message: null,
      stack: null,
          attempt: 1,
      runId: null,
      jobName: null,
      repositoryId: this.repositories[0].id,
      testSuiteId: this.testSuites[0].id,
      checkRunId: null,
      workflowJobId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...result
    };
    this.testResults.push(newResult);
    return newResult;
  }

  getRepositories(): Repository[] {
    return [...this.repositories];
  }

  getTestSuites(): TestSuite[] {
    return [...this.testSuites];
  }

  getTestResults(): TestResult[] {
    return [...this.testResults];
  }

  getIngestionJobs(): IngestionJob[] {
    return [...this.ingestionJobs];
  }

  private setupDynamicMocks() {
    // Repository mocks
    this.mockPrisma.repository.findMany.mockImplementation(async () => this.repositories);
    this.mockPrisma.repository.findFirst.mockImplementation(async (args) => {
      if (!args?.where) {return this.repositories[0] || null;}
      // Simple matching for common queries
      if ('id' in args.where) {
        return this.repositories.find(r => r.id === args.where.id) || null;
      }
      return this.repositories[0] || null;
    });

    // Test suite mocks
    this.mockPrisma.testSuite.findMany.mockImplementation(async () => this.testSuites);
    this.mockPrisma.testSuite.count.mockImplementation(async () => this.testSuites.length);

    // Test result mocks
    this.mockPrisma.testResult.findMany.mockImplementation(async (args) => {
      let results = [...this.testResults];
      
      // Apply basic filtering
      if (args?.where?.repositoryId) {
        results = results.filter(r => r.repositoryId === args.where.repositoryId);
      }
      
      // Apply pagination
      if (args?.skip) {
        results = results.slice(args.skip);
      }
      if (args?.take) {
        results = results.slice(0, args.take);
      }
      
      return results;
    });
    
    this.mockPrisma.testResult.count.mockImplementation(async () => this.testResults.length);

    // Ingestion job mocks
    this.mockPrisma.ingestionJob.findMany.mockImplementation(async () => this.ingestionJobs);
    this.mockPrisma.ingestionJob.count.mockImplementation(async () => this.ingestionJobs.length);
  }
}

export function createMockDatabaseState(mockPrisma: MockPrismaClient): MockDatabaseState {
  return new MockDatabaseState(mockPrisma);
}