/**
 * Database layer for JUnit test ingestion
 *
 * Provides efficient batch operations, upsert logic, and query methods
 * for storing and retrieving JUnit test results with proper transaction management.
 */
// ============================================================================
// Database Repository Class
// ============================================================================
export class TestIngestionRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    /**
     * Batch insert test suites with upsert logic
     */
    async batchUpsertTestSuites(suites, options = {}) {
        const { batchSize = 100 } = options;
        const results = [];
        // Process in batches to avoid memory issues
        for (let i = 0; i < suites.length; i += batchSize) {
            const batch = suites.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(suite => this.upsertTestSuite(suite)));
            results.push(...batchResults);
        }
        return results;
    }
    /**
     * Batch insert test results with upsert logic
     */
    async batchUpsertTestResults(testResults, options = {}) {
        const { batchSize = 500 } = options;
        const results = [];
        // Process in batches to avoid memory issues and improve performance
        for (let i = 0; i < testResults.length; i += batchSize) {
            const batch = testResults.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(testResult => this.upsertTestResult(testResult)));
            results.push(...batchResults);
        }
        return results;
    }
    /**
     * Upsert a single test suite
     */
    async upsertTestSuite(suite) {
        return this.prisma.testSuite.upsert({
            where: {
                repositoryId_name_runId: {
                    repositoryId: suite.repositoryId,
                    name: suite.name,
                    runId: suite.runId || '',
                },
            },
            create: {
                ...suite,
                properties: suite.properties || {},
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
                properties: suite.properties || {},
                updatedAt: new Date(),
            },
        });
    }
    /**
     * Upsert a single test result
     */
    async upsertTestResult(testResult) {
        return this.prisma.testResult.upsert({
            where: {
                repositoryId_testFullName_file_suite: {
                    repositoryId: testResult.repositoryId,
                    testFullName: testResult.testFullName,
                    file: testResult.file || '',
                    suite: testResult.suite,
                },
            },
            create: testResult,
            update: {
                status: testResult.status,
                time: testResult.time,
                duration: testResult.duration,
                message: testResult.message,
                stack: testResult.stack,
                errorMessage: testResult.errorMessage,
                stackTrace: testResult.stackTrace,
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
    async processJUnitTestSuites(junitData, context) {
        return this.prisma.$transaction(async (tx) => {
            const testSuiteInputs = [];
            const testResultInputs = [];
            // Process each test suite
            for (const suite of junitData.suites) {
                // Create test suite input
                const suiteInput = {
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
                    properties: suite.properties || {},
                };
                testSuiteInputs.push(suiteInput);
                // Process test cases in this suite
                for (const testCase of suite.testCases) {
                    const testFullName = `${suite.name}.${testCase.className}.${testCase.name}`;
                    const testResultInput = {
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
            const testSuites = await this.batchUpsertTestSuitesInTransaction(testSuiteInputs, tx);
            // Map suite names to IDs for test results
            const suiteNameToId = new Map();
            testSuites.forEach(suite => {
                suiteNameToId.set(suite.name, suite.id);
            });
            // Update test results with suite IDs
            testResultInputs.forEach(testResult => {
                testResult.testSuiteId = suiteNameToId.get(testResult.suite);
            });
            // Batch upsert test results
            const testResults = await this.batchUpsertTestResultsInTransaction(testResultInputs, tx);
            return { testSuites, testResults };
        });
    }
    /**
     * Get test execution statistics for a repository
     */
    async getTestExecutionStats(repositoryId, options = {}) {
        const whereClause = {
            repositoryId,
            ...(options.startDate && { createdAt: { gte: options.startDate } }),
            ...(options.endDate && { createdAt: { lte: options.endDate } }),
            ...(options.runId && { runId: options.runId }),
        };
        const [totalTests, passedTests, failedTests, errorTests, skippedTests, timeStats, suiteCount,] = await Promise.all([
            this.prisma.testResult.count({ where: whereClause }),
            this.prisma.testResult.count({ where: { ...whereClause, status: 'passed' } }),
            this.prisma.testResult.count({ where: { ...whereClause, status: 'failed' } }),
            this.prisma.testResult.count({ where: { ...whereClause, status: 'error' } }),
            this.prisma.testResult.count({ where: { ...whereClause, status: 'skipped' } }),
            this.prisma.testResult.aggregate({
                where: { ...whereClause, time: { not: null } },
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
            averageTime: timeStats._avg.time || 0,
            totalTime: timeStats._sum.time || 0,
            suiteCount,
        };
    }
    /**
     * Get test history with filtering and pagination
     */
    async getTestHistory(options) {
        const { repositoryId, testName, suite, status, limit = 50, offset = 0, orderBy = 'createdAt', orderDirection = 'desc', startDate, endDate, } = options;
        const whereClause = {
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
                    testSuite: true,
                    repository: true,
                    checkRun: true,
                    workflowJob: true,
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
    async findFlakyTests(repositoryId, options = {}) {
        const { minRuns = 3, maxStableRate = 0.8, daysPeriod = 30, } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysPeriod);
        const results = await this.prisma.$queryRaw `
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
    async cleanupOldTestResults(repositoryId, retentionDays = 90) {
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
    async batchUpsertTestSuitesInTransaction(suites, tx) {
        const results = [];
        for (const suite of suites) {
            const result = await tx.testSuite.upsert({
                where: {
                    repositoryId_name_runId: {
                        repositoryId: suite.repositoryId,
                        name: suite.name,
                        runId: suite.runId || '',
                    },
                },
                create: {
                    ...suite,
                    properties: suite.properties || {},
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
                    properties: suite.properties || {},
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
    async batchUpsertTestResultsInTransaction(testResults, tx) {
        const results = [];
        for (const testResult of testResults) {
            const result = await tx.testResult.upsert({
                where: {
                    repositoryId_testFullName_file_suite: {
                        repositoryId: testResult.repositoryId,
                        testFullName: testResult.testFullName,
                        file: testResult.file || '',
                        suite: testResult.suite,
                    },
                },
                create: testResult,
                update: {
                    status: testResult.status,
                    time: testResult.time,
                    duration: testResult.duration,
                    message: testResult.message,
                    stack: testResult.stack,
                    errorMessage: testResult.errorMessage,
                    stackTrace: testResult.stackTrace,
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
    extractFileFromClassName(className) {
        if (!className)
            return undefined;
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
    mapTestCaseStatus(status) {
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
export function createTestIngestionRepository(prisma) {
    return new TestIngestionRepository(prisma);
}
/**
 * Helper function to validate repository context
 */
export function validateRepositoryContext(context) {
    return Boolean(context.owner && context.repo);
}
//# sourceMappingURL=database.js.map