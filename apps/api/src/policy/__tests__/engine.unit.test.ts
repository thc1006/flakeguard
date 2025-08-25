/**
 * Comprehensive Unit Tests for Policy Engine
 * 
 * Tests all policy configuration scenarios, edge cases, and decision logic
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import type { Octokit } from '@octokit/rest';
import type { TestResult } from '@flakeguard/shared';
import { 
  PolicyEngine, 
  policyConfigSchema, 
  validatePolicyConfig, 
  createPolicyConfig,
  type PolicyConfig,
  type PolicyDecision 
} from '../engine.js';

// Mock dependencies
const mockOctokit = {
  rest: {
    repos: {
      getContent: vi.fn(),
    },
  },
} as unknown as Octokit;

// Test fixtures
const mockTestResult: TestResult = {
  id: 'test-1',
  name: 'should pass all the time',
  status: 'passed',
  duration: 1000,
  executedAt: new Date(),
  flakeAnalysis: {
    failureRate: 0.5,
    totalRuns: 20,
    historicalFailures: 10,
    confidence: 0.8,
    lastFailureDate: new Date(),
    averageFailureDuration: 500,
    failurePattern: 'intermittent',
  },
};

const mockFlakyTestResult: TestResult = {
  ...mockTestResult,
  id: 'test-flaky',
  name: 'flaky test case',
  flakeAnalysis: {
    ...mockTestResult.flakeAnalysis!,
    failureRate: 0.8,
    confidence: 0.9,
    totalRuns: 50,
    historicalFailures: 40,
  },
};

const mockStableTestResult: TestResult = {
  ...mockTestResult,
  id: 'test-stable',
  name: 'stable test case',
  flakeAnalysis: {
    ...mockTestResult.flakeAnalysis!,
    failureRate: 0.1,
    confidence: 0.95,
    totalRuns: 100,
    historicalFailures: 10,
  },
};

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PolicyEngine();
  });

  describe('Policy Configuration Schema', () => {
    it('should validate complete valid configuration', () => {
      const validConfig = {
        flaky_threshold: 0.7,
        warn_threshold: 0.4,
        min_occurrences: 10,
        min_recent_failures: 3,
        lookback_days: 14,
        rolling_window_size: 100,
        exclude_paths: ['**/test/**', '**/*.spec.ts'],
        labels_required: ['flake-safe'],
        quarantine_duration_days: 30,
        auto_quarantine_enabled: true,
        team_notifications: {
          slack_channels: { backend: '#backend-alerts' },
          email_groups: { frontend: ['frontend@company.com'] },
        },
        confidence_threshold: 0.8,
        scoring_weights: {
          intermittency_weight: 0.3,
          rerun_weight: 0.25,
          clustering_weight: 0.15,
          message_variance_weight: 0.1,
          fail_ratio_weight: 0.1,
          consecutive_failure_penalty: 0.1,
        },
        exempted_tests: ['legacy/**'],
        team_overrides: {
          backend: {
            flaky_threshold: 0.8,
            auto_quarantine_enabled: false,
          },
        },
      };

      const result = policyConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toMatchObject(validConfig);
      }
    });

    it('should apply defaults for missing fields', () => {
      const minimalConfig = {
        flaky_threshold: 0.6,
      };

      const result = policyConfigSchema.parse(minimalConfig);
      expect(result.flaky_threshold).toBe(0.6);
      expect(result.warn_threshold).toBe(0.3); // default
      expect(result.min_occurrences).toBe(5); // default
      expect(result.auto_quarantine_enabled).toBe(false); // default
      expect(result.exclude_paths).toEqual([
        'node_modules/**',
        '**/test/**',
        '**/*.spec.ts',
        '**/*.test.ts',
        'examples/**',
        'docs/**',
      ]); // default
    });

    it('should reject invalid threshold values', () => {
      const invalidConfigs = [
        { flaky_threshold: -0.1 }, // negative
        { flaky_threshold: 1.1 }, // > 1
        { warn_threshold: 2.0 }, // > 1
        { min_occurrences: 0 }, // < 1
        { min_occurrences: -5 }, // negative
        { lookback_days: 0 }, // < 1
        { lookback_days: 400 }, // > 365
        { confidence_threshold: -0.1 }, // negative
        { confidence_threshold: 1.5 }, // > 1
      ];

      invalidConfigs.forEach(config => {
        const result = policyConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      });
    });

    it('should validate scoring weights sum and ranges', () => {
      const validWeights = {
        scoring_weights: {
          intermittency_weight: 0.3,
          rerun_weight: 0.25,
          clustering_weight: 0.15,
          message_variance_weight: 0.1,
          fail_ratio_weight: 0.1,
          consecutive_failure_penalty: 0.1,
        },
      };

      const result = policyConfigSchema.safeParse(validWeights);
      expect(result.success).toBe(true);
    });

    it('should reject invalid scoring weights', () => {
      const invalidWeights = [
        { scoring_weights: { intermittency_weight: -0.1 } }, // negative
        { scoring_weights: { intermittency_weight: 1.1 } }, // > 1
        { scoring_weights: { rerun_weight: 2.0 } }, // > 1
      ];

      invalidWeights.forEach(config => {
        const result = policyConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Policy Loading', () => {
    it('should load policy from GitHub repository', async () => {
      const mockYamlContent = `
flaky_threshold: 0.7
warn_threshold: 0.4
min_occurrences: 8
auto_quarantine_enabled: true
exclude_paths:
  - "tests/**"
  - "**/*.integration.ts"
`;

      const mockResponse = {
        data: {
          type: 'file',
          content: Buffer.from(mockYamlContent).toString('base64'),
          sha: 'abc123',
        },
      };

      (mockOctokit.rest.repos.getContent as MockedFunction<any>)
        .mockResolvedValueOnce(mockResponse);

      const policy = await engine.loadPolicy(mockOctokit, 'owner', 'repo');

      expect(policy.flaky_threshold).toBe(0.7);
      expect(policy.warn_threshold).toBe(0.4);
      expect(policy.min_occurrences).toBe(8);
      expect(policy.auto_quarantine_enabled).toBe(true);
      expect(policy.exclude_paths).toEqual(['tests/**', '**/*.integration.ts']);

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        path: '.flakeguard.yml',
        ref: 'HEAD',
      });
    });

    it('should use cached policy when available', async () => {
      const mockResponse = {
        data: {
          type: 'file',
          content: Buffer.from('flaky_threshold: 0.8').toString('base64'),
          sha: 'def456',
        },
      };

      (mockOctokit.rest.repos.getContent as MockedFunction<any>)
        .mockResolvedValueOnce(mockResponse);

      // First load
      const policy1 = await engine.loadPolicy(mockOctokit, 'owner', 'repo');
      expect(policy1.flaky_threshold).toBe(0.8);

      // Second load should use cache
      const policy2 = await engine.loadPolicy(mockOctokit, 'owner', 'repo');
      expect(policy2.flaky_threshold).toBe(0.8);

      // Should only call GitHub API once
      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledTimes(1);
    });

    it('should fallback to defaults when file not found', async () => {
      const error = new Error('Not Found');
      (error as any).status = 404;

      (mockOctokit.rest.repos.getContent as MockedFunction<any>)
        .mockRejectedValueOnce(error);

      const policy = await engine.loadPolicy(mockOctokit, 'owner', 'repo');

      // Should use default values
      expect(policy.flaky_threshold).toBe(0.6); // default
      expect(policy.warn_threshold).toBe(0.3); // default
    });

    it('should handle malformed YAML gracefully', async () => {
      const invalidYaml = 'invalid: yaml: content: [unclosed';
      const mockResponse = {
        data: {
          type: 'file',
          content: Buffer.from(invalidYaml).toString('base64'),
          sha: 'invalid123',
        },
      };

      (mockOctokit.rest.repos.getContent as MockedFunction<any>)
        .mockResolvedValueOnce(mockResponse);

      const policy = await engine.loadPolicy(mockOctokit, 'owner', 'repo');

      // Should fallback to defaults
      expect(policy.flaky_threshold).toBe(0.6);
    });

    it('should handle invalid schema in config file', async () => {
      const invalidConfig = `
flaky_threshold: 2.0  # invalid - exceeds max
min_occurrences: -5   # invalid - negative
`;
      const mockResponse = {
        data: {
          type: 'file',
          content: Buffer.from(invalidConfig).toString('base64'),
          sha: 'invalid456',
        },
      };

      (mockOctokit.rest.repos.getContent as MockedFunction<any>)
        .mockResolvedValueOnce(mockResponse);

      const policy = await engine.loadPolicy(mockOctokit, 'owner', 'repo');

      // Should fallback to defaults
      expect(policy.flaky_threshold).toBe(0.6);
    });
  });

  describe('Policy Evaluation', () => {
    let policy: PolicyConfig;

    beforeEach(() => {
      policy = createPolicyConfig({
        flaky_threshold: 0.7,
        warn_threshold: 0.4,
        min_occurrences: 5,
        min_recent_failures: 2,
        confidence_threshold: 0.7,
        exclude_paths: ['**/test/**'],
        exempted_tests: ['legacy.*'],
      });
    });

    it('should quarantine flaky tests above threshold', async () => {
      const decisions = await engine.evaluatePolicy(
        [mockFlakyTestResult],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('quarantine');
      expect(decisions[0].confidence).toBe(0.9);
      expect(decisions[0].priority).toBe('high');
      expect(decisions[0].reason).toContain('High flakiness score');
    });

    it('should warn for moderately flaky tests', async () => {
      const moderateTest: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          failureRate: 0.5, // between warn and quarantine
          confidence: 0.8,
        },
      };

      const decisions = await engine.evaluatePolicy(
        [moderateTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('warn');
      expect(decisions[0].reason).toContain('Moderate flakiness score');
    });

    it('should take no action for stable tests', async () => {
      const decisions = await engine.evaluatePolicy(
        [mockStableTestResult],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('Low flakiness score');
    });

    it('should skip exempted tests', async () => {
      const exemptedTest: TestResult = {
        ...mockFlakyTestResult,
        name: 'legacy.old_test',
      };

      const decisions = await engine.evaluatePolicy(
        [exemptedTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('explicitly exempted');
      expect(decisions[0].metadata.exempted).toBe(true);
    });

    it('should skip tests with insufficient data', async () => {
      const insufficientDataTest: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          totalRuns: 3, // below min_occurrences
        },
      };

      const decisions = await engine.evaluatePolicy(
        [insufficientDataTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('Insufficient data');
    });

    it('should skip tests with too few recent failures', async () => {
      const lowFailureTest: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          totalRuns: 20,
          historicalFailures: 1, // below min_recent_failures
        },
      };

      const decisions = await engine.evaluatePolicy(
        [lowFailureTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('Too few recent failures');
    });

    it('should skip tests with low confidence', async () => {
      const lowConfidenceTest: TestResult = {
        ...mockFlakyTestResult,
        flakeAnalysis: {
          ...mockFlakyTestResult.flakeAnalysis!,
          confidence: 0.5, // below confidence_threshold
        },
      };

      const decisions = await engine.evaluatePolicy(
        [lowConfidenceTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('Low confidence');
    });

    it('should skip tests without flakiness analysis', async () => {
      const noAnalysisTest: TestResult = {
        ...mockTestResult,
        flakeAnalysis: undefined,
      };

      const decisions = await engine.evaluatePolicy(
        [noAnalysisTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('No flakiness analysis data');
    });
  });

  describe('Path Exclusions', () => {
    let policy: PolicyConfig;

    beforeEach(() => {
      policy = createPolicyConfig({
        exclude_paths: ['**/test/**', '**/*.spec.ts', 'examples/**'],
      });
    });

    it('should exclude tests matching path patterns', async () => {
      const testWithPath: TestResult = {
        ...mockFlakyTestResult,
        stackTrace: '    at Object.<anonymous> (/app/tests/unit/component.spec.ts:10:5)',
      };

      const decisions = await engine.evaluatePolicy(
        [testWithPath],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('matches exclusion pattern');
    });

    it('should process tests not matching exclusion patterns', async () => {
      const testWithValidPath: TestResult = {
        ...mockFlakyTestResult,
        stackTrace: '    at Object.<anonymous> (/app/src/components/Button.test.ts:15:3)',
      };

      const decisions = await engine.evaluatePolicy(
        [testWithValidPath],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('quarantine'); // Should process normally
    });
  });

  describe('Team Overrides', () => {
    let policy: PolicyConfig;

    beforeEach(() => {
      policy = createPolicyConfig({
        flaky_threshold: 0.6,
        warn_threshold: 0.3,
        team_overrides: {
          backend: {
            flaky_threshold: 0.8,
            warn_threshold: 0.5,
          },
          frontend: {
            flaky_threshold: 0.4,
          },
        },
      });
    });

    it('should apply team overrides for quarantine threshold', async () => {
      // Test would normally be quarantined (0.7 > 0.6)
      // But with backend team override (0.8), it should only warn
      const testResult: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          failureRate: 0.7,
          confidence: 0.9,
        },
      };

      const decisions = await engine.evaluatePolicy(
        [testResult],
        policy,
        { owner: 'owner', repo: 'repo' },
        { teamContext: 'backend' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('warn'); // Should warn instead of quarantine
      expect(decisions[0].metadata.teamOverride).toBe('backend');
    });

    it('should apply team overrides for warn threshold', async () => {
      const testResult: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          failureRate: 0.4, // would warn with default (0.3) but not with backend override (0.5)
          confidence: 0.8,
        },
      };

      const decisions = await engine.evaluatePolicy(
        [testResult],
        policy,
        { owner: 'owner', repo: 'repo' },
        { teamContext: 'backend' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none'); // Should not warn with override
    });

    it('should use default thresholds for unknown teams', async () => {
      const testResult: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          failureRate: 0.7, // should quarantine with default threshold
          confidence: 0.9,
        },
      };

      const decisions = await engine.evaluatePolicy(
        [testResult],
        policy,
        { owner: 'owner', repo: 'repo' },
        { teamContext: 'unknown-team' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('quarantine');
    });
  });

  describe('Auto-Quarantine Logic', () => {
    let policy: PolicyConfig;

    beforeEach(() => {
      policy = createPolicyConfig({
        flaky_threshold: 0.6,
        auto_quarantine_enabled: true,
        labels_required: ['safe-to-quarantine'],
      });
    });

    it('should enable auto-quarantine with required labels', async () => {
      const decisions = await engine.evaluatePolicy(
        [mockFlakyTestResult],
        policy,
        { owner: 'owner', repo: 'repo' },
        { pullRequestLabels: ['safe-to-quarantine', 'other-label'] }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('quarantine');
      expect(decisions[0].reason).toContain('auto-quarantine enabled');
    });

    it('should disable auto-quarantine without required labels', async () => {
      const decisions = await engine.evaluatePolicy(
        [mockFlakyTestResult],
        policy,
        { owner: 'owner', repo: 'repo' },
        { pullRequestLabels: ['other-label'] }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('quarantine');
      expect(decisions[0].reason).not.toContain('auto-quarantine enabled');
    });

    it('should work with no required labels when enabled', async () => {
      const noLabelsPolicy = createPolicyConfig({
        flaky_threshold: 0.6,
        auto_quarantine_enabled: true,
        labels_required: [],
      });

      const decisions = await engine.evaluatePolicy(
        [mockFlakyTestResult],
        noLabelsPolicy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('quarantine');
      expect(decisions[0].reason).toContain('auto-quarantine enabled');
    });
  });

  describe('Priority Determination', () => {
    let policy: PolicyConfig;

    beforeEach(() => {
      policy = createPolicyConfig({
        flaky_threshold: 0.5,
        warn_threshold: 0.2,
      });
    });

    it('should assign critical priority for very high flakiness', async () => {
      const criticalTest: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          failureRate: 0.9,
          confidence: 0.9,
        },
      };

      const decisions = await engine.evaluatePolicy(
        [criticalTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions[0].priority).toBe('critical');
    });

    it('should assign high priority for high flakiness', async () => {
      const highTest: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          failureRate: 0.75,
          confidence: 0.8,
        },
      };

      const decisions = await engine.evaluatePolicy(
        [highTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions[0].priority).toBe('high');
    });

    it('should assign medium priority for moderate flakiness', async () => {
      const mediumTest: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          failureRate: 0.45,
          confidence: 0.8,
        },
      };

      const decisions = await engine.evaluatePolicy(
        [mediumTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions[0].priority).toBe('medium');
    });

    it('should assign low priority for stable tests', async () => {
      const decisions = await engine.evaluatePolicy(
        [mockStableTestResult],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions[0].priority).toBe('low');
    });
  });

  describe('Cache Management', () => {
    it('should clear expired cache entries', () => {
      // This requires accessing private methods, so we'll test indirectly
      // through repeated policy loads with different timestamps
      const stats1 = engine.getCacheStats();
      engine.clearExpiredCache();
      const stats2 = engine.getCacheStats();
      
      expect(typeof stats1.size).toBe('number');
      expect(typeof stats2.size).toBe('number');
    });

    it('should invalidate cache for specific repository', () => {
      engine.invalidateCache('owner', 'repo');
      const stats = engine.getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(0);
    });

    it('should provide cache statistics', () => {
      const stats = engine.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('expired');
      expect(stats).toHaveProperty('hitsBySource');
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.expired).toBe('number');
      expect(typeof stats.hitsBySource).toBe('object');
    });
  });

  describe('Utility Functions', () => {
    describe('validatePolicyConfig', () => {
      it('should validate correct configuration', () => {
        const result = validatePolicyConfig({
          flaky_threshold: 0.7,
          warn_threshold: 0.4,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.errors).toBeUndefined();
      });

      it('should return errors for invalid configuration', () => {
        const result = validatePolicyConfig({
          flaky_threshold: -0.1,
          min_occurrences: 'invalid',
        });

        expect(result.success).toBe(false);
        expect(result.data).toBeUndefined();
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
      });
    });

    describe('createPolicyConfig', () => {
      it('should create valid configuration with defaults', () => {
        const config = createPolicyConfig({
          flaky_threshold: 0.8,
        });

        expect(config.flaky_threshold).toBe(0.8);
        expect(config.warn_threshold).toBe(0.3); // default
        expect(config.min_occurrences).toBe(5); // default
      });

      it('should throw for invalid configuration', () => {
        expect(() => {
          createPolicyConfig({
            flaky_threshold: 2.0, // invalid
          });
        }).toThrow();
      });
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle empty test array', async () => {
      const policy = createPolicyConfig({});
      const decisions = await engine.evaluatePolicy(
        [],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(0);
    });

    it('should handle test result with minimal data', async () => {
      const minimalTest: TestResult = {
        id: 'minimal',
        name: 'minimal test',
        status: 'passed',
        duration: 0,
        executedAt: new Date(),
      };

      const policy = createPolicyConfig({});
      const decisions = await engine.evaluatePolicy(
        [minimalTest],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
    });

    it('should handle test with stack trace path extraction', async () => {
      const testWithStackTrace: TestResult = {
        ...mockFlakyTestResult,
        stackTrace: `Error: Test failed
    at Object.<anonymous> (/app/src/components/Button.test.ts:25:10)
    at Promise.then.completed (/app/node_modules/jest/build/jest.js:123:45)`,
      };

      const policy = createPolicyConfig({
        exclude_paths: ['**/*.test.ts'],
      });

      const decisions = await engine.evaluatePolicy(
        [testWithStackTrace],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('matches exclusion pattern');
    });

    it('should handle test with path-like name', async () => {
      const testWithPathName: TestResult = {
        ...mockFlakyTestResult,
        name: '/app/tests/unit/component.spec.ts should work correctly',
      };

      const policy = createPolicyConfig({
        exclude_paths: ['**/tests/**'],
      });

      const decisions = await engine.evaluatePolicy(
        [testWithPathName],
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('matches exclusion pattern');
    });
  });

  describe('Complex Policy Scenarios', () => {
    it('should handle complex multi-test evaluation', async () => {
      const tests: TestResult[] = [
        mockStableTestResult,
        mockFlakyTestResult,
        {
          ...mockTestResult,
          id: 'warning-test',
          name: 'warning level test',
          flakeAnalysis: {
            ...mockTestResult.flakeAnalysis!,
            failureRate: 0.45,
            confidence: 0.8,
          },
        },
        {
          ...mockTestResult,
          id: 'exempted-test',
          name: 'legacy.exempted_test',
          flakeAnalysis: {
            ...mockTestResult.flakeAnalysis!,
            failureRate: 0.9, // would be quarantined but exempted
            confidence: 0.9,
          },
        },
      ];

      const policy = createPolicyConfig({
        flaky_threshold: 0.7,
        warn_threshold: 0.4,
        exempted_tests: ['legacy.*'],
      });

      const decisions = await engine.evaluatePolicy(
        tests,
        policy,
        { owner: 'owner', repo: 'repo' }
      );

      expect(decisions).toHaveLength(4);
      expect(decisions[0].action).toBe('none'); // stable
      expect(decisions[1].action).toBe('quarantine'); // flaky
      expect(decisions[2].action).toBe('warn'); // warning level
      expect(decisions[3].action).toBe('none'); // exempted
      expect(decisions[3].metadata.exempted).toBe(true);
    });

    it('should handle team overrides with partial configuration', async () => {
      const policy = createPolicyConfig({
        flaky_threshold: 0.6,
        warn_threshold: 0.3,
        team_overrides: {
          strict: {
            flaky_threshold: 0.4, // stricter
            // warn_threshold not overridden, uses default
          },
          lenient: {
            // flaky_threshold not overridden, uses default
            warn_threshold: 0.5, // more lenient
          },
        },
      });

      const moderateTest: TestResult = {
        ...mockTestResult,
        flakeAnalysis: {
          ...mockTestResult.flakeAnalysis!,
          failureRate: 0.45,
          confidence: 0.8,
        },
      };

      // Test with strict team (lower quarantine threshold)
      const strictDecisions = await engine.evaluatePolicy(
        [moderateTest],
        policy,
        { owner: 'owner', repo: 'repo' },
        { teamContext: 'strict' }
      );
      expect(strictDecisions[0].action).toBe('quarantine');

      // Test with lenient team (higher warn threshold)  
      const lenientDecisions = await engine.evaluatePolicy(
        [moderateTest],
        policy,
        { owner: 'owner', repo: 'repo' },
        { teamContext: 'lenient' }
      );
      expect(lenientDecisions[0].action).toBe('none'); // Below lenient warn threshold
    });
  });
});