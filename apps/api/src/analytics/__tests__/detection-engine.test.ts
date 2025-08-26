import { describe, it, expect } from 'vitest';
import { FlakeDetectionEngine } from '../detection-engine.js';
import type { TestRun } from '@flakeguard/shared';

describe('FlakeDetectionEngine', () => {
  const engine = new FlakeDetectionEngine();

  const createTestRun = (
    status: 'passed' | 'failed' | 'error',
    date: Date = new Date(),
    message?: string,
    attempt: number = 1
  ): TestRun => ({
    testName: 'test',
    testFullName: 'suite.test',
    status,
    message,
    duration: 1000,
    attempt,
    runId: `run-${date.getTime()}`,
    createdAt: date,
  });

  describe('analyzeTest', () => {
    it('should throw error for empty runs', () => {
      expect(() => engine.analyzeTest([])).toThrow('Cannot analyze test with no runs');
    });

    it('should analyze simple stable test', () => {
      const runs = [
        createTestRun('passed'),
        createTestRun('passed'),
        createTestRun('passed'),
      ];

      const result = engine.analyzeTest(runs);

      expect(result.testName).toBe('test');
      expect(result.testFullName).toBe('suite.test');
      expect(result.flakeScore.score).toBe(0); // All passes = no flakiness
      expect(result.recommendation.action).toBe('none');
    });

    it('should analyze flaky test with retries', () => {
      const baseDate = new Date('2023-01-01T10:00:00Z');
      const runs = [
        createTestRun('failed', new Date(baseDate.getTime()), 'timeout error', 1),
        createTestRun('passed', new Date(baseDate.getTime() + 1000), undefined, 2), // retry success
        createTestRun('failed', new Date(baseDate.getTime() + 60000), 'timeout error', 1),
        createTestRun('passed', new Date(baseDate.getTime() + 61000), undefined, 2), // retry success
        createTestRun('passed', new Date(baseDate.getTime() + 120000), undefined, 1),
      ];

      const result = engine.analyzeTest(runs);

      expect(result.flakeScore.score).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.analyzedAt).toBeInstanceOf(Date);
    });

    it('should detect timeout pattern', () => {
      const runs = [
        createTestRun('failed', new Date(), 'Test timed out after 30 seconds'),
        createTestRun('failed', new Date(), 'Connection timeout'),
        createTestRun('passed', new Date()),
        createTestRun('failed', new Date(), 'Request timeout'),
      ];

      const result = engine.analyzeTest(runs);

      const timeoutPattern = result.patternAnalysis.patterns.find(p => p.type === 'timeout');
      expect(timeoutPattern).toBeDefined();
      expect(timeoutPattern?.confidence).toBeGreaterThan(0.5);
    });

    it('should detect resource contention pattern', () => {
      const runs = [
        createTestRun('failed', new Date(), 'Out of memory error'),
        createTestRun('failed', new Date(), 'Database connection pool exhausted'),
        createTestRun('passed', new Date()),
        createTestRun('failed', new Date(), 'Disk space insufficient'),
      ];

      const result = engine.analyzeTest(runs);

      const resourcePattern = result.patternAnalysis.patterns.find(p => p.type === 'resource_contention');
      expect(resourcePattern).toBeDefined();
      expect(resourcePattern?.confidence).toBeGreaterThan(0.5);
    });

    it('should detect external dependency pattern', () => {
      const runs = [
        createTestRun('failed', new Date(), 'Connection refused to API endpoint'),
        createTestRun('failed', new Date(), 'HTTP 503 Service Unavailable'),
        createTestRun('passed', new Date()),
        createTestRun('failed', new Date(), 'Network unreachable'),
      ];

      const result = engine.analyzeTest(runs);

      const dependencyPattern = result.patternAnalysis.patterns.find(p => p.type === 'external_dependency');
      expect(dependencyPattern).toBeDefined();
      expect(dependencyPattern?.confidence).toBeGreaterThan(0.5);
    });

    it('should analyze environmental factors', () => {
      const baseDate = new Date('2023-01-01T10:00:00Z');
      
      // Create test with high duration variance
      const runs = [
        { ...createTestRun('passed', new Date(baseDate.getTime())), duration: 100 },   // Fast
        { ...createTestRun('passed', new Date(baseDate.getTime() + 1000)), duration: 1000 },  // Normal
        { ...createTestRun('passed', new Date(baseDate.getTime() + 2000)), duration: 5000 },  // Slow
      ];

      const result = engine.analyzeTest(runs);

      expect(result.environmentalAnalysis).toBeDefined();
      expect(result.environmentalAnalysis.factors).toBeDefined();
    });

    it('should analyze retry patterns', () => {
      const runs = [
        createTestRun('failed', new Date(), 'Initial failure', 1),
        createTestRun('passed', new Date(), undefined, 2), // Successful retry
        createTestRun('failed', new Date(), 'Another failure', 1),
        createTestRun('passed', new Date(), undefined, 2), // Another successful retry
      ];

      const result = engine.analyzeTest(runs);

      const retryFactor = result.environmentalAnalysis.factors.find(f => f.type === 'retry_pattern');
      expect(retryFactor?.significance).toBeGreaterThan(0);
    });

    it('should generate combined recommendations', () => {
      const runs = Array.from({ length: 10 }, (_, i) => 
        createTestRun(i % 3 === 0 ? 'failed' : 'passed', new Date(Date.now() + i * 1000))
      );

      const result = engine.analyzeTest(runs);

      expect(result.recommendation).toBeDefined();
      expect(['none', 'warn', 'quarantine']).toContain(result.recommendation.action);
      expect(result.recommendation.confidence).toBeGreaterThanOrEqual(0);
      expect(result.recommendation.confidence).toBeLessThanOrEqual(1);
    });

    it('should handle race condition pattern detection', () => {
      const runs = [
        createTestRun('failed', new Date(), 'Concurrent access violation'),
        createTestRun('failed', new Date(), 'Race condition in thread pool'),
        createTestRun('passed', new Date()),
        createTestRun('failed', new Date(), 'Async operation order issue'),
      ];

      const result = engine.analyzeTest(runs);

      const racePattern = result.patternAnalysis.patterns.find(p => p.type === 'race_condition');
      expect(racePattern).toBeDefined();
    });

    it('should calculate overall confidence correctly', () => {
      const runs = [
        createTestRun('failed', new Date()),
        createTestRun('passed', new Date()),
        createTestRun('failed', new Date()),
        createTestRun('passed', new Date()),
      ];

      const result = engine.analyzeTest(runs);

      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.confidence).toBe('number');
    });
  });
});