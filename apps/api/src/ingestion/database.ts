/**
 * Database layer for JUnit test ingestion
 * 
 * Provides efficient batch operations, upsert logic, and query methods
 * for storing and retrieving JUnit test results with proper transaction management.
 */

import { PrismaClient, TestResult, TestSuite, Prisma } from '@prisma/client';

import type {
  TestSuites as JUnitTestSuites,
  RepositoryContext
} from './types.js';

// ============================================================================
// Database Types and Interfaces
// ============================================================================

/**
 * Input data for creating a test suite
 */
export interface TestSuiteInput {
  name: string;
  package?: string;
  hostname?: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time?: number;
  timestamp?: string;
  runId?: string;
  jobName?: string;
  repositoryId: string;
  checkRunId?: string;
  workflowJobId?: string;
  systemOut?: string;
  systemErr?: string;
  properties?: Record<string, unknown>;
}

/**
 * Input data for creating a test result
 */
export interface TestResultInput {
  name: string;
  suite: string;
  class: string;
  testFullName: string;
  file?: string;
  status: string;
  time?: number;
  duration?: number;
  message?: string;
  stack?: string;
  errorMessage?: string;
  stackTrace?: string;
  attempt?: number;
  runId?: string;
  jobName?: string;
  repositoryId: string;
  testSuiteId?: string;
  checkRunId?: string;
  workflowJobId?: string;
}

/**
 * Batch ingestion input
 */
export interface BatchIngestionInput {
  testSuites: TestSuiteInput[];
  testResults: TestResultInput[];
  repositoryContext: RepositoryContext;
}

/**
 * Query options for retrieving test history
 */
export interface TestHistoryQueryOptions {
  repositoryId: string;
  testName?: string;
  suite?: string;
  status?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'time' | 'name';
  orderDirection?: 'asc' | 'desc';
  startDate?: Date;
  endDate?: Date;
}

/**
 * Test execution statistics
 */
export interface TestExecutionStats {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  errorTests: number;
  skippedTests: number;
  averageTime: number;
  totalTime: number;
  suiteCount: number;
}

// ============================================================================
// Database Repository Class
// ============================================================================

export class TestIngestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Batch insert test suites with upsert logic
   */
  async batchUpsertTestSuites(
    suites: TestSuiteInput[],
    options: { batchSize?: number } = {}
  ): Promise<TestSuite[]> {
    const { batchSize = 100 } = options;
    const results: TestSuite[] = [];

    // Process in batches to avoid memory issues
    for (let i = 0; i < suites.length; i += batchSize) {
      const batch = suites.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(suite => this.upsertTestSuite(suite))
      );
      
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Batch insert test results with upsert logic
   */
  async batchUpsertTestResults(
    testResults: TestResultInput[],
    options: { batchSize?: number } = {}
  ): Promise<TestResult[]> {
    const { batchSize = 500 } = options;
    const results: TestResult[] = [];

    // Process in batches to avoid memory issues and improve performance
    for (let i = 0; i < testResults.length; i += batchSize) {
      const batch = testResults.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(testResult => this.upsertTestResult(testResult))
      );
      
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Upsert a single test suite
   */
  async upsertTestSuite(suite: TestSuiteInput): Promise<TestSuite> {
    return this.prisma.testSuite.upsert({
      where: {
        orgId_repositoryId_name_runId: {
          orgId: 'default-org',
          repositoryId: suite.repositoryId,
          name: suite.name,
          runId: suite.runId || '',
        },
      },
      create: {
        ...suite,
        orgId: 'default-org',
        properties: (suite.properties || {}) as any,
      },
      update: {
        package: suite.package,
        hostname: suite.hostname,
        tests: suite.tests,
        failures: suite.failures,
        errors: suite.errors,
        skipped: suite.skipped,
        time: suite.time,
        timestamp: suite.timestamp,
        jobName: suite.jobName,
        checkRunId: suite.checkRunId,
        workflowJobId: suite.workflowJobId,
        systemOut: suite.systemOut,
        systemErr: suite.systemErr,
        properties: (suite.properties || {}) as any,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Upsert a single test result
   */
  async upsertTestResult(testResult: TestResultInput): Promise<TestResult> {
    return this.prisma.testResult.upsert({
      where: {
        orgId_repositoryId_testFullName_file_suite: {
          orgId: 'default-org',
          repositoryId: testResult.repositoryId,
          testFullName: testResult.testFullName,
          file: testResult.file || '',
          suite: testResult.suite,
        },
      },
      create: { ...testResult, orgId: 'default-org' } as any,
      update: {
        status: testResult.status,
        time: testResult.time,
        message: testResult.message,
        stack: testResult.stack,
        attempt: testResult.attempt || 1,
        jobName: testResult.jobName,
        testSuiteId: testResult.testSuiteId,
        checkRunId: testResult.checkRunId,
        workflowJobId: testResult.workflowJobId,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Process JUnit test suites data for database storage
   */
  async processJUnitTestSuites(
    junitData: JUnitTestSuites,
    context: RepositoryContext & {
      repositoryId: string;
      checkRunId?: string;
      workflowJobId?: string;
    }
  ): Promise<{ testSuites: TestSuite[]; testResults: TestResult[] }> {
    return this.prisma.$transaction(async (tx) => {
      const testSuiteInputs: TestSuiteInput[] = [];
      const testResultInputs: TestResultInput[] = [];

      // Process each test suite
      for (const suite of junitData.suites) {
        // Create test suite input
        const suiteInput: TestSuiteInput = {
          name: suite.name,
          package: suite.package,
          hostname: suite.hostname,
          tests: suite.tests,
          failures: suite.failures,
          errors: suite.errors,
          skipped: suite.skipped,
          time: suite.time,
          timestamp: suite.timestamp,
          runId: context.runId?.toString(),
          jobName: context.jobId?.toString(),
          repositoryId: context.repositoryId,
          checkRunId: context.checkRunId,
          workflowJobId: context.workflowJobId,
          systemOut: suite.systemOut,
          systemErr: suite.systemErr,
          properties: (suite.properties || {}) as any,
        };

        testSuiteInputs.push(suiteInput);

        // Process test cases in this suite
        for (const testCase of suite.testCases) {
          const testFullName = `${suite.name}.${testCase.className}.${testCase.name}`;
          
          const testResultInput: TestResultInput = {
            name: testCase.name,
            suite: suite.name,
            class: testCase.className,
            testFullName,
            file: this.extractFileFromClassName(testCase.className),
            status: this.mapTestCaseStatus(testCase.status),
            time: testCase.time,
            duration: testCase.time ? Math.round(testCase.time * 1000) : undefined,
            message: testCase.failure?.message || testCase.error?.message,
            stack: testCase.failure?.stackTrace || testCase.error?.stackTrace,
            errorMessage: testCase.failure?.message || testCase.error?.message,
            stackTrace: testCase.failure?.stackTrace || testCase.error?.stackTrace,
            attempt: 1,
            runId: context.runId?.toString(),
            jobName: context.jobId?.toString(),
            repositoryId: context.repositoryId,
            checkRunId: context.checkRunId,
            workflowJobId: context.workflowJobId,
          };

          testResultInputs.push(testResultInput);
        }
      }

      // Batch upsert test suites
      const testSuites = await this.batchUpsertTestSuitesInTransaction(
        testSuiteInputs,
        tx
      );

      // Map suite names to IDs for test results
      const suiteNameToId = new Map<string, string>();
      testSuites.forEach(suite => {
        if (suite.name && suite.id) {
          suiteNameToId.set(suite.name, suite.id);
        }
      });

      // Update test results with suite IDs
      testResultInputs.forEach(testResult => {
        const suiteId = suiteNameToId.get(testResult.suite);
        if (suiteId) {
          (testResult as any).testSuiteId = suiteId;
        }
      });

      // Batch upsert test results
      const testResults = await this.batchUpsertTestResultsInTransaction(
        testResultInputs,
        tx
      );

      return { testSuites, testResults };
    });
  }

  /**
   * Get test execution statistics for a repository
   */
  async getTestExecutionStats(
    repositoryId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      runId?: string;
    } = {}
  ): Promise<TestExecutionStats> {
    const whereClause: Prisma.TestResultWhereInput = {
      repositoryId,
      ...(options.startDate && { createdAt: { gte: options.startDate } }),
      ...(options.endDate && { createdAt: { lte: options.endDate } }),
      ...(options.runId && { runId: options.runId }),
    };

    const [
      totalTests,
      passedTests,
      failedTests,
      errorTests,
      skippedTests,
      timeStats,
      suiteCount,
    ] = await Promise.all([
      this.prisma.testResult.count({ where: whereClause }),
      this.prisma.testResult.count({ where: { ...whereClause, status: 'passed' } }),
      this.prisma.testResult.count({ where: { ...whereClause, status: 'failed' } }),
      this.prisma.testResult.count({ where: { ...whereClause, status: 'error' } }),
      this.prisma.testResult.count({ where: { ...whereClause, status: 'skipped' } }),
      this.prisma.testResult.aggregate({
        where: { ...whereClause, time: { not: null as any } },
        _avg: { time: true },
        _sum: { time: true },
      }),
      this.prisma.testSuite.count({
        where: {
          repositoryId,
          ...(options.startDate && { createdAt: { gte: options.startDate } }),
          ...(options.endDate && { createdAt: { lte: options.endDate } }),
          ...(options.runId && { runId: options.runId }),
        },
      }),
    ]);

    return {
      totalTests,
      passedTests,
      failedTests,
      errorTests,
      skippedTests,
      averageTime: (timeStats._avg?.time ?? 0),
      totalTime: (timeStats._sum?.time ?? 0),
      suiteCount,
    };
  }

  /**
   * Get test history with filtering and pagination
   */
  async getTestHistory(options: TestHistoryQueryOptions): Promise<{
    tests: TestResult[];
    total: number;
  }> {
    const {
      repositoryId,
      testName,
      suite,
      status,
      limit = 50,
      offset = 0,
      orderBy = 'createdAt',
      orderDirection = 'desc',
      startDate,
      endDate,
    } = options;

    const whereClause: Prisma.TestResultWhereInput = {
      repositoryId,
      ...(testName && { 
        OR: [
          { name: { contains: testName, mode: 'insensitive' } },
          { testFullName: { contains: testName, mode: 'insensitive' } },
        ]
      }),
      ...(suite && { suite: { contains: suite, mode: 'insensitive' } }),
      ...(status && { status }),
      ...(startDate && { createdAt: { gte: startDate } }),
      ...(endDate && { createdAt: { lte: endDate } }),
    };

    const [tests, total] = await Promise.all([
      this.prisma.testResult.findMany({
        where: whereClause,
        include: {
          testSuite: true
        },
        orderBy: { [orderBy]: orderDirection },
        skip: offset,
        take: limit,
      }),
      this.prisma.testResult.count({ where: whereClause }),
    ]);

    return { tests, total };
  }

  /**
   * Find flaky tests based on inconsistent results
   */
  async findFlakyTests(
    repositoryId: string,
    options: {
      minRuns?: number;
      maxStableRate?: number;
      daysPeriod?: number;
    } = {}
  ): Promise<Array<{
    testFullName: string;
    suite: string;
    class: string;
    totalRuns: number;
    failures: number;
    successRate: number;
    lastFailure: Date | null;
  }>> {
    const {
      minRuns = 3,
      maxStableRate = 0.8,
      daysPeriod = 30,
    } = options;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysPeriod);

    const results = await this.prisma.$queryRaw<Array<{
      testFullName: string;
      suite: string;
      class: string;
      totalRuns: bigint;
      failures: bigint;
      successRate: number;
      lastFailure: Date | null;
    }>>`
      SELECT 
        "testFullName",
        "suite",
        "class",
        COUNT(*) as "totalRuns",
        COUNT(*) FILTER (WHERE status IN ('failed', 'error')) as "failures",
        (COUNT(*) FILTER (WHERE status = 'passed')::float / COUNT(*)::float) as "successRate",
        MAX(CASE WHEN status IN ('failed', 'error') THEN "createdAt" ELSE NULL END) as "lastFailure"
      FROM "TestResult"
      WHERE 
        "repositoryId" = ${repositoryId}
        AND "createdAt" >= ${startDate}
      GROUP BY "testFullName", "suite", "class"
      HAVING 
        COUNT(*) >= ${minRuns}
        AND (COUNT(*) FILTER (WHERE status = 'passed')::float / COUNT(*)::float) <= ${maxStableRate}
        AND COUNT(*) FILTER (WHERE status IN ('failed', 'error')) > 0
      ORDER BY "successRate" ASC, "totalRuns" DESC
    `;

    return results.map(result => ({
      testFullName: result.testFullName,
      suite: result.suite,
      class: result.class,
      totalRuns: Number(result.totalRuns),
      failures: Number(result.failures),
      successRate: result.successRate,
      lastFailure: result.lastFailure,
    }));
  }

  /**
   * Clean up old test results
   */
  async cleanupOldTestResults(
    repositoryId: string,
    retentionDays: number = 90
  ): Promise<{ deletedCount: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.prisma.testResult.deleteMany({
      where: {
        repositoryId,
        createdAt: { lt: cutoffDate },
      },
    });

    return { deletedCount: result.count };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Batch upsert test suites within a transaction
   */
  private async batchUpsertTestSuitesInTransaction(
    suites: TestSuiteInput[],
    tx: Prisma.TransactionClient
  ): Promise<TestSuite[]> {
    const results: TestSuite[] = [];

    for (const suite of suites) {
      const result = await tx.testSuite.upsert({
        where: {
          orgId_repositoryId_name_runId: {
            orgId: 'default-org',
            repositoryId: suite.repositoryId,
            name: suite.name,
            runId: suite.runId || '',
          },
        },
        create: {
          ...suite,
          orgId: 'default-org',
          properties: (suite.properties || {}) as any,
        },
        update: {
          package: suite.package,
          hostname: suite.hostname,
          tests: suite.tests,
          failures: suite.failures,
          errors: suite.errors,
          skipped: suite.skipped,
          time: suite.time,
          timestamp: suite.timestamp,
          jobName: suite.jobName,
          checkRunId: suite.checkRunId,
          workflowJobId: suite.workflowJobId,
          systemOut: suite.systemOut,
          systemErr: suite.systemErr,
          properties: (suite.properties || {}) as any,
          updatedAt: new Date(),
        },
      });

      results.push(result);
    }

    return results;
  }

  /**
   * Batch upsert test results within a transaction
   */
  private async batchUpsertTestResultsInTransaction(
    testResults: TestResultInput[],
    tx: Prisma.TransactionClient
  ): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const testResult of testResults) {
      const result = await tx.testResult.upsert({
        where: {
          orgId_repositoryId_testFullName_file_suite: {
            orgId: 'default-org',
            repositoryId: testResult.repositoryId,
            testFullName: testResult.testFullName,
            file: testResult.file || '',
            suite: testResult.suite,
          },
        },
        create: { ...testResult, orgId: 'default-org' } as any,
        update: {
          status: testResult.status,
          time: testResult.time,
          message: testResult.message,
          stack: testResult.stack,
          attempt: testResult.attempt || 1,
          jobName: testResult.jobName,
          testSuiteId: testResult.testSuiteId,
          checkRunId: testResult.checkRunId,
          workflowJobId: testResult.workflowJobId,
          updatedAt: new Date(),
        },
      });

      results.push(result);
    }

    return results;
  }

  /**
   * Extract file path from class name (heuristic)
   */
  private extractFileFromClassName(className: string): string | undefined {
    if (!className) {return undefined;}
    
    // Convert Java-style class names to file paths
    if (className.includes('.')) {
      return className.replace(/\./g, '/') + '.java';
    }
    
    // Return as-is for other patterns
    return className;
  }

  /**
   * Map JUnit test case status to database status
   */
  private mapTestCaseStatus(status: string): string {
    switch (status.toLowerCase()) {
      case 'passed':
      case 'success':
        return 'passed';
      case 'failed':
      case 'failure':
        return 'failed';
      case 'error':
        return 'error';
      case 'skipped':
      case 'skip':
      case 'ignored':
        return 'skipped';
      case 'flaky':
        return 'flaky';
      default:
        return status.toLowerCase();
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a test ingestion repository instance
 */
export function createTestIngestionRepository(
  prisma: PrismaClient
): TestIngestionRepository {
  return new TestIngestionRepository(prisma);
}

/**
 * Helper function to validate repository context
 */
export function validateRepositoryContext(
  context: RepositoryContext
): context is RepositoryContext & { owner: string; repo: string } {
  return Boolean(context.owner && context.repo);
}