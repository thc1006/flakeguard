/**
 * Optimized Check Runs Rendering System for FlakeGuard
 * 
 * Performance-optimized version with:
 * - GitHub Check Run 65535 character limit compliance
 * - Efficient string building and memory usage
 * - Smart truncation preserving most important data
 * - Cached markdown operations for better performance
 * - Proper handling of large datasets (1000+ flaky tests)
 */

// import type { Octokit } from '@octokit/rest'; // Unused
// import type { PrismaClient } from '@prisma/client'; // Unused

import { logger } from '../utils/logger.js';

// import { ErrorCode } from './api-spec.js'; // Unused
import { GitHubAuthManager } from './auth.js';
// import {
//   CHECK_RUN_ACTION_CONFIGS, // Unused
//   ERROR_MESSAGES, // Unused
// } from './constants.js';
import {
  renderOptimizedCheckRunOutput,
  benchmarkMarkdownGeneration,
  GITHUB_CHECK_RUN_TEXT_LIMIT,
} from './markdown-utils.js';
import type {
  FlakeGuardCheckRun,
  // CheckRunAction, // Unused
  // CheckRunStatus, // Unused
  CheckRunConclusion,
  // TestResult, // Unused
  ApiResponse,
} from './types.js';

// Re-export types and interfaces for backward compatibility
export type { TestCandidate, CheckRunOutput, CheckRunActionDef, CheckRunParams } from './check-runs.js';
export {
  generateCheckRunActions,
  createOrUpdateCheckRun,
  updateExistingCheckRun,
  convertToTestCandidates,
} from './check-runs.js';

/**
 * Optimized markdown summary generation for flaky test candidates
 * Uses efficient string building and respects GitHub Check Run limits
 */
export function renderCheckRunOutput(tests: readonly import('./check-runs.js').TestCandidate[]): import('./check-runs.js').CheckRunOutput {
  const startTime = process.hrtime.bigint();
  
  const result = renderOptimizedCheckRunOutput(tests);
  
  const endTime = process.hrtime.bigint();
  const renderTime = Number(endTime - startTime) / 1_000_000;
  
  // Log performance metrics for monitoring
  logger.debug('Check run markdown rendered', {
    testsProcessed: tests.length,
    charactersGenerated: result.summary.length,
    renderTimeMs: renderTime.toFixed(2),
    withinSizeLimit: result.summary.length <= GITHUB_CHECK_RUN_TEXT_LIMIT,
    truncated: result.summary.includes('due to size limits'),
  });
  
  // Warn if approaching size limits
  if (result.summary.length > GITHUB_CHECK_RUN_TEXT_LIMIT * 0.9) {
    logger.warn('Check run markdown approaching size limit', {
      currentSize: result.summary.length,
      sizeLimit: GITHUB_CHECK_RUN_TEXT_LIMIT,
      utilizationPercent: ((result.summary.length / GITHUB_CHECK_RUN_TEXT_LIMIT) * 100).toFixed(1),
    });
  }
  
  return result;
}

/**
 * Create a comprehensive FlakeGuard check run with performance monitoring
 */
export async function createFlakeGuardCheckRun(
  authManager: GitHubAuthManager,
  owner: string,
  repo: string,
  headSha: string,
  installationId: number,
  tests: readonly import('./check-runs.js').TestCandidate[],
  hasFailures: boolean = false
): Promise<ApiResponse<FlakeGuardCheckRun>> {
  // Benchmark the markdown generation
  const metrics = benchmarkMarkdownGeneration(tests);
  
  logger.info('Generated FlakeGuard check run markdown', {
    owner,
    repo,
    testsProcessed: metrics.testsProcessed,
    renderTimeMs: metrics.renderTime.toFixed(2),
    charactersGenerated: metrics.charactersGenerated,
    memoryUsedKB: (metrics.memoryUsed / 1024).toFixed(1),
    truncated: metrics.truncated,
  });
  
  const output = renderOptimizedCheckRunOutput(tests);
  const { generateCheckRunActions } = await import('./check-runs.js');
  const actions = generateCheckRunActions(tests, hasFailures);
  
  // Determine conclusion based on findings
  let conclusion: CheckRunConclusion;
  if (tests.some(t => t.confidence >= 0.8)) {
    conclusion = 'action_required';
  } else if (tests.length > 0) {
    conclusion = 'neutral';
  } else {
    conclusion = 'success';
  }
  
  const { createOrUpdateCheckRun } = await import('./check-runs.js');
  return createOrUpdateCheckRun(authManager, {
    owner,
    repo,
    name: 'FlakeGuard Analysis',
    headSha,
    installationId,
    status: 'completed',
    conclusion,
    output,
    actions,
  });
}

/**
 * Performance monitoring wrapper for check run operations
 */
export async function createPerformanceMonitoredCheckRun(
  authManager: GitHubAuthManager,
  owner: string,
  repo: string,
  headSha: string,
  installationId: number,
  tests: readonly import('./check-runs.js').TestCandidate[],
  hasFailures: boolean = false
): Promise<{
  result: ApiResponse<FlakeGuardCheckRun>;
  performance: {
    markdownRenderTime: number;
    totalTime: number;
    charactersGenerated: number;
    memoryUsed: number;
    truncated: boolean;
  };
}> {
  const startTime = process.hrtime.bigint();
  
  const markdownMetrics = benchmarkMarkdownGeneration(tests);
  const result = await createFlakeGuardCheckRun(authManager, owner, repo, headSha, installationId, tests, hasFailures);
  
  const endTime = process.hrtime.bigint();
  const totalTime = Number(endTime - startTime) / 1_000_000;
  
  return {
    result,
    performance: {
      markdownRenderTime: markdownMetrics.renderTime,
      totalTime,
      charactersGenerated: markdownMetrics.charactersGenerated,
      memoryUsed: markdownMetrics.memoryUsed,
      truncated: markdownMetrics.truncated,
    },
  };
}
