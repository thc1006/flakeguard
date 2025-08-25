/**
 * Prisma model extensions and validation helpers for JUnit test ingestion
 * 
 * Provides custom types, validation helpers, and database mapping utilities
 * for converting between JUnit XML data and database models.
 */

import type { 
  TestResult, 
  TestSuite, 
  Prisma,
  PrismaClient 
} from '@prisma/client';
import { z } from 'zod';

import type {
  TestCase,
  TestSuite as JUnitTestSuite,
  TestSuites as JUnitTestSuites,
  TestCaseStatus,
  TestFailure,
  RepositoryContext
} from './types.js';

// ============================================================================
// Extended Prisma Types
// ============================================================================

/**
 * Extended TestResult with relations
 */
export type TestResultWithRelations = TestResult & {
  repository?: {
    id: string;
    name: string;
    fullName: string;
    owner: string;
  };
  testSuite?: TestSuite;
  checkRun?: {
    id: string;
    name: string;
    status: string;
    conclusion: string | null;
    headSha: string;
  };
  workflowJob?: {
    id: string;
    name: string;
    status: string;
    conclusion: string | null;
  };
  flakeDetections?: Array<{
    id: string;
    isFlaky: boolean;
    confidence: number;
    status: string;
  }>;
};

/**
 * Extended TestSuite with relations
 */
export type TestSuiteWithRelations = TestSuite & {
  repository?: {
    id: string;
    name: string;
    fullName: string;
    owner: string;
  };
  testResults?: TestResult[];
  checkRun?: {
    id: string;
    name: string;
    status: string;
    conclusion: string | null;
  };
  workflowJob?: {
    id: string;
    name: string;
    status: string;
    conclusion: string | null;
  };
};

/**
 * Test execution summary
 */
export interface TestExecutionSummary {
  testSuite: TestSuiteWithRelations;
  testResults: TestResultWithRelations[];
  statistics: {
    totalTests: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    flaky: number;
    successRate: number;
    averageTime: number;
    totalTime: number;
  };
  trends: {
    previousRuns: number;
    successRateTrend: 'improving' | 'declining' | 'stable';
    performanceTrend: 'faster' | 'slower' | 'stable';
  };
}

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Schema for validating test suite input data
 */
export const TestSuiteInputSchema = z.object({
  name: z.string().min(1).max(255),
  package: z.string().max(255).optional(),
  hostname: z.string().max(255).optional(),
  tests: z.number().int().min(0),
  failures: z.number().int().min(0),
  errors: z.number().int().min(0),
  skipped: z.number().int().min(0),
  time: z.number().min(0).optional(),
  timestamp: z.string().optional(),
  runId: z.string().max(255).optional(),
  jobName: z.string().max(255).optional(),
  repositoryId: z.string().cuid(),
  checkRunId: z.string().cuid().optional(),
  workflowJobId: z.string().cuid().optional(),
  systemOut: z.string().optional(),
  systemErr: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
});

/**
 * Schema for validating test result input data
 */
export const TestResultInputSchema = z.object({
  name: z.string().min(1).max(255),
  suite: z.string().min(1).max(255),
  class: z.string().min(1).max(255),
  testFullName: z.string().min(1).max(500),
  file: z.string().max(500).optional(),
  status: z.enum(['passed', 'failed', 'error', 'skipped', 'flaky']),
  time: z.number().min(0).optional(),
  duration: z.number().int().min(0).optional(),
  message: z.string().optional(),
  stack: z.string().optional(),
  errorMessage: z.string().optional(),
  stackTrace: z.string().optional(),
  attempt: z.number().int().min(1).default(1),
  runId: z.string().max(255).optional(),
  jobName: z.string().max(255).optional(),
  repositoryId: z.string().cuid(),
  testSuiteId: z.string().cuid().optional(),
  checkRunId: z.string().cuid().optional(),
  workflowJobId: z.string().cuid().optional(),
});

/**
 * Schema for batch ingestion input
 */
export const BatchIngestionInputSchema = z.object({
  testSuites: z.array(TestSuiteInputSchema),
  testResults: z.array(TestResultInputSchema),
  repositoryContext: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().optional(),
    sha: z.string().optional(),
    runId: z.number().optional(),
    jobId: z.number().optional(),
  }),
});

/**
 * Schema for test history query options
 */
export const TestHistoryQuerySchema = z.object({
  repositoryId: z.string().cuid(),
  testName: z.string().optional(),
  suite: z.string().optional(),
  status: z.enum(['passed', 'failed', 'error', 'skipped', 'flaky']).optional(),
  limit: z.number().int().min(1).max(1000).default(50),
  offset: z.number().int().min(0).default(0),
  orderBy: z.enum(['createdAt', 'time', 'name']).default('createdAt'),
  orderDirection: z.enum(['asc', 'desc']).default('desc'),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

// ============================================================================
// Mapping Utilities
// ============================================================================

/**
 * Convert JUnit TestCase to database TestResult input
 */
export function mapTestCaseToTestResult(
  testCase: TestCase,
  suite: JUnitTestSuite,
  context: {
    repositoryId: string;
    checkRunId?: string;
    workflowJobId?: string;
    testSuiteId?: string;
    runId?: string;
    jobName?: string;
  }
): z.infer<typeof TestResultInputSchema> {
  const testFullName = `${suite.name}.${testCase.className}.${testCase.name}`;
  const file = extractFileFromClassName(testCase.className);
  
  // Extract failure/error information
  const failure = testCase.failure || testCase.error;
  const message = failure?.message || testCase.skipped?.message;
  const stack = failure?.stackTrace;

  return {
    name: testCase.name,
    suite: suite.name,
    class: testCase.className,
    testFullName,
    file,
    status: mapTestCaseStatus(testCase.status),
    time: testCase.time,
    duration: testCase.time ? Math.round(testCase.time * 1000) : undefined,
    message,
    stack,
    errorMessage: message, // Legacy compatibility
    stackTrace: stack, // Legacy compatibility
    attempt: 1,
    runId: context.runId,
    jobName: context.jobName,
    repositoryId: context.repositoryId,
    testSuiteId: context.testSuiteId,
    checkRunId: context.checkRunId,
    workflowJobId: context.workflowJobId,
  };
}

/**
 * Convert JUnit TestSuite to database TestSuite input
 */
export function mapTestSuiteToInput(
  testSuite: JUnitTestSuite,
  context: {
    repositoryId: string;
    checkRunId?: string;
    workflowJobId?: string;
    runId?: string;
    jobName?: string;
  }
): z.infer<typeof TestSuiteInputSchema> {
  return {
    name: testSuite.name,
    package: testSuite.package,
    hostname: testSuite.hostname,
    tests: testSuite.tests,
    failures: testSuite.failures,
    errors: testSuite.errors,
    skipped: testSuite.skipped,
    time: testSuite.time,
    timestamp: testSuite.timestamp,
    runId: context.runId,
    jobName: context.jobName,
    repositoryId: context.repositoryId,
    checkRunId: context.checkRunId,
    workflowJobId: context.workflowJobId,
    systemOut: testSuite.systemOut,
    systemErr: testSuite.systemErr,
    properties: testSuite.properties || {},
  };
}

/**
 * Convert JUnit TestSuites to batch ingestion input
 */
export function mapJUnitDataToBatchInput(
  junitData: JUnitTestSuites,
  repositoryContext: RepositoryContext & {
    repositoryId: string;
    checkRunId?: string;
    workflowJobId?: string;
  }
): z.infer<typeof BatchIngestionInputSchema> {
  const testSuites: z.infer<typeof TestSuiteInputSchema>[] = [];
  const testResults: z.infer<typeof TestResultInputSchema>[] = [];

  const context = {
    repositoryId: repositoryContext.repositoryId,
    checkRunId: repositoryContext.checkRunId,
    workflowJobId: repositoryContext.workflowJobId,
    runId: repositoryContext.runId?.toString(),
    jobName: repositoryContext.jobId?.toString(),
  };

  // Process each test suite
  for (const suite of junitData.suites) {
    // Map test suite
    const testSuiteInput = mapTestSuiteToInput(suite, context);
    testSuites.push(testSuiteInput);

    // Map test cases in this suite
    for (const testCase of suite.testCases) {
      const testResultInput = mapTestCaseToTestResult(
        testCase,
        suite,
        context
      );
      testResults.push(testResultInput);
    }
  }

  return {
    testSuites,
    testResults,
    repositoryContext,
  };
}

// ============================================================================
// Database Constraint Helpers
// ============================================================================

/**
 * Validate unique constraint for test results
 */
export function validateTestResultUniqueness(
  testResult: z.infer<typeof TestResultInputSchema>
): boolean {
  return Boolean(
    testResult.repositoryId &&
    testResult.testFullName &&
    testResult.suite &&
    (testResult.file !== undefined) // Can be null/empty
  );
}

/**
 * Validate unique constraint for test suites
 */
export function validateTestSuiteUniqueness(
  testSuite: z.infer<typeof TestSuiteInputSchema>
): boolean {
  return Boolean(
    testSuite.repositoryId &&
    testSuite.name &&
    (testSuite.runId !== undefined) // Can be null/empty
  );
}

/**
 * Generate test full name consistently
 */
export function generateTestFullName(
  suiteName: string,
  className: string,
  testName: string
): string {
  return `${suiteName}.${className}.${testName}`;
}

/**
 * Check for duplicate test results in a batch
 */
export function findDuplicateTestResults(
  testResults: z.infer<typeof TestResultInputSchema>[]
): Array<{ index: number; duplicate: z.infer<typeof TestResultInputSchema> }> {
  const seen = new Set<string>();
  const duplicates: Array<{ index: number; duplicate: z.infer<typeof TestResultInputSchema> }> = [];

  testResults.forEach((testResult, index) => {
    const key = `${testResult.repositoryId}:${testResult.testFullName}:${testResult.file || ''}:${testResult.suite}`;
    
    if (seen.has(key)) {
      duplicates.push({ index, duplicate: testResult });
    } else {
      seen.add(key);
    }
  });

  return duplicates;
}

// ============================================================================
// Type Conversion Utilities
// ============================================================================

/**
 * Convert database TestResult to API response format
 */
export function formatTestResultForAPI(
  testResult: TestResultWithRelations
): {
  id: string;
  name: string;
  suite: string;
  class: string;
  testFullName: string;
  file: string | null;
  status: string;
  time: number | null;
  duration: number | null;
  message: string | null;
  stack: string | null;
  attempt: number;
  runId: string | null;
  jobName: string | null;
  createdAt: string;
  updatedAt: string;
  repository?: {
    id: string;
    name: string;
    fullName: string;
    owner: string;
  };
  testSuite?: {
    id: string;
    name: string;
    package: string | null;
  };
  isFlaky?: boolean;
  flakyConfidence?: number;
} {
  const isFlaky = testResult.flakeDetections?.some(fd => fd.isFlaky) || false;
  const flakyConfidence = testResult.flakeDetections?.find(fd => fd.isFlaky)?.confidence;

  return {
    id: testResult.id,
    name: testResult.name,
    suite: testResult.suite,
    class: testResult.class,
    testFullName: testResult.testFullName,
    file: testResult.file,
    status: testResult.status,
    time: testResult.time,
    duration: testResult.duration,
    message: testResult.message,
    stack: testResult.stack,
    attempt: testResult.attempt,
    runId: testResult.runId,
    jobName: testResult.jobName,
    createdAt: testResult.createdAt.toISOString(),
    updatedAt: testResult.updatedAt.toISOString(),
    repository: testResult.repository,
    testSuite: testResult.testSuite ? {
      id: testResult.testSuite.id,
      name: testResult.testSuite.name,
      package: testResult.testSuite.package,
    } : undefined,
    isFlaky,
    flakyConfidence,
  };
}

/**
 * Convert database TestSuite to API response format
 */
export function formatTestSuiteForAPI(
  testSuite: TestSuiteWithRelations
): {
  id: string;
  name: string;
  package: string | null;
  hostname: string | null;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number | null;
  timestamp: string | null;
  runId: string | null;
  jobName: string | null;
  systemOut: string | null;
  systemErr: string | null;
  properties: any;
  createdAt: string;
  updatedAt: string;
  testResults?: Array<{
    id: string;
    name: string;
    status: string;
    time: number | null;
    message: string | null;
  }>;
  statistics: {
    successRate: number;
    averageTime: number;
    flakyTests: number;
  };
} {
  const testResults = testSuite.testResults || [];
  const successRate = testResults.length > 0 
    ? testResults.filter(tr => tr.status === 'passed').length / testResults.length
    : 0;
  
  const averageTime = testResults.length > 0
    ? testResults.reduce((sum, tr) => sum + (tr.time || 0), 0) / testResults.length
    : 0;
  
  const flakyTests = testResults.filter(tr => tr.status === 'flaky').length;

  return {
    id: testSuite.id,
    name: testSuite.name,
    package: testSuite.package,
    hostname: testSuite.hostname,
    tests: testSuite.tests,
    failures: testSuite.failures,
    errors: testSuite.errors,
    skipped: testSuite.skipped,
    time: testSuite.time,
    timestamp: testSuite.timestamp,
    runId: testSuite.runId,
    jobName: testSuite.jobName,
    systemOut: testSuite.systemOut,
    systemErr: testSuite.systemErr,
    properties: testSuite.properties,
    createdAt: testSuite.createdAt.toISOString(),
    updatedAt: testSuite.updatedAt.toISOString(),
    testResults: testResults.map(tr => ({
      id: tr.id,
      name: tr.name,
      status: tr.status,
      time: tr.time,
      message: tr.message,
    })),
    statistics: {
      successRate,
      averageTime,
      flakyTests,
    },
  };
}

// ============================================================================
// Private Helper Functions
// ============================================================================

/**
 * Extract file path from class name using various heuristics
 */
function extractFileFromClassName(className: string): string | undefined {
  if (!className || className.trim() === '') {
    return undefined;
  }

  // Handle Java-style class names (com.example.MyClass)
  if (className.includes('.')) {
    const parts = className.split('.');
    const fileName = parts[parts.length - 1];
    const packagePath = parts.slice(0, -1).join('/');
    
    // Common file extensions based on patterns
    if (className.includes('Test') || className.endsWith('Tests')) {
      return `${packagePath}/${fileName}.java`;
    }
    
    return `${packagePath}/${fileName}.java`;
  }

  // Handle simple class names
  if (className.includes('Test') || className.endsWith('Tests')) {
    return `${className}.java`;
  }

  // Handle Python-style test files
  if (className.startsWith('test_') || className.endsWith('_test')) {
    return `${className}.py`;
  }

  // Handle JavaScript/TypeScript test files
  if (className.includes('.spec') || className.includes('.test')) {
    return className.includes('.ts') ? `${className}.ts` : `${className}.js`;
  }

  // Default case - assume it's a simple class name
  return className;
}

/**
 * Map JUnit test case status to standardized database status
 */
function mapTestCaseStatus(status: TestCaseStatus): string {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'error':
      return 'error';
    case 'skipped':
      return 'skipped';
    case 'flaky':
      return 'flaky';
    default:
      return 'passed'; // Default to passed for unknown statuses
  }
}

/**
 * Calculate test execution trends
 */
export async function calculateTestTrends(
  prisma: PrismaClient,
  repositoryId: string,
  testFullName: string,
  period: number = 30
): Promise<{
  successRateTrend: 'improving' | 'declining' | 'stable';
  performanceTrend: 'faster' | 'slower' | 'stable';
  confidence: number;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - period);

  const results = await prisma.testResult.findMany({
    where: {
      repositoryId,
      testFullName,
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      status: true,
      time: true,
      createdAt: true,
    },
  });

  if (results.length < 4) {
    return {
      successRateTrend: 'stable',
      performanceTrend: 'stable',
      confidence: 0,
    };
  }

  // Split results into two halves for comparison
  const mid = Math.floor(results.length / 2);
  const firstHalf = results.slice(0, mid);
  const secondHalf = results.slice(mid);

  // Calculate success rates
  const firstSuccessRate = firstHalf.filter(r => r.status === 'passed').length / firstHalf.length;
  const secondSuccessRate = secondHalf.filter(r => r.status === 'passed').length / secondHalf.length;

  // Calculate average execution times (excluding null values)
  const firstHalfTimes = firstHalf.filter(r => r.time !== null).map(r => r.time);
  const secondHalfTimes = secondHalf.filter(r => r.time !== null).map(r => r.time);
  
  const firstAvgTime = firstHalfTimes.length > 0 
    ? firstHalfTimes.reduce((sum, time) => sum + time, 0) / firstHalfTimes.length
    : 0;
  const secondAvgTime = secondHalfTimes.length > 0
    ? secondHalfTimes.reduce((sum, time) => sum + time, 0) / secondHalfTimes.length
    : 0;

  // Determine trends
  const successRateDiff = secondSuccessRate - firstSuccessRate;
  const timeDiff = secondAvgTime - firstAvgTime;
  
  const successRateTrend = 
    Math.abs(successRateDiff) < 0.05 ? 'stable' :
    successRateDiff > 0 ? 'improving' : 'declining';

  const performanceTrend = 
    Math.abs(timeDiff) < 0.1 || firstAvgTime === 0 || secondAvgTime === 0 ? 'stable' :
    timeDiff < 0 ? 'faster' : 'slower';

  // Calculate confidence based on sample size and consistency
  const confidence = Math.min(results.length / 10, 1);

  return {
    successRateTrend,
    performanceTrend,
    confidence,
  };
}