/**
 * GitHub API Helpers
 * 
 * Comprehensive helper functions for GitHub API operations including:
 * - Check run helper functions with up to 3 requested actions
 * - Workflow re-run functionality for failed jobs and complete workflows  
 * - Artifact listing and one-shot download URL generation
 * - Authentication and client management
 * - Rate limiting and retry logic
 * - Error handling and logging
 */

import { logger } from '../utils/logger.js';

import { ErrorCode } from './api-spec.js';
import { GitHubAuthManager } from './auth.js';
import {
  CHECK_RUN_ACTION_CONFIGS,
  ERROR_MESSAGES,
  ARTIFACT_TYPES,
} from './constants.js';
import type {
  CheckRunAction,
  FlakeAnalysis,
  CreateCheckRunParams,
  UpdateCheckRunParams,
  FlakeGuardCheckRun,
  TestArtifact,
  ApiResponse,
} from './types.js';


/**
 * Flake issue creation parameters
 */
export interface FlakeIssueParams {
  readonly testName: string;
  readonly confidence: number;
  readonly failureRate: number;
  readonly failurePattern: string | null;
  readonly checkRunUrl: string;
}

/**
 * Flake summary for repository
 */
export interface FlakeSummary {
  readonly totalFlaky: number;
  readonly totalQuarantined: number;
  readonly recentlyDetected: number;
  readonly topFlaky: ReadonlyArray<{
    readonly testName: string;
    readonly confidence: number;
    readonly failureRate: number;
    readonly lastFailureAt: string | null;
  }>;
}

/**
 * GitHub API Helpers class
 */
export class GitHubHelpers {
  private readonly authManager: GitHubAuthManager;

  constructor(authManager: GitHubAuthManager) {
    this.authManager = authManager;
  }

  // =============================================================================
  // CHECK RUN OPERATIONS
  // =============================================================================

  /**
   * Create a check run with FlakeGuard branding and actions
   */
  async createCheckRun(
    owner: string,
    repo: string,
    params: Omit<CreateCheckRunParams, 'owner' | 'repo'>,
    installationId: number
  ): Promise<ApiResponse<FlakeGuardCheckRun>> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      const { data } = await client.rest.checks.create({
        owner,
        repo,
        name: params.name,
        head_sha: params.headSha,
        status: params.status as 'queued' | 'in_progress' | 'completed',
        conclusion: params.conclusion as "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | undefined,
        started_at: params.startedAt,
        completed_at: params.completedAt,
        output: params.output,
        actions: params.actions?.map(action => ({
          label: action.label,
          description: action.description,
          identifier: action.identifier,
        })),
      });

      const checkRun: FlakeGuardCheckRun = {
        id: data.id,
        name: data.name,
        headSha: data.head_sha,
        status: data.status as 'queued' | 'in_progress' | 'completed',
        conclusion: data.conclusion as "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | null,
        startedAt: data.started_at,
        completedAt: data.completed_at,
        output: {
          title: data.output?.title || '',
          summary: data.output?.summary || '',
          text: data.output?.text || undefined,
        },
        actions: (data as { actions?: Array<{ label: string; description: string; identifier: string }> }).actions?.map((action: { label: string; description: string; identifier: string }) => ({
          label: action.label,
          description: action.description,
          identifier: action.identifier as CheckRunAction,
        })) || [],
      };

      logger.info('Check run created', {
        owner,
        repo,
        checkRunId: data.id,
        name: data.name,
      });

      return { success: true, data: checkRun };

    } catch (error: unknown) {
      logger.error('Failed to create check run', {
        owner,
        repo,
        name: params.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: error && typeof error === 'object' && 'status' in error ? (error as { status: unknown }).status : undefined,
      });

      return {
        success: false,
        error: {
          code: this.mapGitHubErrorCode(error),
          message: error instanceof Error ? error.message : ERROR_MESSAGES.GITHUB_API_ERROR,
        },
      };
    }
  }

  /**
   * Update a check run with new status, conclusion, and actions
   */
  async updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    installationId: number,
    updates: Omit<UpdateCheckRunParams, 'checkRunId'>
  ): Promise<ApiResponse<FlakeGuardCheckRun>> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      const { data } = await client.rest.checks.update({
        owner,
        repo,
        check_run_id: checkRunId,
        status: updates.status as 'queued' | 'in_progress' | 'completed',
        conclusion: updates.conclusion as 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'skipped' | 'stale' | undefined,
        completed_at: updates.completedAt,
        output: updates.output,
        actions: updates.actions?.map(action => ({
          label: action.label,
          description: action.description,
          identifier: action.identifier,
        })),
      });

      const checkRun: FlakeGuardCheckRun = {
        id: data.id,
        name: data.name,
        headSha: data.head_sha,
        status: data.status as 'queued' | 'in_progress' | 'completed',
        conclusion: data.conclusion as "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | null,
        startedAt: data.started_at,
        completedAt: data.completed_at,
        output: {
          title: data.output?.title || '',
          summary: data.output?.summary || '',
          text: data.output?.text || undefined,
        },
        actions: (data as { actions?: Array<{ label: string; description: string; identifier: string }> }).actions?.map((action: { label: string; description: string; identifier: string }) => ({
          label: action.label,
          description: action.description,
          identifier: action.identifier as CheckRunAction,
        })) || [],
      };

      logger.info('Check run updated', {
        owner,
        repo,
        checkRunId,
        status: updates.status,
        conclusion: updates.conclusion,
      });

      return { success: true, data: checkRun };

    } catch (error: unknown) {
      logger.error('Failed to update check run', {
        owner,
        repo,
        checkRunId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: {
          code: this.mapGitHubErrorCode(error),
          message: error instanceof Error ? error.message : ERROR_MESSAGES.GITHUB_API_ERROR,
        },
      };
    }
  }

  /**
   * Update check run with flake actions
   */
  async updateCheckRunWithFlakeActions(
    owner: string,
    repo: string,
    checkRunId: number,
    installationId: number
  ): Promise<void> {
    const actions = [
      CHECK_RUN_ACTION_CONFIGS.quarantine,
      CHECK_RUN_ACTION_CONFIGS.rerun_failed,
      CHECK_RUN_ACTION_CONFIGS.open_issue,
    ];

    await this.updateCheckRun(owner, repo, checkRunId, installationId, {
      actions: actions.map(config => ({
        label: config.label,
        description: config.description,
        identifier: config.identifier,
      })),
    });
  }

  /**
   * Update check run with flake detection results
   */
  async updateCheckRunWithFlakeDetection(
    owner: string,
    repo: string,
    checkRunId: number,
    installationId: number,
    analysis: FlakeAnalysis,
    suggestedActions: readonly CheckRunAction[]
  ): Promise<void> {
    const confidenceLevel = this.getConfidenceLabel(analysis.confidence);
    const title = analysis.isFlaky 
      ? `🚨 Flaky Test Detected (${confidenceLevel} confidence)`
      : '✅ Test Analysis Complete';

    const summary = analysis.isFlaky
      ? this.generateFlakeDetectionSummary(analysis)
      : 'No flaky behavior detected in this test execution.';

    const actions = suggestedActions.slice(0, 3).map(actionId => {
      const config = CHECK_RUN_ACTION_CONFIGS[actionId];
      return {
        label: config.label,
        description: config.description,
        identifier: config.identifier,
      } as const;
    });

    await this.updateCheckRun(owner, repo, checkRunId, installationId, {
      conclusion: analysis.isFlaky ? 'neutral' : 'success',
      output: {
        title,
        summary,
      },
      actions,
    });
  }

  /**
   * Create FlakeGuard check run for detected flaky test
   */
  async createFlakeGuardCheckRun(
    owner: string,
    repo: string,
    headSha: string,
    installationId: number,
    params: {
      testName: string;
      isFlaky: boolean;
      confidence: number;
      failurePattern: string | null;
      suggestedActions: readonly CheckRunAction[];
    }
  ): Promise<void> {
    const { testName, isFlaky, confidence, failurePattern, suggestedActions } = params;
    
    const confidenceLevel = this.getConfidenceLabel(confidence);
    const name = `FlakeGuard: ${testName}`;
    
    let title: string;
    let summary: string;
    let conclusion: 'success' | 'failure' | 'neutral';

    if (isFlaky) {
      title = `🚨 Flaky Test Detected (${confidenceLevel} confidence)`;
      summary = `Test "${testName}" shows flaky behavior with ${(confidence * 100).toFixed(1)}% confidence.\n\n`;
      
      if (failurePattern) {
        summary += `**Failure Pattern:** ${failurePattern}\n\n`;
      }
      
      summary += '**Suggested Actions:**\n';
      summary += suggestedActions.map(action => 
        `- ${CHECK_RUN_ACTION_CONFIGS[action].label}: ${CHECK_RUN_ACTION_CONFIGS[action].description}`
      ).join('\n');
      
      conclusion = 'neutral';
    } else {
      title = '✅ No Flaky Behavior Detected';
      summary = `Test "${testName}" appears to be stable based on current analysis.`;
      conclusion = 'success';
    }

    const actions = suggestedActions.slice(0, 3).map(actionId => {
      const config = CHECK_RUN_ACTION_CONFIGS[actionId];
      return {
        label: config.label,
        description: config.description,
        identifier: config.identifier,
      } as const;
    });

    await this.createCheckRun(owner, repo, {
      name,
      headSha,
      status: 'completed',
      conclusion,
      completedAt: new Date().toISOString(),
      output: { title, summary },
      actions,
    }, installationId);
  }

  /**
   * Create FlakeGuard summary check run
   */
  async createFlakeGuardSummaryCheckRun(
    owner: string,
    repo: string,
    headSha: string,
    installationId: number,
    summary: FlakeSummary,
    hasFailures: boolean
  ): Promise<void> {
    const title = hasFailures 
      ? '🔍 FlakeGuard Analysis Complete - Issues Found'
      : '✅ FlakeGuard Analysis Complete - No Issues';

    let summaryText = '## FlakeGuard Test Analysis Summary\n\n';
    summaryText += `- **Total Flaky Tests:** ${summary.totalFlaky}\n`;
    summaryText += `- **Quarantined Tests:** ${summary.totalQuarantined}\n`;
    summaryText += `- **Recently Detected:** ${summary.recentlyDetected}\n\n`;

    if (summary.topFlaky.length > 0) {
      summaryText += '## Top Flaky Tests\n\n';
      for (const test of summary.topFlaky.slice(0, 5)) {
        summaryText += `- **${test.testName}** - `;
        summaryText += `${(test.confidence * 100).toFixed(1)}% confidence, `;
        summaryText += `${(test.failureRate * 100).toFixed(1)}% failure rate\n`;
      }
    }

    const conclusion = summary.totalFlaky > 0 ? 'neutral' : 'success';
    const actions: Array<{
      label: string;
      description: string;
      identifier: string;
    }> = [];

    if (hasFailures) {
      actions.push({
        label: 'Rerun Failed Jobs',
        description: 'Rerun only the failed jobs in this workflow',
        identifier: 'rerun_failed' as const,
      });
    }

    if (summary.totalFlaky > 0) {
      actions.push({
        label: 'View Flaky Tests',
        description: 'Open detailed report of flaky tests',
        identifier: 'open_issue' as const,
      });
    }

    await this.createCheckRun(owner, repo, {
      name: 'FlakeGuard Summary',
      headSha,
      status: 'completed',
      conclusion,
      completedAt: new Date().toISOString(),
      output: {
        title,
        summary: summaryText,
      },
      actions: actions.slice(0, 3),
    }, installationId);
  }

  // =============================================================================
  // WORKFLOW OPERATIONS
  // =============================================================================

  /**
   * Rerun entire workflow
   */
  async rerunWorkflow(
    owner: string,
    repo: string,
    runId: number,
    installationId: number,
    options: {
      enableDebugLogging?: boolean;
    } = {}
  ): Promise<{ success: true; message: string; runId: number }> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      await client.rest.actions.reRunWorkflow({
        owner,
        repo,
        run_id: runId,
        enable_debug_logging: options.enableDebugLogging,
      });

      logger.info('Workflow rerun initiated', {
        owner,
        repo,
        runId,
      });

      return {
        success: true,
        message: 'Workflow rerun initiated successfully',
        runId,
      };

    } catch (error: unknown) {
      logger.error('Failed to rerun workflow', {
        owner,
        repo,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to rerun workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Rerun only failed jobs in a workflow
   */
  async rerunFailedJobs(
    owner: string,
    repo: string,
    runId: number,
    installationId: number,
    options: {
      enableDebugLogging?: boolean;
    } = {}
  ): Promise<{ success: true; message: string; runId: number }> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      await client.rest.actions.reRunWorkflowFailedJobs({
        owner,
        repo,
        run_id: runId,
        enable_debug_logging: options.enableDebugLogging,
      });

      logger.info('Failed jobs rerun initiated', {
        owner,
        repo,
        runId,
      });

      return {
        success: true,
        message: 'Failed jobs rerun initiated successfully',
        runId,
      };

    } catch (error: unknown) {
      logger.error('Failed to rerun failed jobs', {
        owner,
        repo,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to rerun failed jobs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Cancel workflow run
   */
  async cancelWorkflow(
    owner: string,
    repo: string,
    runId: number,
    installationId: number
  ): Promise<{ success: true; message: string }> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      await client.rest.actions.cancelWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });

      logger.info('Workflow cancelled', {
        owner,
        repo,
        runId,
      });

      return {
        success: true,
        message: 'Workflow cancelled successfully',
      };

    } catch (error: unknown) {
      logger.error('Failed to cancel workflow', {
        owner,
        repo,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to cancel workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get workflow jobs
   */
  async getWorkflowJobs(
    owner: string,
    repo: string,
    runId: number,
    installationId: number
  ): Promise<Array<{
    id: number;
    run_id: number;
    workflow_name: string | null;
    head_branch: string | null;
    run_url: string;
    run_attempt: number | undefined;
    node_id: string;
    head_sha: string;
    url: string;
    html_url: string | null;
    status: string;
    conclusion: string | null;
    started_at: string;
    completed_at: string | null;
    name: string;
    check_run_url: string;
    labels: string[];
    runner_id: number | null;
    runner_name: string | null;
    runner_group_id: number | null;
    runner_group_name: string | null;
  }>> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      const { data } = await client.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });

      return data.jobs.map(job => ({...job, run_attempt: job.run_attempt ?? 1}));

    } catch (error: unknown) {
      logger.error('Failed to get workflow jobs', {
        owner,
        repo,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to get workflow jobs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // =============================================================================
  // ARTIFACT OPERATIONS
  // =============================================================================

  /**
   * List artifacts for a workflow run
   */
  async listArtifacts(
    owner: string,
    repo: string,
    runId: number,
    installationId: number,
    options: {
      page?: number;
      perPage?: number;
      name?: string;
    } = {}
  ): Promise<TestArtifact[]> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      const { data } = await client.rest.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: runId,
        page: options.page,
        per_page: options.perPage,
        name: options.name,
      });

      return data.artifacts.map((artifact): TestArtifact => ({
        id: artifact.id,
        name: artifact.name,
        type: this.inferArtifactType(artifact.name) as 'test-results' | 'coverage-report' | 'logs' | 'screenshots',
        sizeInBytes: artifact.size_in_bytes,
        url: artifact.url,
        archiveDownloadUrl: artifact.archive_download_url,
        expired: artifact.expired,
        createdAt: artifact.created_at ?? new Date().toISOString(),
        expiresAt: artifact.expires_at,
        updatedAt: artifact.updated_at,
      }));

    } catch (error: unknown) {
      logger.error('Failed to list artifacts', {
        owner,
        repo,
        runId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to list artifacts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate download URL for artifact
   */
  async generateArtifactDownloadUrl(
    owner: string,
    repo: string,
    artifactId: number,
    installationId: number
  ): Promise<{
    downloadUrl: string;
    expiresAt: string;
    sizeInBytes: number;
  }> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      // First get artifact metadata
      const { data: artifact } = await client.rest.actions.getArtifact({
        owner,
        repo,
        artifact_id: artifactId,
      });

      if (artifact.expired) {
        throw new Error('Artifact has expired');
      }

      // Download URL is the archive_download_url
      return {
        downloadUrl: artifact.archive_download_url,
        expiresAt: artifact.expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Default to 24h from now
        sizeInBytes: artifact.size_in_bytes,
      };

    } catch (error: unknown) {
      logger.error('Failed to generate artifact download URL', {
        owner,
        repo,
        artifactId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to generate download URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // =============================================================================
  // ISSUE OPERATIONS
  // =============================================================================

  /**
   * Create GitHub issue for flaky test
   */
  async createFlakeIssue(
    owner: string,
    repo: string,
    installationId: number,
    params: FlakeIssueParams
  ): Promise<void> {
    try {
      const client = await this.authManager.getInstallationClient(installationId);
      
      const title = `[FlakeGuard] Flaky test detected: ${params.testName}`;
      let body = '## Flaky Test Report\n\n';
      body += `**Test Name:** ${params.testName}\n`;
      body += `**Confidence:** ${(params.confidence * 100).toFixed(1)}%\n`;
      body += `**Failure Rate:** ${(params.failureRate * 100).toFixed(1)}%\n`;
      
      if (params.failurePattern) {
        body += `**Failure Pattern:** ${params.failurePattern}\n`;
      }
      
      body += `**Check Run:** ${params.checkRunUrl}\n\n`;
      body += '### What is a flaky test?\n\n';
      body += 'A flaky test is a test that produces both passing and failing results ';
      body += 'without any changes to the code. This can be caused by:\n\n';
      body += '- Race conditions\n';
      body += '- Timing issues\n';
      body += '- External dependencies\n';
      body += '- Resource contention\n';
      body += '- Non-deterministic behavior\n\n';
      body += '### Recommended Actions\n\n';
      body += '1. Review the test implementation for timing issues\n';
      body += '2. Check for external dependencies that might be unstable\n';
      body += '3. Consider adding proper synchronization or waits\n';
      body += '4. Investigate resource cleanup between test runs\n';
      body += '5. Consider quarantining the test temporarily if it affects CI stability\n\n';
      body += '---\n';
      body += '*This issue was automatically created by FlakeGuard*';

      await client.rest.issues.create({
        owner,
        repo,
        title,
        body,
        labels: ['flaky-test', 'bug', 'testing'],
      });

      logger.info('Flake issue created', {
        owner,
        repo,
        testName: params.testName,
        title,
      });

    } catch (error: unknown) {
      logger.error('Failed to create flake issue', {
        owner,
        repo,
        testName: params.testName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private generateFlakeDetectionSummary(analysis: FlakeAnalysis): string {
    let summary = `This test shows flaky behavior with ${(analysis.confidence * 100).toFixed(1)}% confidence.\n\n`;
    
    summary += `**Statistics:**\n`;
    summary += `- Failure Rate: ${(analysis.failureRate * 100).toFixed(1)}%\n`;
    summary += `- Total Runs Analyzed: ${analysis.totalRuns}\n`;
    summary += `- Historical Failures: ${analysis.historicalFailures}\n`;
    
    if (analysis.lastFailureAt) {
      const lastFailure = new Date(analysis.lastFailureAt);
      summary += `- Last Failure: ${lastFailure.toLocaleDateString()}\n`;
    }
    
    if (analysis.failurePattern) {
      summary += `\n**Failure Pattern:** ${analysis.failurePattern}\n`;
    }
    
    summary += '\n**What this means:**\n';
    summary += 'This test intermittently fails without code changes, ';
    summary += 'which may indicate timing issues, race conditions, or ';
    summary += 'unstable external dependencies.';

    return summary;
  }

  private getConfidenceLabel(confidence: number): string {
    if (confidence >= 0.8) {return 'High';}
    if (confidence >= 0.5) {return 'Medium';}
    return 'Low';
  }

  private inferArtifactType(artifactName: string): 'test-results' | 'coverage-report' | 'logs' | 'screenshots' {
    const name = artifactName.toLowerCase();
    
    if (name.includes('test') || name.includes('junit') || name.includes('results')) {
      return ARTIFACT_TYPES.TEST_RESULTS;
    }
    if (name.includes('coverage') || name.includes('cov')) {
      return ARTIFACT_TYPES.COVERAGE_REPORT;
    }
    if (name.includes('log') || name.includes('output')) {
      return ARTIFACT_TYPES.LOGS;
    }
    if (name.includes('screenshot') || name.includes('image') || name.includes('png')) {
      return ARTIFACT_TYPES.SCREENSHOTS;
    }
    
    return 'logs'; // Default to logs if we can't determine the type
  }

  private mapGitHubErrorCode(error: unknown): ErrorCode {
    const status = error && typeof error === 'object' && 'status' in error ? (error as { status: unknown }).status : undefined;
    if (status === 401) {return ErrorCode.UNAUTHORIZED;}
    if (status === 403) {return ErrorCode.FORBIDDEN;}
    if (status === 404) {return ErrorCode.RESOURCE_NOT_FOUND;}
    if (status === 422) {return ErrorCode.VALIDATION_ERROR;}
    if (status === 429) {return ErrorCode.GITHUB_RATE_LIMITED;}
    if (typeof status === 'number' && status >= 500) {return ErrorCode.GITHUB_SERVICE_UNAVAILABLE;}
    
    return ErrorCode.GITHUB_API_ERROR;
  }
}

/**
 * Create GitHub helpers instance
 */
export function createGitHubHelpers(authManager: GitHubAuthManager): GitHubHelpers {
  return new GitHubHelpers(authManager);
}