/**
 * Performance Benchmarks for FlakeGuard Markdown Generation
 * 
 * This test suite benchmarks markdown rendering performance with varying dataset sizes
 * to ensure the system can handle large numbers of flaky tests efficiently while
 * respecting GitHub Check Run size constraints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  benchmarkMarkdownGeneration,
  generateBenchmarkTestCandidates,
  renderOptimizedCheckRunOutput,
  MarkdownBuilder,
  escapeMarkdown,
  createTruncatedTestTable,
  clearFormattingCache,
  getFormattingCacheStats,
  GITHUB_CHECK_RUN_TEXT_LIMIT,
  type MarkdownPerformanceMetrics
} from '../markdown-utils.js';

describe('Markdown Performance Benchmarks', () => {
  beforeEach(() => {
    clearFormattingCache();
  });

  afterEach(() => {
    clearFormattingCache();
  });

  describe('Performance Scaling Tests', () => {
    const testSizes = [1, 10, 100, 1000];
    
    testSizes.forEach(size => {
      it(`should handle ${size} test candidates efficiently`, () => {
        const tests = generateBenchmarkTestCandidates(size);
        const metrics = benchmarkMarkdownGeneration(tests);
        
        expect(metrics.testsProcessed).toBe(size);
        expect(metrics.renderTime).toBeLessThan(size * 2);
        expect(metrics.charactersGenerated).toBeGreaterThan(0);
        expect(metrics.charactersGenerated).toBeLessThanOrEqual(GITHUB_CHECK_RUN_TEXT_LIMIT);
        
        if (size <= 100) {
          expect(metrics.memoryUsed).toBeLessThan(1024 * 1024);
        }
        
        console.log(`${size} tests: ${metrics.renderTime.toFixed(2)}ms, ${metrics.charactersGenerated} chars`);
      });
    });

    it('should handle extreme dataset sizes gracefully', () => {
      const largeTests = generateBenchmarkTestCandidates(5000);
      const metrics = benchmarkMarkdownGeneration(largeTests);
      
      expect(metrics.renderTime).toBeLessThan(1000);
      expect(metrics.charactersGenerated).toBeLessThanOrEqual(GITHUB_CHECK_RUN_TEXT_LIMIT);
      expect(metrics.truncated).toBe(true);
    });
  });

  describe('Size Constraint Tests', () => {
    it('should respect GitHub Check Run text limits', () => {
      const tests = generateBenchmarkTestCandidates(2000);
      const result = renderOptimizedCheckRunOutput(tests);
      
      expect(result.summary.length).toBeLessThanOrEqual(GITHUB_CHECK_RUN_TEXT_LIMIT);
      expect(result.title.length).toBeGreaterThan(0);
    });

    it('should provide smart truncation', () => {
      const tests = generateBenchmarkTestCandidates(1000);
      const { table, truncated, shown } = createTruncatedTestTable(tests, 5000);
      
      expect(truncated).toBe(true);
      expect(shown).toBeLessThan(tests.length);
      expect(shown).toBeGreaterThan(0);
      expect(table.length).toBeLessThanOrEqual(5000);
    });
  });

  describe('Caching Performance', () => {
    it('should cache markdown escaping efficiently', () => {
      const testStrings = ['test1', 'test[special]', 'test_normal'];
      
      testStrings.forEach(str => escapeMarkdown(str));
      
      const cacheStats = getFormattingCacheStats();
      expect(cacheStats.size).toBe(testStrings.length);
    });
  });
});
