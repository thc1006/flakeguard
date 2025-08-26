/**
 * Optimized Markdown Generation Utilities for FlakeGuard Check Runs
 * 
 * This module provides high-performance markdown rendering with:
 * - GitHub Check Run 65535 character limit compliance
 * - Efficient string building using arrays
 * - Smart truncation preserving most important data
 * - Cached formatting functions
 * - Memory-optimized operations for large datasets
 */

import type { TestCandidate, CheckRunOutput } from './check-runs.js';

// GitHub Check Run text field limit
export const GITHUB_CHECK_RUN_TEXT_LIMIT = 65535;

// Markdown formatting cache for frequently used strings
const formatCache = new Map<string, string>();

/**
 * Cached markdown escaping to avoid repeated regex operations
 */
export function escapeMarkdown(text: string): string {
  if (formatCache.has(text)) {
    return formatCache.get(text)!;
  }
  
  const escaped = text.replace(/([\`*_{}\[\]()#+\-.!])/g, '\$1');
  
  // Cache up to 1000 entries to prevent memory bloat
  if (formatCache.size < 1000) {
    formatCache.set(text, escaped);
  }
  
  return escaped;
}

/**
 * Efficient string builder using array join pattern
 */
export class MarkdownBuilder {
  private parts: string[] = [];
  private currentSize = 0;
  private readonly maxSize: number;
  
  constructor(maxSize = GITHUB_CHECK_RUN_TEXT_LIMIT) {
    this.maxSize = maxSize;
  }
  
  append(text: string): this {
    if (this.currentSize + text.length <= this.maxSize) {
      this.parts.push(text);
      this.currentSize += text.length;
    }
    return this;
  }
  
  appendLine(text = ''): this {
    return this.append(text + '\n');
  }
  
  appendSection(title: string, content: string): this {
    const section = `### ${title}\n\n${content}\n\n`;
    return this.append(section);
  }
  
  canFit(additionalChars: number): boolean {
    return this.currentSize + additionalChars <= this.maxSize;
  }
  
  getRemainingSpace(): number {
    return this.maxSize - this.currentSize;
  }
  
  getCurrentSize(): number {
    return this.currentSize;
  }
  
  build(): string {
    return this.parts.join('');
  }
  
  clear(): void {
    this.parts = [];
    this.currentSize = 0;
  }
}

/**
 * Optimized table row generator with size estimation
 */
export function generateTableRow(test: TestCandidate): string {
  const passRate = `${(test.rerunPassRate * 100).toFixed(1)}%`;
  const confidence = `${(test.confidence * 100).toFixed(1)}%`;
  const lastRun = test.lastFailedRun 
    ? new Date(test.lastFailedRun).toLocaleDateString()
    : 'N/A';
  
  return `| \`${escapeMarkdown(test.testName)}\` | ${test.failCount} | ${passRate} | ${lastRun} | ${confidence} |\n`;
}

/**
 * Estimate the size of a test table row without building it
 */
export function estimateTableRowSize(testName: string): number {
  // Base table structure + escaped test name + typical numeric values
  return 50 + testName.length * 1.2; // Account for potential escaping
}

/**
 * Smart truncation that preserves high-priority tests and adds summary
 */
export function createTruncatedTestTable(
  tests: readonly TestCandidate[], 
  maxSize: number
): { table: string; truncated: boolean; shown: number } {
  if (tests.length === 0) {
    return { table: '', truncated: false, shown: 0 };
  }
  
  // Sort by priority: confidence desc, then failCount desc
  const sortedTests = [...tests].sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return b.failCount - a.failCount;
  });
  
  const builder = new MarkdownBuilder(maxSize);
  
  // Add table header
  const header = '| Test Name | Fail Count | Rerun Pass Rate | Last Failed Run | Confidence |\n' +
                 '|-----------|------------|-----------------|-----------------|------------|\n';
  
  if (!builder.canFit(header.length)) {
    return { table: '', truncated: true, shown: 0 };
  }
  
  builder.append(header);
  let shown = 0;
  let hasSpace = true;
  
  // Add rows while we have space
  for (const test of sortedTests) {
    const row = generateTableRow(test);
    
    if (builder.canFit(row.length)) {
      builder.append(row);
      shown++;
    } else {
      hasSpace = false;
      break;
    }
  }
  
  const truncated = !hasSpace || shown < tests.length;
  
  // Add truncation notice if needed
  if (truncated && shown < tests.length) {
    const notice = `\n*Showing top ${shown} of ${tests.length} total candidates due to size limits.*\n`;
    if (builder.canFit(notice.length)) {
      builder.append(notice);
    }
  }
  
  return {
    table: builder.build(),
    truncated,
    shown
  };
}

/**
 * Optimized check run output renderer with size constraints
 */
export function renderOptimizedCheckRunOutput(tests: readonly TestCandidate[]): CheckRunOutput {
  if (tests.length === 0) {
    return {
      title: '✅ FlakeGuard Analysis Complete',
      summary: 'No flaky test candidates detected in this run.\n\nAll tests appear to be stable based on historical analysis.',
    };
  }
  
  const title = `🔍 FlakeGuard Analysis: ${tests.length} Flaky Test Candidate${tests.length === 1 ? '' : 's'} Detected`;
  const builder = new MarkdownBuilder();
  
  // Add main section header
  builder.appendLine('## Flaky Test Candidates')
         .appendLine()
         .appendLine('The following tests show patterns consistent with flaky behavior:')
         .appendLine();
  
  // Create test table with smart truncation
  const remainingSpace = builder.getRemainingSpace() - 2000; // Reserve space for footer content
  const { table, truncated: _truncated, shown: _shown } = createTruncatedTestTable(tests, remainingSpace);
  
  builder.append(table);
  
  // Add explanation sections if we have space
  const explanationContent = getExplanationContent();
  if (builder.canFit(explanationContent.length)) {
    builder.append(explanationContent);
  } else {
    // Add minimal footer if full explanation doesn't fit
    const minimalFooter = '\n*This analysis is generated by FlakeGuard based on historical test execution data.*';
    if (builder.canFit(minimalFooter.length)) {
      builder.append(minimalFooter);
    }
  }
  
  return {
    title,
    summary: builder.build(),
  };
}

/**
 * Get explanation content as a reusable string
 */
function getExplanationContent(): string {
  return `
### What are flaky tests?

Flaky tests are tests that exhibit both passing and failing results without changes to the code. They can be caused by:

- **Race conditions** - Timing-dependent code execution
- **External dependencies** - Network calls, databases, file system
- **Resource contention** - Insufficient memory, CPU, or I/O
- **Non-deterministic behavior** - Random values, system time dependencies

### Recommended Actions

1. **Quarantine** high-confidence flaky tests to prevent CI instability
2. **Rerun** failed jobs to confirm flaky behavior
3. **Open issues** to track and fix root causes

*This analysis is generated by FlakeGuard based on historical test execution data.*`;
}

/**
 * Performance metrics collection for benchmarking
 */
export interface MarkdownPerformanceMetrics {
  renderTime: number;
  memoryUsed: number;
  charactersGenerated: number;
  testsProcessed: number;
  truncated: boolean;
}

/**
 * Benchmark markdown generation performance
 */
export function benchmarkMarkdownGeneration(tests: readonly TestCandidate[]): MarkdownPerformanceMetrics {
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage().heapUsed;
  
  const result = renderOptimizedCheckRunOutput(tests);
  
  const endTime = process.hrtime.bigint();
  const endMemory = process.memoryUsage().heapUsed;
  
  return {
    renderTime: Number(endTime - startTime) / 1_000_000, // Convert to milliseconds
    memoryUsed: Math.max(0, endMemory - startMemory),
    charactersGenerated: result.summary.length,
    testsProcessed: tests.length,
    truncated: result.summary.includes('due to size limits')
  };
}

/**
 * Generate test candidates for performance benchmarking
 */
export function generateBenchmarkTestCandidates(count: number): TestCandidate[] {
  const candidates: TestCandidate[] = [];
  
  for (let i = 0; i < count; i++) {
    candidates.push({
      testName: `com.example.test.TestClass${i}.testMethod${i}`,
      failCount: Math.floor(Math.random() * 20) + 1,
      rerunPassRate: Math.random() * 0.8 + 0.2,
      lastFailedRun: Math.random() > 0.3 ? new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString() : null,
      confidence: Math.random(),
      failurePattern: Math.random() > 0.5 ? (['timeout', 'race condition', 'network error', 'connection refused'][Math.floor(Math.random() * 4)] || null) : null,
      totalRuns: Math.floor(Math.random() * 100) + 10,
    });
  }
  
  return candidates;
}

/**
 * Clear the formatting cache (useful for memory management in long-running processes)
 */
export function clearFormattingCache(): void {
  formatCache.clear();
}

/**
 * Get formatting cache statistics
 */
export function getFormattingCacheStats(): { size: number; maxSize: number } {
  return {
    size: formatCache.size,
    maxSize: 1000
  };
}
