/**
 * Integration tests for GitHub Checks API helpers
 * 
 * Tests the createCheckRun and updateCheckRun functions with mocked Octokit responses
 * Covers rate limiting, error handling, and proper status transitions
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import type { Octokit } from '@octokit/rest';
import {
  createCheckRun,
  updateCheckRun,
  validateStatusTransition,
  createCheckRunWithProgression,
} from '../check-api.js';
import type { CheckRunOutput, CheckRunActionDef } from '../check-api.js';
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
    checks: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
} as unknown as Octokit);

describe('GitHub Checks API', () => {
  let mockOctokit: Octokit;
  const mockOutput: CheckRunOutput = {
    title: 'Test Analysis Complete',
    summary: 'All tests passed successfully',
    text: 'Detailed analysis results...',
  };
  const mockActions: CheckRunActionDef[] = [
    {
      label: 'Quarantine',
      description: 'Quarantine flaky test',
      identifier: 'quarantine',
    },
  ];

  beforeEach(() => {
    mockOctokit = createMockOctokit();
    vi.clearAllMocks();
  });

  describe('createCheckRun', () => {
    it('should create check run with default parameters', async () => {
      const mockResponse = {
        data: {
          id: 12345,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'success',
          started_at: '2024-01-01T00:00:00Z',
          completed_at: '2024-01-01T00:01:00Z',
          output: {
            title: mockOutput.title,
            summary: mockOutput.summary,
            text: mockOutput.text,
          },
          actions: [
            {
              label: mockActions[0].label,
              description: mockActions[0].description,
              identifier: mockActions[0].identifier,
            },
          ],
        },
      };

      (mockOctokit.rest.checks.create as MockedFunction<any>).mockResolvedValue(mockResponse);

      const result = await createCheckRun(
        mockOctokit,
        'owner',
        'repo',
        'abc123',
        mockOutput,
        {
          conclusion: 'success',
          actions: mockActions,
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.id).toBe(12345);
      expect(result.data!.name).toBe('FlakeGuard Analysis');
      expect(result.data!.status).toBe('completed');
      expect(result.data!.conclusion).toBe('success');
      expect(result.data!.actions).toHaveLength(1);
      expect(result.data!.actions[0].identifier).toBe('quarantine');
    });

    it('should handle GitHub API errors', async () => {
      const apiError = new Error('API Error');
      (apiError as any).status = 422;
      (apiError as any).message = 'Invalid request';

      (mockOctokit.rest.checks.create as MockedFunction<any>).mockRejectedValue(apiError);

      const result = await createCheckRun(
        mockOctokit,
        'owner',
        'repo',
        'abc123',
        mockOutput
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(result.error!.message).toBe('Invalid request');
    });

    it('should limit actions to maximum of 3', async () => {
      const manyActions: CheckRunActionDef[] = [
        { label: 'Action 1', description: 'First action', identifier: 'quarantine' },
        { label: 'Action 2', description: 'Second action', identifier: 'rerun_failed' },
        { label: 'Action 3', description: 'Third action', identifier: 'open_issue' },
        { label: 'Action 4', description: 'Fourth action', identifier: 'dismiss_flake' },
      ];

      const mockResponse = {
        data: {
          id: 12345,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'neutral',
          started_at: '2024-01-01T00:00:00Z',
          completed_at: '2024-01-01T00:01:00Z',
          output: mockOutput,
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
        'owner',
        'repo',
        'abc123',
        mockOutput,
        { actions: manyActions }
      );

      expect(result.success).toBe(true);
      expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: expect.arrayContaining([
            expect.objectContaining({ identifier: 'quarantine' }),
            expect.objectContaining({ identifier: 'rerun_failed' }),
            expect.objectContaining({ identifier: 'open_issue' }),
          ]),
        })
      );
      expect((mockOctokit.rest.checks.create as MockedFunction<any>).mock.calls[0][0].actions).toHaveLength(3);
    });
  });

  describe('updateCheckRun', () => {
    it('should update check run with new status', async () => {
      const mockResponse = {
        data: {
          id: 12345,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2024-01-01T00:00:00Z',
          completed_at: '2024-01-01T00:01:00Z',
          output: {
            title: 'Analysis Failed',
            summary: 'Flaky tests detected',
          },
          actions: [],
        },
      };

      (mockOctokit.rest.checks.update as MockedFunction<any>).mockResolvedValue(mockResponse);

      const result = await updateCheckRun(
        mockOctokit,
        'owner',
        'repo',
        12345,
        {
          title: 'Analysis Failed',
          summary: 'Flaky tests detected',
        },
        {
          status: 'completed',
          conclusion: 'failure',
        }
      );

      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('completed');
      expect(result.data!.conclusion).toBe('failure');
    });

    it('should handle rate limiting with retry', async () => {
      const rateLimitError = new Error('Rate limited');
      (rateLimitError as any).status = 429;
      (rateLimitError as any).response = {
        headers: {
          'x-ratelimit-reset': Math.floor(Date.now() / 1000 + 1).toString(),
        },
      };

      const mockResponse = {
        data: {
          id: 12345,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'success',
          started_at: '2024-01-01T00:00:00Z',
          completed_at: '2024-01-01T00:01:00Z',
          output: mockOutput,
          actions: [],
        },
      };

      (mockOctokit.rest.checks.update as MockedFunction<any>)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(mockResponse);

      const result = await updateCheckRun(
        mockOctokit,
        'owner',
        'repo',
        12345,
        mockOutput,
        { status: 'completed' }
      );

      expect(result.success).toBe(true);
      expect(mockOctokit.rest.checks.update).toHaveBeenCalledTimes(2);
    }, 10000); // Increased timeout for retry logic
  });

  describe('validateStatusTransition', () => {
    it('should allow valid status transitions', () => {
      // Initial states
      expect(validateStatusTransition(null, 'queued')).toBe(true);
      expect(validateStatusTransition(null, 'in_progress')).toBe(true);
      expect(validateStatusTransition(null, 'completed')).toBe(true);

      // From queued
      expect(validateStatusTransition('queued', 'in_progress')).toBe(true);
      expect(validateStatusTransition('queued', 'completed')).toBe(true);

      // From in_progress
      expect(validateStatusTransition('in_progress', 'completed')).toBe(true);
    });

    it('should reject invalid status transitions', () => {
      // Cannot transition from completed
      expect(validateStatusTransition('completed', 'queued')).toBe(false);
      expect(validateStatusTransition('completed', 'in_progress')).toBe(false);

      // Cannot go backwards
      expect(validateStatusTransition('in_progress', 'queued')).toBe(false);
      expect(validateStatusTransition('completed', 'in_progress')).toBe(false);
    });
  });

  describe('createCheckRunWithProgression', () => {
    it('should create check run with proper status progression', async () => {
      const queuedResponse = {
        data: {
          id: 12345,
          name: 'Test Analysis',
          head_sha: 'abc123',
          status: 'queued',
          conclusion: null,
          started_at: '2024-01-01T00:00:00Z',
          completed_at: null,
          output: {
            title: 'Analysis Queued',
            summary: 'FlakeGuard analysis has been queued for processing.',
          },
          actions: [],
        },
      };

      const inProgressResponse = {
        data: {
          ...queuedResponse.data,
          status: 'in_progress',
          output: {
            title: 'Analysis In Progress',
            summary: 'FlakeGuard is analyzing test results and patterns.',
          },
        },
      };

      const completedResponse = {
        data: {
          ...queuedResponse.data,
          status: 'completed',
          conclusion: 'success',
          completed_at: '2024-01-01T00:01:00Z',
          output: mockOutput,
          actions: [],
        },
      };

      (mockOctokit.rest.checks.create as MockedFunction<any>).mockResolvedValue(queuedResponse);
      (mockOctokit.rest.checks.update as MockedFunction<any>)
        .mockResolvedValueOnce(inProgressResponse)
        .mockResolvedValueOnce(completedResponse);

      const result = await createCheckRunWithProgression(
        mockOctokit,
        'owner',
        'repo',
        'abc123',
        'Test Analysis',
        mockOutput,
        { conclusion: 'success' }
      );

      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('completed');
      expect(result.data!.conclusion).toBe('success');

      // Verify the progression: create -> update (in_progress) -> update (completed)
      expect(mockOctokit.rest.checks.create).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.checks.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should map GitHub error codes correctly', async () => {
      const testCases = [
        { status: 401, expectedCode: ErrorCode.UNAUTHORIZED },
        { status: 403, expectedCode: ErrorCode.FORBIDDEN },
        { status: 404, expectedCode: ErrorCode.RESOURCE_NOT_FOUND },
        { status: 422, expectedCode: ErrorCode.VALIDATION_ERROR },
        { status: 429, expectedCode: ErrorCode.GITHUB_RATE_LIMITED },
        { status: 502, expectedCode: ErrorCode.GITHUB_SERVICE_UNAVAILABLE },
        { status: 500, expectedCode: ErrorCode.GITHUB_SERVICE_UNAVAILABLE },
      ];

      for (const testCase of testCases) {
        const apiError = new Error('API Error');
        (apiError as any).status = testCase.status;

        (mockOctokit.rest.checks.create as MockedFunction<any>).mockRejectedValue(apiError);

        const result = await createCheckRun(
          mockOctokit,
          'owner',
          'repo',
          'abc123',
          mockOutput
        );

        expect(result.success).toBe(false);
        expect(result.error!.code).toBe(testCase.expectedCode);
      }
    });

    it('should include error details in response', async () => {
      const apiError = new Error('Detailed error message');
      (apiError as any).status = 422;
      (apiError as any).response = {
        data: {
          message: 'Validation failed',
          errors: [{ field: 'head_sha', message: 'is required' }],
        },
      };

      (mockOctokit.rest.checks.create as MockedFunction<any>).mockRejectedValue(apiError);

      const result = await createCheckRun(
        mockOctokit,
        'owner',
        'repo',
        'abc123',
        mockOutput
      );

      expect(result.success).toBe(false);
      expect(result.error!.details).toBeDefined();
      expect(result.error!.details!.status).toBe(422);
      expect(result.error!.details!.response).toBeDefined();
    });
  });
});
