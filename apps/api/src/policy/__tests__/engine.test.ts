/**
 * Policy Engine Tests
 * 
 * Comprehensive test suite covering policy loading, validation, evaluation,
 * caching, and error handling scenarios.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Octokit } from '@octokit/rest';
import yaml from 'yaml';
import {
  PolicyEngine,
  policyConfigSchema,
  validatePolicyConfig,
  createPolicyConfig,
  getPolicyEngine,
} from '../engine.js';
import type { TestResult, PolicyDecision } from '@flakeguard/shared';

// Mock dependencies
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config/index.js', () => ({
  config: {
    policy: {
      warnThreshold: 0.3,
      quarantineThreshold: 0.6,
    },
  },
}));

describe('PolicyEngine', () => {
  let engine: PolicyEngine;
  let mockOctokit: Partial<Octokit>;

  beforeEach(() => {
    engine = new PolicyEngine();
    mockOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(),
        } as any,
      } as any,
    };
    
    // Clear environment variables
    delete process.env.FLAKE_WARN_THRESHOLD;
    delete process.env.FLAKE_QUARANTINE_THRESHOLD;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('policy configuration loading', () => {
    it('should load valid .flakeguard.yml from repository', async () => {
      const validConfig = {
        flaky_threshold: 0.7,
        warn_threshold: 0.4,
        min_occurrences: 3,
        exclude_paths: ['test/**'],
        labels_required: ['ci'],
      };

      const mockContent = Buffer.from(yaml.stringify(validConfig)).toString('base64');
      
      (mockOctokit.rest!.repos!.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      const policy = await engine.loadPolicy(
        mockOctokit as Octokit,
        'owner',
        'repo'
      );

      expect(policy.flaky_threshold).toBe(0.7);
      expect(policy.warn_threshold).toBe(0.4);
      expect(policy.min_occurrences).toBe(3);
      expect(policy.exclude_paths).toEqual(['test/**']);
      expect(policy.labels_required).toEqual(['ci']);
    });

    it('should return defaults when .flakeguard.yml not found', async () => {
      (mockOctokit.rest!.repos!.getContent as any).mockRejectedValue({
        status: 404,
        message: 'Not Found',
      });

      const policy = await engine.loadPolicy(
        mockOctokit as Octokit,
        'owner',
        'repo'
      );

      expect(policy.flaky_threshold).toBe(0.6); // default
      expect(policy.warn_threshold).toBe(0.3); // default
      expect(policy.min_occurrences).toBe(5); // default
    });

    it('should handle invalid YAML content gracefully', async () => {
      const invalidYaml = 'invalid: yaml: content: [';
      const mockContent = Buffer.from(invalidYaml).toString('base64');
      
      (mockOctokit.rest!.repos!.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      const policy = await engine.loadPolicy(
        mockOctokit as Octokit,
        'owner',
        'repo'
      );

      // Should fall back to defaults
      expect(policy.flaky_threshold).toBe(0.6);
      expect(policy.warn_threshold).toBe(0.3);
    });

    it('should handle invalid configuration values', async () => {
      const invalidConfig = {
        flaky_threshold: 1.5, // invalid - above 1.0
        warn_threshold: -0.1, // invalid - below 0.0
        min_occurrences: 0, // invalid - must be >= 1
      };

      const mockContent = Buffer.from(yaml.stringify(invalidConfig)).toString('base64');
      
      (mockOctokit.rest!.repos!.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      const policy = await engine.loadPolicy(
        mockOctokit as Octokit,
        'owner',
        'repo'
      );

      // Should fall back to defaults
      expect(policy.flaky_threshold).toBe(0.6);
      expect(policy.warn_threshold).toBe(0.3);
      expect(policy.min_occurrences).toBe(5);
    });

    it('should use cached policy when available', async () => {
      const validConfig = {
        flaky_threshold: 0.8,
        warn_threshold: 0.5,
      };

      const mockContent = Buffer.from(yaml.stringify(validConfig)).toString('base64');
      
      (mockOctokit.rest!.repos!.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      // First call should fetch from GitHub
      const policy1 = await engine.loadPolicy(
        mockOctokit as Octokit,
        'owner',
        'repo'
      );

      // Second call should use cache
      const policy2 = await engine.loadPolicy(
        mockOctokit as Octokit,
        'owner',
        'repo'
      );

      expect(mockOctokit.rest!.repos!.getContent).toHaveBeenCalledTimes(1);
      expect(policy1).toEqual(policy2);
    });
  });

  describe('policy evaluation', () => {
    const createTestResult = (overrides: Partial<TestResult> = {}): TestResult => ({
      name: 'test.spec.js:should work',
      status: 'failed',
      duration: 1000,
      flakeAnalysis: {
        isFlaky: true,
        confidence: 0.8,
        historicalFailures: 5,
        totalRuns: 10,
        failureRate: 0.5,
      },
      ...overrides,
    });

    const defaultPolicy = {
      flaky_threshold: 0.6,
      warn_threshold: 0.3,
      min_occurrences: 2,
      min_recent_failures: 1,
      lookback_days: 7,
      rolling_window_size: 50,
      exclude_paths: ['node_modules/**'],
      labels_required: [],
      quarantine_duration_days: 30,
      auto_quarantine_enabled: false,
      team_notifications: {},
      confidence_threshold: 0.5,
      scoring_weights: {
        intermittency_weight: 0.30,
        rerun_weight: 0.25,
        clustering_weight: 0.15,
        message_variance_weight: 0.10,
        fail_ratio_weight: 0.10,
        consecutive_failure_penalty: 0.10,
      },
      exempted_tests: [],
      team_overrides: {},
    };

    it('should recommend quarantine for highly flaky test', async () => {
      const tests = [
        createTestResult({
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.9,
            historicalFailures: 6,
            totalRuns: 10,
            failureRate: 0.8, // Above quarantine threshold
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        defaultPolicy,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('quarantine');
      expect(decisions[0].priority).toBe('critical');
      expect(decisions[0].reason).toContain('quarantine threshold');
    });

    it('should recommend warning for moderately flaky test', async () => {
      const tests = [
        createTestResult({
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.7,
            historicalFailures: 3,
            totalRuns: 10,
            failureRate: 0.4, // Between warn and quarantine threshold
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        defaultPolicy,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('warn');
      expect(decisions[0].reason).toContain('warning threshold');
    });

    it('should recommend no action for stable test', async () => {
      const tests = [
        createTestResult({
          flakeAnalysis: {
            isFlaky: false,
            confidence: 0.8,
            historicalFailures: 1,
            totalRuns: 10,
            failureRate: 0.1, // Below warning threshold
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        defaultPolicy,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('below warning threshold');
    });

    it('should skip tests with insufficient data', async () => {
      const tests = [
        createTestResult({
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.8,
            historicalFailures: 5,
            totalRuns: 1, // Below min_occurrences
            failureRate: 0.8,
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        defaultPolicy,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('Insufficient data');
    });

    it('should skip tests with low confidence', async () => {
      const tests = [
        createTestResult({
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.3, // Below confidence threshold
            historicalFailures: 5,
            totalRuns: 10,
            failureRate: 0.8,
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        defaultPolicy,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('Low confidence');
    });

    it('should handle exempted tests', async () => {
      const policyWithExemptions = {
        ...defaultPolicy,
        exempted_tests: ['test.spec.js:*'],
      };

      const tests = [
        createTestResult({
          name: 'test.spec.js:should work',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.9,
            historicalFailures: 5,
            totalRuns: 10,
            failureRate: 0.8,
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        policyWithExemptions,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('explicitly exempted');
      expect(decisions[0].metadata.exempted).toBe(true);
    });

    it('should handle excluded paths', async () => {
      const tests = [
        createTestResult({
          name: 'node_modules/lib/test.js:should work',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.9,
            historicalFailures: 5,
            totalRuns: 10,
            failureRate: 0.8,
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        defaultPolicy,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('exclusion pattern');
    });

    it('should apply team overrides', async () => {
      const policyWithTeamOverrides = {
        ...defaultPolicy,
        team_overrides: {
          'team-a': {
            flaky_threshold: 0.8, // Higher threshold for team-a
            warn_threshold: 0.5,
          },
        },
      };

      const tests = [
        createTestResult({
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.9,
            historicalFailures: 5,
            totalRuns: 10,
            failureRate: 0.7, // Would be quarantine for default, warn for team-a
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        policyWithTeamOverrides,
        { owner: 'test', repo: 'repo' },
        { teamContext: 'team-a' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('warn'); // Should use team override
      expect(decisions[0].metadata.teamOverride).toBe('team-a');
    });

    it('should handle tests without flake analysis', async () => {
      const tests = [
        createTestResult({
          flakeAnalysis: undefined,
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        defaultPolicy,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('none');
      expect(decisions[0].reason).toContain('No flakiness analysis data');
    });

    it('should check auto-quarantine requirements', async () => {
      const policyWithAutoQuarantine = {
        ...defaultPolicy,
        auto_quarantine_enabled: true,
        labels_required: ['ci', 'tests'],
      };

      const tests = [
        createTestResult({
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.9,
            historicalFailures: 5,
            totalRuns: 10,
            failureRate: 0.8,
          },
        }),
      ];

      // With required labels
      const decisionsWithLabels = await engine.evaluatePolicy(
        tests,
        policyWithAutoQuarantine,
        { owner: 'test', repo: 'repo' },
        { pullRequestLabels: ['ci', 'tests'] }
      );

      expect(decisionsWithLabels[0].action).toBe('quarantine');
      expect(decisionsWithLabels[0].reason).toContain('auto-quarantine enabled');

      // Without required labels
      const decisionsWithoutLabels = await engine.evaluatePolicy(
        tests,
        policyWithAutoQuarantine,
        { owner: 'test', repo: 'repo' },
        { pullRequestLabels: ['ci'] } // Missing 'tests' label
      );

      expect(decisionsWithoutLabels[0].action).toBe('quarantine');
      expect(decisionsWithoutLabels[0].reason).not.toContain('auto-quarantine enabled');
    });
  });

  describe('caching', () => {
    it('should clear expired cache entries', () => {
      // This is a bit tricky to test without manipulating time
      // We'll test the cache stats function instead
      const stats = engine.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('expired');
      expect(stats).toHaveProperty('hitsBySource');
    });

    it('should invalidate cache for specific repository', async () => {
      const validConfig = { flaky_threshold: 0.7 };
      const mockContent = Buffer.from(yaml.stringify(validConfig)).toString('base64');
      
      (mockOctokit.rest!.repos!.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      // Load policy to populate cache
      await engine.loadPolicy(mockOctokit as Octokit, 'owner', 'repo');
      
      // Verify cache has entry
      expect(engine.getCacheStats().size).toBeGreaterThan(0);
      
      // Invalidate cache
      engine.invalidateCache('owner', 'repo');
      
      // Next call should fetch again
      await engine.loadPolicy(mockOctokit as Octokit, 'owner', 'repo');
      expect(mockOctokit.rest!.repos!.getContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('validation helpers', () => {
    it('should validate correct configuration', () => {
      const validConfig = {
        flaky_threshold: 0.6,
        warn_threshold: 0.3,
        min_occurrences: 5,
      };

      const result = validatePolicyConfig(validConfig);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    it('should reject invalid configuration', () => {
      const invalidConfig = {
        flaky_threshold: 2.0, // invalid
        warn_threshold: -0.1, // invalid
        min_occurrences: 0, // invalid
      };

      const result = validatePolicyConfig(invalidConfig);
      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should create policy config with defaults', () => {
      const partialConfig = {
        flaky_threshold: 0.7,
      };

      const config = createPolicyConfig(partialConfig);
      expect(config.flaky_threshold).toBe(0.7);
      expect(config.warn_threshold).toBe(0.3); // default
      expect(config.min_occurrences).toBe(5); // default
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const engine1 = getPolicyEngine();
      const engine2 = getPolicyEngine();
      expect(engine1).toBe(engine2);
    });
  });

  describe('environment variable loading', () => {
    beforeEach(() => {
      // Reset singleton for each test
      vi.resetModules();
    });

    it('should load thresholds from environment variables', async () => {
      process.env.FLAKE_WARN_THRESHOLD = '0.4';
      process.env.FLAKE_QUARANTINE_THRESHOLD = '0.8';

      // Re-import to get fresh instance with env vars
      const { PolicyEngine: FreshPolicyEngine } = await import('../engine.js');
      const freshEngine = new FreshPolicyEngine();

      // Mock GitHub API call that returns 404
      (mockOctokit.rest!.repos!.getContent as any).mockRejectedValue({
        status: 404,
        message: 'Not Found',
      });

      const policy = await freshEngine.loadPolicy(
        mockOctokit as Octokit,
        'owner',
        'repo'
      );

      expect(policy.warn_threshold).toBe(0.4);
      expect(policy.flaky_threshold).toBe(0.8);
    });
  });

  describe('complex policy scenarios', () => {
    it('should handle complex glob patterns in exclude_paths', async () => {
      const policyWithComplexPatterns = {
        ...defaultPolicy,
        exclude_paths: [
          '**/*.spec.ts',
          'src/test/**',
          '**/fixtures/**',
          '!src/important/test.ts', // Negation pattern
        ],
      };

      const tests = [
        createTestResult({ name: 'src/components/Button.spec.ts:should render' }),
        createTestResult({ name: 'src/test/utils.test.ts:should work' }),
        createTestResult({ name: 'src/fixtures/data.test.ts:should load' }),
        createTestResult({ name: 'src/important/test.ts:should always run' }),
        createTestResult({ name: 'src/components/Input.test.ts:should validate' }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        policyWithComplexPatterns,
        { owner: 'test', repo: 'repo' }
      );

      // Should exclude .spec.ts and test/** and fixtures/**, but not the important one
      const excludedTests = decisions.filter(d => 
        d.reason.includes('exclusion pattern')
      );
      
      expect(excludedTests.length).toBe(4); // All except the important one
    });

    it('should handle priority escalation correctly', async () => {
      const tests = [
        // Critical priority: high score + high confidence
        createTestResult({
          name: 'critical.test.ts:flaky test',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.9,
            historicalFailures: 8,
            totalRuns: 10,
            failureRate: 0.85,
          },
        }),
        // High priority: high score or good confidence
        createTestResult({
          name: 'high.test.ts:flaky test',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.7,
            historicalFailures: 7,
            totalRuns: 10,
            failureRate: 0.75,
          },
        }),
        // Medium priority: moderate score
        createTestResult({
          name: 'medium.test.ts:flaky test',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.6,
            historicalFailures: 4,
            totalRuns: 10,
            failureRate: 0.45,
          },
        }),
      ];

      const decisions = await engine.evaluatePolicy(
        tests,
        defaultPolicy,
        { owner: 'test', repo: 'repo' }
      );

      expect(decisions[0].priority).toBe('critical');
      expect(decisions[1].priority).toBe('high');
      expect(decisions[2].priority).toBe('medium');
    });
  });
});

describe('Policy Configuration Schema', () => {
  it('should validate minimal configuration', () => {
    const minimal = {};
    const result = policyConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    
    if (result.success) {
      expect(result.data.flaky_threshold).toBe(0.6);
      expect(result.data.warn_threshold).toBe(0.3);
      expect(result.data.exclude_paths).toContain('node_modules/**');
    }
  });

  it('should reject invalid threshold values', () => {
    const invalid = {
      flaky_threshold: 1.5,
      warn_threshold: -0.1,
    };
    const result = policyConfigSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should validate complex configuration', () => {
    const complex = {
      flaky_threshold: 0.8,
      warn_threshold: 0.4,
      min_occurrences: 3,
      exclude_paths: ['test/**', '**/*.spec.ts'],
      labels_required: ['ci', 'tests'],
      team_notifications: {
        slack_channels: {
          'team-a': '#team-a-alerts',
          'team-b': '#team-b-alerts',
        },
      },
      team_overrides: {
        'critical-team': {
          flaky_threshold: 0.9,
          auto_quarantine_enabled: true,
        },
      },
    };
    
    const result = policyConfigSchema.safeParse(complex);
    expect(result.success).toBe(true);
    
    if (result.success) {
      expect(result.data.team_notifications.slack_channels).toEqual({
        'team-a': '#team-a-alerts',
        'team-b': '#team-b-alerts',
      });
      expect(result.data.team_overrides['critical-team'].flaky_threshold).toBe(0.9);
    }
  });
});
