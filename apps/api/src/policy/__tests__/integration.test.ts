/**
 * Policy Integration Tests
 * 
 * Integration tests covering policy engine with GitHub Contents API,
 * caching, and real-world scenarios.
 */

import type { TestResult } from '@flakeguard/shared';
import { Octokit } from '@octokit/rest';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import yaml from 'yaml';

import { GitHubAuthManager } from '../../github/auth.js';
import { PolicyEngine } from '../engine.js';
import { PolicyService, createPolicyService } from '../service.js';


// Mock dependencies
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../config/index.js', () => ({
  config: {
    policy: {
      warnThreshold: 0.3,
      quarantineThreshold: 0.6,
    },
  },
}));

describe('Policy Integration Tests', () => {
  let service: PolicyService;
  let mockAuthManager: Partial<GitHubAuthManager>;
  let mockOctokit: Partial<Octokit>;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(),
        } as any,
      } as any,
    };

    mockAuthManager = {
      getInstallationClient: vi.fn().mockResolvedValue(mockOctokit),
      validateInstallationAccess: vi.fn().mockResolvedValue(true),
    };

    service = createPolicyService(mockAuthManager as GitHubAuthManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('end-to-end policy evaluation', () => {
    it('should evaluate policy from GitHub repository with real configuration', async () => {
      const repoPolicy = {
        flaky_threshold: 0.7,
        warn_threshold: 0.4,
        min_occurrences: 3,
        exclude_paths: ['**/*.integration.test.ts'],
        team_overrides: {
          'frontend': {
            flaky_threshold: 0.8,
          },
        },
      };

      const mockContent = Buffer.from(yaml.stringify(repoPolicy)).toString('base64');
      
      (mockOctokit.rest!.repos.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      const testResults: TestResult[] = [
        {
          name: 'frontend/Button.test.tsx:should render correctly',
          status: 'failed',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.9,
            historicalFailures: 7,
            totalRuns: 10,
            failureRate: 0.75, // Above team threshold (0.8) but below global (0.7)
          },
        },
        {
          name: 'backend/api.integration.test.ts:should connect to database',
          status: 'failed',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.85,
            historicalFailures: 6,
            totalRuns: 10,
            failureRate: 0.75, // Should be excluded by path pattern
          },
        },
      ];

      const result = await service.evaluatePolicy(
        {
          owner: 'testorg',
          repo: 'testrepo',
          tests: testResults,
          options: {
            teamContext: 'frontend',
          },
        },
        12345
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.decisions).toHaveLength(2);
      
      // First test should get warning (below team threshold)
      expect(result.data!.decisions[0].action).toBe('warn');
      expect(result.data!.decisions[0].metadata.teamOverride).toBe('frontend');
      
      // Second test should be excluded
      expect(result.data!.decisions[1].action).toBe('none');
      expect(result.data!.decisions[1].reason).toContain('exclusion pattern');
    });

    it('should handle GitHub API failures gracefully', async () => {
      (mockOctokit.rest!.repos.getContent as any).mockRejectedValue({
        status: 403,
        message: 'API rate limit exceeded',
      });

      const testResults: TestResult[] = [
        {
          name: 'test.js:should work',
          status: 'failed',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.8,
            historicalFailures: 5,
            totalRuns: 8,
            failureRate: 0.7,
          },
        },
      ];

      const result = await service.evaluatePolicy(
        {
          owner: 'testorg',
          repo: 'testrepo',
          tests: testResults,
        },
        12345
      );

      // Should fall back to defaults and still work
      expect(result.success).toBe(true);
      expect(result.data!.decisions[0].action).toBe('quarantine');
    });

    it('should handle repository access denied', async () => {
      (mockAuthManager.validateInstallationAccess as any).mockResolvedValue(false);

      const result = await service.evaluatePolicy(
        {
          owner: 'testorg',
          repo: 'privaterepo',
          tests: [],
        },
        12345
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FORBIDDEN');
      expect(result.error?.message).toContain('does not have access');
    });
  });

  describe('policy caching', () => {
    it('should cache and reuse policy configurations', async () => {
      const repoPolicy = { flaky_threshold: 0.8 };
      const mockContent = Buffer.from(yaml.stringify(repoPolicy)).toString('base64');
      
      (mockOctokit.rest!.repos.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      // Load policy twice
      await service.loadPolicy({ owner: 'org', repo: 'repo' }, 12345);
      await service.loadPolicy({ owner: 'org', repo: 'repo' }, 12345);

      // Should only call GitHub API once due to caching
      expect(mockOctokit.rest!.repos.getContent).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache when requested', async () => {
      const repoPolicy = { flaky_threshold: 0.8 };
      const mockContent = Buffer.from(yaml.stringify(repoPolicy)).toString('base64');
      
      (mockOctokit.rest!.repos.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      // Load policy
      await service.loadPolicy({ owner: 'org', repo: 'repo' }, 12345);
      
      // Invalidate cache
      await service.invalidatePolicyCache('org', 'repo');
      
      // Load again - should call API again
      await service.loadPolicy({ owner: 'org', repo: 'repo' }, 12345);

      expect(mockOctokit.rest!.repos.getContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('complex scenarios', () => {
    it('should handle large policy configurations correctly', async () => {
      const complexPolicy = {
        flaky_threshold: 0.6,
        warn_threshold: 0.3,
        min_occurrences: 5,
        exclude_paths: [
          'node_modules/**',
          'dist/**',
          'build/**',
          '**/*.spec.ts',
          '**/*.test.ts',
          'test/**',
          'tests/**',
          'e2e/**',
          'integration/**',
          'fixtures/**',
          'mocks/**',
        ],
        labels_required: ['ci', 'tests', 'ready'],
        team_overrides: {
          'platform': { flaky_threshold: 0.9 },
          'frontend': { flaky_threshold: 0.7, warn_threshold: 0.4 },
          'backend': { flaky_threshold: 0.8, warn_threshold: 0.5 },
          'mobile': { flaky_threshold: 0.6, warn_threshold: 0.3 },
          'qa': { flaky_threshold: 0.5, warn_threshold: 0.2 },
        },
        exempted_tests: [
          '**/*smoke*',
          '**/*critical*',
          'platform/**/*auth*',
          'security/**',
        ],
        team_notifications: {
          slack_channels: {
            'platform': '#platform-alerts',
            'frontend': '#frontend-flaky',
            'backend': '#backend-quality',
            'mobile': '#mobile-ci',
            'qa': '#qa-triage',
          },
        },
      };

      const mockContent = Buffer.from(yaml.stringify(complexPolicy)).toString('base64');
      
      (mockOctokit.rest!.repos.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      const testResults: TestResult[] = [
        {
          name: 'platform/auth/oauth.test.ts:should authenticate',
          status: 'failed',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.95,
            historicalFailures: 8,
            totalRuns: 10,
            failureRate: 0.95, // Very flaky but should be exempted
          },
        },
        {
          name: 'frontend/components/Modal.test.tsx:should open',
          status: 'failed',
          flakeAnalysis: {
            isFlaky: true,
            confidence: 0.8,
            historicalFailures: 6,
            totalRuns: 10,
            failureRate: 0.75, // Above frontend team threshold
          },
        },
      ];

      const result = await service.evaluatePolicy(
        {
          owner: 'enterprise',
          repo: 'monorepo',
          tests: testResults,
          options: {
            teamContext: 'platform',
            pullRequestLabels: ['ci', 'tests', 'ready'],
          },
        },
        12345
      );

      expect(result.success).toBe(true);
      expect(result.data!.decisions).toHaveLength(2);
      
      // Platform auth test should be exempted despite high flakiness
      expect(result.data!.decisions[0].action).toBe('none');
      expect(result.data!.decisions[0].reason).toContain('exempted');
      
      // Frontend test should be quarantined (0.75 > 0.7 team threshold)
      expect(result.data!.decisions[1].action).toBe('quarantine');
      expect(result.data!.decisions[1].metadata.teamOverride).toBe('platform'); // Using platform context
    });

    it('should handle malformed YAML gracefully', async () => {
      const malformedYaml = `
flaky_threshold: 0.6
warn_threshold: 0.3
exclude_paths:
  - "test/**
  - "spec/**"  # Missing closing quote
labels_required:
  - ci
  - tests
    - nested_invalid  # Invalid nesting
`;

      const mockContent = Buffer.from(malformedYaml).toString('base64');
      
      (mockOctokit.rest!.repos.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      const result = await service.loadPolicy(
        { owner: 'org', repo: 'repo' },
        12345
      );

      expect(result.success).toBe(true);
      // Should fall back to defaults
      expect(result.data!.config.flaky_threshold).toBe(0.6); // default
      expect(result.data!.source).toBe('file'); // Should indicate attempted to load from file
    });
  });

  describe('performance and reliability', () => {
    it('should handle concurrent policy loads efficiently', async () => {
      const repoPolicy = { flaky_threshold: 0.8 };
      const mockContent = Buffer.from(yaml.stringify(repoPolicy)).toString('base64');
      
      (mockOctokit.rest!.repos.getContent as any).mockResolvedValue({
        data: {
          type: 'file',
          content: mockContent,
          sha: 'abc123',
        },
      });

      // Load policy concurrently multiple times
      const promises = Array(5).fill(null).map(() => 
        service.loadPolicy({ owner: 'org', repo: 'repo' }, 12345)
      );

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every(r => r.success)).toBe(true);
      
      // Should cache and avoid multiple API calls
      expect(mockOctokit.rest!.repos.getContent).toHaveBeenCalledTimes(1);
    });

    it('should provide meaningful stats', () => {
      const stats = service.getPolicyStats();
      
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('expired');
      expect(stats).toHaveProperty('hitsBySource');
      expect(typeof stats.size).toBe('number');
      expect(typeof stats.expired).toBe('number');
    });
  });
});
