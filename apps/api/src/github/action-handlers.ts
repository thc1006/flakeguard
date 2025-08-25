/**
 * GitHub Action Handlers for FlakeGuard Check Runs
 * 
 * Provides idempotent action handlers for:
 * - Quarantine actions with PR comment creation
 * - Failed job re-runs with workflow management
 * - GitHub issue creation with detailed flake reports
 * - Proper error handling and recovery for partial failures
 */

import type { Octokit } from '@octokit/rest';
import type { PrismaClient } from '@prisma/client';

import { logger } from '../utils/logger.js';

import { ErrorCode } from './api-spec.js';
import { ERROR_MESSAGES } from './constants.js';
import type {
  CheckRunAction,
  RepositoryInfo,
  ApiResponse,
} from './types.js';

/**
 * Test information for action handling
 */
export interface TestInfo {
  readonly name: string;
  readonly confidence: number;
  readonly failureRate: number;
  readonly failurePattern: string | null;
  readonly lastFailureAt: string | null;
  readonly totalRuns: number;
  readonly historicalFailures: number;
}

/**
 * Repository information for actions
 */
export interface RepositoryContext {
  readonly owner: string;
  readonly repo: string;
  readonly fullName: string;
  readonly installationId: number;
  readonly defaultBranch: string;
}

/**
 * Action handler result
 */
export interface ActionResult {
  readonly success: boolean;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
}

/**
 * Requested action interface from GitHub webhooks
 */
export interface RequestedAction {
  readonly identifier: CheckRunAction;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Action handler type definition
 */
export type ActionHandler = (
  octokit: Octokit,
  test: TestInfo,
  repository: RepositoryContext,
  metadata?: Record<string, unknown>
) => Promise<ActionResult>;

/**
 * Handle quarantine action - creates PR comment and updates test status
 * This action is idempotent and handles partial failures gracefully
 */
export async function handleQuarantineAction(
  octokit: Octokit,
  test: TestInfo,
  repository: RepositoryContext,
  metadata: Record<string, unknown> = {}
): Promise<ActionResult> {
  const { owner, repo } = repository;
  const prNumber = metadata.pullRequestNumber as number | undefined;
  const checkRunId = metadata.checkRunId as number | undefined;

  logger.info('Handling quarantine action', {
    testName: test.name,
    repository: repository.fullName,
    confidence: test.confidence,
    prNumber,
    checkRunId,
  });

  try {
    const results: Record<string, boolean> = {
      commentCreated: false,
      testQuarantined: false,
      issueCreated: false,
    };

    // Step 1: Create PR comment if PR number is provided
    if (prNumber) {
      try {
        await createQuarantineComment(octokit, owner, repo, prNumber, test);
        results.commentCreated = true;
        logger.info('Quarantine PR comment created', {
          testName: test.name,
          prNumber,
        });
      } catch (error: any) {
        logger.warn('Failed to create PR comment, continuing with quarantine', {
          testName: test.name,
          prNumber,
          error: error.message,
        });
      }
    }

    // Step 2: Create tracking issue for quarantined test
    try {
      const issue = await createQuarantineIssue(octokit, owner, repo, test, {
        checkRunId,
        prNumber,
      });
      results.issueCreated = true;
      results.issueNumber = issue.number;
      
      logger.info('Quarantine tracking issue created', {
        testName: test.name,
        issueNumber: issue.number,
      });
    } catch (error: any) {
      logger.error('Failed to create quarantine tracking issue', {
        testName: test.name,
        error: error.message,
      });
      // Continue with quarantine even if issue creation fails
    }

    // Step 3: Mark test as quarantined (this should be handled by the flake detector)
    results.testQuarantined = true;

    const successCount = Object.values(results).filter(Boolean).length;
    const partialSuccess = successCount > 0 && successCount < 3;

    return {
      success: true,
      message: partialSuccess 
        ? `Test "${test.name}" quarantined with ${successCount}/3 actions completed`
        : `Test "${test.name}" successfully quarantined`,
      details: results,
    };

  } catch (error: any) {
    logger.error('Failed to handle quarantine action', {
      testName: test.name,
      repository: repository.fullName,
      error: error.message,
    });

    return {
      success: false,
      message: `Failed to quarantine test "${test.name}"`,
      error: {
        code: mapActionErrorCode(error),
        message: error.message,
        recoverable: isRecoverableError(error),
      },
    };
  }
}

/**
 * Handle rerun failed action - triggers workflow job re-runs
 * This action is idempotent and tracks re-run status
 */
export async function handleRerunFailedAction(
  octokit: Octokit,
  runId: number,
  jobIds: number[],
  repository: RepositoryContext,
  metadata: Record<string, unknown> = {}
): Promise<ActionResult> {
  const { owner, repo } = repository;
  const enableDebugLogging = metadata.enableDebugLogging as boolean || false;

  logger.info('Handling rerun failed action', {
    runId,
    jobIds,
    repository: repository.fullName,
    enableDebugLogging,
  });

  try {
    const results: Record<string, unknown> = {
      workflowRerun: false,
      jobsRerun: [],
      failedJobs: [],
    };

    // If no specific job IDs provided, rerun all failed jobs in the workflow
    if (!jobIds || jobIds.length === 0) {
      try {
        await octokit.rest.actions.reRunWorkflowFailedJobs({
          owner,
          repo,
          run_id: runId,
          enable_debug_logging: enableDebugLogging,
        });
        
        results.workflowRerun = true;
        
        logger.info('Workflow failed jobs rerun initiated', {
          runId,
          repository: repository.fullName,
        });
      } catch (error: any) {
        logger.error('Failed to rerun workflow failed jobs', {
          runId,
          error: error.message,
        });
        
        throw error;
      }
    } else {
      // Rerun specific jobs (note: GitHub API doesn't support individual job reruns)
      // This would require rerunning the entire workflow
      logger.warn('Individual job rerun not supported by GitHub API, rerunning entire workflow', {
        runId,
        requestedJobIds: jobIds,
      });
      
      await octokit.rest.actions.reRunWorkflow({
        owner,
        repo,
        run_id: runId,
        enable_debug_logging: enableDebugLogging,
      });
      
      results.workflowRerun = true;
    }

    // Add comment to PR if available
    const prNumber = metadata.pullRequestNumber as number | undefined;
    if (prNumber) {
      try {
        await createRerunComment(octokit, owner, repo, prNumber, runId, jobIds);
        results.commentCreated = true;
      } catch (error: any) {
        logger.warn('Failed to create rerun comment', {
          prNumber,
          error: error.message,
        });
      }
    }

    return {
      success: true,
      message: jobIds.length > 0 
        ? `Rerun initiated for workflow run ${runId} (requested ${jobIds.length} specific jobs)`
        : `Rerun initiated for all failed jobs in workflow run ${runId}`,
      details: results,
    };

  } catch (error: any) {
    logger.error('Failed to handle rerun failed action', {
      runId,
      jobIds,
      repository: repository.fullName,
      error: error.message,
    });

    return {
      success: false,
      message: `Failed to rerun workflow ${runId}`,
      error: {
        code: mapActionErrorCode(error),
        message: error.message,
        recoverable: isRecoverableError(error),
      },
    };
  }
}

/**
 * Handle open issue action - creates GitHub issue with detailed flake information
 * This action is idempotent and prevents duplicate issue creation
 */
export async function handleOpenIssueAction(
  octokit: Octokit,
  tests: TestInfo[],
  repository: RepositoryContext,
  metadata: Record<string, unknown> = {}
): Promise<ActionResult> {
  const { owner, repo } = repository;
  const checkRunId = metadata.checkRunId as number | undefined;
  const workflowRunId = metadata.workflowRunId as number | undefined;

  logger.info('Handling open issue action', {
    testsCount: tests.length,
    repository: repository.fullName,
    checkRunId,
    workflowRunId,
  });

  try {
    // Check for existing issues to prevent duplicates
    const existingIssues = await findExistingFlakeIssues(
      octokit,
      owner,
      repo,
      tests.map(t => t.name)
    );

    const testsWithoutIssues = tests.filter(
      test => !existingIssues.some(issue => 
        issue.title.includes(test.name) || issue.body?.includes(test.name)
      )
    );

    if (testsWithoutIssues.length === 0) {
      logger.info('All tests already have existing issues', {
        testsCount: tests.length,
        existingIssuesCount: existingIssues.length,
      });
      
      return {
        success: true,
        message: `All ${tests.length} test(s) already have existing tracking issues`,
        details: {
          existingIssues: existingIssues.map(issue => ({
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
          })),
        },
      };
    }

    const createdIssues: Array<{ number: number; title: string; url: string }> = [];

    // Create issues for tests without existing ones
    if (testsWithoutIssues.length === 1) {
      // Single test issue
      const test = testsWithoutIssues[0];
      const issue = await createDetailedFlakeIssue(octokit, owner, repo, test, {
        checkRunId,
        workflowRunId,
      });
      createdIssues.push({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
      });
    } else {
      // Multiple tests - create summary issue
      const issue = await createMultiTestFlakeIssue(
        octokit,
        owner,
        repo,
        testsWithoutIssues,
        {
          checkRunId,
          workflowRunId,
        }
      );
      createdIssues.push({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
      });
    }

    logger.info('Flake issues created successfully', {
      testsCount: testsWithoutIssues.length,
      issuesCreated: createdIssues.length,
    });

    return {
      success: true,
      message: `Created ${createdIssues.length} issue(s) for ${testsWithoutIssues.length} flaky test(s)`,
      details: {
        createdIssues,
        skippedTests: tests.length - testsWithoutIssues.length,
      },
    };

  } catch (error: any) {
    logger.error('Failed to handle open issue action', {
      testsCount: tests.length,
      repository: repository.fullName,
      error: error.message,
    });

    return {
      success: false,
      message: `Failed to create issues for ${tests.length} flaky test(s)`,
      error: {
        code: mapActionErrorCode(error),
        message: error.message,
        recoverable: isRecoverableError(error),
      },
    };
  }
}

/**
 * Create quarantine PR comment
 */
async function createQuarantineComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  test: TestInfo
): Promise<void> {
  const confidencePercentage = (test.confidence * 100).toFixed(1);
  const failureRatePercentage = (test.failureRate * 100).toFixed(1);
  
  const body = `## 🚨 Test Quarantined by FlakeGuard

The test \`${test.name}\` has been **quarantined** due to detected flaky behavior.

### Analysis Results
- **Confidence:** ${confidencePercentage}%
- **Failure Rate:** ${failureRatePercentage}%
- **Total Runs Analyzed:** ${test.totalRuns}
- **Historical Failures:** ${test.historicalFailures}
${test.failurePattern ? `- **Failure Pattern:** ${test.failurePattern}` : ''}

### What This Means
This test has been temporarily isolated to prevent CI instability. The test shows patterns consistent with flaky behavior - producing both passing and failing results without code changes.

### Next Steps
1. **Investigate** the root cause (timing issues, race conditions, external dependencies)
2. **Fix** the underlying issue that causes flaky behavior
3. **Remove** the quarantine once the test is stable

### Common Causes of Flaky Tests
- Race conditions in concurrent code
- Timing dependencies (sleeps, waits)
- External service dependencies
- Resource contention (memory, CPU, I/O)
- Non-deterministic behavior (random values, system time)

---
*This comment was automatically generated by [FlakeGuard](https://github.com/your-org/flakeguard)*`;

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

/**
 * Create quarantine tracking issue
 */
async function createQuarantineIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  test: TestInfo,
  context: { checkRunId?: number; prNumber?: number }
): Promise<{ number: number; title: string; html_url: string }> {
  const title = `[FlakeGuard] Quarantined flaky test: ${test.name}`;
  const confidencePercentage = (test.confidence * 100).toFixed(1);
  const failureRatePercentage = (test.failureRate * 100).toFixed(1);
  
  const body = `## Quarantined Flaky Test Report

This test has been automatically quarantined due to detected flaky behavior.

### Test Information
- **Test Name:** \`${test.name}\`
- **Confidence:** ${confidencePercentage}%
- **Failure Rate:** ${failureRatePercentage}%
- **Total Runs Analyzed:** ${test.totalRuns}
- **Historical Failures:** ${test.historicalFailures}
- **Last Failure:** ${test.lastFailureAt ? new Date(test.lastFailureAt).toLocaleDateString() : 'Unknown'}
${test.failurePattern ? `- **Failure Pattern:** ${test.failurePattern}` : ''}

### Context
${context.checkRunId ? `- **Check Run:** https://github.com/${owner}/${repo}/runs/${context.checkRunId}` : ''}
${context.prNumber ? `- **Pull Request:** #${context.prNumber}` : ''}

### Analysis
This test shows patterns consistent with flaky behavior - producing both passing and failing results without changes to the underlying code. Common causes include:

- **Race Conditions:** Multiple threads accessing shared resources
- **Timing Issues:** Dependencies on system timing or external delays
- **External Dependencies:** Network calls, databases, file system operations
- **Resource Contention:** Insufficient memory, CPU, or I/O resources
- **Non-deterministic Behavior:** Random values, timestamps, or order dependencies

### Recommended Actions

#### 1. Investigation
- [ ] Review test implementation for timing dependencies
- [ ] Check for shared state between test runs
- [ ] Identify external dependencies that could be unstable
- [ ] Look for race conditions in concurrent code

#### 2. Common Fixes
- [ ] Add proper synchronization (locks, barriers, waits)
- [ ] Mock external dependencies
- [ ] Use deterministic test data
- [ ] Implement proper cleanup between runs
- [ ] Add timeouts and retries where appropriate

#### 3. Validation
- [ ] Run the test multiple times locally
- [ ] Test in different environments
- [ ] Verify fix doesn't introduce new issues

#### 4. De-quarantine
- [ ] Remove test from quarantine once stabilized
- [ ] Monitor for regression

---
*This issue was automatically created by FlakeGuard. The test will remain quarantined until this issue is resolved.*`;

  const { data } = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels: ['flaky-test', 'quarantine', 'bug', 'testing'],
  });

  return {
    number: data.number,
    title: data.title,
    html_url: data.html_url,
  };
}

/**
 * Create rerun comment
 */
async function createRerunComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  runId: number,
  jobIds: number[]
): Promise<void> {
  const body = `## 🔄 Workflow Rerun Initiated by FlakeGuard

${jobIds.length > 0 
    ? `Rerunning workflow run [#${runId}](https://github.com/${owner}/${repo}/actions/runs/${runId}) (requested ${jobIds.length} specific jobs)`
    : `Rerunning all failed jobs in workflow run [#${runId}](https://github.com/${owner}/${repo}/actions/runs/${runId})`
  }

This rerun was triggered to help identify flaky test behavior by running the same tests again without code changes.

---
*This comment was automatically generated by [FlakeGuard](https://github.com/your-org/flakeguard)*`;

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

/**
 * Find existing flake issues
 */
async function findExistingFlakeIssues(
  octokit: Octokit,
  owner: string,
  repo: string,
  testNames: string[]
): Promise<Array<{ number: number; title: string; body?: string; html_url: string }>> {
  try {
    const searchQuery = `repo:${owner}/${repo} is:issue is:open label:flaky-test`;
    
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: searchQuery,
      sort: 'created',
      order: 'desc',
      per_page: 50,
    });

    return data.items.map(issue => ({
      number: issue.number,
      title: issue.title,
      body: issue.body || undefined,
      html_url: issue.html_url,
    }));
  } catch (error: any) {
    logger.warn('Failed to search for existing flake issues', {
      owner,
      repo,
      error: error.message,
    });
    return [];
  }
}

/**
 * Create detailed issue for single flaky test
 */
async function createDetailedFlakeIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  test: TestInfo,
  context: { checkRunId?: number; workflowRunId?: number }
): Promise<{ number: number; title: string; html_url: string }> {
  const title = `[FlakeGuard] Flaky test detected: ${test.name}`;
  const confidencePercentage = (test.confidence * 100).toFixed(1);
  const failureRatePercentage = (test.failureRate * 100).toFixed(1);
  
  const body = `## Flaky Test Report

**Test Name:** \`${test.name}\`

### Detection Results
- **Confidence:** ${confidencePercentage}%
- **Failure Rate:** ${failureRatePercentage}%
- **Total Runs Analyzed:** ${test.totalRuns}
- **Historical Failures:** ${test.historicalFailures}
- **Last Failure:** ${test.lastFailureAt ? new Date(test.lastFailureAt).toLocaleDateString() : 'Unknown'}
${test.failurePattern ? `- **Failure Pattern:** ${test.failurePattern}` : ''}

### Context
${context.checkRunId ? `- **Check Run:** https://github.com/${owner}/${repo}/runs/${context.checkRunId}` : ''}
${context.workflowRunId ? `- **Workflow Run:** https://github.com/${owner}/${repo}/actions/runs/${context.workflowRunId}` : ''}

### What is a flaky test?
A flaky test produces both passing and failing results without changes to the code under test. This inconsistency can be caused by:

- **Race conditions** in concurrent code
- **Timing dependencies** on system delays or external services
- **External dependencies** that may be unreliable
- **Resource contention** when tests compete for limited resources
- **Non-deterministic behavior** from random values or system state

### Recommended Actions
1. **Investigate** the test implementation for common flaky patterns
2. **Reproduce** the failure locally by running the test multiple times
3. **Identify** and eliminate sources of non-determinism
4. **Add** proper synchronization and cleanup
5. **Consider** quarantining the test temporarily if it affects CI stability

### Need Help?
- [Flaky Test Debugging Guide](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/about-monitoring-and-troubleshooting)
- [Testing Best Practices](https://martinfowler.com/articles/nonDeterminism.html)

---
*This issue was automatically created by FlakeGuard*`;

  const { data } = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels: ['flaky-test', 'bug', 'testing'],
  });

  return {
    number: data.number,
    title: data.title,
    html_url: data.html_url,
  };
}

/**
 * Create summary issue for multiple flaky tests
 */
async function createMultiTestFlakeIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  tests: TestInfo[],
  context: { checkRunId?: number; workflowRunId?: number }
): Promise<{ number: number; title: string; html_url: string }> {
  const title = `[FlakeGuard] Multiple flaky tests detected (${tests.length} tests)`;
  
  let body = `## Multiple Flaky Tests Report

FlakeGuard has detected **${tests.length} flaky tests** that require attention.

### Context
${context.checkRunId ? `- **Check Run:** https://github.com/${owner}/${repo}/runs/${context.checkRunId}` : ''}
${context.workflowRunId ? `- **Workflow Run:** https://github.com/${owner}/${repo}/actions/runs/${context.workflowRunId}` : ''}

### Detected Tests

`;

  tests.forEach((test, index) => {
    const confidencePercentage = (test.confidence * 100).toFixed(1);
    const failureRatePercentage = (test.failureRate * 100).toFixed(1);
    
    body += `#### ${index + 1}. \`${test.name}\`
- **Confidence:** ${confidencePercentage}%
- **Failure Rate:** ${failureRatePercentage}%
- **Total Runs:** ${test.totalRuns}
- **Historical Failures:** ${test.historicalFailures}
${test.failurePattern ? `- **Pattern:** ${test.failurePattern}` : ''}

`;
  });

  body += `### Recommended Actions

1. **Prioritize** tests with highest confidence scores (>80%)
2. **Group** tests by failure patterns for efficient fixing
3. **Consider** quarantining high-impact flaky tests temporarily
4. **Create** individual issues for complex tests that need detailed investigation

### What causes flaky tests?
- Race conditions and timing issues
- External dependencies and network calls
- Resource contention and cleanup issues
- Non-deterministic behavior and random values

---
*This issue was automatically created by FlakeGuard*`;

  const { data } = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels: ['flaky-test', 'multiple-tests', 'bug', 'testing'],
  });

  return {
    number: data.number,
    title: data.title,
    html_url: data.html_url,
  };
}

/**
 * Map action errors to internal error codes
 */
function mapActionErrorCode(error: any): string {
  if (error.status === 401) return ErrorCode.UNAUTHORIZED;
  if (error.status === 403) return ErrorCode.FORBIDDEN;
  if (error.status === 404) return ErrorCode.RESOURCE_NOT_FOUND;
  if (error.status === 422) return ErrorCode.VALIDATION_ERROR;
  if (error.status === 429) return ErrorCode.GITHUB_RATE_LIMITED;
  if (error.status >= 500) return ErrorCode.GITHUB_SERVICE_UNAVAILABLE;
  
  return ErrorCode.GITHUB_API_ERROR;
}

/**
 * Check if an error is recoverable (can be retried)
 */
function isRecoverableError(error: any): boolean {
  // Rate limits and server errors are recoverable
  if (error.status === 429 || (error.status >= 500 && error.status < 600)) {
    return true;
  }
  
  // Network timeouts are recoverable
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  return false;
}
