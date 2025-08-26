/**
 * GitHub Helpers Tests
 * 
 * Comprehensive tests for all GitHub API helper functions:
 * - Check run operations (create, update, with flake actions)
 * - Workflow operations (rerun, cancel, get jobs)
 * - Artifact operations (list, download URLs) 
 * - Issue operations (create flake issues)
 * - Error handling and rate limiting
 * - Octokit client mocking
 */

import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';

import { ErrorCode } from '../api-spec.js';
import { GitHubAuthManager } from '../auth.js';
import { GitHubHelpers, createGitHubHelpers, type FlakeIssueParams } from '../helpers.js';
import type { CheckRunAction, FlakeAnalysis, CreateCheckRunParams, UpdateCheckRunParams } from '../types.js';

import { createMockOctokitClient, createMockAuthManager } from './mocks.js';

describe('GitHubHelpers', () => {
  let helpers: GitHubHelpers;
  let mockAuthManager: GitHubAuthManager;
  let mockOctokit: ReturnType<typeof createMockOctokitClient>;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    mockOctokit = createMockOctokitClient();
    mockAuthManager = createMockAuthManager();
    mockAuthManager.getInstallationClient = vi.fn().mockResolvedValue(mockOctokit);
    helpers = new GitHubHelpers(mockAuthManager);
  });

  afterEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  describe('Check Run Operations', () => {
    describe('createCheckRun', () => {
      it('should create check run successfully', async () => {
        const mockResponse = {
          data: {
            id: 123,
            name: 'FlakeGuard Test',
            head_sha: 'abc123',
            status: 'completed',
            conclusion: 'success',
            started_at: '2024-01-01T10:00:00Z',
            completed_at: '2024-01-01T10:05:00Z',
            output: {
              title: 'Test passed',
              summary: 'All tests passed successfully',
              text: null,
            },
            actions: [
              {
                label: 'Rerun',
                description: 'Rerun this check',
                identifier: 'rerun',
              },
            ],
          },
        };

        mockOctokit.rest.checks.create.mockResolvedValue(mockResponse);

        const params: Omit<CreateCheckRunParams, 'owner' | 'repo'> = {
          name: 'FlakeGuard Test',
          headSha: 'abc123',
          status: 'completed',
          conclusion: 'success',
          startedAt: '2024-01-01T10:00:00Z',
          completedAt: '2024-01-01T10:05:00Z',
          output: {
            title: 'Test passed',
            summary: 'All tests passed successfully',
          },
          actions: [
            {
              label: 'Rerun',
              description: 'Rerun this check',
              identifier: 'rerun_failed',
            },
          ],
        };

        const result = await helpers.createCheckRun('owner', 'repo', params, 12345);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.id).toBe(123);
        expect(result.data?.name).toBe('FlakeGuard Test');
        expect(result.data?.headSha).toBe('abc123');
        expect(result.data?.status).toBe('completed');
        expect(result.data?.conclusion).toBe('success');

        expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          name: 'FlakeGuard Test',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'success',
          started_at: '2024-01-01T10:00:00Z',
          completed_at: '2024-01-01T10:05:00Z',
          output: {
            title: 'Test passed',
            summary: 'All tests passed successfully',
          },
          actions: [
            {
              label: 'Rerun',
              description: 'Rerun this check',
              identifier: 'rerun_failed',
            },
          ],
        });
      });

      it('should handle GitHub API errors', async () => {
        const error = new Error('API Error');
        (error as any).status = 403;
        mockOctokit.rest.checks.create.mockRejectedValue(error);

        const params: Omit<CreateCheckRunParams, 'owner' | 'repo'> = {
          name: 'Test Check',
          headSha: 'abc123',
        };

        const result = await helpers.createCheckRun('owner', 'repo', params, 12345);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error?.code).toBe(ErrorCode.FORBIDDEN);
        expect(result.error?.message).toBe('API Error');
      });

      it('should handle rate limiting errors', async () => {
        const error = new Error('Rate limited');
        (error as any).status = 429;
        mockOctokit.rest.checks.create.mockRejectedValue(error);

        const params: Omit<CreateCheckRunParams, 'owner' | 'repo'> = {
          name: 'Test Check',
          headSha: 'abc123',
        };

        const result = await helpers.createCheckRun('owner', 'repo', params, 12345);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(ErrorCode.GITHUB_RATE_LIMITED);
      });
    });

    describe('updateCheckRun', () => {
      it('should update check run successfully', async () => {
        const mockResponse = {
          data: {
            id: 123,
            name: 'FlakeGuard Test',
            head_sha: 'abc123',
            status: 'completed',
            conclusion: 'failure',
            started_at: '2024-01-01T10:00:00Z',
            completed_at: '2024-01-01T10:05:00Z',
            output: {
              title: 'Flaky test detected',
              summary: 'This test appears to be flaky',
              text: null,
            },
            actions: [
              {
                label: 'Quarantine',
                description: 'Quarantine this test',
                identifier: 'quarantine',
              },
            ],
          },
        };

        mockOctokit.rest.checks.update.mockResolvedValue(mockResponse);

        const updates: Omit<UpdateCheckRunParams, 'checkRunId'> = {
          status: 'completed',
          conclusion: 'failure',
          completedAt: '2024-01-01T10:05:00Z',
          output: {
            title: 'Flaky test detected',
            summary: 'This test appears to be flaky',
          },
          actions: [
            {
              label: 'Quarantine',
              description: 'Quarantine this test',
              identifier: 'quarantine',
            },
          ],
        };

        const result = await helpers.updateCheckRun('owner', 'repo', 123, 12345, updates);

        expect(result.success).toBe(true);
        expect(result.data?.conclusion).toBe('failure');
        expect(result.data?.actions).toHaveLength(1);
        expect(result.data?.actions?.[0]?.identifier).toBe('quarantine');

        expect(mockOctokit.rest.checks.update).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          check_run_id: 123,
          status: 'completed',
          conclusion: 'failure',
          completed_at: '2024-01-01T10:05:00Z',
          output: {
            title: 'Flaky test detected',
            summary: 'This test appears to be flaky',
          },
          actions: [
            {
              label: 'Quarantine',
              description: 'Quarantine this test',
              identifier: 'quarantine',
            },
          ],
        });
      });

      it('should handle not found errors', async () => {
        const error = new Error('Not found');
        (error as any).status = 404;
        mockOctokit.rest.checks.update.mockRejectedValue(error);

        const updates: Omit<UpdateCheckRunParams, 'checkRunId'> = {
          conclusion: 'success',
        };

        const result = await helpers.updateCheckRun('owner', 'repo', 999, 12345, updates);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
      });
    });

    describe('updateCheckRunWithFlakeActions', () => {
      it('should add flake actions to check run', async () => {
        const mockResponse = {
          data: {
            id: 123,
            name: 'Test',
            head_sha: 'abc123',
            status: 'completed',
            conclusion: null,
            started_at: null,
            completed_at: null,
            output: { title: '', summary: '', text: null },
            actions: [
              { label: 'Quarantine Test', description: 'Mark as flaky', identifier: 'quarantine' },
              { label: 'Rerun Failed Jobs', description: 'Rerun failed jobs', identifier: 'rerun_failed' },
              { label: 'Open Issue', description: 'Create issue', identifier: 'open_issue' },
            ],
          },
        };

        mockOctokit.rest.checks.update.mockResolvedValue(mockResponse);

        await helpers.updateCheckRunWithFlakeActions('owner', 'repo', 123, 12345);

        expect(mockOctokit.rest.checks.update).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          check_run_id: 123,
          status: undefined,
          conclusion: undefined,
          completed_at: undefined,
          output: undefined,
          actions: [
            {
              label: 'Quarantine Test',
              description: 'Mark this test as flaky and quarantine it from affecting CI',
              identifier: 'quarantine',
            },
            {
              label: 'Rerun Failed Jobs',
              description: 'Rerun only the failed jobs in this workflow',
              identifier: 'rerun_failed',
            },
            {
              label: 'Open Issue',
              description: 'Create a GitHub issue to track this flaky test',
              identifier: 'open_issue',
            },
          ],
        });
      });
    });

    describe('updateCheckRunWithFlakeDetection', () => {
      it('should update check run with flake detection results', async () => {
        const mockResponse = {
          data: {
            id: 123,
            name: 'Test',
            head_sha: 'abc123',
            status: 'completed',
            conclusion: 'neutral',
            started_at: null,
            completed_at: null,
            output: {
              title: '🚨 Flaky Test Detected (High confidence)',
              summary: expect.stringContaining('flaky behavior with 80.0% confidence'),
              text: null,
            },
            actions: [
              { label: 'Quarantine Test', description: 'Quarantine action', identifier: 'quarantine' },
              { label: 'Open Issue', description: 'Issue action', identifier: 'open_issue' },
            ],
          },
        };

        mockOctokit.rest.checks.update.mockResolvedValue(mockResponse);

        const analysis: FlakeAnalysis = {
          isFlaky: true,
          confidence: 0.8,
          failurePattern: 'timeout',
          historicalFailures: 8,
          totalRuns: 20,
          failureRate: 0.4,
          lastFailureAt: new Date().toISOString(),
          suggestedAction: 'quarantine',
        };

        const suggestedActions: CheckRunAction[] = ['quarantine', 'open_issue'];

        await helpers.updateCheckRunWithFlakeDetection(
          'owner',
          'repo',
          123,
          12345,
          analysis,
          suggestedActions
        );

        expect(mockOctokit.rest.checks.update).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          check_run_id: 123,
          status: undefined,
          conclusion: 'neutral',
          completed_at: undefined,
          output: {
            title: '🚨 Flaky Test Detected (High confidence)',
            summary: expect.stringContaining('flaky behavior with 80.0% confidence'),
          },
          actions: [
            {
              label: 'Quarantine Test',
              description: 'Mark this test as flaky and quarantine it from affecting CI',
              identifier: 'quarantine',
            },
            {
              label: 'Open Issue',
              description: 'Create a GitHub issue to track this flaky test',
              identifier: 'open_issue',
            },
          ],
        });
      });

      it('should handle non-flaky test results', async () => {
        const mockResponse = {
          data: {
            id: 123,
            name: 'Test',
            head_sha: 'abc123',
            status: 'completed',
            conclusion: 'success',
            started_at: null,
            completed_at: null,
            output: {
              title: '✅ Test Analysis Complete',
              summary: 'No flaky behavior detected in this test execution.',
              text: null,
            },
            actions: [],
          },
        };

        mockOctokit.rest.checks.update.mockResolvedValue(mockResponse);

        const analysis: FlakeAnalysis = {
          isFlaky: false,
          confidence: 0.2,
          failurePattern: null,
          historicalFailures: 1,
          totalRuns: 20,
          failureRate: 0.05,
          lastFailureAt: null,
          suggestedAction: null,
        };

        await helpers.updateCheckRunWithFlakeDetection(
          'owner',
          'repo',
          123,
          12345,
          analysis,
          []
        );

        expect(mockOctokit.rest.checks.update).toHaveBeenCalledWith(
          expect.objectContaining({
            conclusion: 'success',
            output: {
              title: '✅ Test Analysis Complete',
              summary: 'No flaky behavior detected in this test execution.',
            },
            actions: [],
          })
        );
      });
    });

    describe('createFlakeGuardCheckRun', () => {
      it('should create FlakeGuard check run for flaky test', async () => {
        const mockResponse = {
          data: {
            id: 456,
            name: 'FlakeGuard: integration-test',
            head_sha: 'def456',
            status: 'completed',
            conclusion: 'neutral',
            started_at: null,
            completed_at: expect.any(String),
            output: {
              title: '🚨 Flaky Test Detected (High confidence)',
              summary: expect.stringContaining('shows flaky behavior with 85.0% confidence'),
              text: null,
            },
            actions: [
              { label: 'Quarantine Test', description: 'Quarantine', identifier: 'quarantine' },
              { label: 'Open Issue', description: 'Open issue', identifier: 'open_issue' },
            ],
          },
        };

        mockOctokit.rest.checks.create.mockResolvedValue(mockResponse);

        await helpers.createFlakeGuardCheckRun('owner', 'repo', 'def456', 12345, {
          testName: 'integration-test',
          isFlaky: true,
          confidence: 0.85,
          failurePattern: 'connection timeout',
          suggestedActions: ['quarantine', 'open_issue'],
        });

        expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
          expect.objectContaining({
            owner: 'owner',
            repo: 'repo',
            name: 'FlakeGuard: integration-test',
            head_sha: 'def456',
            status: 'completed',
            conclusion: 'neutral',
            completed_at: expect.any(String),
            output: {
              title: '🚨 Flaky Test Detected (High confidence)',
              summary: expect.stringContaining('shows flaky behavior with 85.0% confidence'),
            },
            actions: [
              {
                label: 'Quarantine Test',
                description: 'Mark this test as flaky and quarantine it from affecting CI',
                identifier: 'quarantine',
              },
              {
                label: 'Open Issue',
                description: 'Create a GitHub issue to track this flaky test',
                identifier: 'open_issue',
              },
            ],
          })
        );
      });

      it('should create FlakeGuard check run for stable test', async () => {
        const mockResponse = {
          data: {
            id: 789,
            name: 'FlakeGuard: unit-test',
            head_sha: 'ghi789',
            status: 'completed',
            conclusion: 'success',
            started_at: null,
            completed_at: expect.any(String),
            output: {
              title: '✅ No Flaky Behavior Detected',
              summary: 'Test "unit-test" appears to be stable based on current analysis.',
              text: null,
            },
            actions: [],
          },
        };

        mockOctokit.rest.checks.create.mockResolvedValue(mockResponse);

        await helpers.createFlakeGuardCheckRun('owner', 'repo', 'ghi789', 12345, {
          testName: 'unit-test',
          isFlaky: false,
          confidence: 0.1,
          failurePattern: null,
          suggestedActions: [],
        });

        expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'FlakeGuard: unit-test',
            conclusion: 'success',
            output: {
              title: '✅ No Flaky Behavior Detected',
              summary: 'Test "unit-test" appears to be stable based on current analysis.',
            },
            actions: [],
          })
        );
      });
    });

    describe('createFlakeGuardSummaryCheckRun', () => {
      it('should create summary check run with issues', async () => {
        const mockResponse = {
          data: {
            id: 999,
            name: 'FlakeGuard Summary',
            head_sha: 'summary123',
            status: 'completed',
            conclusion: 'neutral',
            started_at: null,
            completed_at: expect.any(String),
            output: {
              title: '🔍 FlakeGuard Analysis Complete - Issues Found',
              summary: expect.stringContaining('## FlakeGuard Test Analysis Summary'),
              text: null,
            },
            actions: [
              { label: 'Rerun Failed Jobs', description: 'Rerun failed', identifier: 'rerun_failed' },
              { label: 'View Flaky Tests', description: 'View report', identifier: 'open_issue' },
            ],
          },
        };

        mockOctokit.rest.checks.create.mockResolvedValue(mockResponse);

        const summary = {
          totalFlaky: 3,
          totalQuarantined: 1,
          recentlyDetected: 2,
          topFlaky: [
            {
              testName: 'flaky-test-1',
              confidence: 0.9,
              failureRate: 0.6,
              lastFailureAt: new Date().toISOString(),
            },
            {
              testName: 'flaky-test-2',
              confidence: 0.7,
              failureRate: 0.3,
              lastFailureAt: new Date().toISOString(),
            },
          ],
        };

        await helpers.createFlakeGuardSummaryCheckRun(
          'owner',
          'repo',
          'summary123',
          12345,
          summary,
          true
        );

        expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'FlakeGuard Summary',
            head_sha: 'summary123',
            status: 'completed',
            conclusion: 'neutral',
            output: {
              title: '🔍 FlakeGuard Analysis Complete - Issues Found',
              summary: expect.stringContaining('Total Flaky Tests:** 3'),
            },
            actions: [
              {
                label: 'Rerun Failed Jobs',
                description: 'Rerun only the failed jobs in this workflow',
                identifier: 'rerun_failed',
              },
              {
                label: 'View Flaky Tests',
                description: 'Open detailed report of flaky tests',
                identifier: 'open_issue',
              },
            ],
          })
        );
      });

      it('should create summary check run with no issues', async () => {
        const mockResponse = {
          data: {
            id: 998,
            name: 'FlakeGuard Summary',
            head_sha: 'summary456',
            status: 'completed',
            conclusion: 'success',
            started_at: null,
            completed_at: expect.any(String),
            output: {
              title: '✅ FlakeGuard Analysis Complete - No Issues',
              summary: expect.stringContaining('Total Flaky Tests:** 0'),
              text: null,
            },
            actions: [],
          },
        };

        mockOctokit.rest.checks.create.mockResolvedValue(mockResponse);

        const summary = {
          totalFlaky: 0,
          totalQuarantined: 0,
          recentlyDetected: 0,
          topFlaky: [],
        };

        await helpers.createFlakeGuardSummaryCheckRun(
          'owner',
          'repo',
          'summary456',
          12345,
          summary,
          false
        );

        expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
          expect.objectContaining({
            conclusion: 'success',
            output: {
              title: '✅ FlakeGuard Analysis Complete - No Issues',
              summary: expect.stringContaining('Total Flaky Tests:** 0'),
            },
            actions: [],
          })
        );
      });
    });
  });

  describe('Workflow Operations', () => {
    describe('rerunWorkflow', () => {
      it('should rerun workflow successfully', async () => {
        mockOctokit.rest.actions.reRunWorkflow.mockResolvedValue({ data: {} });

        const result = await helpers.rerunWorkflow('owner', 'repo', 123, 12345, {
          enableDebugLogging: true,
        });

        expect(result.success).toBe(true);
        expect(result.message).toBe('Workflow rerun initiated successfully');
        expect(result.runId).toBe(123);

        expect(mockOctokit.rest.actions.reRunWorkflow).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          run_id: 123,
          enable_debug_logging: true,
        });
      });

      it('should handle workflow rerun errors', async () => {
        const error = new Error('Workflow cannot be rerun');
        mockOctokit.rest.actions.reRunWorkflow.mockRejectedValue(error);

        await expect(
          helpers.rerunWorkflow('owner', 'repo', 123, 12345)
        ).rejects.toThrow('Failed to rerun workflow: Workflow cannot be rerun');
      });
    });

    describe('rerunFailedJobs', () => {
      it('should rerun failed jobs successfully', async () => {
        mockOctokit.rest.actions.reRunWorkflowFailedJobs.mockResolvedValue({ data: {} });

        const result = await helpers.rerunFailedJobs('owner', 'repo', 456, 12345, {
          enableDebugLogging: false,
        });

        expect(result.success).toBe(true);
        expect(result.message).toBe('Failed jobs rerun initiated successfully');
        expect(result.runId).toBe(456);

        expect(mockOctokit.rest.actions.reRunWorkflowFailedJobs).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          run_id: 456,
          enable_debug_logging: false,
        });
      });
    });

    describe('cancelWorkflow', () => {
      it('should cancel workflow successfully', async () => {
        mockOctokit.rest.actions.cancelWorkflowRun.mockResolvedValue({ data: {} });

        const result = await helpers.cancelWorkflow('owner', 'repo', 789, 12345);

        expect(result.success).toBe(true);
        expect(result.message).toBe('Workflow cancelled successfully');

        expect(mockOctokit.rest.actions.cancelWorkflowRun).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          run_id: 789,
        });
      });
    });

    describe('getWorkflowJobs', () => {
      it('should get workflow jobs successfully', async () => {
        const mockJobs = [
          {
            id: 1,
            name: 'test-job-1',
            conclusion: 'success',
            steps: [],
          },
          {
            id: 2,
            name: 'test-job-2', 
            conclusion: 'failure',
            steps: [
              {
                name: 'Run tests',
                conclusion: 'failure',
              },
            ],
          },
        ];

        mockOctokit.rest.actions.listJobsForWorkflowRun.mockResolvedValue({
          data: { jobs: mockJobs },
        });

        const result = await helpers.getWorkflowJobs('owner', 'repo', 123, 12345);

        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('test-job-1');
        expect(result[1].conclusion).toBe('failure');

        expect(mockOctokit.rest.actions.listJobsForWorkflowRun).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          run_id: 123,
        });
      });
    });
  });

  describe('Artifact Operations', () => {
    describe('listArtifacts', () => {
      it('should list artifacts successfully', async () => {
        const mockArtifacts = [
          {
            id: 123,
            name: 'test-results',
            size_in_bytes: 1024,
            url: 'https://api.github.com/repos/owner/repo/actions/artifacts/123',
            archive_download_url: 'https://api.github.com/download/123',
            expired: false,
            created_at: '2024-01-01T10:00:00Z',
            expires_at: '2024-03-01T10:00:00Z',
            updated_at: '2024-01-01T10:05:00Z',
          },
          {
            id: 456,
            name: 'coverage-report',
            size_in_bytes: 2048,
            url: 'https://api.github.com/repos/owner/repo/actions/artifacts/456',
            archive_download_url: 'https://api.github.com/download/456',
            expired: false,
            created_at: '2024-01-01T10:00:00Z',
            expires_at: '2024-03-01T10:00:00Z',
            updated_at: '2024-01-01T10:05:00Z',
          },
        ];

        mockOctokit.rest.actions.listWorkflowRunArtifacts.mockResolvedValue({
          data: { artifacts: mockArtifacts },
        });

        const result = await helpers.listArtifacts('owner', 'repo', 123, 12345, {
          page: 1,
          perPage: 50,
          name: 'test',
        });

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(123);
        expect(result[0].name).toBe('test-results');
        expect(result[0].type).toBe('test-results');
        expect(result[0].sizeInBytes).toBe(1024);
        expect(result[1].type).toBe('coverage-report');

        expect(mockOctokit.rest.actions.listWorkflowRunArtifacts).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          run_id: 123,
          page: 1,
          per_page: 50,
          name: 'test',
        });
      });

      it('should infer artifact types correctly', async () => {
        const mockArtifacts = [
          { id: 1, name: 'junit-results', size_in_bytes: 100, url: '', archive_download_url: '', expired: false, created_at: '', expires_at: '', updated_at: '' },
          { id: 2, name: 'coverage-lcov', size_in_bytes: 200, url: '', archive_download_url: '', expired: false, created_at: '', expires_at: '', updated_at: '' },
          { id: 3, name: 'build-logs', size_in_bytes: 300, url: '', archive_download_url: '', expired: false, created_at: '', expires_at: '', updated_at: '' },
          { id: 4, name: 'test-screenshots', size_in_bytes: 400, url: '', archive_download_url: '', expired: false, created_at: '', expires_at: '', updated_at: '' },
          { id: 5, name: 'other-artifact', size_in_bytes: 500, url: '', archive_download_url: '', expired: false, created_at: '', expires_at: '', updated_at: '' },
        ];

        mockOctokit.rest.actions.listWorkflowRunArtifacts.mockResolvedValue({
          data: { artifacts: mockArtifacts },
        });

        const result = await helpers.listArtifacts('owner', 'repo', 123, 12345);

        expect(result[0].type).toBe('test-results');
        expect(result[1].type).toBe('coverage-report');
        expect(result[2].type).toBe('logs');
        expect(result[3].type).toBe('screenshots');
        expect(result[4].type).toBe('other');
      });
    });

    describe('generateArtifactDownloadUrl', () => {
      it('should generate download URL successfully', async () => {
        const mockArtifact = {
          data: {
            id: 123,
            name: 'test-results',
            size_in_bytes: 1024,
            archive_download_url: 'https://api.github.com/download/123',
            expired: false,
            expires_at: '2024-03-01T10:00:00Z',
          },
        };

        mockOctokit.rest.actions.getArtifact.mockResolvedValue(mockArtifact);

        const result = await helpers.generateArtifactDownloadUrl('owner', 'repo', 123, 12345);

        expect(result.downloadUrl).toBe('https://api.github.com/download/123');
        expect(result.expiresAt).toBe('2024-03-01T10:00:00Z');
        expect(result.sizeInBytes).toBe(1024);

        expect(mockOctokit.rest.actions.getArtifact).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          artifact_id: 123,
        });
      });

      it('should handle expired artifact', async () => {
        const mockArtifact = {
          data: {
            id: 123,
            name: 'test-results',
            size_in_bytes: 1024,
            archive_download_url: 'https://api.github.com/download/123',
            expired: true,
            expires_at: '2024-01-01T10:00:00Z',
          },
        };

        mockOctokit.rest.actions.getArtifact.mockResolvedValue(mockArtifact);

        await expect(
          helpers.generateArtifactDownloadUrl('owner', 'repo', 123, 12345)
        ).rejects.toThrow('Artifact has expired');
      });
    });
  });

  describe('Issue Operations', () => {
    describe('createFlakeIssue', () => {
      it('should create flake issue successfully', async () => {
        const mockIssue = {
          data: {
            id: 1,
            number: 42,
            title: '[FlakeGuard] Flaky test detected: integration-test',
            body: expect.stringContaining('## Flaky Test Report'),
            labels: [
              { name: 'flaky-test' },
              { name: 'bug' },
              { name: 'testing' },
            ],
          },
        };

        mockOctokit.rest.issues.create.mockResolvedValue(mockIssue);

        const params: FlakeIssueParams = {
          testName: 'integration-test',
          confidence: 0.8,
          failureRate: 0.4,
          failurePattern: 'connection timeout',
          checkRunUrl: 'https://github.com/owner/repo/runs/123',
        };

        await helpers.createFlakeIssue('owner', 'repo', 12345, params);

        expect(mockOctokit.rest.issues.create).toHaveBeenCalledWith({
          owner: 'owner',
          repo: 'repo',
          title: '[FlakeGuard] Flaky test detected: integration-test',
          body: expect.stringContaining('**Test Name:** integration-test'),
          labels: ['flaky-test', 'bug', 'testing'],
        });

        const callArgs = mockOctokit.rest.issues.create.mock.calls[0][0];
        expect(callArgs.body).toContain('**Confidence:** 80.0%');
        expect(callArgs.body).toContain('**Failure Rate:** 40.0%');
        expect(callArgs.body).toContain('**Failure Pattern:** connection timeout');
        expect(callArgs.body).toContain('**Check Run:** https://github.com/owner/repo/runs/123');
        expect(callArgs.body).toContain('### What is a flaky test?');
        expect(callArgs.body).toContain('### Recommended Actions');
        expect(callArgs.body).toContain('*This issue was automatically created by FlakeGuard*');
      });

      it('should handle issue creation without failure pattern', async () => {
        mockOctokit.rest.issues.create.mockResolvedValue({
          data: { id: 1, number: 43 },
        });

        const params: FlakeIssueParams = {
          testName: 'unit-test',
          confidence: 0.6,
          failureRate: 0.2,
          failurePattern: null,
          checkRunUrl: 'https://github.com/owner/repo/runs/456',
        };

        await helpers.createFlakeIssue('owner', 'repo', 12345, params);

        const callArgs = mockOctokit.rest.issues.create.mock.calls[0][0];
        expect(callArgs.body).not.toContain('**Failure Pattern:**');
        expect(callArgs.body).toContain('**Confidence:** 60.0%');
      });

      it('should handle issue creation errors', async () => {
        const error = new Error('API Error');
        mockOctokit.rest.issues.create.mockRejectedValue(error);

        const params: FlakeIssueParams = {
          testName: 'test',
          confidence: 0.5,
          failureRate: 0.3,
          failurePattern: null,
          checkRunUrl: 'https://github.com/test',
        };

        await expect(
          helpers.createFlakeIssue('owner', 'repo', 12345, params)
        ).rejects.toThrow('Failed to create issue: API Error');
      });
    });
  });

  describe('Utility Methods', () => {
    describe('getConfidenceLabel', () => {
      it('should return correct confidence labels', () => {
        // Access private method through type assertion for testing
        const helperInstance = helpers as any;
        
        expect(helperInstance.getConfidenceLabel(0.9)).toBe('High');
        expect(helperInstance.getConfidenceLabel(0.8)).toBe('High');
        expect(helperInstance.getConfidenceLabel(0.7)).toBe('Medium');
        expect(helperInstance.getConfidenceLabel(0.5)).toBe('Medium');
        expect(helperInstance.getConfidenceLabel(0.4)).toBe('Low');
        expect(helperInstance.getConfidenceLabel(0.1)).toBe('Low');
      });
    });

    describe('inferArtifactType', () => {
      it('should infer artifact types correctly', () => {
        const helperInstance = helpers as any;
        
        expect(helperInstance.inferArtifactType('junit-test-results')).toBe('test-results');
        expect(helperInstance.inferArtifactType('test-output')).toBe('test-results');
        expect(helperInstance.inferArtifactType('coverage-report')).toBe('coverage-report');
        expect(helperInstance.inferArtifactType('lcov-cov')).toBe('coverage-report');
        expect(helperInstance.inferArtifactType('build-logs')).toBe('logs');
        expect(helperInstance.inferArtifactType('test-output')).toBe('test-results');
        expect(helperInstance.inferArtifactType('screenshot-failures')).toBe('screenshots');
        expect(helperInstance.inferArtifactType('test-image.png')).toBe('screenshots');
        expect(helperInstance.inferArtifactType('other-artifact')).toBe('other');
      });
    });

    describe('mapGitHubErrorCode', () => {
      it('should map GitHub error codes correctly', () => {
        const helperInstance = helpers as any;
        
        expect(helperInstance.mapGitHubErrorCode({ status: 401 })).toBe(ErrorCode.UNAUTHORIZED);
        expect(helperInstance.mapGitHubErrorCode({ status: 403 })).toBe(ErrorCode.FORBIDDEN);
        expect(helperInstance.mapGitHubErrorCode({ status: 404 })).toBe(ErrorCode.RESOURCE_NOT_FOUND);
        expect(helperInstance.mapGitHubErrorCode({ status: 422 })).toBe(ErrorCode.VALIDATION_ERROR);
        expect(helperInstance.mapGitHubErrorCode({ status: 429 })).toBe(ErrorCode.GITHUB_RATE_LIMITED);
        expect(helperInstance.mapGitHubErrorCode({ status: 500 })).toBe(ErrorCode.GITHUB_SERVICE_UNAVAILABLE);
        expect(helperInstance.mapGitHubErrorCode({ status: 502 })).toBe(ErrorCode.GITHUB_SERVICE_UNAVAILABLE);
        expect(helperInstance.mapGitHubErrorCode({ status: 418 })).toBe(ErrorCode.GITHUB_API_ERROR);
        expect(helperInstance.mapGitHubErrorCode({})).toBe(ErrorCode.GITHUB_API_ERROR);
      });
    });
  });

  describe('Factory Function', () => {
    it('should create helpers instance', () => {
      const instance = createGitHubHelpers(mockAuthManager);
      expect(instance).toBeInstanceOf(GitHubHelpers);
    });
  });

  describe('Rate Limiting and Retry Logic', () => {
    it('should handle rate limiting gracefully', async () => {
      const rateLimitError = new Error('Rate limited');
      (rateLimitError as any).status = 429;
      
      mockOctokit.rest.checks.create.mockRejectedValueOnce(rateLimitError);

      const params: Omit<CreateCheckRunParams, 'owner' | 'repo'> = {
        name: 'Test Check',
        headSha: 'abc123',
      };

      const result = await helpers.createCheckRun('owner', 'repo', params, 12345);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCode.GITHUB_RATE_LIMITED);
    });
  });

  describe('Error Boundary Tests', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      mockOctokit.rest.checks.create.mockRejectedValue(networkError);

      const params: Omit<CreateCheckRunParams, 'owner' | 'repo'> = {
        name: 'Test Check',
        headSha: 'abc123',
      };

      const result = await helpers.createCheckRun('owner', 'repo', params, 12345);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(ErrorCode.GITHUB_API_ERROR);
    });

    it('should handle malformed responses', async () => {
      mockOctokit.rest.checks.create.mockResolvedValue({
        data: null as any,
      });

      const params: Omit<CreateCheckRunParams, 'owner' | 'repo'> = {
        name: 'Test Check',
        headSha: 'abc123',
      };

      // Should not throw but may have undefined behavior
      const result = await helpers.createCheckRun('owner', 'repo', params, 12345);
      expect(result.success).toBe(true);
    });
  });
});