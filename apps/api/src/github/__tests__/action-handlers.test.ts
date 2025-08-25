/**
 * Integration tests for GitHub Action Handlers
 * 
 * Tests the quarantine, rerun, and issue creation handlers with mocked Octokit responses
 * Covers idempotency, partial failures, and proper error handling
 */

import type { Octokit } from '@octokit/rest';
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';

import {
  handleQuarantineAction,
  handleRerunFailedAction,
  handleOpenIssueAction,
  type TestInfo,
  type RepositoryContext,
} from '../action-handlers.js';
import { ErrorCode } from '../api-spec.js';

// Mock the logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Octokit instance
const createMockOctokit = () => ({
  rest: {
    issues: {
      createComment: vi.fn(),
      create: vi.fn(),
    },
    actions: {
      reRunWorkflowFailedJobs: vi.fn(),
      reRunWorkflow: vi.fn(),
    },
    search: {
      issuesAndPullRequests: vi.fn(),
    },
  },
} as unknown as Octokit);

describe('GitHub Action Handlers', () => {
  let mockOctokit: Octokit;
  const mockTest: TestInfo = {
    name: 'com.example.FlakyTest',
    confidence: 0.85,
    failureRate: 0.25,
    failurePattern: 'Timeout waiting for element',
    lastFailureAt: '2024-01-01T00:00:00Z',
    totalRuns: 100,
    historicalFailures: 25,
  };
  const mockRepository: RepositoryContext = {
    owner: 'test-owner',
    repo: 'test-repo',
    fullName: 'test-owner/test-repo',
    installationId: 12345,
    defaultBranch: 'main',
  };

  beforeEach(() => {
    mockOctokit = createMockOctokit();
    vi.clearAllMocks();
  });

  describe('handleQuarantineAction', () => {
    it('should successfully quarantine a test with PR comment', async () => {
      const mockIssueResponse = {
        data: {
          id: 1001,
          number: 42,
          title: '[FlakeGuard] Quarantined flaky test: com.example.FlakyTest',
          html_url: 'https://github.com/test-owner/test-repo/issues/42',
        },
      };

      (mockOctokit.rest.issues.createComment as MockedFunction<any>).mockResolvedValue({ data: {} });
      (mockOctokit.rest.issues.create as MockedFunction<any>).mockResolvedValue(mockIssueResponse);

      const result = await handleQuarantineAction(
        mockOctokit,
        mockTest,
        mockRepository,
        {
          pullRequestNumber: 123,
          checkRunId: 456,
        }
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully quarantined');
      expect(result.details).toBeDefined();
      expect(result.details!.commentCreated).toBe(true);
      expect(result.details!.issueCreated).toBe(true);
      expect(result.details!.testQuarantined).toBe(true);
      expect(result.details!.issueNumber).toBe(42);

      // Verify PR comment was created with correct content
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 123,
        body: expect.stringContaining('Test Quarantined by FlakeGuard'),
      });

      // Verify issue was created with correct content
      expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: '[FlakeGuard] Quarantined flaky test: com.example.FlakyTest',
        body: expect.stringContaining('Quarantined Flaky Test Report'),
        labels: ['flaky-test', 'quarantine', 'bug', 'testing'],
      });
    });

    it('should handle partial failures gracefully', async () => {
      const commentError = new Error('Failed to create comment');
      const mockIssueResponse = {
        data: {
          id: 1001,
          number: 42,
          title: '[FlakeGuard] Quarantined flaky test: com.example.FlakyTest',
          html_url: 'https://github.com/test-owner/test-repo/issues/42',
        },
      };

      (mockOctokit.rest.issues.createComment as MockedFunction<any>).mockRejectedValue(commentError);
      (mockOctokit.rest.issues.create as MockedFunction<any>).mockResolvedValue(mockIssueResponse);

      const result = await handleQuarantineAction(
        mockOctokit,
        mockTest,
        mockRepository,
        {
          pullRequestNumber: 123,
          checkRunId: 456,
        }
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('2/3 actions completed');
      expect(result.details!.commentCreated).toBe(false);
      expect(result.details!.issueCreated).toBe(true);
      expect(result.details!.testQuarantined).toBe(true);
    });

    it('should handle complete failure', async () => {
      const apiError = new Error('API Error');
      (apiError as any).status = 403;

      (mockOctokit.rest.issues.create as MockedFunction<any>).mockRejectedValue(apiError);

      const result = await handleQuarantineAction(
        mockOctokit,
        mockTest,
        mockRepository,
        { pullRequestNumber: 123 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(ErrorCode.FORBIDDEN);
      expect(result.error!.recoverable).toBe(false);
    });
  });

  describe('handleRerunFailedAction', () => {
    it('should rerun all failed jobs when no specific jobs specified', async () => {
      (mockOctokit.rest.actions.reRunWorkflowFailedJobs as MockedFunction<any>).mockResolvedValue({ data: {} });
      (mockOctokit.rest.issues.createComment as MockedFunction<any>).mockResolvedValue({ data: {} });

      const result = await handleRerunFailedAction(
        mockOctokit,
        123456,
        [],
        mockRepository,
        {
          pullRequestNumber: 789,
          enableDebugLogging: true,
        }
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('all failed jobs in workflow run 123456');
      expect(result.details!.workflowRerun).toBe(true);

      expect(mockOctokit.rest.actions.reRunWorkflowFailedJobs).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        run_id: 123456,
        enable_debug_logging: true,
      });

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 789,
        body: expect.stringContaining('Workflow Rerun Initiated by FlakeGuard'),
      });
    });

    it('should rerun entire workflow when specific jobs requested', async () => {
      (mockOctokit.rest.actions.reRunWorkflow as MockedFunction<any>).mockResolvedValue({ data: {} });

      const result = await handleRerunFailedAction(
        mockOctokit,
        123456,
        [1001, 1002],
        mockRepository
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('requested 2 specific jobs');
      expect(result.details!.workflowRerun).toBe(true);

      expect(mockOctokit.rest.actions.reRunWorkflow).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        run_id: 123456,
        enable_debug_logging: false,
      });
    });

    it('should handle rerun failures', async () => {
      const apiError = new Error('Workflow not found');
      (apiError as any).status = 404;

      (mockOctokit.rest.actions.reRunWorkflowFailedJobs as MockedFunction<any>).mockRejectedValue(apiError);

      const result = await handleRerunFailedAction(
        mockOctokit,
        123456,
        [],
        mockRepository
      );

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    });
  });

  describe('handleOpenIssueAction', () => {
    it('should create single issue for one flaky test', async () => {
      const mockSearchResponse = {
        data: {
          items: [],
        },
      };

      const mockIssueResponse = {
        data: {
          id: 1001,
          number: 42,
          title: '[FlakeGuard] Flaky test detected: com.example.FlakyTest',
          html_url: 'https://github.com/test-owner/test-repo/issues/42',
        },
      };

      (mockOctokit.rest.search.issuesAndPullRequests as MockedFunction<any>).mockResolvedValue(mockSearchResponse);
      (mockOctokit.rest.issues.create as MockedFunction<any>).mockResolvedValue(mockIssueResponse);

      const result = await handleOpenIssueAction(
        mockOctokit,
        [mockTest],
        mockRepository,
        {
          checkRunId: 456,
          workflowRunId: 789,
        }
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('Created 1 issue(s) for 1 flaky test(s)');
      expect(result.details!.createdIssues).toHaveLength(1);
      expect(result.details!.createdIssues[0].number).toBe(42);

      expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: '[FlakeGuard] Flaky test detected: com.example.FlakyTest',
        body: expect.stringContaining('Flaky Test Report'),
        labels: ['flaky-test', 'bug', 'testing'],
      });
    });

    it('should create summary issue for multiple flaky tests', async () => {
      const multipleTests: TestInfo[] = [
        mockTest,
        {
          name: 'com.example.AnotherFlakyTest',
          confidence: 0.72,
          failureRate: 0.15,
          failurePattern: null,
          lastFailureAt: '2024-01-01T01:00:00Z',
          totalRuns: 80,
          historicalFailures: 12,
        },
      ];

      const mockSearchResponse = {
        data: {
          items: [],
        },
      };

      const mockIssueResponse = {
        data: {
          id: 1001,
          number: 42,
          title: '[FlakeGuard] Multiple flaky tests detected (2 tests)',
          html_url: 'https://github.com/test-owner/test-repo/issues/42',
        },
      };

      (mockOctokit.rest.search.issuesAndPullRequests as MockedFunction<any>).mockResolvedValue(mockSearchResponse);
      (mockOctokit.rest.issues.create as MockedFunction<any>).mockResolvedValue(mockIssueResponse);

      const result = await handleOpenIssueAction(
        mockOctokit,
        multipleTests,
        mockRepository
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('Created 1 issue(s) for 2 flaky test(s)');

      expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: '[FlakeGuard] Multiple flaky tests detected (2 tests)',
        body: expect.stringContaining('Multiple Flaky Tests Report'),
        labels: ['flaky-test', 'multiple-tests', 'bug', 'testing'],
      });
    });

    it('should skip tests that already have existing issues', async () => {
      const mockSearchResponse = {
        data: {
          items: [
            {
              number: 35,
              title: '[FlakeGuard] Flaky test detected: com.example.FlakyTest',
              body: 'Test Name: com.example.FlakyTest',
              html_url: 'https://github.com/test-owner/test-repo/issues/35',
            },
          ],
        },
      };

      (mockOctokit.rest.search.issuesAndPullRequests as MockedFunction<any>).mockResolvedValue(mockSearchResponse);

      const result = await handleOpenIssueAction(
        mockOctokit,
        [mockTest],
        mockRepository
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('already have existing tracking issues');
      expect(result.details!.existingIssues).toHaveLength(1);
      expect(result.details!.existingIssues[0].number).toBe(35);

      expect(mockOctokit.rest.issues.create).not.toHaveBeenCalled();
    });

    it('should handle issue creation failures', async () => {
      const mockSearchResponse = {
        data: {
          items: [],
        },
      };

      const apiError = new Error('Repository access denied');
      (apiError as any).status = 403;

      (mockOctokit.rest.search.issuesAndPullRequests as MockedFunction<any>).mockResolvedValue(mockSearchResponse);
      (mockOctokit.rest.issues.create as MockedFunction<any>).mockRejectedValue(apiError);

      const result = await handleOpenIssueAction(
        mockOctokit,
        [mockTest],
        mockRepository
      );

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe(ErrorCode.FORBIDDEN);
    });
  });

  describe('error recovery', () => {
    it('should identify recoverable errors correctly', async () => {
      const recoverableErrors = [
        { status: 429, code: ErrorCode.GITHUB_RATE_LIMITED, recoverable: true },
        { status: 500, code: ErrorCode.GITHUB_SERVICE_UNAVAILABLE, recoverable: true },
        { status: 502, code: ErrorCode.GITHUB_SERVICE_UNAVAILABLE, recoverable: true },
      ];

      const nonRecoverableErrors = [
        { status: 401, code: ErrorCode.UNAUTHORIZED, recoverable: false },
        { status: 403, code: ErrorCode.FORBIDDEN, recoverable: false },
        { status: 404, code: ErrorCode.RESOURCE_NOT_FOUND, recoverable: false },
      ];

      // Test recoverable errors
      for (const errorCase of recoverableErrors) {
        const apiError = new Error('API Error');
        (apiError as any).status = errorCase.status;

        (mockOctokit.rest.actions.reRunWorkflowFailedJobs as MockedFunction<any>).mockRejectedValue(apiError);

        const result = await handleRerunFailedAction(
          mockOctokit,
          123456,
          [],
          mockRepository
        );

        expect(result.success).toBe(false);
        expect(result.error!.recoverable).toBe(errorCase.recoverable);
      }

      // Test non-recoverable errors
      for (const errorCase of nonRecoverableErrors) {
        const apiError = new Error('API Error');
        (apiError as any).status = errorCase.status;

        (mockOctokit.rest.actions.reRunWorkflowFailedJobs as MockedFunction<any>).mockRejectedValue(apiError);

        const result = await handleRerunFailedAction(
          mockOctokit,
          123456,
          [],
          mockRepository
        );

        expect(result.success).toBe(false);
        expect(result.error!.recoverable).toBe(errorCase.recoverable);
      }
    });
  });
});
