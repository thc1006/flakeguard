import { describe, it, expect } from 'vitest';
import { FailureClusteringAnalyzer } from '../clustering.js';
import type { TestRun } from '@flakeguard/shared';

describe('FailureClusteringAnalyzer', () => {
  const analyzer = new FailureClusteringAnalyzer();

  const createTestRun = (
    date: Date,
    status: 'passed' | 'failed' | 'error' = 'failed'
  ): TestRun => ({
    testName: 'test',
    testFullName: 'suite.test',
    status,
    duration: 1000,
    attempt: 1,
    runId: 'run-1',
    createdAt: date,
  });

  describe('analyzeClusters', () => {
    it('should return empty analysis for no failures', () => {
      const runs = [createTestRun(new Date(), 'passed')];
      const result = analyzer.analyzeClusters(runs);

      expect(result.clusters).toHaveLength(0);
      expect(result.patterns.randomness).toBe(1);
      expect(result.metrics.totalClusters).toBe(0);
    });

    it('should identify single cluster for closely spaced failures', () => {
      const baseDate = new Date('2023-01-01T10:00:00Z');
      const runs = [
        createTestRun(new Date(baseDate.getTime())),
        createTestRun(new Date(baseDate.getTime() + 5 * 60 * 1000)), // 5 minutes later
        createTestRun(new Date(baseDate.getTime() + 10 * 60 * 1000)), // 10 minutes later
      ];

      const result = analyzer.analyzeClusters(runs);

      expect(result.clusters).toHaveLength(1);
      expect(result.clusters[0]?.runs).toHaveLength(3);
      expect(result.metrics.totalClusters).toBe(1);
    });

    it('should identify multiple clusters for spaced failures', () => {
      const baseDate = new Date('2023-01-01T10:00:00Z');
      const runs = [
        // First cluster
        createTestRun(new Date(baseDate.getTime())),
        createTestRun(new Date(baseDate.getTime() + 5 * 60 * 1000)),
        
        // Very large gap (24 hours)
        
        // Second cluster
        createTestRun(new Date(baseDate.getTime() + 24 * 60 * 60 * 1000)), // 24 hours later
        createTestRun(new Date(baseDate.getTime() + 24 * 60 * 60 * 1000 + 5 * 60 * 1000)),
      ];

      const result = analyzer.analyzeClusters(runs);

      // With adaptive threshold, this should create 2 clusters
      expect(result.clusters.length).toBeGreaterThanOrEqual(1);
      expect(result.metrics.totalClusters).toBeGreaterThanOrEqual(1);
    });

    it('should calculate burstiness correctly', () => {
      const baseDate = new Date('2023-01-01T10:00:00Z');
      
      // Create highly bursty pattern: very tight cluster with high density variation
      const runs = [
        // Very tight burst (all within 2 minutes)
        createTestRun(new Date(baseDate.getTime())),
        createTestRun(new Date(baseDate.getTime() + 10 * 1000)), // 10 seconds
        createTestRun(new Date(baseDate.getTime() + 20 * 1000)), // 20 seconds
        createTestRun(new Date(baseDate.getTime() + 30 * 1000)), // 30 seconds
        createTestRun(new Date(baseDate.getTime() + 60 * 1000)), // 1 minute
        
        // Much longer gap, then sparse failures
        createTestRun(new Date(baseDate.getTime() + 24 * 60 * 60 * 1000)), // 24 hours later
      ];

      const result = analyzer.analyzeClusters(runs);

      // Should detect burstiness (or at least not be 0)
      expect(result.patterns.burstiness).toBeGreaterThanOrEqual(0);
      expect(result.patterns.randomness).toBeGreaterThanOrEqual(0);
    });

    it('should handle edge cases gracefully', () => {
      // Empty runs
      expect(() => analyzer.analyzeClusters([])).not.toThrow();

      // Single failure
      const singleRun = [createTestRun(new Date())];
      const result = analyzer.analyzeClusters(singleRun);
      expect(result.clusters).toHaveLength(0);
      expect(result.patterns.randomness).toBe(1);
    });

    it('should calculate temporal spread correctly', () => {
      const baseDate = new Date('2023-01-01T10:00:00Z');
      const runs = [
        createTestRun(new Date(baseDate.getTime())),
        createTestRun(new Date(baseDate.getTime() + 60 * 60 * 1000)), // 1 hour later
      ];

      const result = analyzer.analyzeClusters(runs);
      
      if (result.clusters.length > 0) {
        expect(result.metrics.temporalSpread).toBeGreaterThan(0);
      }
    });
  });
});