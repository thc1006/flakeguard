/**
 * Check Runs Rendering System Tests
 * 
 * Comprehensive test suite for FlakeGuard check run rendering including:
 * - Markdown output format consistency and snapshot testing
 * - Action count validation (never exceeding 3)
 * - Edge cases with varying test data
 * - GitHub API integration testing
 * - Error handling and status transitions
 */

import type { Octokit } from '@octokit/rest';
import type { PrismaClient } from '@prisma/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { GitHubAuthManager } from '../auth.js';
import {
  renderCheckRunOutput,
  generateCheckRunActions,
  createOrUpdateCheckRun,
  updateExistingCheckRun,
  createFlakeGuardCheckRun,
  convertToTestCandidates,
  type TestCandidate,
  type CheckRunParams,
} from '../check-runs.js';

import { createMockPrismaClient } from './mocks.js';

// Mock the auth manager
vi.mock('../auth.js', () => ({
  GitHubAuthManager: vi.fn(),
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Check Runs Rendering System', () => {
  let mockAuthManager: GitHubAuthManager;
  let mockOctokit: Octokit;
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    
    // Mock Octokit client
    mockOctokit = {
      rest: {
        checks: {
          create: vi.fn(),
          update: vi.fn(),
        },
      },
    } as any;
    
    // Mock auth manager
    mockAuthManager = {
      getInstallationClient: vi.fn().mockResolvedValue(mockOctokit),
    } as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('renderCheckRunOutput', () => {
    it('should render empty state correctly', () => {
      const output = renderCheckRunOutput([]);
      
      expect(output.title).toBe('✅ FlakeGuard Analysis Complete');
      expect(output.summary).toContain('No flaky test candidates detected');
      expect(output.summary).toContain('All tests appear to be stable');
    });

    it('should render single test candidate', () => {
      const tests: TestCandidate[] = [
        {
          testName: 'integration.test.DatabaseConnection',
          failCount: 5,
          rerunPassRate: 0.75,
          lastFailedRun: '2024-01-15T10:30:00Z',
          confidence: 0.85,
          failurePattern: 'timeout',
          totalRuns: 20,
        },
      ];

      const output = renderCheckRunOutput(tests);
      
      expect(output.title).toBe('🔍 FlakeGuard Analysis: 1 Flaky Test Candidate Detected');
      expect(output.summary).toContain('## Flaky Test Candidates');
      expect(output.summary).toContain('| Test Name | Fail Count | Rerun Pass Rate | Last Failed Run | Confidence |');
      expect(output.summary).toContain('`integration.test.DatabaseConnection`');
      expect(output.summary).toContain('| 5 | 75.0% |');
      expect(output.summary).toContain('85.0%');
      expect(output.summary).toContain('1/15/2024'); // Date formatting
    });

    it('should render multiple test candidates with proper sorting', () => {
      const tests: TestCandidate[] = [
        {
          testName: 'test.LowConfidence',
          failCount: 2,
          rerunPassRate: 0.9,
          lastFailedRun: '2024-01-10T10:00:00Z',
          confidence: 0.3,
          failurePattern: null,
          totalRuns: 10,
        },
        {
          testName: 'test.HighConfidence',
          failCount: 8,
          rerunPassRate: 0.6,
          lastFailedRun: '2024-01-15T10:00:00Z',
          confidence: 0.9,
          failurePattern: 'race condition',
          totalRuns: 15,
        },
        {
          testName: 'test.MediumConfidence',
          failCount: 4,
          rerunPassRate: 0.8,
          lastFailedRun: null,
          confidence: 0.6,
          failurePattern: 'timeout',
          totalRuns: 12,
        },
      ];

      const output = renderCheckRunOutput(tests);
      
      expect(output.title).toBe('🔍 FlakeGuard Analysis: 3 Flaky Test Candidates Detected');
      
      // Verify sorting: HighConfidence (0.9) should be first, then MediumConfidence (0.6), then LowConfidence (0.3)
      const summaryLines = output.summary.split('\n');
      const testRows = summaryLines.filter(line => line.includes('`test.'));
      
      expect(testRows[0]).toContain('test.HighConfidence');
      expect(testRows[1]).toContain('test.MediumConfidence');
      expect(testRows[2]).toContain('test.LowConfidence');
    });

    it('should handle special characters in test names', () => {
      const tests: TestCandidate[] = [
        {
          testName: 'test_with_underscores.TestClass[param*value]',
          failCount: 1,
          rerunPassRate: 0.95,
          lastFailedRun: null,
          confidence: 0.4,
          failurePattern: null,
          totalRuns: 5,
        },
      ];

      const output = renderCheckRunOutput(tests);
      
      // Verify markdown escaping
      expect(output.summary).toContain('`test_with_underscores.TestClass\\[param\\*value\\]`');
    });

    it('should limit display to top 10 candidates', () => {
      const tests: TestCandidate[] = Array.from({ length: 15 }, (_, i) => ({
        testName: `test.Candidate${i + 1}`,
        failCount: 15 - i, // Descending fail count
        rerunPassRate: 0.7,
        lastFailedRun: null,
        confidence: 0.5,
        failurePattern: null,
        totalRuns: 20,
      }));

      const output = renderCheckRunOutput(tests);
      
      // Should show message about limiting results
      expect(output.summary).toContain('*Showing top 10 of 15 total candidates.*');
      
      // Count actual test rows in table
      const summaryLines = output.summary.split('\n');
      const testRows = summaryLines.filter(line => line.includes('`test.Candidate'));
      expect(testRows).toHaveLength(10);
    });

    it('should include comprehensive explanation sections', () => {
      const tests: TestCandidate[] = [
        {
          testName: 'test.Example',
          failCount: 3,
          rerunPassRate: 0.8,
          lastFailedRun: null,
          confidence: 0.7,
          failurePattern: 'timeout',
          totalRuns: 10,
        },
      ];

      const output = renderCheckRunOutput(tests);
      
      expect(output.summary).toContain('### What are flaky tests?');
      expect(output.summary).toContain('Race conditions');
      expect(output.summary).toContain('External dependencies');
      expect(output.summary).toContain('Resource contention');
      expect(output.summary).toContain('Non-deterministic behavior');
      
      expect(output.summary).toContain('### Recommended Actions');
      expect(output.summary).toContain('Quarantine');
      expect(output.summary).toContain('Rerun');
      expect(output.summary).toContain('Open issues');
      
      expect(output.summary).toContain('*This analysis is generated by FlakeGuard');
    });

    it('should be consistent for snapshot testing', () => {
      const tests: TestCandidate[] = [
        {
          testName: 'com.example.IntegrationTest.testDatabaseConnection',
          failCount: 7,
          rerunPassRate: 0.65,
          lastFailedRun: '2024-01-15T10:30:00.000Z',
          confidence: 0.82,
          failurePattern: 'connection timeout',
          totalRuns: 25,
        },
        {
          testName: 'com.example.UnitTest.testAsyncOperation',
          failCount: 3,
          rerunPassRate: 0.88,
          lastFailedRun: '2024-01-14T15:45:30.000Z',
          confidence: 0.58,
          failurePattern: 'race condition',
          totalRuns: 18,
        },
      ];

      const output = renderCheckRunOutput(tests);
      
      // This output should be consistent for snapshot testing
      expect(output).toMatchSnapshot('flaky-test-candidates-output');
    });
  });

  describe('generateCheckRunActions', () => {
    it('should never exceed 3 actions', () => {
      const tests: TestCandidate[] = Array.from({ length: 10 }, (_, i) => ({
        testName: `test${i}`,
        failCount: 5,
        rerunPassRate: 0.7,
        lastFailedRun: null,
        confidence: 0.9, // All high confidence
        failurePattern: 'timeout',
        totalRuns: 20,
      }));

      const actions = generateCheckRunActions(tests, true);
      
      expect(actions).toHaveLength(3);
      expect(actions.every(action => action.identifier)).toBe(true);
      expect(actions.every(action => action.label)).toBe(true);
      expect(actions.every(action => action.description)).toBe(true);
    });

    it('should prioritize actions correctly with failures', () => {
      const tests: TestCandidate[] = [
        {
          testName: 'test.HighConfidence',
          failCount: 5,
          rerunPassRate: 0.7,
          lastFailedRun: null,
          confidence: 0.85, // High confidence
          failurePattern: 'timeout',
          totalRuns: 20,
        },
      ];

      const actions = generateCheckRunActions(tests, true);
      
      // Should include rerun_failed, quarantine, and open_issue in that priority
      expect(actions).toHaveLength(3);
      expect(actions[0].identifier).toBe('rerun_failed');
      expect(actions[1].identifier).toBe('quarantine');
      expect(actions[2].identifier).toBe('open_issue');
    });

    it('should handle no failures scenario', () => {
      const tests: TestCandidate[] = [
        {
          testName: 'test.MediumConfidence',
          failCount: 2,
          rerunPassRate: 0.85,
          lastFailedRun: null,
          confidence: 0.6, // Medium confidence
          failurePattern: null,
          totalRuns: 15,
        },
      ];

      const actions = generateCheckRunActions(tests, false);
      
      // Without failures, should not include rerun_failed
      expect(actions).toHaveLength(1);
      expect(actions[0].identifier).toBe('open_issue');
    });

    it('should handle empty tests array', () => {
      const actions = generateCheckRunActions([], true);
      
      // With failures but no flaky tests, should only suggest rerun
      expect(actions).toHaveLength(1);
      expect(actions[0].identifier).toBe('rerun_failed');
    });

    it('should handle no tests and no failures', () => {
      const actions = generateCheckRunActions([], false);
      
      // No actions needed
      expect(actions).toHaveLength(0);
    });

    it('should customize action descriptions based on test count', () => {
      const multipleHighConfidenceTests: TestCandidate[] = [
        { testName: 'test1', failCount: 5, rerunPassRate: 0.7, lastFailedRun: null, confidence: 0.9, failurePattern: 'timeout', totalRuns: 20 },
        { testName: 'test2', failCount: 3, rerunPassRate: 0.8, lastFailedRun: null, confidence: 0.85, failurePattern: 'race condition', totalRuns: 15 },
        { testName: 'test3', failCount: 4, rerunPassRate: 0.75, lastFailedRun: null, confidence: 0.8, failurePattern: 'network', totalRuns: 18 },
      ];

      const actions = generateCheckRunActions(multipleHighConfidenceTests, true);
      
      const quarantineAction = actions.find(a => a.identifier === 'quarantine');
      expect(quarantineAction?.description).toBe('Quarantine 3 high-confidence flaky tests');
      
      const issueAction = actions.find(a => a.identifier === 'open_issue');
      expect(issueAction?.description).toBe('Create issue for 3 flaky test candidates');
    });

    it('should handle singular vs plural action descriptions', () => {
      const singleTest: TestCandidate[] = [
        { testName: 'test1', failCount: 5, rerunPassRate: 0.7, lastFailedRun: null, confidence: 0.9, failurePattern: 'timeout', totalRuns: 20 },
      ];

      const actions = generateCheckRunActions(singleTest, true);
      
      const quarantineAction = actions.find(a => a.identifier === 'quarantine');
      expect(quarantineAction?.description).toBe('Quarantine 1 high-confidence flaky test');
      
      const issueAction = actions.find(a => a.identifier === 'open_issue');
      expect(issueAction?.description).toBe('Create issue for 1 flaky test candidate');
    });
  });

  describe('createOrUpdateCheckRun', () => {
    it('should create check run with proper parameters', async () => {
      const mockCheckRunResponse = {
        id: 12345,
        name: 'FlakeGuard Analysis',
        head_sha: 'abc123',
        status: 'completed',
        conclusion: 'neutral',
        started_at: '2024-01-15T10:00:00Z',
        completed_at: '2024-01-15T10:05:00Z',
        output: {
          title: 'Test Title',
          summary: 'Test Summary',
        },
        actions: [
          {
            label: 'Rerun Failed',
            description: 'Rerun failed jobs',
            identifier: 'rerun_failed',
          },
        ],
      };

      mockOctokit.rest.checks.create = vi.fn().mockResolvedValue({ data: mockCheckRunResponse });

      const params: CheckRunParams = {
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'FlakeGuard Analysis',
        headSha: 'abc123',
        installationId: 12345,
        status: 'completed',
        conclusion: 'neutral',
        output: {
          title: 'Test Title',
          summary: 'Test Summary',
        },
        actions: [
          {
            label: 'Rerun Failed',
            description: 'Rerun failed jobs',
            identifier: 'rerun_failed',
          },
        ],
      };

      const result = await createOrUpdateCheckRun(mockAuthManager, params);

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(12345);
      expect(result.data?.name).toBe('FlakeGuard Analysis');
      expect(result.data?.status).toBe('completed');
      expect(result.data?.conclusion).toBe('neutral');
      expect(result.data?.actions).toHaveLength(1);

      expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'FlakeGuard Analysis',
        head_sha: 'abc123',
        status: 'completed',
        conclusion: 'neutral',
        started_at: expect.any(String),
        completed_at: expect.any(String),
        output: {
          title: 'Test Title',
          summary: 'Test Summary',
          text: undefined,
        },
        actions: [
          {
            label: 'Rerun Failed',
            description: 'Rerun failed jobs',
            identifier: 'rerun_failed',
          },
        ],
      });
    });

    it('should handle API errors gracefully', async () => {
      const apiError = new Error('GitHub API Error');
      (apiError as any).status = 403;
      (apiError as any).response = { data: { message: 'Forbidden' } };

      mockOctokit.rest.checks.create = vi.fn().mockRejectedValue(apiError);

      const params: CheckRunParams = {
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'FlakeGuard Analysis',
        headSha: 'abc123',
        installationId: 12345,
      };

      const result = await createOrUpdateCheckRun(mockAuthManager, params);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FORBIDDEN');
      expect(result.error?.message).toBe('GitHub API Error');
      expect(result.error?.details?.status).toBe(403);
    });

    it('should default to completed status and neutral conclusion', async () => {
      const mockResponse = { data: { id: 1, name: 'test', head_sha: 'abc', status: 'completed', conclusion: 'neutral', output: {}, actions: [] } };
      mockOctokit.rest.checks.create = vi.fn().mockResolvedValue(mockResponse);

      const params: CheckRunParams = {
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'FlakeGuard Analysis',
        headSha: 'abc123',
        installationId: 12345,
        // No status or conclusion specified
      };

      await createOrUpdateCheckRun(mockAuthManager, params);

      expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          conclusion: 'neutral',
          completed_at: expect.any(String),
        })
      );
    });
  });

  describe('updateExistingCheckRun', () => {
    it('should update check run with new status and actions', async () => {
      const mockResponse = {
        data: {
          id: 12345,
          name: 'FlakeGuard Analysis',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'action_required',
          started_at: '2024-01-15T10:00:00Z',
          completed_at: '2024-01-15T10:05:00Z',
          output: {
            title: 'Updated Title',
            summary: 'Updated Summary',
          },
          actions: [],
        },
      };

      mockOctokit.rest.checks.update = vi.fn().mockResolvedValue(mockResponse);

      const result = await updateExistingCheckRun(
        mockAuthManager,
        'test-owner',
        'test-repo',
        12345,
        67890,
        {
          status: 'completed',
          conclusion: 'action_required',
          output: {
            title: 'Updated Title',
            summary: 'Updated Summary',
          },
          actions: [],
        }
      );

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('completed');
      expect(result.data?.conclusion).toBe('action_required');

      expect(mockOctokit.rest.checks.update).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        check_run_id: 12345,
        status: 'completed',
        conclusion: 'action_required',
        completed_at: expect.any(String),
        output: {
          title: 'Updated Title',
          summary: 'Updated Summary',
          text: undefined,
        },
        actions: [],
      });
    });
  });

  describe('createFlakeGuardCheckRun', () => {
    it('should create comprehensive check run with proper conclusion', async () => {
      const tests: TestCandidate[] = [
        {
          testName: 'test.HighConfidence',
          failCount: 5,
          rerunPassRate: 0.7,
          lastFailedRun: null,
          confidence: 0.9, // High confidence -> action_required
          failurePattern: 'timeout',
          totalRuns: 20,
        },
      ];

      const mockResponse = { data: { id: 1, name: 'test', head_sha: 'abc', status: 'completed', conclusion: 'action_required', output: {}, actions: [] } };
      mockOctokit.rest.checks.create = vi.fn().mockResolvedValue(mockResponse);

      const result = await createFlakeGuardCheckRun(
        mockAuthManager,
        'test-owner',
        'test-repo',
        'abc123',
        12345,
        tests,
        true
      );

      expect(result.success).toBe(true);
      expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'FlakeGuard Analysis',
          conclusion: 'action_required', // High confidence tests require attention
        })
      );
    });

    it('should set neutral conclusion for medium confidence tests', async () => {
      const tests: TestCandidate[] = [
        {
          testName: 'test.MediumConfidence',
          failCount: 2,
          rerunPassRate: 0.85,
          lastFailedRun: null,
          confidence: 0.6, // Medium confidence -> neutral
          failurePattern: null,
          totalRuns: 10,
        },
      ];

      const mockResponse = { data: { id: 1, name: 'test', head_sha: 'abc', status: 'completed', conclusion: 'neutral', output: {}, actions: [] } };
      mockOctokit.rest.checks.create = vi.fn().mockResolvedValue(mockResponse);

      await createFlakeGuardCheckRun(
        mockAuthManager,
        'test-owner',
        'test-repo',
        'abc123',
        12345,
        tests,
        false
      );

      expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conclusion: 'neutral', // Medium confidence is neutral
        })
      );
    });

    it('should set success conclusion for no flaky tests', async () => {
      const mockResponse = { data: { id: 1, name: 'test', head_sha: 'abc', status: 'completed', conclusion: 'success', output: {}, actions: [] } };
      mockOctokit.rest.checks.create = vi.fn().mockResolvedValue(mockResponse);

      await createFlakeGuardCheckRun(
        mockAuthManager,
        'test-owner',
        'test-repo',
        'abc123',
        12345,
        [], // No flaky tests
        false
      );

      expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conclusion: 'success', // No flaky tests = success
        })
      );
    });
  });

  describe('convertToTestCandidates', () => {
    it('should convert database records to test candidates', () => {
      const dbRecords = [
        {
          testName: 'com.example.IntegrationTest',
          confidence: 0.85,
          failureRate: 0.4,
          totalRuns: 25,
          historicalFailures: 10,
          lastFailureAt: new Date('2024-01-15T10:30:00Z'),
          failurePattern: 'connection timeout',
        },
        {
          testName: 'com.example.UnitTest',
          confidence: 0.6,
          failureRate: 0.2,
          totalRuns: 15,
          historicalFailures: 3,
          lastFailureAt: null,
          failurePattern: null,
        },
      ];

      const candidates = convertToTestCandidates(mockPrisma, dbRecords);

      expect(candidates).toHaveLength(2);
      
      expect(candidates[0]).toEqual({
        testName: 'com.example.IntegrationTest',
        failCount: 10,
        rerunPassRate: expect.any(Number), // Calculated based on failure rate
        lastFailedRun: '2024-01-15T10:30:00.000Z',
        confidence: 0.85,
        failurePattern: 'connection timeout',
        totalRuns: 25,
      });
      
      expect(candidates[0].rerunPassRate).toBeGreaterThan(0);
      expect(candidates[0].rerunPassRate).toBeLessThan(1);
      
      expect(candidates[1]).toEqual({
        testName: 'com.example.UnitTest',
        failCount: 3,
        rerunPassRate: expect.any(Number),
        lastFailedRun: null,
        confidence: 0.6,
        failurePattern: null,
        totalRuns: 15,
      });
    });

    it('should handle edge cases in rerun pass rate calculation', () => {
      const dbRecords = [
        {
          testName: 'test.HighFailureRate',
          confidence: 0.8,
          failureRate: 0.9, // Very high failure rate
          totalRuns: 10,
          historicalFailures: 9,
          lastFailureAt: new Date(),
          failurePattern: 'error',
        },
        {
          testName: 'test.NoRuns',
          confidence: 0.5,
          failureRate: 0.0,
          totalRuns: 0, // Edge case: no runs
          historicalFailures: 0,
          lastFailureAt: null,
          failurePattern: null,
        },
      ];

      const candidates = convertToTestCandidates(mockPrisma, dbRecords);

      // High failure rate should still give some positive rerun pass rate
      expect(candidates[0].rerunPassRate).toBeGreaterThanOrEqual(0);
      
      // No runs should give 0 rerun pass rate
      expect(candidates[1].rerunPassRate).toBe(0);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed test data gracefully', () => {
      const malformedTests: TestCandidate[] = [
        {
          testName: '',
          failCount: -1,
          rerunPassRate: 1.5, // Invalid rate
          lastFailedRun: 'invalid-date',
          confidence: 2.0, // Invalid confidence
          failurePattern: null,
          totalRuns: 0,
        },
      ];

      // Should not throw
      expect(() => renderCheckRunOutput(malformedTests)).not.toThrow();
      expect(() => generateCheckRunActions(malformedTests, true)).not.toThrow();
    });

    it('should handle GitHub API rate limiting', async () => {
      const rateLimitError = new Error('API rate limit exceeded');
      (rateLimitError as any).status = 429;
      (rateLimitError as any).response = {
        data: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-reset': '1642684800' },
      };

      mockOctokit.rest.checks.create = vi.fn().mockRejectedValue(rateLimitError);

      const params: CheckRunParams = {
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'FlakeGuard Analysis',
        headSha: 'abc123',
        installationId: 12345,
      };

      const result = await createOrUpdateCheckRun(mockAuthManager, params);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_RATE_LIMITED');
    });

    it('should handle network timeouts', async () => {
      const timeoutError = new Error('Request timeout');
      (timeoutError as any).status = 504;

      mockOctokit.rest.checks.create = vi.fn().mockRejectedValue(timeoutError);

      const params: CheckRunParams = {
        owner: 'test-owner',
        repo: 'test-repo',
        name: 'FlakeGuard Analysis',
        headSha: 'abc123',
        installationId: 12345,
      };

      const result = await createOrUpdateCheckRun(mockAuthManager, params);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GITHUB_SERVICE_UNAVAILABLE');
    });

    it('should validate action count constraint is never violated', () => {
      // Test with extreme conditions that might try to generate > 3 actions
      const manyHighConfidenceTests: TestCandidate[] = Array.from({ length: 50 }, (_, i) => ({
        testName: `test${i}`,
        failCount: 10,
        rerunPassRate: 0.5,
        lastFailedRun: null,
        confidence: 0.95, // All very high confidence
        failurePattern: 'timeout',
        totalRuns: 20,
      }));

      const actions = generateCheckRunActions(manyHighConfidenceTests, true);
      
      // The fundamental constraint: never more than 3 actions
      expect(actions.length).toBeLessThanOrEqual(3);
      
      // And never less than 0
      expect(actions.length).toBeGreaterThanOrEqual(0);
    });
  });
});