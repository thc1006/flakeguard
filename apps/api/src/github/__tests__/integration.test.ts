/**
 * Integration tests for GitHub Checks API integration
 * 
 * Tests the complete workflow from check run creation to action handling
 * Includes end-to-end scenarios with mocked GitHub API responses
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import type { Octokit } from '@octokit/rest';
import {
  createCheckRun,
  updateCheckRun,
  type CheckRunOutput,
  type CheckRunActionDef,
} from '../check-api.js';
import {
  handleQuarantineAction,
  handleRerunFailedAction,
  handleOpenIssueAction,
  type TestInfo,
  type RepositoryContext,
} from '../action-handlers.js';

// Mock the logger
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Octokit instance with comprehensive API surface
const createMockOctokit = () => ({
  rest: {
    checks: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
    },
    issues: {
      createComment: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    actions: {
      reRunWorkflowFailedJobs: vi.fn(),
      reRunWorkflow: vi.fn(),
      listWorkflowRuns: vi.fn(),
      listJobsForWorkflowRun: vi.fn(),
    },
    search: {
      issuesAndPullRequests: vi.fn(),
    },
  },
} as unknown as Octokit);

describe('GitHub Checks API Integration', () => {
  let mockOctokit: Octokit;
  const mockRepository: RepositoryContext = {
    owner: 'flakeguard-org',
    repo: 'example-project',
    fullName: 'flakeguard-org/example-project',
    installationId: 12345,
    defaultBranch: 'main',
  };

  const mockFlakyTest: TestInfo = {
    name: 'com.example.integration.DatabaseTest#testTransactionRollback',
    confidence: 0.87,
    failureRate: 0.23,
    failurePattern: 'Connection timeout after 5000ms',
    lastFailureAt: '2024-01-15T14:30:00Z',
    totalRuns: 150,
    historicalFailures: 35,
  };

  beforeEach(() => {
    mockOctokit = createMockOctokit();
    vi.clearAllMocks();
  });

  describe('Complete Flake Detection Workflow', () => {
    it('should handle complete flake detection and quarantine workflow', async () => {
      // Step 1: Create initial check run
      const initialOutput: CheckRunOutput = {
        title: '🔍 FlakeGuard Analysis Complete',
        summary: '1 flaky test candidate detected requiring attention.',
        text: `## Detected Flaky Test\n\n- **${mockFlakyTest.name}** - ${(mockFlakyTest.confidence * 100).toFixed(1)}% confidence`,
      };

      const initialActions: CheckRunActionDef[] = [
        {
          label: 'Quarantine Test',
          description: 'Quarantine this flaky test to prevent CI instability',
          identifier: 'quarantine',
        },
        {
          label: 'Rerun Failed Jobs',
          description: 'Rerun failed jobs to confirm flaky behavior',
          identifier: 'rerun_failed',
        },
        {
          label: 'Open Issue',
          description: 'Create tracking issue for this flaky test',
          identifier: 'open_issue',
        },
      ];

      const mockCheckRunResponse = {
        data: {
          id: 987654,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123def456',
          status: 'completed',
          conclusion: 'neutral',
          started_at: '2024-01-15T14:25:00Z',
          completed_at: '2024-01-15T14:30:00Z',
          output: {
            title: initialOutput.title,
            summary: initialOutput.summary,
            text: initialOutput.text,
          },
          actions: initialActions.map(action => ({
            label: action.label,
            description: action.description,
            identifier: action.identifier,
          })),
          url: 'https://api.github.com/repos/flakeguard-org/example-project/check-runs/987654',
          html_url: 'https://github.com/flakeguard-org/example-project/runs/987654',
        },
      };

      (mockOctokit.rest.checks.create as MockedFunction<any>).mockResolvedValue(mockCheckRunResponse);

      const checkRunResult = await createCheckRun(
        mockOctokit,
        mockRepository.owner,
        mockRepository.repo,
        'abc123def456',
        initialOutput,
        {
          name: 'FlakeGuard Analysis',
          conclusion: 'neutral',
          actions: initialActions,
        }
      );

      expect(checkRunResult.success).toBe(true);
      expect(checkRunResult.data!.actions).toHaveLength(3);
      expect(checkRunResult.data!.conclusion).toBe('neutral');

      // Step 2: User clicks "Quarantine Test" action
      const mockQuarantineIssueResponse = {
        data: {
          id: 2001,
          number: 156,
          title: '[FlakeGuard] Quarantined flaky test: com.example.integration.DatabaseTest#testTransactionRollback',
          html_url: 'https://github.com/flakeguard-org/example-project/issues/156',
        },
      };

      (mockOctokit.rest.issues.createComment as MockedFunction<any>).mockResolvedValue({ data: {} });
      (mockOctokit.rest.issues.create as MockedFunction<any>).mockResolvedValue(mockQuarantineIssueResponse);

      const quarantineResult = await handleQuarantineAction(
        mockOctokit,
        mockFlakyTest,
        mockRepository,
        {
          pullRequestNumber: 42,
          checkRunId: 987654,
        }
      );

      expect(quarantineResult.success).toBe(true);
      expect(quarantineResult.details!.issueNumber).toBe(156);

      // Verify PR comment includes test details
      const commentCall = (mockOctokit.rest.issues.createComment as MockedFunction<any>).mock.calls[0][0];
      expect(commentCall.body).toContain('Test Quarantined by FlakeGuard');
      expect(commentCall.body).toContain(mockFlakyTest.name);
      expect(commentCall.body).toContain('87.0%'); // Confidence percentage
      expect(commentCall.body).toContain('23.0%'); // Failure rate percentage

      // Verify issue creation with comprehensive details
      const issueCall = (mockOctokit.rest.issues.create as MockedFunction<any>).mock.calls[0][0];
      expect(issueCall.title).toBe('[FlakeGuard] Quarantined flaky test: com.example.integration.DatabaseTest#testTransactionRollback');
      expect(issueCall.body).toContain('Quarantined Flaky Test Report');
      expect(issueCall.body).toContain('Connection timeout after 5000ms');
      expect(issueCall.labels).toEqual(['flaky-test', 'quarantine', 'bug', 'testing']);

      // Step 3: Update check run to reflect quarantine action completion
      const updatedOutput: CheckRunOutput = {
        title: '✅ Quarantine Action Completed',
        summary: 'Test has been successfully quarantined and tracking issue #156 created.',
        text: `The flaky test **${mockFlakyTest.name}** has been quarantined to prevent further CI instability.\n\n**Actions Taken:**\n- Created tracking issue #156\n- Added PR comment with analysis results\n- Test marked as quarantined in FlakeGuard database`,
      };

      const mockUpdateResponse = {
        data: {
          ...mockCheckRunResponse.data,
          output: {
            title: updatedOutput.title,
            summary: updatedOutput.summary,
            text: updatedOutput.text,
          },
          conclusion: 'success',
          actions: [], // Remove actions after completion
        },
      };

      (mockOctokit.rest.checks.update as MockedFunction<any>).mockResolvedValue(mockUpdateResponse);

      const updateResult = await updateCheckRun(
        mockOctokit,
        mockRepository.owner,
        mockRepository.repo,
        987654,
        updatedOutput,
        {
          conclusion: 'success',
          actions: [],
        }
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data!.conclusion).toBe('success');
      expect(updateResult.data!.actions).toHaveLength(0);
    });

    it('should handle multiple flaky tests with batch issue creation', async () => {
      const multipleTests: TestInfo[] = [
        mockFlakyTest,
        {
          name: 'com.example.ui.LoginTest#testPasswordValidation',
          confidence: 0.92,
          failureRate: 0.18,
          failurePattern: 'Element not found: #password-field',
          lastFailureAt: '2024-01-15T13:45:00Z',
          totalRuns: 200,
          historicalFailures: 36,
        },
        {
          name: 'com.example.api.RateLimitTest#testConcurrentRequests',
          confidence: 0.76,
          failureRate: 0.31,
          failurePattern: null,
          lastFailureAt: '2024-01-15T12:15:00Z',
          totalRuns: 95,
          historicalFailures: 29,
        },
      ];

      // Mock no existing issues
      (mockOctokit.rest.search.issuesAndPullRequests as MockedFunction<any>).mockResolvedValue({
        data: { items: [] },
      });

      // Mock summary issue creation for multiple tests
      const mockSummaryIssueResponse = {
        data: {
          id: 3001,
          number: 157,
          title: '[FlakeGuard] Multiple flaky tests detected (3 tests)',
          html_url: 'https://github.com/flakeguard-org/example-project/issues/157',
        },
      };

      (mockOctokit.rest.issues.create as MockedFunction<any>).mockResolvedValue(mockSummaryIssueResponse);

      const result = await handleOpenIssueAction(
        mockOctokit,
        multipleTests,
        mockRepository,
        {
          checkRunId: 987654,
          workflowRunId: 456789,
        }
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('Created 1 issue(s) for 3 flaky test(s)');
      expect(result.details!.createdIssues).toHaveLength(1);
      expect(result.details!.createdIssues[0].number).toBe(157);

      // Verify summary issue contains all test details
      const issueCall = (mockOctokit.rest.issues.create as MockedFunction<any>).mock.calls[0][0];
      expect(issueCall.body).toContain('Multiple Flaky Tests Report');
      expect(issueCall.body).toContain('com.example.integration.DatabaseTest#testTransactionRollback');
      expect(issueCall.body).toContain('com.example.ui.LoginTest#testPasswordValidation');
      expect(issueCall.body).toContain('com.example.api.RateLimitTest#testConcurrentRequests');
      expect(issueCall.labels).toEqual(['flaky-test', 'multiple-tests', 'bug', 'testing']);
    });

    it('should handle rerun workflow with proper error handling', async () => {
      // Mock successful workflow rerun
      (mockOctokit.rest.actions.reRunWorkflowFailedJobs as MockedFunction<any>).mockResolvedValue({ data: {} });
      (mockOctokit.rest.issues.createComment as MockedFunction<any>).mockResolvedValue({ data: {} });

      const result = await handleRerunFailedAction(
        mockOctokit,
        456789,
        [],
        mockRepository,
        {
          pullRequestNumber: 42,
          enableDebugLogging: true,
        }
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('all failed jobs in workflow run 456789');

      // Verify workflow rerun API call
      expect(mockOctokit.rest.actions.reRunWorkflowFailedJobs).toHaveBeenCalledWith({
        owner: 'flakeguard-org',
        repo: 'example-project',
        run_id: 456789,
        enable_debug_logging: true,
      });

      // Verify PR comment creation
      const commentCall = (mockOctokit.rest.issues.createComment as MockedFunction<any>).mock.calls[0][0];
      expect(commentCall.body).toContain('Workflow Rerun Initiated by FlakeGuard');
      expect(commentCall.body).toContain('456789');
    });
  });

  describe('Error Scenarios and Recovery', () => {
    it('should handle rate limiting gracefully across multiple operations', async () => {
      const rateLimitError = new Error('API rate limit exceeded');
      (rateLimitError as any).status = 429;
      (rateLimitError as any).response = {
        headers: {
          'x-ratelimit-reset': Math.floor(Date.now() / 1000 + 2).toString(),
        },
      };

      const mockSuccessResponse = {
        data: {
          id: 987654,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123def456',
          status: 'completed',
          conclusion: 'neutral',
          started_at: '2024-01-15T14:25:00Z',
          completed_at: '2024-01-15T14:30:00Z',
          output: {
            title: 'Analysis Complete',
            summary: 'Rate limit recovered',
          },
          actions: [],
        },
      };

      // First call fails with rate limit, second succeeds
      (mockOctokit.rest.checks.create as MockedFunction<any>)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(mockSuccessResponse);

      const result = await createCheckRun(
        mockOctokit,
        mockRepository.owner,
        mockRepository.repo,
        'abc123def456',
        {
          title: 'Analysis Complete',
          summary: 'Rate limit test',
        }
      );

      expect(result.success).toBe(true);
      expect(mockOctokit.rest.checks.create).toHaveBeenCalledTimes(2);
    }, 10000); // Extended timeout for retry logic

    it('should handle partial action failures with proper reporting', async () => {
      // Issue creation succeeds, but comment fails
      const commentError = new Error('PR not found');
      (commentError as any).status = 404;

      const mockIssueResponse = {
        data: {
          id: 2001,
          number: 158,
          title: '[FlakeGuard] Quarantined flaky test: com.example.integration.DatabaseTest#testTransactionRollback',
          html_url: 'https://github.com/flakeguard-org/example-project/issues/158',
        },
      };

      (mockOctokit.rest.issues.createComment as MockedFunction<any>).mockRejectedValue(commentError);
      (mockOctokit.rest.issues.create as MockedFunction<any>).mockResolvedValue(mockIssueResponse);

      const result = await handleQuarantineAction(
        mockOctokit,
        mockFlakyTest,
        mockRepository,
        {
          pullRequestNumber: 999, // Non-existent PR
          checkRunId: 987654,
        }
      );

      expect(result.success).toBe(true); // Still successful overall
      expect(result.message).toContain('2/3 actions completed');
      expect(result.details!.commentCreated).toBe(false);
      expect(result.details!.issueCreated).toBe(true);
      expect(result.details!.testQuarantined).toBe(true);
      expect(result.details!.issueNumber).toBe(158);
    });
  });

  describe('GitHub API Best Practices', () => {
    it('should respect action limits and prioritize important actions', async () => {
      const manyActions: CheckRunActionDef[] = [
        { label: 'Quarantine', description: 'Quarantine test', identifier: 'quarantine' },
        { label: 'Rerun', description: 'Rerun failed', identifier: 'rerun_failed' },
        { label: 'Open Issue', description: 'Create issue', identifier: 'open_issue' },
        { label: 'Dismiss', description: 'Dismiss flake', identifier: 'dismiss_flake' },
        { label: 'Mark Stable', description: 'Mark as stable', identifier: 'mark_stable' },
      ];

      const mockResponse = {
        data: {
          id: 987654,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123def456',
          status: 'completed',
          conclusion: 'neutral',
          started_at: '2024-01-15T14:25:00Z',
          completed_at: '2024-01-15T14:30:00Z',
          output: {
            title: 'Analysis Complete',
            summary: 'Multiple actions available',
          },
          actions: manyActions.slice(0, 3).map(action => ({
            label: action.label,
            description: action.description,
            identifier: action.identifier,
          })),
        },
      };

      (mockOctokit.rest.checks.create as MockedFunction<any>).mockResolvedValue(mockResponse);

      const result = await createCheckRun(
        mockOctokit,
        mockRepository.owner,
        mockRepository.repo,
        'abc123def456',
        {
          title: 'Analysis Complete',
          summary: 'Multiple actions test',
        },
        {
          actions: manyActions,
        }
      );

      expect(result.success).toBe(true);
      expect(result.data!.actions).toHaveLength(3); // Limited to 3

      // Verify the API call was made with exactly 3 actions
      const createCall = (mockOctokit.rest.checks.create as MockedFunction<any>).mock.calls[0][0];
      expect(createCall.actions).toHaveLength(3);
      expect(createCall.actions[0].identifier).toBe('quarantine');
      expect(createCall.actions[1].identifier).toBe('rerun_failed');
      expect(createCall.actions[2].identifier).toBe('open_issue');
    });

    it('should include proper context in all API calls', async () => {
      const contextualOutput: CheckRunOutput = {
        title: 'FlakeGuard Analysis - High Priority',
        summary: 'Critical flaky test detected in production code path',
        text: '## Detailed Analysis\n\nThis test affects core functionality and should be addressed immediately.',
      };

      const mockResponse = {
        data: {
          id: 987654,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123def456',
          status: 'completed',
          conclusion: 'action_required',
          started_at: '2024-01-15T14:25:00Z',
          completed_at: '2024-01-15T14:30:00Z',
          output: {
            title: contextualOutput.title,
            summary: contextualOutput.summary,
            text: contextualOutput.text,
          },
          actions: [],
          details_url: 'https://flakeguard.com/analysis/987654',
          external_id: 'flakeguard-analysis-abc123def456',
        },
      };

      (mockOctokit.rest.checks.create as MockedFunction<any>).mockResolvedValue(mockResponse);

      const result = await createCheckRun(
        mockOctokit,
        mockRepository.owner,
        mockRepository.repo,
        'abc123def456',
        contextualOutput,
        {
          name: 'FlakeGuard Analysis',
          conclusion: 'action_required',
          detailsUrl: 'https://flakeguard.com/analysis/987654',
          externalId: 'flakeguard-analysis-abc123def456',
        }
      );

      expect(result.success).toBe(true);
      expect(result.data!.conclusion).toBe('action_required');

      // Verify API call includes all contextual information
      const createCall = (mockOctokit.rest.checks.create as MockedFunction<any>).mock.calls[0][0];
      expect(createCall.details_url).toBe('https://flakeguard.com/analysis/987654');
      expect(createCall.external_id).toBe('flakeguard-analysis-abc123def456');
      expect(createCall.output.text).toContain('Detailed Analysis');
    });
  });
});
