import { describe, it, expect, beforeEach } from 'vitest';
import { FlakinessScorer } from '../flakiness.js';
import type { TestRun, QuarantinePolicy } from '@flakeguard/shared';

describe('FlakinessScorer', () => {
  let scorer: FlakinessScorer;

  beforeEach(() => {
    scorer = new FlakinessScorer();
  });

  describe('computeFlakeScore', () => {
    it('should throw error for empty runs array', () => {
      expect(() => scorer.computeFlakeScore([])).toThrow('Cannot compute flake score with no test runs');
    });

    it('should assign zero score for stable test (all passing)', () => {
      const runs = createStableTestRuns(20);
      const score = scorer.computeFlakeScore(runs);
      
      expect(score.score).toBe(0);
      expect(score.recommendation.action).toBe('none');
      expect(score.features.failSuccessRatio).toBe(0);
      expect(score.features.intermittencyScore).toBe(0);
    });

    it('should assign low score for consistently failing test (broken, not flaky)', () => {
      const runs = createConsistentlyFailingRuns(20);
      const score = scorer.computeFlakeScore(runs);
      
      // Broken tests should have lower flakiness scores than intermittent ones
      expect(score.score).toBeLessThan(0.4);
      expect(score.features.failSuccessRatio).toBe(1.0);
      expect(score.features.intermittencyScore).toBe(0);
      expect(score.features.rerunPassRate).toBe(0);
    });

    it('should assign high score for intermittent flaky test', () => {
      const runs = createIntermittentTestRuns(20);
      const score = scorer.computeFlakeScore(runs);
      
      expect(score.score).toBeGreaterThan(0.3);
      expect(score.features.intermittencyScore).toBeGreaterThan(0.4);
      expect(score.features.failSuccessRatio).toBeLessThan(1.0);
      expect(score.features.failSuccessRatio).toBeGreaterThan(0);
    });

    it('should assign very high score for retry-passing flaky test', () => {
      const runs = createRetryPassingFlaky(15);
      const score = scorer.computeFlakeScore(runs);
      
      expect(score.score).toBeGreaterThan(0.5);
      expect(score.features.rerunPassRate).toBeGreaterThan(0.3);
      expect(score.recommendation.action).toBe('quarantine');
    });

    it('should be deterministic for same input', () => {
      const runs = createIntermittentTestRuns(10);
      const score1 = scorer.computeFlakeScore(runs);
      const score2 = scorer.computeFlakeScore(runs);
      
      expect(score1.score).toBe(score2.score);
      expect(score1.features).toEqual(score2.features);
      expect(score1.recommendation).toEqual(score2.recommendation);
    });

    it('should handle mixed status results correctly', () => {
      const runs = createMixedStatusRuns(15);
      const score = scorer.computeFlakeScore(runs);
      
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(1);
      expect(score.features.totalRuns).toBe(15);
    });
  });

  describe('rolling window algorithm', () => {
    it('should use only recent runs when more than window size available', () => {
      const policy: QuarantinePolicy = {
        warnThreshold: 0.3,
        quarantineThreshold: 0.6,
        minRunsForQuarantine: 5,
        minRecentFailures: 2,
        lookbackDays: 7,
        rollingWindowSize: 10,
      };
      
      const scorerWithSmallWindow = new FlakinessScorer(policy);
      
      // Create 20 old stable runs + 10 recent flaky runs
      const oldStableRuns = createStableTestRunsWithDate(20, new Date('2024-01-01'));
      const recentFlakyRuns = createIntermittentTestRunsWithDate(10, new Date('2024-02-01'));
      const allRuns = [...oldStableRuns, ...recentFlakyRuns];
      
      const score = scorerWithSmallWindow.computeFlakeScore(allRuns);
      
      // Should focus on recent flaky behavior, not old stable behavior
      expect(score.score).toBeGreaterThan(0.2);
      expect(score.features.totalRuns).toBe(10); // Only recent runs in window
    });

    it('should handle window size larger than available runs', () => {
      const runs = createIntermittentTestRuns(5);
      const score = scorer.computeFlakeScore(runs);
      
      expect(score.features.totalRuns).toBe(5);
      expect(score.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('feature extraction', () => {
    describe('rerun pass rate', () => {
      it('should calculate rerun pass rate correctly', () => {
        const runs: TestRun[] = [
          createTestRun('test1', 'failed', 1, 'run1'),
          createTestRun('test1', 'passed', 2, 'run1'), // retry passes
          createTestRun('test1', 'failed', 1, 'run2'),
          createTestRun('test1', 'failed', 2, 'run2'), // retry fails
        ];
        
        const score = scorer.computeFlakeScore(runs);
        expect(score.features.rerunPassRate).toBe(0.5); // 1 out of 2 retries passed
      });

      it('should handle no retries', () => {
        const runs = createStableTestRuns(5);
        const score = scorer.computeFlakeScore(runs);
        expect(score.features.rerunPassRate).toBe(0);
      });
    });

    describe('intermittency score', () => {
      it('should detect alternating pass/fail patterns', () => {
        const runs: TestRun[] = [
          createTestRunWithDate('test1', 'passed', new Date('2024-01-01')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-02')),
          createTestRunWithDate('test1', 'passed', new Date('2024-01-03')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-04')),
        ];
        
        const score = scorer.computeFlakeScore(runs);
        expect(score.features.intermittencyScore).toBe(1.0); // Perfect alternation
      });

      it('should ignore skipped tests in intermittency calculation', () => {
        const runs: TestRun[] = [
          createTestRunWithDate('test1', 'passed', new Date('2024-01-01')),
          createTestRunWithDate('test1', 'skipped', new Date('2024-01-02')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-03')),
          createTestRunWithDate('test1', 'skipped', new Date('2024-01-04')),
          createTestRunWithDate('test1', 'passed', new Date('2024-01-05')),
        ];
        
        const score = scorer.computeFlakeScore(runs);
        expect(score.features.intermittencyScore).toBe(1.0); // passed -> failed -> passed
      });
    });

    describe('consecutive failures analysis', () => {
      it('should identify consecutive failures at end', () => {
        const runs: TestRun[] = [
          createTestRunWithDate('test1', 'passed', new Date('2024-01-01')),
          createTestRunWithDate('test1', 'passed', new Date('2024-01-02')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-03')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-04')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-05')),
        ];
        
        const score = scorer.computeFlakeScore(runs);
        expect(score.features.consecutiveFailures).toBe(3);
        expect(score.features.maxConsecutiveFailures).toBe(3);
      });

      it('should track maximum consecutive failures', () => {
        const runs: TestRun[] = [
          createTestRunWithDate('test1', 'failed', new Date('2024-01-01')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-02')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-03')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-04')),
          createTestRunWithDate('test1', 'passed', new Date('2024-01-05')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-06')),
          createTestRunWithDate('test1', 'failed', new Date('2024-01-07')),
        ];
        
        const score = scorer.computeFlakeScore(runs);
        expect(score.features.consecutiveFailures).toBe(2); // At end
        expect(score.features.maxConsecutiveFailures).toBe(4); // Maximum ever
      });
    });
  });

  describe('message normalization', () => {
    it('should normalize timestamps', () => {
      const message1 = 'Test failed at 2024-01-15T10:30:45.123Z with timeout';
      const message2 = 'Test failed at 2024-02-20T15:45:30.456Z with timeout';
      
      const normalized1 = scorer.normalizeMessage(message1);
      const normalized2 = scorer.normalizeMessage(message2);
      
      expect(normalized1).toBe(normalized2);
      expect(normalized1).toContain('[TIMESTAMP]');
    });

    it('should normalize file paths', () => {
      const message1 = 'Error in /home/user/project/test/file.ts:45';
      const message2 = 'Error in /Users/dev/myproject/spec/other.ts:123';
      
      const normalized1 = scorer.normalizeMessage(message1);
      const normalized2 = scorer.normalizeMessage(message2);
      
      expect(normalized1).toBe(normalized2);
      expect(normalized1).toContain('[FILE:LINE]');
    });

    it('should normalize memory addresses and hex values', () => {
      const message1 = 'Memory error at 0x7fff5fbff8a0';
      const message2 = 'Memory error at 0x1234567890ab';
      
      const normalized1 = scorer.normalizeMessage(message1);
      const normalized2 = scorer.normalizeMessage(message2);
      
      expect(normalized1).toBe(normalized2);
      expect(normalized1).toContain('[HEX]');
    });

    it('should normalize timeout values', () => {
      const message1 = 'Connection timeout after 5000ms';
      const message2 = 'Connection timeout after 3000ms';
      
      const normalized1 = scorer.normalizeMessage(message1);
      const normalized2 = scorer.normalizeMessage(message2);
      
      expect(normalized1).toBe(normalized2);
      expect(normalized1).toContain('timeout [NUM]');
    });

    it('should normalize assertion values', () => {
      const message1 = 'AssertionError: expected: 42, actual: 13';
      const message2 = 'AssertionError: expected: 100, actual: 99';
      
      const normalized1 = scorer.normalizeMessage(message1);
      const normalized2 = scorer.normalizeMessage(message2);
      
      expect(normalized1).toBe(normalized2);
      expect(normalized1).toContain('expected: [VALUE]');
      expect(normalized1).toContain('actual: [VALUE]');
    });
  });

  describe('threshold behavior', () => {
    it('should respect custom policy thresholds', () => {
      const customPolicy: QuarantinePolicy = {
        warnThreshold: 0.1,
        quarantineThreshold: 0.2,
        minRunsForQuarantine: 3,
        minRecentFailures: 1,
        lookbackDays: 7,
        rollingWindowSize: 50,
      };
      
      const customScorer = new FlakinessScorer(customPolicy);
      const runs = createMildlyFlakyRuns(10);
      const score = customScorer.computeFlakeScore(runs);
      
      if (score.score >= 0.2) {
        expect(score.recommendation.action).toBe('quarantine');
      } else if (score.score >= 0.1) {
        expect(score.recommendation.action).toBe('warn');
      } else {
        expect(score.recommendation.action).toBe('none');
      }
    });

    it('should require minimum runs for quarantine eligibility', () => {
      const policy: QuarantinePolicy = {
        warnThreshold: 0.1,
        quarantineThreshold: 0.2,
        minRunsForQuarantine: 10,
        minRecentFailures: 2,
        lookbackDays: 7,
        rollingWindowSize: 50,
      };
      
      const strictScorer = new FlakinessScorer(policy);
      const runs = createIntermittentTestRuns(5); // Below minimum
      const score = strictScorer.computeFlakeScore(runs);
      
      expect(score.recommendation.action).toBe('none');
      expect(score.recommendation.reason).toContain('Insufficient data');
    });

    it('should require minimum recent failures', () => {
      const policy: QuarantinePolicy = {
        warnThreshold: 0.1,
        quarantineThreshold: 0.2,
        minRunsForQuarantine: 5,
        minRecentFailures: 3,
        lookbackDays: 7,
        rollingWindowSize: 50,
      };
      
      const strictScorer = new FlakinessScorer(policy);
      // Create runs with failures, but not recent enough
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const runs = createIntermittentTestRunsWithDate(10, oldDate);
      const score = strictScorer.computeFlakeScore(runs);
      
      expect(score.recommendation.action).toBe('none');
      expect(score.recommendation.reason).toContain('Too few recent failures');
    });
  });

  describe('edge cases', () => {
    it('should handle new test with single run', () => {
      const runs = [createTestRun('new_test', 'passed', 1, 'run1')];
      const score = scorer.computeFlakeScore(runs);
      
      expect(score.score).toBe(0);
      expect(score.confidence).toBeLessThan(0.5); // Low confidence for new test
      expect(score.recommendation.action).toBe('none');
    });

    it('should handle test with only skipped runs', () => {
      const runs = [
        createTestRun('skipped_test', 'skipped', 1, 'run1'),
        createTestRun('skipped_test', 'skipped', 1, 'run2'),
        createTestRun('skipped_test', 'skipped', 1, 'run3'),
      ];
      
      const score = scorer.computeFlakeScore(runs);
      expect(score.score).toBe(0);
      expect(score.features.failSuccessRatio).toBe(0);
    });

    it('should handle sparse data over long time period', () => {
      const runs: TestRun[] = [
        createTestRunWithDate('sparse_test', 'passed', new Date('2024-01-01')),
        createTestRunWithDate('sparse_test', 'failed', new Date('2024-01-15')),
        createTestRunWithDate('sparse_test', 'passed', new Date('2024-02-01')),
      ];
      
      const score = scorer.computeFlakeScore(runs);
      expect(score.features.daysSinceFirstSeen).toBeGreaterThan(15);
      expect(score.features.avgTimeBetweenFailures).toBeGreaterThan(0);
    });

    it('should handle tests with varying message formats', () => {
      const runs: TestRun[] = [
        createTestRunWithMessage('varying_test', 'failed', 'Timeout after 5000ms'),
        createTestRunWithMessage('varying_test', 'failed', 'Connection refused on port 8080'),
        createTestRunWithMessage('varying_test', 'failed', 'AssertionError: expected true, got false'),
        createTestRunWithMessage('varying_test', 'passed', ''),
      ];
      
      const score = scorer.computeFlakeScore(runs);
      expect(score.features.messageSignatureVariance).toBeGreaterThan(0.5);
    });
  });

  describe('stability metrics', () => {
    it('should build comprehensive stability metrics', () => {
      const runs = createMixedStatusRuns(20);
      const metrics = scorer.buildStabilityMetrics('test1', 'com.example.Test1', 'repo1', runs);
      
      expect(metrics.testName).toBe('test1');
      expect(metrics.testFullName).toBe('com.example.Test1');
      expect(metrics.repositoryId).toBe('repo1');
      expect(metrics.totalRuns).toBe(20);
      expect(metrics.successfulRuns).toBeGreaterThanOrEqual(0);
      expect(metrics.failedRuns).toBeGreaterThanOrEqual(0);
      expect(metrics.firstSeen).toBeInstanceOf(Date);
      expect(metrics.lastSeen).toBeInstanceOf(Date);
      expect(metrics.avgDuration).toBeGreaterThan(0);
    });

    it('should identify failure clusters', () => {
      // Create clustered failures
      const baseDate = new Date('2024-01-01T10:00:00Z');
      const runs: TestRun[] = [
        createTestRunWithDate('test1', 'passed', baseDate),
        // First cluster
        createTestRunWithDate('test1', 'failed', new Date(baseDate.getTime() + 60 * 1000)), // +1 min
        createTestRunWithDate('test1', 'failed', new Date(baseDate.getTime() + 90 * 1000)), // +1.5 min
        createTestRunWithDate('test1', 'failed', new Date(baseDate.getTime() + 120 * 1000)), // +2 min
        // Gap
        createTestRunWithDate('test1', 'passed', new Date(baseDate.getTime() + 24 * 60 * 60 * 1000)), // +1 day
        // Second cluster  
        createTestRunWithDate('test1', 'failed', new Date(baseDate.getTime() + 25 * 60 * 60 * 1000)), // +25 hours
        createTestRunWithDate('test1', 'failed', new Date(baseDate.getTime() + 25.5 * 60 * 60 * 1000)), // +25.5 hours
      ];
      
      const metrics = scorer.buildStabilityMetrics('test1', 'com.example.Test1', 'repo1', runs);
      expect(metrics.failureClusters.length).toBeGreaterThan(0);
    });

    it('should categorize failure messages', () => {
      const runs: TestRun[] = [
        createTestRunWithMessage('test1', 'failed', 'Connection timeout after 5000ms'),
        createTestRunWithMessage('test1', 'failed', 'AssertionError: expected 1, got 0'),
        createTestRunWithMessage('test1', 'failed', 'Out of memory error'),
        createTestRunWithMessage('test1', 'failed', 'Socket connection refused'),
      ];
      
      const metrics = scorer.buildStabilityMetrics('test1', 'com.example.Test1', 'repo1', runs);
      expect(metrics.failureMessages).toHaveLength(4);
      
      const categories = metrics.failureMessages.map(m => m.category);
      expect(categories).toContain('timeout');
      expect(categories).toContain('assertion');
      expect(categories).toContain('resource');
      expect(categories).toContain('connection');
    });
  });
});

// Helper functions for creating test data

function createTestRun(name: string, status: TestRun['status'], attempt: number = 1, runId: string = 'run1'): TestRun {
  return {
    testName: name,
    testFullName: `com.example.${name}`,
    status,
    duration: Math.random() * 1000,
    attempt,
    runId,
    createdAt: new Date(),
  };
}

function createTestRunWithDate(name: string, status: TestRun['status'], date: Date): TestRun {
  return {
    testName: name,
    testFullName: `com.example.${name}`,
    status,
    duration: Math.random() * 1000,
    attempt: 1,
    runId: `run_${date.getTime()}`,
    createdAt: date,
  };
}

function createTestRunWithMessage(name: string, status: TestRun['status'], message: string): TestRun {
  return {
    testName: name,
    testFullName: `com.example.${name}`,
    status,
    message: message || undefined,
    duration: Math.random() * 1000,
    attempt: 1,
    runId: `run_${Math.random()}`,
    createdAt: new Date(),
  };
}

function createStableTestRuns(count: number): TestRun[] {
  const runs: TestRun[] = [];
  for (let i = 0; i < count; i++) {
    runs.push(createTestRun('stable_test', 'passed', 1, `run${i}`));
  }
  return runs;
}

function createStableTestRunsWithDate(count: number, baseDate: Date): TestRun[] {
  const runs: TestRun[] = [];
  for (let i = 0; i < count; i++) {
    const runDate = new Date(baseDate.getTime() + i * 60 * 60 * 1000); // 1 hour apart
    runs.push(createTestRunWithDate('stable_test', 'passed', runDate));
  }
  return runs;
}

function createConsistentlyFailingRuns(count: number): TestRun[] {
  const runs: TestRun[] = [];
  for (let i = 0; i < count; i++) {
    runs.push(createTestRun('broken_test', 'failed', 1, `run${i}`));
  }
  return runs;
}

function createIntermittentTestRuns(count: number): TestRun[] {
  const runs: TestRun[] = [];
  for (let i = 0; i < count; i++) {
    const status = i % 2 === 0 ? 'passed' : 'failed';
    runs.push(createTestRun('flaky_test', status, 1, `run${i}`));
  }
  return runs;
}

function createIntermittentTestRunsWithDate(count: number, baseDate: Date): TestRun[] {
  const runs: TestRun[] = [];
  for (let i = 0; i < count; i++) {
    const status = i % 2 === 0 ? 'passed' : 'failed';
    const runDate = new Date(baseDate.getTime() + i * 60 * 60 * 1000);
    runs.push(createTestRunWithDate('flaky_test', status, runDate));
  }
  return runs;
}

function createRetryPassingFlaky(count: number): TestRun[] {
  const runs: TestRun[] = [];
  let runId = 1;
  
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) {
      // Initial failure
      runs.push(createTestRun('retry_flaky', 'failed', 1, `run${runId}`));
      // Successful retry
      runs.push(createTestRun('retry_flaky', 'passed', 2, `run${runId}`));
      runId++;
    } else {
      // Regular passing run
      runs.push(createTestRun('retry_flaky', 'passed', 1, `run${runId}`));
      runId++;
    }
  }
  
  return runs;
}

function createMildlyFlakyRuns(count: number): TestRun[] {
  const runs: TestRun[] = [];
  for (let i = 0; i < count; i++) {
    // 70% pass, 30% fail
    const status = i % 10 < 7 ? 'passed' : 'failed';
    runs.push(createTestRun('mildly_flaky', status, 1, `run${i}`));
  }
  return runs;
}

function createMixedStatusRuns(count: number): TestRun[] {
  const runs: TestRun[] = [];
  const statuses: TestRun['status'][] = ['passed', 'failed', 'skipped', 'error'];
  
  for (let i = 0; i < count; i++) {
    const status = statuses[i % statuses.length];
    runs.push(createTestRun('mixed_test', status, 1, `run${i}`));
  }
  return runs;
}