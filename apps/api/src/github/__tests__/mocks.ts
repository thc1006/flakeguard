/**
 * Mock Implementations and Test Utilities
 * 
 * Provides comprehensive mocking for:
 * - GitHub API responses and webhook payloads
 * - Octokit client instances
 * - PrismaClient with all operations
 * - Authentication managers
 * - Database test utilities
 * - Webhook signature verification
 * - Reusable test helpers
 */

import crypto from 'crypto';

import type { Octokit } from '@octokit/rest';
import type { PrismaClient } from '@prisma/client';
import { vi, expect, beforeEach, afterEach } from 'vitest';

import { GitHubAuthManager } from '../auth.js';
import { FlakeDetector } from '../flake-detector.js';
import { GitHubHelpers } from '../helpers.js';
import type {
  CheckRunWebhookPayload,
  WorkflowRunWebhookPayload,
  InstallationWebhookPayload,
} from '../schemas.js';
import type {
  CheckRunAction,
  FlakeAnalysis,
  TestResult,
  FlakeGuardCheckRun,
  TestArtifact,
  ApiResponse,
} from '../types.js';

// =============================================================================
// WEBHOOK PAYLOAD FACTORIES
// =============================================================================

export function createMockRepository(overrides: Partial<any> = {}) {
  return {
    id: 123456,
    node_id: 'MDEwOlJlcG9zaXRvcnkxMjM0NTY=',
    name: 'test-repo',
    full_name: 'test-owner/test-repo',
    owner: {
      login: 'test-owner',
      id: 67890,
      type: 'Organization' as const,
    },
    private: false,
    default_branch: 'main',
    pushed_at: '2024-01-01T10:00:00Z',
    created_at: '2024-01-01T09:00:00Z',
    updated_at: '2024-01-01T10:00:00Z',
    ...overrides,
  };
}

export function createMockInstallation(overrides: Partial<any> = {}) {
  return {
    id: 12345,
    account: {
      login: 'test-owner',
      id: 67890,
      type: 'Organization' as const,
    },
    ...overrides,
  };
}

export function createMockCheckRunPayload(
  action: 'created' | 'completed' | 'rerequested' | 'requested_action',
  checkRunOverrides: Partial<any> = {},
  payloadOverrides: Partial<any> = {}
): CheckRunWebhookPayload {
  const baseCheckRun = {
    id: 123,
    name: 'test-check',
    head_sha: 'abc123',
    status: 'completed' as const,
    conclusion: null as any,
    started_at: '2024-01-01T10:00:00Z',
    completed_at: action === 'completed' ? '2024-01-01T10:05:00Z' : null,
    output: {
      title: 'Test Check',
      summary: 'Test completed',
      text: null,
    },
    ...checkRunOverrides,
  };

  return {
    action,
    check_run: baseCheckRun,
    repository: createMockRepository(),
    installation: createMockInstallation(),
    ...payloadOverrides,
  } as CheckRunWebhookPayload;
}

export function createMockWorkflowRunPayload(
  action: 'completed' | 'requested' | 'in_progress',
  workflowRunOverrides: Partial<any> = {},
  payloadOverrides: Partial<any> = {}
): WorkflowRunWebhookPayload {
  const baseWorkflowRun = {
    id: 456,
    name: 'CI',
    head_branch: 'main',
    head_sha: 'def456',
    status: action === 'completed' ? 'completed' : 'in_progress' as const,
    conclusion: action === 'completed' ? 'success' : null as any,
    workflow_id: 789,
    created_at: '2024-01-01T10:00:00Z',
    updated_at: '2024-01-01T10:05:00Z',
    run_started_at: '2024-01-01T10:00:00Z',
    ...workflowRunOverrides,
  };

  const baseWorkflow = {
    id: 789,
    name: 'Test Workflow',
    path: '.github/workflows/test.yml',
  };

  return {
    action,
    workflow_run: baseWorkflowRun,
    workflow: baseWorkflow,
    repository: createMockRepository(),
    installation: createMockInstallation(),
    ...payloadOverrides,
  } as WorkflowRunWebhookPayload;
}

export function createMockInstallationPayload(
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted',
  installationOverrides: Partial<any> = {},
  payloadOverrides: Partial<any> = {}
): InstallationWebhookPayload {
  const baseInstallation = {
    id: 12345,
    account: {
      login: 'test-org',
      id: 67890,
      type: 'Organization' as const,
    },
    repository_selection: 'selected' as const,
    permissions: {
      checks: 'write' as const,
      actions: 'read' as const,
    },
    events: ['check_run', 'workflow_run'],
    created_at: '2024-01-01T09:00:00Z',
    updated_at: '2024-01-01T10:00:00Z',
    suspended_at: null,
    ...installationOverrides,
  };

  return {
    action,
    installation: baseInstallation,
    ...payloadOverrides,
  } as InstallationWebhookPayload;
}

// =============================================================================
// GITHUB API RESPONSE MOCKS
// =============================================================================

export function createMockCheckRun(overrides: Partial<any> = {}): FlakeGuardCheckRun {
  return {
    id: 123,
    name: 'FlakeGuard Test',
    headSha: 'abc123',
    status: 'completed',
    conclusion: 'success',
    startedAt: '2024-01-01T10:00:00Z',
    completedAt: '2024-01-01T10:05:00Z',
    output: {
      title: 'Test passed',
      summary: 'All tests passed successfully',
      text: undefined,
    },
    actions: [],
    ...overrides,
  };
}

export function createMockArtifact(overrides: Partial<any> = {}): TestArtifact {
  return {
    id: 123,
    name: 'test-results',
    type: 'test-results',
    sizeInBytes: 1024,
    url: 'https://api.github.com/repos/owner/repo/actions/artifacts/123',
    archiveDownloadUrl: 'https://api.github.com/download/123',
    expired: false,
    createdAt: '2024-01-01T10:00:00Z',
    expiresAt: '2024-03-01T10:00:00Z',
    updatedAt: '2024-01-01T10:05:00Z',
    testResults: [],
    ...overrides,
  };
}

export function createMockFlakeAnalysis(overrides: Partial<FlakeAnalysis> = {}): FlakeAnalysis {
  return {
    isFlaky: false,
    confidence: 0.2,
    failurePattern: null,
    historicalFailures: 1,
    totalRuns: 10,
    failureRate: 0.1,
    lastFailureAt: null,
    suggestedAction: null,
    ...overrides,
  };
}

export function createMockTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    name: 'test-result',
    status: 'passed',
    duration: 1000,
    errorMessage: undefined,
    stackTrace: undefined,
    flakeAnalysis: undefined,
    ...overrides,
  };
}

// =============================================================================
// OCTOKIT CLIENT MOCKS
// =============================================================================

export function createMockOctokitClient() {
  return {
    rest: {
      checks: {
        create: vi.fn(),
        update: vi.fn(),
        get: vi.fn(),
        listForRef: vi.fn(),
      },
      actions: {
        reRunWorkflow: vi.fn(),
        reRunWorkflowFailedJobs: vi.fn(),
        cancelWorkflowRun: vi.fn(),
        listJobsForWorkflowRun: vi.fn(),
        listWorkflowRunArtifacts: vi.fn(),
        getArtifact: vi.fn(),
        downloadArtifact: vi.fn(),
      },
      issues: {
        create: vi.fn(),
        update: vi.fn(),
        createComment: vi.fn(),
      },
      repos: {
        get: vi.fn(),
        listCollaborators: vi.fn(),
      },
      git: {
        getRef: vi.fn(),
        createRef: vi.fn(),
      },
    },
    graphql: vi.fn(),
    hook: {
      before: vi.fn(),
      after: vi.fn(),
      error: vi.fn(),
      wrap: vi.fn(),
    },
    auth: vi.fn(),
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    request: vi.fn(),
  } as unknown as Octokit;
}

// =============================================================================
// PRISMA CLIENT MOCKS
// =============================================================================

export function createMockPrismaClient(): PrismaClient {
  const mockPrisma = {
    // Repository operations
    repository: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    
    // Installation operations
    installation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    
    // Check run operations
    checkRun: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    
    // Workflow run operations
    workflowRun: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    
    // Test result operations
    testResult: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    
    // Flake detection operations
    flakeDetection: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    
    // Transaction support
    $transaction: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
    
  } as unknown as PrismaClient;

  // Configure default successful responses
  Object.values(mockPrisma as any).forEach((model: any) => {
    if (typeof model === 'object' && model !== null) {
      Object.keys(model).forEach(method => {
        if (typeof model[method] === 'function' && !model[method].mock) {
          // Skip already mocked functions
          return;
        }
        
        // Set up default responses for common operations
        switch (method) {
          case 'create':
          case 'update':
          case 'upsert':
            model[method] = model[method] || vi.fn().mockResolvedValue({
              id: 'mock-id',
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            break;
          case 'findFirst':
          case 'findUnique':
            model[method] = model[method] || vi.fn().mockResolvedValue(null);
            break;
          case 'findMany':
            model[method] = model[method] || vi.fn().mockResolvedValue([]);
            break;
          case 'count':
            model[method] = model[method] || vi.fn().mockResolvedValue(0);
            break;
          case 'delete':
            model[method] = model[method] || vi.fn().mockResolvedValue({
              id: 'mock-id',
            });
            break;
        }
      });
    }
  });

  return mockPrisma;
}

// =============================================================================
// SERVICE MOCKS
// =============================================================================

export function createMockAuthManager(): GitHubAuthManager {
  const mockAuthManager = {
    getInstallationClient: vi.fn(),
    getInstallationToken: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    refreshInstallationToken: vi.fn(),
  } as unknown as GitHubAuthManager;

  // Set up default successful responses
  (mockAuthManager.getInstallationClient as any).mockResolvedValue(createMockOctokitClient());
  (mockAuthManager.getInstallationToken as any).mockResolvedValue({
    token: '<REDACTED_TOKEN>',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    permissions: { checks: 'write', actions: 'read' },
    repositorySelection: 'all',
  });
  (mockAuthManager.verifyWebhookSignature as any).mockResolvedValue(true);

  return mockAuthManager;
}

export function createMockHelpers(): GitHubHelpers {
  const mockHelpers = {
    // Check run operations
    createCheckRun: vi.fn(),
    updateCheckRun: vi.fn(),
    updateCheckRunWithFlakeActions: vi.fn(),
    updateCheckRunWithFlakeDetection: vi.fn(),
    createFlakeGuardCheckRun: vi.fn(),
    createFlakeGuardSummaryCheckRun: vi.fn(),
    
    // Workflow operations
    rerunWorkflow: vi.fn(),
    rerunFailedJobs: vi.fn(),
    cancelWorkflow: vi.fn(),
    getWorkflowJobs: vi.fn(),
    
    // Artifact operations
    listArtifacts: vi.fn(),
    generateArtifactDownloadUrl: vi.fn(),
    
    // Issue operations
    createFlakeIssue: vi.fn(),
  } as unknown as GitHubHelpers;

  // Set up default successful responses
  const successfulApiResponse = <T>(data: T): ApiResponse<T> => ({
    success: true,
    data,
  });

  (mockHelpers.createCheckRun as any).mockResolvedValue(
    successfulApiResponse(createMockCheckRun())
  );
  (mockHelpers.updateCheckRun as any).mockResolvedValue(
    successfulApiResponse(createMockCheckRun())
  );
  (mockHelpers.updateCheckRunWithFlakeActions as any).mockResolvedValue(undefined);
  (mockHelpers.updateCheckRunWithFlakeDetection as any).mockResolvedValue(undefined);
  (mockHelpers.createFlakeGuardCheckRun as any).mockResolvedValue(undefined);
  (mockHelpers.createFlakeGuardSummaryCheckRun as any).mockResolvedValue(undefined);
  
  (mockHelpers.rerunWorkflow as any).mockResolvedValue({
    success: true,
    message: 'Workflow rerun initiated',
    runId: 123,
  });
  (mockHelpers.rerunFailedJobs as any).mockResolvedValue({
    success: true,
    message: 'Failed jobs rerun initiated',
    runId: 123,
  });
  (mockHelpers.cancelWorkflow as any).mockResolvedValue({
    success: true,
    message: 'Workflow cancelled',
  });
  (mockHelpers.getWorkflowJobs as any).mockResolvedValue([]);
  
  (mockHelpers.listArtifacts as any).mockResolvedValue([]);
  (mockHelpers.generateArtifactDownloadUrl as any).mockResolvedValue({
    downloadUrl: 'https://api.github.com/download/123',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    sizeInBytes: 1024,
  });
  
  (mockHelpers.createFlakeIssue as any).mockResolvedValue(undefined);

  return mockHelpers;
}

export function createMockFlakeDetector(): FlakeDetector {
  const mockFlakeDetector = {
    analyzeTestExecution: vi.fn(),
    batchAnalyzeTests: vi.fn(),
    getFlakeStatus: vi.fn(),
    updateFlakeStatus: vi.fn(),
    getRepositoryFlakeSummary: vi.fn(),
  } as unknown as FlakeDetector;

  // Set up default responses
  (mockFlakeDetector.analyzeTestExecution as any).mockResolvedValue({
    analysis: createMockFlakeAnalysis(),
    shouldUpdateCheckRun: false,
    suggestedActions: ['rerun_failed'] as CheckRunAction[],
    confidenceLevel: 'low' as const,
  });
  
  (mockFlakeDetector.batchAnalyzeTests as any).mockResolvedValue([]);
  (mockFlakeDetector.getFlakeStatus as any).mockResolvedValue(null);
  (mockFlakeDetector.updateFlakeStatus as any).mockResolvedValue(undefined);
  (mockFlakeDetector.getRepositoryFlakeSummary as any).mockResolvedValue({
    totalFlaky: 0,
    totalQuarantined: 0,
    recentlyDetected: 0,
    topFlaky: [],
  });

  return mockFlakeDetector;
}

// =============================================================================
// COMPREHENSIVE TEST MOCK FACTORY
// =============================================================================

export function createTestMocks(): {
  authManager: any;
  helpers: any;
  flakeDetector: any;
  prisma: any;
  octokit: any;
} {
  const authManager = createMockAuthManager();
  const helpers = createMockHelpers();
  const flakeDetector = createMockFlakeDetector();
  const prisma = createMockPrismaClient();
  const octokit = createMockOctokitClient();

  return {
    authManager,
    helpers,
    flakeDetector,
    prisma,
    octokit,
  };
}

// =============================================================================
// WEBHOOK SIGNATURE UTILITIES
// =============================================================================

export function signWebhookPayload(payload: string, secret: string): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
  return `sha256=${signature}`;
}

export function createInvalidWebhookSignature(): string {
  return 'sha256=invalid_signature_that_should_fail_validation';
}

// =============================================================================
// DATABASE TEST UTILITIES
// =============================================================================

export interface DatabaseTestFixture {
  repository: {
    id: string;
    githubId: number;
    name: string;
    fullName: string;
    owner: string;
    installationId: string;
  };
  installation: {
    id: string;
    githubInstallationId: number;
    accountLogin: string;
    accountId: number;
    accountType: string;
  };
  checkRun: {
    id: string;
    githubId: number;
    name: string;
    headSha: string;
    status: string;
    conclusion: string | null;
    repositoryId: string;
  };
  workflowRun: {
    id: string;
    githubId: number;
    name: string;
    headSha: string;
    workflowId: number;
    repositoryId: string;
  };
  testResult: {
    id: string;
    name: string;
    status: string;
    repositoryId: string;
    checkRunId?: string;
  };
  flakeDetection: {
    testName: string;
    repositoryId: string;
    isFlaky: boolean;
    confidence: number;
    failureRate: number;
  };
}

export function createDatabaseFixture(): DatabaseTestFixture {
  const repositoryId = 'repo-fixture-1';
  const installationId = 'install-fixture-1';
  
  return {
    repository: {
      id: repositoryId,
      githubId: 123456,
      name: 'test-repo',
      fullName: 'test-owner/test-repo',
      owner: 'test-owner',
      installationId,
    },
    installation: {
      id: installationId,
      githubInstallationId: 12345,
      accountLogin: 'test-owner',
      accountId: 67890,
      accountType: 'Organization',
    },
    checkRun: {
      id: 'checkrun-fixture-1',
      githubId: 789,
      name: 'test-check',
      headSha: 'abc123',
      status: 'completed',
      conclusion: 'failure',
      repositoryId,
    },
    workflowRun: {
      id: 'workflow-fixture-1',
      githubId: 456,
      name: 'CI',
      headSha: 'def456',
      workflowId: 999,
      repositoryId,
    },
    testResult: {
      id: 'testresult-fixture-1',
      name: 'integration-test',
      status: 'failed',
      repositoryId,
      checkRunId: 'checkrun-fixture-1',
    },
    flakeDetection: {
      testName: 'integration-test',
      repositoryId,
      isFlaky: true,
      confidence: 0.8,
      failureRate: 0.4,
    },
  };
}

export function setupDatabaseFixture(prisma: PrismaClient, fixture: DatabaseTestFixture) {
  // Configure Prisma mocks to return the fixture data
  (prisma.repository.findFirst as any).mockImplementation((args: any) => {
    if (args.where?.githubId === fixture.repository.githubId) {
      return Promise.resolve(fixture.repository);
    }
    return Promise.resolve(null);
  });

  (prisma.repository.findUnique as any).mockImplementation((args: any) => {
    if (args.where?.githubId === fixture.repository.githubId) {
      return Promise.resolve(fixture.repository);
    }
    return Promise.resolve(null);
  });

  (prisma.installation.findFirst as any).mockImplementation((args: any) => {
    if (args.where?.githubInstallationId === fixture.installation.githubInstallationId) {
      return Promise.resolve(fixture.installation);
    }
    return Promise.resolve(null);
  });

  (prisma.checkRun.findMany as any).mockImplementation((args: any) => {
    if (args.where?.repositoryId === fixture.repository.id) {
      return Promise.resolve([fixture.checkRun]);
    }
    return Promise.resolve([]);
  });

  (prisma.testResult.findMany as any).mockImplementation((args: any) => {
    if (args.where?.repositoryId === fixture.repository.id) {
      return Promise.resolve([fixture.testResult]);
    }
    return Promise.resolve([]);
  });

  (prisma.flakeDetection.findUnique as any).mockImplementation((args: any) => {
    const where = args.where?.testName_repositoryId;
    if (where?.testName === fixture.flakeDetection.testName && 
        where?.repositoryId === fixture.flakeDetection.repositoryId) {
      return Promise.resolve(fixture.flakeDetection);
    }
    return Promise.resolve(null);
  });
}

// =============================================================================
// TEST DATA GENERATORS
// =============================================================================

export function generateTestResults(count: number, options: {
  testName?: string;
  failureRate?: number;
  commonError?: string;
} = {}): TestResult[] {
  const {
    testName = 'generated-test',
    failureRate = 0.2,
    commonError = 'Test failure',
  } = options;

  return Array.from({ length: count }, (_, ) => {
    const shouldFail = Math.random() < failureRate;
    
    return createMockTestResult({
      name: testName,
      status: shouldFail ? 'failed' : 'passed',
      errorMessage: shouldFail ? commonError : undefined,
    });
  });
}

export function generateFlakeScenario(scenario: 'stable' | 'flaky' | 'always-failing') {
  switch (scenario) {
    case 'stable':
      return {
        testResults: generateTestResults(20, { failureRate: 0.05 }),
        expectedFlaky: false,
        expectedConfidence: 'low' as const,
      };
    
    case 'flaky':
      return {
        testResults: generateTestResults(20, { 
          failureRate: 0.3,
          commonError: 'Connection timeout',
        }),
        expectedFlaky: true,
        expectedConfidence: 'medium' as const,
      };
    
    case 'always-failing':
      return {
        testResults: generateTestResults(20, { failureRate: 1.0 }),
        expectedFlaky: false,
        expectedConfidence: 'low' as const,
      };
    
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}

// =============================================================================
// ASSERTION HELPERS
// =============================================================================

export function expectSuccessfulApiResponse<T>(
  response: ApiResponse<T>
): asserts response is ApiResponse<T> & { success: true; data: T } {
  expect(response.success).toBe(true);
  expect(response.data).toBeDefined();
  expect(response.error).toBeUndefined();
}

export function expectFailedApiResponse<T>(
  response: ApiResponse<T>,
  expectedErrorCode?: string
): asserts response is ApiResponse<T> & { success: false; error: NonNullable<ApiResponse<T>['error']> } {
  expect(response.success).toBe(false);
  expect(response.error).toBeDefined();
  expect(response.data).toBeUndefined();
  
  if (expectedErrorCode) {
    expect(response.error!.code).toBe(expectedErrorCode);
  }
}

export function expectFlakeAnalysis(
  analysis: FlakeAnalysis,
  expected: {
    isFlaky?: boolean;
    confidenceRange?: [number, number];
    hasPattern?: boolean;
    minTotalRuns?: number;
  }
) {
  if (expected.isFlaky !== undefined) {
    expect(analysis.isFlaky).toBe(expected.isFlaky);
  }
  
  if (expected.confidenceRange) {
    expect(analysis.confidence).toBeGreaterThanOrEqual(expected.confidenceRange[0]);
    expect(analysis.confidence).toBeLessThanOrEqual(expected.confidenceRange[1]);
  }
  
  if (expected.hasPattern !== undefined) {
    if (expected.hasPattern) {
      expect(analysis.failurePattern).not.toBeNull();
    } else {
      expect(analysis.failurePattern).toBeNull();
    }
  }
  
  if (expected.minTotalRuns !== undefined) {
    expect(analysis.totalRuns).toBeGreaterThanOrEqual(expected.minTotalRuns);
  }
}

// =============================================================================
// PERFORMANCE TEST UTILITIES
// =============================================================================

export async function measureExecutionTime<T>(
  operation: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const startTime = Date.now();
  const result = await operation();
  const duration = Date.now() - startTime;
  
  return { result, duration };
}

export function createLargeDataset(size: number) {
  return {
    testResults: Array.from({ length: size }, (_, i) => ({
      id: `result-${i}`,
      name: `test-${i % 100}`, // 100 different test names
      status: i % 3 === 0 ? 'failed' : 'passed', // ~33% failure rate
      duration: Math.floor(Math.random() * 10000),
      errorMessage: i % 3 === 0 ? `Error ${i % 10}` : undefined,
      repositoryId: 'large-repo',
      createdAt: new Date(Date.now() - i * 60000), // 1 minute apart
      updatedAt: new Date(),
    })),
  };
}

// =============================================================================
// ENVIRONMENT SETUP UTILITIES
// =============================================================================

export function setupTestEnvironment() {
  // Mock console methods to reduce test noise
  const originalConsole = { ...console };
  
  beforeEach(() => {
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    console.info = vi.fn();
  });
  
  afterEach(() => {
    Object.assign(console, originalConsole);
    vi.clearAllMocks();
  });
  
  return {
    restoreConsole: () => Object.assign(console, originalConsole),
  };
}

export function mockEnvironmentVariables(vars: Record<string, string>) {
  const originalEnv = { ...process.env };
  
  beforeEach(() => {
    Object.assign(process.env, vars);
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  return {
    restoreEnv: () => {
      process.env = originalEnv;
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  type CheckRunWebhookPayload,
  type WorkflowRunWebhookPayload,
  type InstallationWebhookPayload,
  type FlakeAnalysis,
  type TestResult,
  type FlakeGuardCheckRun,
  type TestArtifact,
  type ApiResponse,
  type CheckRunAction,
};