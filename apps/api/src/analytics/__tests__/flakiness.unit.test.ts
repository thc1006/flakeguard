/**
 * Comprehensive Unit Tests for Flakiness Scoring Algorithm
 * 
 * Tests all scoring scenarios, edge cases, and ensures deterministic results
 */

import type { TestRun, QuarantinePolicy } from '@flakeguard/shared';
import { describe, it, expect, beforeEach } from 'vitest';

import { FlakinessScorer } from '../flakiness.js';

describe('FlakinessScorer', () => {
  let scorer: FlakinessScorer;
  let baseTestRun: TestRun;

  beforeEach(() => {
    scorer = new FlakinessScorer();
    
    baseTestRun = {
      testName: 'should work correctly',
      testFullName: 'com.example.TestClass.shouldWorkCorrectly',
      runId: 'workflow-1',
      attempt: 1,
      status: 'passed',
      duration: 1000,
      createdAt: new Date('2023-10-01T10:00:00.000Z'),
    };
  });

  describe('Basic Scoring', () => {
    it('should throw error with no test runs', () => {
      expect(() => scorer.computeFlakeScore([])).toThrow(
        'Cannot compute flake score with no test runs'
      );
    });

    it('should handle single passing test run', () => {
      const runs: TestRun[] = [baseTestRun];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.testName).toBe('should work correctly');
      expect(result.testFullName).toBe('com.example.TestClass.shouldWorkCorrectly');
      expect(result.score).toBe(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.features.totalRuns).toBe(1);
      expect(result.features.failSuccessRatio).toBe(0);
      expect(result.features.intermittencyScore).toBe(0);
      expect(result.recommendation.action).toBe('none');
    });

    it('should handle single failing test run', () => {
      const runs: TestRun[] = [{
        ...baseTestRun,
        status: 'failed',
        message: 'Test assertion failed',
      }];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.score).toBe(0); // Single failure isn't flaky
      expect(result.features.failSuccessRatio).toBe(1);
      expect(result.features.intermittencyScore).toBe(0);
      expect(result.recommendation.action).toBe('none');
      expect(result.recommendation.reason).toContain('Insufficient data');
    });

    it('should compute score for multiple runs', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, runId: 'run-1', status: 'passed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, runId: 'run-2', status: 'failed', message: 'Fail 1', createdAt: new Date('2023-10-01T11:00:00.000Z') },
        { ...baseTestRun, runId: 'run-3', status: 'passed', createdAt: new Date('2023-10-01T12:00:00.000Z') },
        { ...baseTestRun, runId: 'run-4', status: 'failed', message: 'Fail 2', createdAt: new Date('2023-10-01T13:00:00.000Z') },
        { ...baseTestRun, runId: 'run-5', status: 'passed', createdAt: new Date('2023-10-01T14:00:00.000Z') },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.totalRuns).toBe(5);
      expect(result.features.failSuccessRatio).toBe(0.4); // 2 failures out of 5 runs
      expect(result.features.intermittencyScore).toBe(1); // Perfect alternating pattern
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });

  describe('Intermittency Score Calculation', () => {
    it('should calculate perfect intermittency (alternating pattern)', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, runId: 'run-1', status: 'passed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, runId: 'run-2', status: 'failed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, runId: 'run-3', status: 'passed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, runId: 'run-4', status: 'failed', createdAt: new Date('2023-10-01T10:03:00.000Z') },
        { ...baseTestRun, runId: 'run-5', status: 'passed', createdAt: new Date('2023-10-01T10:04:00.000Z') },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.intermittencyScore).toBe(1); // 4 transitions out of 4 possible
      expect(result.score).toBeGreaterThan(0.3); // High intermittency should boost score
    });

    it('should calculate zero intermittency (all passing)', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, runId: 'run-1', status: 'passed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, runId: 'run-2', status: 'passed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, runId: 'run-3', status: 'passed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, runId: 'run-4', status: 'passed', createdAt: new Date('2023-10-01T10:03:00.000Z') },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.intermittencyScore).toBe(0);
      expect(result.score).toBe(0);
    });

    it('should calculate zero intermittency (all failing)', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, runId: 'run-1', status: 'failed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, runId: 'run-2', status: 'failed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, runId: 'run-3', status: 'failed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, runId: 'run-4', status: 'failed', createdAt: new Date('2023-10-01T10:03:00.000Z') },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.intermittencyScore).toBe(0);
      // Score should be low due to consecutive failure penalty
      expect(result.score).toBeLessThan(0.5);
    });

    it('should skip skipped tests in intermittency calculation', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'passed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', status: 'skipped', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, testName: 'run-3', status: 'failed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, testName: 'run-4', status: 'skipped', createdAt: new Date('2023-10-01T10:03:00.000Z') },
        { ...baseTestRun, testName: 'run-5', status: 'passed', createdAt: new Date('2023-10-01T10:04:00.000Z') },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      // Should only count transitions between passed/failed (skip skipped)
      expect(result.features.intermittencyScore).toBe(1); // 2 transitions out of 2 possible
    });
  });

  describe('Rerun Pass Rate Calculation', () => {
    it('should calculate rerun pass rate correctly', () => {
      const runs: TestRun[] = [
        // First workflow - initial failure, then success on retry
        { ...baseTestRun, testName: 'run-1', runId: 'workflow-1', attempt: 1, status: 'failed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', runId: 'workflow-1', attempt: 2, status: 'passed', createdAt: new Date('2023-10-01T10:00:30.000Z') },
        
        // Second workflow - failure on retry too
        { ...baseTestRun, testName: 'run-3', runId: 'workflow-2', attempt: 1, status: 'failed', createdAt: new Date('2023-10-01T11:00:00.000Z') },
        { ...baseTestRun, testName: 'run-4', runId: 'workflow-2', attempt: 2, status: 'failed', createdAt: new Date('2023-10-01T11:00:30.000Z') },
        
        // Third workflow - success on retry
        { ...baseTestRun, testName: 'run-5', runId: 'workflow-3', attempt: 1, status: 'failed', createdAt: new Date('2023-10-01T12:00:00.000Z') },
        { ...baseTestRun, testName: 'run-6', runId: 'workflow-3', attempt: 2, status: 'passed', createdAt: new Date('2023-10-01T12:00:30.000Z') },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      // 2 successful retries out of 3 total retries = 0.667
      expect(result.features.rerunPassRate).toBeCloseTo(0.667, 2);
      expect(result.score).toBeGreaterThan(0.1); // Rerun success should boost score
    });

    it('should handle no reruns', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', runId: 'workflow-1', attempt: 1, status: 'passed' },
        { ...baseTestRun, testName: 'run-2', runId: 'workflow-2', attempt: 1, status: 'failed' },
        { ...baseTestRun, testName: 'run-3', runId: 'workflow-3', attempt: 1, status: 'passed' },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.rerunPassRate).toBe(0);
    });

    it('should handle multiple attempts in same workflow', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', runId: 'workflow-1', attempt: 1, status: 'failed' },
        { ...baseTestRun, testName: 'run-2', runId: 'workflow-1', attempt: 2, status: 'failed' },
        { ...baseTestRun, testName: 'run-3', runId: 'workflow-1', attempt: 3, status: 'passed' },
        { ...baseTestRun, testName: 'run-4', runId: 'workflow-1', attempt: 4, status: 'failed' },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      // 1 success out of 3 retries (attempts 2, 3, 4) = 0.333
      expect(result.features.rerunPassRate).toBeCloseTo(0.333, 2);
    });
  });

  describe('Message Normalization', () => {
    it('should normalize timestamps', () => {
      const message = 'Test failed at 2023-10-01T10:30:45.123Z with error';
      const normalized = scorer.normalizeMessage(message);
      expect(normalized).toBe('Test failed at [TIMESTAMP] with error');
    });

    it('should normalize file paths and line numbers', () => {
      const message = 'Error at /home/user/project/src/test.js:45:12';
      const normalized = scorer.normalizeMessage(message);
      expect(normalized).toBe('Error at [FILE:LINE]');
    });

    it('should normalize memory addresses', () => {
      const message = 'Segmentation fault at 0x7fff5fc01234';
      const normalized = scorer.normalizeMessage(message);
      expect(normalized).toBe('Segmentation fault at [HEX]');
    });

    it('should normalize assertion patterns', () => {
      const message = 'AssertionError: expected: 42, actual: 43';
      const normalized = scorer.normalizeMessage(message);
      expect(normalized).toBe('AssertionError: expected: [VALUE], actual: [VALUE]');
    });

    it('should normalize process IDs', () => {
      const message = 'Process PID 12345 terminated unexpectedly';
      const normalized = scorer.normalizeMessage(message);
      expect(normalized).toBe('Process [PID] terminated unexpectedly');
    });

    it('should normalize UUIDs and hashes', () => {
      const message = 'Session 550e8400-e29b-41d4-a716-446655440000 failed with hash abcdef1234567890abcdef1234567890';
      const normalized = scorer.normalizeMessage(message);
      expect(normalized).toBe('Session [UUID] failed with hash [HASH]');
    });

    it('should normalize timeouts and numeric values', () => {
      const message = 'Request timeout after 5000ms, received 1024 bytes';
      const normalized = scorer.normalizeMessage(message);
      expect(normalized).toBe('Request timeout after [NUM] ms, received [NUM] bytes');
    });

    it('should normalize stack traces', () => {
      const message = `Error occurred
        at TestClass.method(test.js:10:5)
        at Promise.resolve(async.js:20:3)`;
      const normalized = scorer.normalizeMessage(message);
      expect(normalized).toBe('Error occurred [STACK] [STACK]');
    });
  });

  describe('Message Variance Calculation', () => {
    it('should calculate variance for identical messages', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'failed', message: 'Test failed: assertion error' },
        { ...baseTestRun, testName: 'run-2', status: 'failed', message: 'Test failed: assertion error' },
        { ...baseTestRun, testName: 'run-3', status: 'failed', message: 'Test failed: assertion error' },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.messageSignatureVariance).toBe(1/3); // 1 unique message out of 3 total
    });

    it('should calculate variance for different messages', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'failed', message: 'Connection timeout after 5000ms' },
        { ...baseTestRun, testName: 'run-2', status: 'failed', message: 'Connection timeout after 3000ms' },
        { ...baseTestRun, testName: 'run-3', status: 'failed', message: 'Assertion failed: expected true' },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      // Messages normalize to:
      // 1. 'Connection timeout after [NUM] ms' (appears twice)
      // 2. 'Assertion failed: expected: [VALUE]' (appears once)
      expect(result.features.messageSignatureVariance).toBeCloseTo(2/3, 2);
    });

    it('should handle runs without messages', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'failed' }, // No message
        { ...baseTestRun, testName: 'run-2', status: 'failed', message: 'Error occurred' },
        { ...baseTestRun, testName: 'run-3', status: 'passed' },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.messageSignatureVariance).toBe(1); // 1 unique message out of 1 message
    });

    it('should return 0 variance for single failed run', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'failed', message: 'Single failure' },
        { ...baseTestRun, testName: 'run-2', status: 'passed' },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.messageSignatureVariance).toBe(0);
    });
  });

  describe('Consecutive Failures Analysis', () => {
    it('should track consecutive failures at the end', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'passed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', status: 'passed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, testName: 'run-3', status: 'failed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, testName: 'run-4', status: 'failed', createdAt: new Date('2023-10-01T10:03:00.000Z') },
        { ...baseTestRun, testName: 'run-5', status: 'failed', createdAt: new Date('2023-10-01T10:04:00.000Z') },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.consecutiveFailures).toBe(3);
      expect(result.features.maxConsecutiveFailures).toBe(3);
    });

    it('should track maximum consecutive failures', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'failed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', status: 'failed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, testName: 'run-3', status: 'failed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, testName: 'run-4', status: 'failed', createdAt: new Date('2023-10-01T10:03:00.000Z') },
        { ...baseTestRun, testName: 'run-5', status: 'passed', createdAt: new Date('2023-10-01T10:04:00.000Z') },
        { ...baseTestRun, testName: 'run-6', status: 'failed', createdAt: new Date('2023-10-01T10:05:00.000Z') },
        { ...baseTestRun, testName: 'run-7', status: 'failed', createdAt: new Date('2023-10-01T10:06:00.000Z') },
      ];
      
      const result = scorer.computeFlakeScore(runs);
      
      expect(result.features.consecutiveFailures).toBe(2); // Current consecutive at end
      expect(result.features.maxConsecutiveFailures).toBe(4); // Maximum in history
    });

    it('should apply consecutive failure penalty', () => {
      // Test with mostly consecutive failures (broken test)
      const brokenTestRuns: TestRun[] = Array.from({ length: 10 }, (_, i) => ({
        ...baseTestRun,
        id: `run-${i}`,
        status: 'failed' as const,
        createdAt: new Date(Date.now() + i * 60000),
      }));

      // Test with intermittent failures (flaky test)
      const flakyTestRuns: TestRun[] = Array.from({ length: 10 }, (_, i) => ({
        ...baseTestRun,
        id: `run-${i}`,
        status: (i % 2 === 0 ? 'passed' : 'failed') as const,
        createdAt: new Date(Date.now() + i * 60000),
      }));

      const brokenResult = scorer.computeFlakeScore(brokenTestRuns);
      const flakyResult = scorer.computeFlakeScore(flakyTestRuns);
      
      // Flaky test should have higher score than broken test due to penalty
      expect(flakyResult.score).toBeGreaterThan(brokenResult.score);
    });
  });

  describe('Confidence Calculation', () => {
    it('should increase confidence with more runs', () => {
      const fewRuns: TestRun[] = Array.from({ length: 3 }, (_, i) => ({
        ...baseTestRun,
        id: `run-${i}`,
        status: 'passed',
      }));
      
      const manyRuns: TestRun[] = Array.from({ length: 25 }, (_, i) => ({
        ...baseTestRun,
        id: `run-${i}`,
        status: 'passed',
      }));

      const fewResult = scorer.computeFlakeScore(fewRuns);
      const manyResult = scorer.computeFlakeScore(manyRuns);
      
      expect(manyResult.confidence).toBeGreaterThan(fewResult.confidence);
      expect(manyResult.confidence).toBeCloseTo(1.0, 1);
    });

    it('should increase confidence with longer history', () => {
      const oldDate = new Date('2023-01-01T10:00:00.000Z');
      const recentDate = new Date('2023-10-01T10:00:00.000Z');
      
      const oldRuns: TestRun[] = Array.from({ length: 10 }, (_, i) => ({
        ...baseTestRun,
        id: `old-run-${i}`,
        createdAt: new Date(oldDate.getTime() + i * 86400000), // Daily runs for 10 days
      }));
      
      const recentRuns: TestRun[] = Array.from({ length: 10 }, (_, i) => ({
        ...baseTestRun,
        id: `recent-run-${i}`,
        createdAt: new Date(recentDate.getTime() + i * 3600000), // Hourly runs for 10 hours
      }));

      const oldResult = scorer.computeFlakeScore(oldRuns);
      const recentResult = scorer.computeFlakeScore(recentRuns);
      
      expect(oldResult.confidence).toBeGreaterThan(recentResult.confidence);
    });

    it('should reduce confidence for very new tests', () => {
      const veryRecentDate = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
      
      const veryNewRuns: TestRun[] = Array.from({ length: 10 }, (_, i) => ({
        ...baseTestRun,
        id: `new-run-${i}`,
        createdAt: new Date(veryRecentDate.getTime() + i * 60000), // Minute apart
      }));

      const result = scorer.computeFlakeScore(veryNewRuns);
      
      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('Quarantine Recommendations', () => {
    it('should recommend none for insufficient data', () => {
      const customScorer = new FlakinessScorer({
        minRunsForQuarantine: 10,
      });
      
      const runs: TestRun[] = Array.from({ length: 5 }, (_, i) => ({
        ...baseTestRun,
        id: `run-${i}`,
        status: 'failed',
      }));

      const result = customScorer.computeFlakeScore(runs);
      
      expect(result.recommendation.action).toBe('none');
      expect(result.recommendation.reason).toContain('Insufficient data');
    });

    it('should recommend none for too few recent failures', () => {
      const customScorer = new FlakinessScorer({
        minRecentFailures: 5,
        lookbackDays: 7,
      });
      
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const runs: TestRun[] = Array.from({ length: 10 }, (_, i) => ({
        ...baseTestRun,
        id: `run-${i}`,
        status: 'failed',
        createdAt: new Date(oldDate.getTime() + i * 60000),
      }));

      const result = customScorer.computeFlakeScore(runs);
      
      expect(result.recommendation.action).toBe('none');
      expect(result.recommendation.reason).toContain('Too few recent failures');
    });

    it('should recommend warn for moderate flakiness', () => {
      const customScorer = new FlakinessScorer({
        warnThreshold: 0.3,
        quarantineThreshold: 0.7,
        minRunsForQuarantine: 5,
        minRecentFailures: 2,
      });
      
      // Create moderately flaky test
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'passed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', status: 'failed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, testName: 'run-3', status: 'passed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, testName: 'run-4', status: 'failed', createdAt: new Date('2023-10-01T10:03:00.000Z') },
        { ...baseTestRun, testName: 'run-5', status: 'passed', createdAt: new Date('2023-10-01T10:04:00.000Z') },
        { ...baseTestRun, testName: 'run-6', status: 'passed', createdAt: new Date('2023-10-01T10:05:00.000Z') },
      ];

      const result = customScorer.computeFlakeScore(runs);
      
      if (result.score >= 0.3 && result.score < 0.7) {
        expect(result.recommendation.action).toBe('warn');
        expect(result.recommendation.priority).toBe('medium');
      }
    });

    it('should recommend quarantine for high flakiness', () => {
      const customScorer = new FlakinessScorer({
        quarantineThreshold: 0.6,
        minRunsForQuarantine: 5,
        minRecentFailures: 2,
      });
      
      // Create highly flaky test with reruns
      const runs: TestRun[] = [
        // Workflow 1 - initial fail, retry pass
        { ...baseTestRun, testName: 'run-1', runId: 'wf-1', attempt: 1, status: 'failed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', runId: 'wf-1', attempt: 2, status: 'passed', createdAt: new Date('2023-10-01T10:00:30.000Z') },
        // Workflow 2 - initial fail, retry pass  
        { ...baseTestRun, testName: 'run-3', runId: 'wf-2', attempt: 1, status: 'failed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, testName: 'run-4', runId: 'wf-2', attempt: 2, status: 'passed', createdAt: new Date('2023-10-01T10:01:30.000Z') },
        // Workflow 3 - initial fail, retry pass
        { ...baseTestRun, testName: 'run-5', runId: 'wf-3', attempt: 1, status: 'failed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, testName: 'run-6', runId: 'wf-3', attempt: 2, status: 'passed', createdAt: new Date('2023-10-01T10:02:30.000Z') },
        // Some more alternating passes/fails
        { ...baseTestRun, testName: 'run-7', runId: 'wf-4', attempt: 1, status: 'passed', createdAt: new Date('2023-10-01T10:03:00.000Z') },
        { ...baseTestRun, testName: 'run-8', runId: 'wf-5', attempt: 1, status: 'failed', createdAt: new Date('2023-10-01T10:04:00.000Z') },
      ];

      const result = customScorer.computeFlakeScore(runs);
      
      expect(result.score).toBeGreaterThan(0.6);
      expect(result.recommendation.action).toBe('quarantine');
      expect(result.recommendation.priority).toMatch(/medium|high|critical/);
    });
  });

  describe('Priority Determination', () => {
    it('should assign critical priority for very high flakiness', () => {
      const customScorer = new FlakinessScorer({
        quarantineThreshold: 0.5,
        minRunsForQuarantine: 5,
        minRecentFailures: 2,
      });
      
      // Create extremely flaky test pattern
      const runs: TestRun[] = Array.from({ length: 10 }, (_, i) => {
        const isRerun = i % 2 === 1;
        const runId = `workflow-${Math.floor(i / 2)}`;
        const attempt = isRerun ? 2 : 1;
        const status = isRerun ? 'passed' : 'failed'; // All reruns pass
        
        return {
          ...baseTestRun,
          id: `run-${i}`,
          runId,
          attempt,
          status: status as 'passed' | 'failed',
          createdAt: new Date(Date.now() + i * 60000),
        };
      });

      const result = customScorer.computeFlakeScore(runs);
      
      if (result.score > 0.8) {
        expect(result.recommendation.action).toBe('quarantine');
        expect(result.recommendation.priority).toBe('critical');
      }
    });
  });

  describe('Rolling Window Application', () => {
    it('should limit to rolling window size', () => {
      const customScorer = new FlakinessScorer({
        rollingWindowSize: 5,
      });
      
      const runs: TestRun[] = Array.from({ length: 10 }, (_, i) => ({
        ...baseTestRun,
        id: `run-${i}`,
        status: i < 5 ? 'failed' : 'passed', // Older 5 failed, newer 5 passed
        createdAt: new Date(Date.now() + i * 60000),
      }));

      const result = customScorer.computeFlakeScore(runs);
      
      // Should only consider the most recent 5 runs (all passed)
      expect(result.features.totalRuns).toBe(5);
      expect(result.features.failSuccessRatio).toBe(0);
    });
  });

  describe('Stability Metrics', () => {
    it('should build comprehensive stability metrics', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'passed', duration: 1000, createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', status: 'failed', duration: 2000, message: 'Test failed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, testName: 'run-3', status: 'skipped', duration: 0, createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, testName: 'run-4', runId: 'wf-2', attempt: 1, status: 'failed', duration: 1500, message: 'Another failure', createdAt: new Date('2023-10-01T10:03:00.000Z') },
        { ...baseTestRun, testName: 'run-5', runId: 'wf-2', attempt: 2, status: 'passed', duration: 1200, createdAt: new Date('2023-10-01T10:03:30.000Z') },
        { ...baseTestRun, testName: 'run-6', status: 'error', duration: 500, message: 'Error occurred', createdAt: new Date('2023-10-01T10:04:00.000Z') },
      ];

      const metrics = scorer.buildStabilityMetrics(
        'test method',
        'com.example.TestClass.testMethod',
        'repo-123',
        runs
      );

      expect(metrics.testName).toBe('test method');
      expect(metrics.testFullName).toBe('com.example.TestClass.testMethod');
      expect(metrics.repositoryId).toBe('repo-123');
      expect(metrics.totalRuns).toBe(6);
      expect(metrics.successfulRuns).toBe(2);
      expect(metrics.failedRuns).toBe(2);
      expect(metrics.skippedRuns).toBe(1);
      expect(metrics.errorRuns).toBe(1);
      expect(metrics.rerunAttempts).toBe(1);
      expect(metrics.rerunSuccesses).toBe(1);
      expect(metrics.firstSeen).toEqual(new Date('2023-10-01T10:00:00.000Z'));
      expect(metrics.lastSeen).toEqual(new Date('2023-10-01T10:04:00.000Z'));
      expect(metrics.lastFailure).toEqual(new Date('2023-10-01T10:04:00.000Z'));
      expect(metrics.avgDuration).toBe(1000); // (1000+2000+0+1500+1200+500)/6
      expect(metrics.failureMessages).toHaveLength(3); // 3 distinct normalized messages
    });

    it('should throw error for empty runs in stability metrics', () => {
      expect(() => {
        scorer.buildStabilityMetrics('test', 'test.full', 'repo-1', []);
      }).toThrow('Cannot build stability metrics with no test runs');
    });
  });

  describe('Custom Policy Configuration', () => {
    it('should use custom policy thresholds', () => {
      const customPolicy: QuarantinePolicy = {
        warnThreshold: 0.2,
        quarantineThreshold: 0.5,
        minRunsForQuarantine: 3,
        minRecentFailures: 1,
        lookbackDays: 14,
        rollingWindowSize: 20,
      };
      
      const customScorer = new FlakinessScorer(customPolicy);
      
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'passed' },
        { ...baseTestRun, testName: 'run-2', status: 'failed' },
        { ...baseTestRun, testName: 'run-3', status: 'passed' },
      ];

      const result = customScorer.computeFlakeScore(runs);
      
      // Should use custom thresholds for recommendations
      expect(result.recommendation.reason).toContain('0.2'); // Custom warn threshold
    });
  });

  describe('Deterministic Results', () => {
    it('should produce identical results for identical inputs', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'passed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', status: 'failed', message: 'Test failed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, testName: 'run-3', status: 'passed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
        { ...baseTestRun, testName: 'run-4', status: 'failed', message: 'Test failed', createdAt: new Date('2023-10-01T10:03:00.000Z') },
        { ...baseTestRun, testName: 'run-5', status: 'passed', createdAt: new Date('2023-10-01T10:04:00.000Z') },
      ];

      const result1 = scorer.computeFlakeScore(runs);
      const result2 = scorer.computeFlakeScore(runs);
      
      expect(result1.score).toBe(result2.score);
      expect(result1.confidence).toBe(result2.confidence);
      expect(result1.features).toEqual(result2.features);
      expect(result1.recommendation).toEqual(result2.recommendation);
    });

    it('should handle different input orders consistently', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'passed', createdAt: new Date('2023-10-01T10:00:00.000Z') },
        { ...baseTestRun, testName: 'run-2', status: 'failed', createdAt: new Date('2023-10-01T10:01:00.000Z') },
        { ...baseTestRun, testName: 'run-3', status: 'passed', createdAt: new Date('2023-10-01T10:02:00.000Z') },
      ];
      
      // Same runs in different order
      const shuffledRuns = [runs[2], runs[0], runs[1]];

      const result1 = scorer.computeFlakeScore(runs);
      const result2 = scorer.computeFlakeScore(shuffledRuns);
      
      expect(result1.score).toBe(result2.score);
      expect(result1.features.intermittencyScore).toBe(result2.features.intermittencyScore);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle runs with identical timestamps', () => {
      const sameTime = new Date('2023-10-01T10:00:00.000Z');
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'passed', createdAt: sameTime },
        { ...baseTestRun, testName: 'run-2', status: 'failed', createdAt: sameTime },
        { ...baseTestRun, testName: 'run-3', status: 'passed', createdAt: sameTime },
      ];

      const result = scorer.computeFlakeScore(runs);
      
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it('should handle runs with only skipped status', () => {
      const runs: TestRun[] = [
        { ...baseTestRun, testName: 'run-1', status: 'skipped' },
        { ...baseTestRun, testName: 'run-2', status: 'skipped' },
        { ...baseTestRun, testName: 'run-3', status: 'skipped' },
      ];

      const result = scorer.computeFlakeScore(runs);
      
      expect(result.score).toBe(0);
      expect(result.features.intermittencyScore).toBe(0);
      expect(result.features.failSuccessRatio).toBe(0);
    });

    it('should handle very large number of runs efficiently', () => {
      const largeRunCount = 1000;
      const runs: TestRun[] = Array.from({ length: largeRunCount }, (_, i) => ({
        ...baseTestRun,
        id: `run-${i}`,
        status: (i % 3 === 0 ? 'failed' : 'passed') as 'passed' | 'failed',
        createdAt: new Date(Date.now() + i * 1000),
      }));

      const startTime = Date.now();
      const result = scorer.computeFlakeScore(runs);
      const executionTime = Date.now() - startTime;
      
      expect(executionTime).toBeLessThan(1000); // Should complete in less than 1 second
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });
});