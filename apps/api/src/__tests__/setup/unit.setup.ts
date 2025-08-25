/**
 * Unit Test Setup for FlakeGuard API
 * 
 * Configures the test environment for isolated unit tests
 */

import { beforeEach, afterEach, vi } from 'vitest';
import type { MockedFunction } from 'vitest';

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

// Mock environment variables
vi.mock('process', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/flakeguard_test',
    REDIS_URL: 'redis://localhost:6379',
    GITHUB_APP_ID: 'test-app-id',
    GITHUB_PRIVATE_KEY: 'test-private-key',
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
    SLACK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_SIGNING_SECRET: 'test-signing-secret',
  },
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