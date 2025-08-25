/**
 * Database layer for JUnit test ingestion
 *
 * Provides efficient batch operations, upsert logic, and query methods
 * for storing and retrieving JUnit test results with proper transaction management.
 */
import { PrismaClient, TestResult, TestSuite } from '@prisma/client';
import type { TestSuites as JUnitTestSuites, RepositoryContext } from './types.js';
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
export declare class TestIngestionRepository {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    /**
     * Batch insert test suites with upsert logic
     */
    batchUpsertTestSuites(suites: TestSuiteInput[], options?: {
        batchSize?: number;
    }): Promise<TestSuite[]>;
    /**
     * Batch insert test results with upsert logic
     */
    batchUpsertTestResults(testResults: TestResultInput[], options?: {
        batchSize?: number;
    }): Promise<TestResult[]>;
    /**
     * Upsert a single test suite
     */
    upsertTestSuite(suite: TestSuiteInput): Promise<TestSuite>;
    /**
     * Upsert a single test result
     */
    upsertTestResult(testResult: TestResultInput): Promise<TestResult>;
    /**
     * Process JUnit test suites data for database storage
     */
    processJUnitTestSuites(junitData: JUnitTestSuites, context: RepositoryContext & {
        repositoryId: string;
        checkRunId?: string;
        workflowJobId?: string;
    }): Promise<{
        testSuites: TestSuite[];
        testResults: TestResult[];
    }>;
    /**
     * Get test execution statistics for a repository
     */
    getTestExecutionStats(repositoryId: string, options?: {
        startDate?: Date;
        endDate?: Date;
        runId?: string;
    }): Promise<TestExecutionStats>;
    /**
     * Get test history with filtering and pagination
     */
    getTestHistory(options: TestHistoryQueryOptions): Promise<{
        tests: TestResult[];
        total: number;
    }>;
    /**
     * Find flaky tests based on inconsistent results
     */
    findFlakyTests(repositoryId: string, options?: {
        minRuns?: number;
        maxStableRate?: number;
        daysPeriod?: number;
    }): Promise<Array<{
        testFullName: string;
        suite: string;
        class: string;
        totalRuns: number;
        failures: number;
        successRate: number;
        lastFailure: Date | null;
    }>>;
    /**
     * Clean up old test results
     */
    cleanupOldTestResults(repositoryId: string, retentionDays?: number): Promise<{
        deletedCount: number;
    }>;
    /**
     * Batch upsert test suites within a transaction
     */
    private batchUpsertTestSuitesInTransaction;
    /**
     * Batch upsert test results within a transaction
     */
    private batchUpsertTestResultsInTransaction;
    /**
     * Extract file path from class name (heuristic)
     */
    private extractFileFromClassName;
    /**
     * Map JUnit test case status to database status
     */
    private mapTestCaseStatus;
}
/**
 * Create a test ingestion repository instance
 */
export declare function createTestIngestionRepository(prisma: PrismaClient): TestIngestionRepository;
/**
 * Helper function to validate repository context
 */
export declare function validateRepositoryContext(context: RepositoryContext): context is RepositoryContext & {
    owner: string;
    repo: string;
};
//# sourceMappingURL=database.d.ts.map