/**
 * Check Run Output Rendering System for FlakeGuard P4
 * 
 * Provides comprehensive Check Run output rendering with GitHub integration:
 * - Generates markdown tables with flaky test metrics
 * - Creates GitHub file permalinks for test locations
 * - Implements intelligent action selection (≤3 actions)
 * - Includes emoji severity indicators and proper formatting
 * - Handles edge cases and provides type-safe interfaces
 */

import type {
  FlakeScore,
  TestStabilityMetrics,
} from '@flakeguard/shared';

import {
  CHECK_RUN_ACTION_CONFIGS,
} from './constants.js';
import type {
  CheckRunAction,
  // RepositoryInfo, // Unused
} from './types.js';

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

/**
 * Repository information for generating file links
 */
export interface Repository {
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch?: string;
}

/**
 * Test data with file location information
 */
export interface TestWithLocation {
  readonly testName: string;
  readonly failCount: number;
  readonly rerunPassRate: number;
  readonly lastFailedRun: string | null;
  readonly confidence: number;
  readonly totalRuns: number;
  readonly file?: string;
  readonly line?: number;
  readonly flakeScore: number;
}

/**
 * Check run output structure
 */
export interface CheckRunOutput {
  readonly title: string;
  readonly summary: string;
  readonly text?: string;
  readonly actions: readonly CheckRunActionDef[];
}

/**
 * Action definition for check runs
 */
export interface CheckRunActionDef {
  readonly identifier: CheckRunAction;
  readonly label: string;
  readonly description: string;
}

/**
 * Severity levels for emoji indicators
 */
export type SeverityLevel = 'critical' | 'warning' | 'stable';

// =============================================================================
// MAIN RENDERING FUNCTION
// =============================================================================

/**
 * Generate comprehensive Check Run output with markdown table and actions
 * 
 * @param tests - Array of test candidates with flakiness metrics
 * @param repository - Repository information for generating file links
 * @returns Complete check run output with title, summary, and actions
 */
export function renderCheckRunOutput(
  tests: readonly TestWithLocation[],
  repository: Repository
): CheckRunOutput {
  if (tests.length === 0) {
    return {
      title: '✅ FlakeGuard Analysis Complete',
      summary: 'No flaky test candidates detected in this run.\n\nAll tests appear to be stable based on historical analysis.',
      actions: [],
    };
  }

  const title = `🔍 FlakeGuard Analysis: ${tests.length} Flaky Test Candidate${tests.length === 1 ? '' : 's'} Detected`;
  
  // Sort tests by confidence and flake score
  const sortedTests = [...tests]
    .sort((a, b) => {
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return b.flakeScore - a.flakeScore;
    })
    .slice(0, 100); // Limit to prevent overly large outputs
    
  let summary = '## Flaky Test Candidates\n\n';
  summary += 'The following tests show patterns consistent with flaky behavior:\n\n';
  
  // Generate markdown table with file links and severity indicators
  summary += '| Test Name | Fail Count | Rerun Pass Rate | Last Failed Run | Severity |\n';
  summary += '|-----------|------------|-----------------|-----------------|----------|\n';
  
  // Show up to 20 top candidates for readability
  const displayTests = sortedTests.slice(0, 20);
  
  for (const test of displayTests) {
    const formattedName = formatTestName(test.testName);
    const nameWithLink = test.file && test.line
      ? `[${formattedName}](${generateFileLink(test.file, test.line, repository)})`
      : `\`${formattedName}\``;
    
    const passRate = `${(test.rerunPassRate * 100).toFixed(1)}%`;
    const lastRun = test.lastFailedRun 
      ? new Date(test.lastFailedRun).toLocaleDateString()
      : 'N/A';
    
    const severity = calculateSeverity(test.flakeScore);
    const severityIcon = getSeverityEmoji(severity);
    const severityText = `${severityIcon} ${severity.charAt(0).toUpperCase() + severity.slice(1)}`;
    
    summary += `| ${nameWithLink} | ${test.failCount} | ${passRate} | ${lastRun} | ${severityText} |\n`;
  }
  
  summary += '\n';
  
  if (sortedTests.length > displayTests.length) {
    summary += `*Showing top ${displayTests.length} of ${sortedTests.length} total candidates.*\n\n`;
  }
  
  // Add severity legend
  summary += '### Severity Levels\n\n';
  summary += '- 🔴 **Critical** - High confidence flaky tests requiring immediate attention\n';
  summary += '- 🟡 **Warning** - Moderate confidence tests that may be flaky\n';
  summary += '- 🟢 **Stable** - Low confidence, likely not flaky but worth monitoring\n\n';
  
  // Add explanation section
  summary += '### Understanding Flaky Tests\n\n';
  summary += 'Flaky tests exhibit non-deterministic behavior, passing and failing without code changes. Common causes:\n\n';
  summary += '- **Timing Issues** - Race conditions and timing-dependent logic\n';
  summary += '- **External Dependencies** - Network calls, databases, third-party services\n';
  summary += '- **Resource Constraints** - Memory, CPU, or I/O limitations\n';
  summary += '- **Environment Factors** - System state, parallel execution, cleanup issues\n\n';
  
  // Add actionable recommendations
  summary += '### Recommended Actions\n\n';
  const criticalTests = sortedTests.filter(t => calculateSeverity(t.flakeScore) === 'critical');
  const warningTests = sortedTests.filter(t => calculateSeverity(t.flakeScore) === 'warning');
  
  if (criticalTests.length > 0) {
    summary += `1. **Quarantine ${criticalTests.length} critical test${criticalTests.length === 1 ? '' : 's'}** to prevent CI instability\n`;
  }
  
  if (warningTests.length > 0) {
    summary += `2. **Investigate ${warningTests.length} warning test${warningTests.length === 1 ? '' : 's'}** for potential improvements\n`;
  }
  
  summary += '3. **Rerun failed jobs** to confirm flaky behavior patterns\n';
  summary += '4. **Create tracking issues** for systematic resolution\n\n';
  
  summary += '*Analysis generated by FlakeGuard based on historical execution data and statistical models.*';
  
  // Generate intelligent actions
  const actions = selectTopActions(sortedTests);
  
  return {
    title,
    summary,
    actions,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format test name by truncating to 50 characters and escaping markdown
 * 
 * @param name - Raw test name
 * @returns Formatted and escaped test name
 */
export function formatTestName(name: string): string {
  if (!name) {return 'Unknown Test';}
  
  let formatted = name.length > 50 ? `${name.substring(0, 47)}...` : name;
  
  // Escape markdown special characters
  formatted = formatted.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
  
  return formatted;
}

/**
 * Generate GitHub permalink to file at specific line
 * 
 * @param file - File path relative to repository root
 * @param line - Line number (1-based)
 * @param repo - Repository information
 * @returns GitHub permalink URL
 */
export function generateFileLink(
  file: string,
  line: number,
  repo: Repository
): string {
  const branch = repo.defaultBranch || 'main';
  const cleanFile = file.startsWith('./') ? file.substring(2) : file;
  
  return `https://github.com/${repo.owner}/${repo.repo}/blob/${branch}/${cleanFile}#L${line}`;
}

/**
 * Select up to 3 most relevant actions based on test characteristics
 * 
 * @param tests - Array of test candidates
 * @returns Array of up to 3 actions, never exceeding GitHub's limit
 */
export function selectTopActions(
  tests: readonly TestWithLocation[]
): readonly CheckRunActionDef[] {
  const actions: CheckRunActionDef[] = [];
  
  // Count tests by severity
  const criticalTests = tests.filter(t => calculateSeverity(t.flakeScore) === 'critical');
  const warningTests = tests.filter(t => calculateSeverity(t.flakeScore) === 'warning');
  void warningTests; // Avoid unused variable warning
  const recentFailures = tests.filter(t => {
    if (!t.lastFailedRun) {return false;}
    const lastFailed = new Date(t.lastFailedRun);
    const daysSince = (Date.now() - lastFailed.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= 7; // Failed in last 7 days
  });
  
  // Priority 1: Quarantine critical tests
  if (criticalTests.length > 0 && actions.length < 3) {
    actions.push({
      identifier: 'quarantine',
      label: CHECK_RUN_ACTION_CONFIGS.quarantine.label,
      description: `Quarantine ${criticalTests.length} critical flaky test${criticalTests.length === 1 ? '' : 's'}`,
    });
  }
  
  // Priority 2: Rerun if there are recent failures
  if (recentFailures.length > 0 && actions.length < 3) {
    actions.push({
      identifier: 'rerun_failed',
      label: CHECK_RUN_ACTION_CONFIGS.rerun_failed.label,
      description: `Rerun ${recentFailures.length} recently failed test${recentFailures.length === 1 ? '' : 's'}`,
    });
  }
  
  // Priority 3: Open issue for persistent problems
  if (tests.length > 0 && actions.length < 3) {
    const persistentTests = tests.filter(t => t.failCount >= 3);
    if (persistentTests.length > 0) {
      actions.push({
        identifier: 'open_issue',
        label: CHECK_RUN_ACTION_CONFIGS.open_issue.label,
        description: `Create tracking issue for ${persistentTests.length} persistent flaky test${persistentTests.length === 1 ? '' : 's'}`,
      });
    } else {
      actions.push({
        identifier: 'open_issue',
        label: CHECK_RUN_ACTION_CONFIGS.open_issue.label,
        description: `Create issue for ${tests.length} flaky test candidate${tests.length === 1 ? '' : 's'}`,
      });
    }
  }
  
  // Ensure we never exceed GitHub's 3-action limit
  return actions.slice(0, 3);
}

/**
 * Calculate severity level based on flake score
 * 
 * @param score - Flake score (0.0 to 1.0)
 * @returns Severity level classification
 */
export function calculateSeverity(score: number): SeverityLevel {
  if (score >= 0.8) {return 'critical';}
  if (score >= 0.5) {return 'warning';}
  return 'stable';
}

/**
 * Get emoji indicator for severity level
 * 
 * @param severity - Severity level
 * @returns Emoji character
 */
function getSeverityEmoji(severity: SeverityLevel): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'warning':
      return '🟡';
    case 'stable':
      return '🟢';
    default:
      return '⚪';
  }
}

// =============================================================================
// UTILITY FUNCTIONS FOR INTEGRATION
// =============================================================================

/**
 * Convert FlakeScore objects to TestWithLocation format
 * 
 * @param flakeScores - Array of flake score analysis results
 * @param repository - Repository context for file links
 * @returns Converted test data suitable for rendering
 */
export function convertFlakeScoresToTests(
  flakeScores: readonly FlakeScore[],
  _repository: Repository
): TestWithLocation[] {
  return flakeScores.map(score => {
    // Calculate rerun pass rate based on features
    const rerunPassRate = Math.max(0, score.features.rerunPassRate);
    
    // Determine file location if available (would need to be added to FlakeScore)
    // For now, we'll extract from testFullName if it follows common patterns
    const { file, line } = extractFileLocation(score.testFullName);
    
    return {
      testName: score.testName,
      failCount: score.features.recentFailures,
      rerunPassRate,
      lastFailedRun: score.lastUpdated.toISOString(),
      confidence: score.confidence,
      totalRuns: score.features.totalRuns,
      file,
      line,
      flakeScore: score.score,
    };
  });
}

/**
 * Convert TestStabilityMetrics to TestWithLocation format
 * 
 * @param metrics - Array of test stability metrics
 * @param repository - Repository context for file links
 * @returns Converted test data suitable for rendering
 */
export function convertStabilityMetricsToTests(
  metrics: readonly TestStabilityMetrics[],
  repository: Repository
): TestWithLocation[] {
  return metrics.map(metric => {
    const failureRate = metric.totalRuns > 0 ? metric.failedRuns / metric.totalRuns : 0;
    const rerunPassRate = metric.rerunAttempts > 0 
      ? metric.rerunSuccesses / metric.rerunAttempts 
      : Math.max(0, 1 - failureRate * 1.2);
    
    // Calculate confidence based on available data
    const confidence = calculateConfidenceFromMetrics(metric);
    
    // Extract file location
    const { file, line } = extractFileLocation(metric.testFullName);
    
    return {
      testName: metric.testName,
      failCount: metric.failedRuns,
      rerunPassRate,
      lastFailedRun: metric.lastFailure?.toISOString() || null,
      confidence,
      totalRuns: metric.totalRuns,
      file,
      line,
      flakeScore: failureRate, // Use failure rate as flake score approximation
    };
  });
}

/**
 * Calculate confidence score from stability metrics
 */
function calculateConfidenceFromMetrics(metric: TestStabilityMetrics): number {
  if (metric.totalRuns < 5) {return 0.1;} // Low confidence with few runs
  
  const failureRate = metric.failedRuns / metric.totalRuns;
  const hasRecentFailures = metric.lastFailure && 
    (Date.now() - metric.lastFailure.getTime()) < (7 * 24 * 60 * 60 * 1000);
  
  let confidence = failureRate;
  
  // Boost confidence for recent failures
  if (hasRecentFailures) {confidence *= 1.3;}
  
  // Boost confidence for intermittent patterns
  if (metric.rerunAttempts > 0) {
    const rerunSuccessRate = metric.rerunSuccesses / metric.rerunAttempts;
    if (rerunSuccessRate > 0.3) {confidence *= 1.2;} // Sometimes passes on rerun
  }
  
  // Factor in failure clustering
  if (metric.failureClusters.length > 1) {confidence *= 1.1;}
  
  return Math.min(1.0, confidence);
}

/**
 * Extract file location from test full name using common patterns
 */
function extractFileLocation(testFullName: string): { file?: string; line?: number } {
  // Common patterns:
  // - "path/to/file.test.ts:123 TestSuite TestCase"
  // - "file.spec.js:45 describe block test"
  // - "src/components/Button.test.tsx TestButton should render"
  
  const fileLineMatch = testFullName.match(/^([^\s]+\.(test|spec|tests)\.[jt]sx?):(\d+)/);
  if (fileLineMatch) {
    return {
      file: fileLineMatch[1]!,
      line: parseInt(fileLineMatch[3], 10),
    };
  }
  
  // Pattern without line number
  const fileMatch = testFullName.match(/^([^\s]+\.(test|spec|tests)\.[jt]sx?)/);
  if (fileMatch) {
    return {
      file: fileMatch[1]!,
      line: undefined,
    };
  }
  
  // Extract from common directory structures
  const pathMatch = testFullName.match(/(src|test|tests|spec|__tests__)\/.+\.(test|spec|tests)\.[jt]sx?/);
  if (pathMatch) {
    return {
      file: pathMatch[0],
      line: undefined,
    };
  }
  
  return { file: undefined, line: undefined };
}
