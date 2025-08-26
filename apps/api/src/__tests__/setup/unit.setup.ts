/**
 * Unit Test Setup for FlakeGuard API
 * 
 * Configures the test environment for isolated unit tests
 */

import { beforeEach, afterEach, beforeAll, vi } from 'vitest';
// import type { MockedFunction } from 'vitest'; // unused for now

// Set up environment variables BEFORE any imports that use config
beforeAll(() => {
  // Set environment variables for test
  (process.env as any).NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/flakeguard_test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum-length';
  process.env.API_KEY = 'FAKE_API_KEY_FOR_TESTS_ONLY_123';
  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_PRIVATE_KEY = '-----BEGIN FAKE PRIVATE KEY FOR TESTS ONLY-----\nTHIS_IS_A_FAKE_KEY_FOR_TESTING_PURPOSES_ONLY\nDO_NOT_USE_IN_PRODUCTION_ENVIRONMENTS\n-----END FAKE PRIVATE KEY FOR TESTS ONLY-----';
  process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
  process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret';
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
  process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
  
  // Optional environment variables
  process.env.ENABLE_SLACK_APP = 'false';
  process.env.LOG_LEVEL = 'error';
});

// Mock external dependencies at module level
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      actions: {
        listWorkflowRuns: vi.fn(),
        downloadArtifact: vi.fn(),
        listArtifactsForRepo: vi.fn(),
      },
      checks: {
        create: vi.fn(),
        update: vi.fn(),
        listForRef: vi.fn(),
      },
      repos: {
        get: vi.fn(),
      },
    },
  })),
}));

vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(() => ({
    client: {
      chat: {
        postMessage: vi.fn(),
      },
    },
    start: vi.fn(),
  })),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $transaction: vi.fn(),
    repository: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    testRun: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    testCase: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  })),
}));

vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

// Mock BullMQ
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    close: vi.fn(),
  })),
  Worker: vi.fn().mockImplementation(() => ({
    run: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock IORedis
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

// Mock the config module to use test configuration
vi.mock('../config/index.js', async () => {
  const { testConfig } = await import('../../config/test-config.js');
  return {
    config: testConfig,
  };
});

// Mock filesystem operations for tests that don't need actual files
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue('test-file-content'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock node-stream-zip for artifact processing
vi.mock('node-stream-zip', () => ({
  default: vi.fn().mockImplementation(() => ({
    entries: {},
    entryDataSync: vi.fn().mockReturnValue(Buffer.from('test content')),
    close: vi.fn(),
  })),
}));

// Global test setup
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
  
  // Reset modules to ensure clean state
  vi.resetModules();
  
  // Mock console methods to avoid noise in test output
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Restore all mocks after each test
  vi.restoreAllMocks();
});

// Global test utilities
declare global {
  var testUtils: {
    createMockRepository: () => any;
    createMockTestRun: () => any;
    createMockTestCase: () => any;
    createMockGitHubEvent: (type: string) => any;
    createMockJUnitXML: () => string;
  };
}

global.testUtils = {
  createMockRepository: () => ({
    id: '1',
    name: 'test-repo',
    fullName: 'test-org/test-repo',
    owner: 'test-org',
    installationId: 12345,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),

  createMockTestRun: () => ({
    id: '1',
    repositoryId: '1',
    workflowRunId: 12345,
    runAttempt: 1,
    status: 'completed',
    conclusion: 'success',
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }),

  createMockTestCase: () => ({
    id: '1',
    testRunId: '1',
    name: 'should pass',
    className: 'TestClass',
    fileName: 'test.spec.ts',
    status: 'passed',
    duration: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),

  createMockGitHubEvent: (type: string) => ({
    id: '12345',
    type,
    created_at: new Date().toISOString(),
    payload: {
      action: 'completed',
      workflow_run: {
        id: 12345,
        name: 'CI',
        head_branch: 'main',
        head_sha: 'abc123',
        status: 'completed',
        conclusion: 'success',
        repository: {
          id: 123,
          name: 'test-repo',
          full_name: 'test-org/test-repo',
        },
      },
    },
  }),

  createMockJUnitXML: () => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Jest Tests" tests="2" failures="0" errors="0" time="1.234">
  <testsuite name="test.spec.ts" tests="2" failures="0" errors="0" time="1.234">
    <testcase classname="TestClass" name="should pass" time="0.123"/>
    <testcase classname="TestClass" name="should also pass" time="0.111"/>
  </testsuite>
</testsuites>`,
};