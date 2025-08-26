/**
 * GitHub-specific types exported from @flakeguard/shared
 * These types can be reused across the entire FlakeGuard monorepo
 * 
 * Note: This file defines shared types that mirror those in the API package
 * to avoid circular dependencies while maintaining type safety across packages.
 */

import type {
  CheckRunEvent,
  CheckSuiteEvent,
  WorkflowRunEvent,
  WorkflowJobEvent,
  PullRequestEvent,
  PushEvent,
  IssuesEvent,
  InstallationEvent,
} from '@octokit/webhooks-types';

// =============================================================================
// CORE GITHUB TYPES (mirrored from API package)
// =============================================================================

export const CHECK_RUN_ACTIONS = [
  'quarantine',
  'rerun_failed',
  'open_issue',
  'dismiss_flake',
  'mark_stable',
] as const;

export type CheckRunAction = typeof CHECK_RUN_ACTIONS[number];

export const CHECK_RUN_CONCLUSIONS = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
] as const;

export type CheckRunConclusion = typeof CHECK_RUN_CONCLUSIONS[number];

export const CHECK_RUN_STATUS = ['queued', 'in_progress', 'completed'] as const;

export type CheckRunStatus = typeof CHECK_RUN_STATUS[number];

export const WORKFLOW_RUN_CONCLUSIONS = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
] as const;

export type WorkflowRunConclusion = typeof WORKFLOW_RUN_CONCLUSIONS[number];

export const WORKFLOW_RUN_STATUS = [
  'queued',
  'in_progress',
  'completed',
  'waiting',
  'requested',
  'pending',
] as const;

export type WorkflowRunStatus = typeof WORKFLOW_RUN_STATUS[number];

export interface GitHubAppConfig {
  readonly appId: number;
  readonly privateKey: string;
  readonly webhookSecret: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly installationId?: number;
}

export interface FlakeAnalysis {
  readonly isFlaky: boolean;
  readonly confidence: number;
  readonly failurePattern: string | null;
  readonly historicalFailures: number;
  readonly totalRuns: number;
  readonly failureRate: number;
  readonly lastFailureAt: string | null;
  readonly suggestedAction: CheckRunAction | null;
}

export interface GitHubTestResult {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly duration?: number;
  readonly errorMessage?: string;
  readonly stackTrace?: string;
  readonly flakeAnalysis?: FlakeAnalysis;
}

export interface FlakeGuardCheckRun {
  readonly id: number;
  readonly name: string;
  readonly headSha: string;
  readonly status: CheckRunStatus;
  readonly conclusion: CheckRunConclusion | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly output: {
    readonly title: string;
    readonly summary: string;
    readonly text?: string;
  };
  readonly actions: ReadonlyArray<{
    readonly label: string;
    readonly description: string;
    readonly identifier: CheckRunAction;
  }>;
}

export interface RepositoryInfo {
  readonly id: number;
  readonly nodeId: string;
  readonly name: string;
  readonly fullName: string;
  readonly owner: {
    readonly login: string;
    readonly id: number;
    readonly type: 'User' | 'Organization';
  };
  readonly private: boolean;
  readonly defaultBranch: string;
  readonly pushedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

export type SupportedWebhookEvent =
  | CheckRunEvent
  | CheckSuiteEvent
  | WorkflowRunEvent
  | WorkflowJobEvent
  | PullRequestEvent
  | PushEvent
  | IssuesEvent
  | InstallationEvent;

export type WebhookPayload<T extends string> = T extends 'check_run'
  ? CheckRunEvent
  : T extends 'check_suite'
  ? CheckSuiteEvent
  : T extends 'workflow_run'
  ? WorkflowRunEvent
  : T extends 'workflow_job'
  ? WorkflowJobEvent
  : T extends 'pull_request'
  ? PullRequestEvent
  : T extends 'push'
  ? PushEvent
  : T extends 'issues'
  ? IssuesEvent
  : T extends 'installation'
  ? InstallationEvent
  : never;

export type WebhookEventMap = {
  'check_run': CheckRunEvent;
  'check_suite': CheckSuiteEvent;
  'workflow_run': WorkflowRunEvent;
  'workflow_job': WorkflowJobEvent;
  'pull_request': PullRequestEvent;
  'push': PushEvent;
  'issues': IssuesEvent;
  'installation': InstallationEvent;
};

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
  readonly pagination?: {
    readonly page: number;
    readonly perPage: number;
    readonly totalCount: number;
    readonly totalPages: number;
  };
}

export type PaginatedResponse<T> = ApiResponse<ReadonlyArray<T>> & {
  readonly pagination: {
    readonly page: number;
    readonly perPage: number;
    readonly totalCount: number;
    readonly totalPages: number;
  };
};

// =============================================================================
// ADDITIONAL SHARED TYPES FOR CROSS-PACKAGE USAGE
// =============================================================================

/**
 * Common GitHub repository identifier
 */
export interface GitHubRepository {
  readonly owner: string;
  readonly repo: string;
  readonly fullName?: string;
}

/**
 * GitHub App installation context
 */
export interface GitHubInstallationContext {
  readonly installationId: number;
  readonly repository?: GitHubRepository;
  readonly sender?: {
    readonly login: string;
    readonly id: number;
    readonly type: 'User' | 'Organization';
  };
}

/**
 * Flake detection result for cross-service communication
 */
export interface FlakeDetectionResult {
  readonly testName: string;
  readonly isFlaky: boolean;
  readonly confidence: number;
  readonly recommendation: 'quarantine' | 'rerun' | 'investigate' | 'ignore';
  readonly evidence: {
    readonly failureRate: number;
    readonly inconsistentBehavior: boolean;
    readonly environmentalFactors: ReadonlyArray<string>;
    readonly similarFailures: number;
  };
}

/**
 * Test execution summary for reporting
 */
export interface TestExecutionSummary {
  readonly runId: string;
  readonly repository: GitHubRepository;
  readonly branch: string;
  readonly commit: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly skippedTests: number;
  readonly flakyTests: number;
  readonly flakeDetectionResults: ReadonlyArray<FlakeDetectionResult>;
}

/**
 * GitHub webhook processing status
 */
export interface WebhookProcessingStatus {
  readonly deliveryId: string;
  readonly eventType: string;
  readonly status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';
  readonly processedAt: string | null;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryCount: number;
    readonly nextRetryAt: string | null;
  };
}

// =============================================================================
// CHECK RUN OUTPUT AND ACTION INTERFACES
// =============================================================================

/**
 * Check run output interface for GitHub API
 */
export interface CheckRunOutput {
  readonly title: string;
  readonly summary: string;
  readonly text?: string;
  readonly annotationsCount?: number;
  readonly annotationsUrl?: string;
}

/**
 * Check run action definition interface
 */
export interface CheckRunActionDef {
  readonly label: string;
  readonly description: string;
  readonly identifier: CheckRunAction;
}

/**
 * Requested action interface from GitHub webhooks
 */
export interface RequestedAction {
  readonly identifier: CheckRunAction;
  readonly metadata?: Record<string, unknown>;
}

/**
 * GitHub Action handler result interface
 */
export interface GitHubActionResult {
  readonly success: boolean;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
}

// =============================================================================
// GITHUB API RESPONSE TYPES
// =============================================================================

/**
 * GitHub Check Run API response
 */
export interface GitHubCheckRunResponse {
  readonly id: number;
  readonly name: string;
  readonly head_sha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly output?: {
    readonly title: string;
    readonly summary: string;
    readonly text?: string;
    readonly annotations_count?: number;
    readonly annotations_url?: string;
  };
  readonly actions?: ReadonlyArray<{
    readonly label: string;
    readonly description: string;
    readonly identifier: string;
  }>;
  readonly url: string;
  readonly html_url: string;
  readonly details_url?: string;
  readonly external_id?: string;
}

/**
 * GitHub Issue API response
 */
export interface GitHubIssueResponse {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly html_url: string;
  readonly state: 'open' | 'closed';
  readonly labels: ReadonlyArray<{
    readonly name: string;
    readonly color: string;
    readonly description: string | null;
  }>;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
}

/**
 * GitHub Workflow Run API response
 */
export interface GitHubWorkflowRunResponse {
  readonly id: number;
  readonly name: string | null;
  readonly head_branch: string;
  readonly head_sha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly workflow_id: number;
  readonly run_number: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly run_started_at: string | null;
  readonly html_url: string;
  readonly jobs_url: string;
  readonly logs_url: string;
  readonly check_suite_url: string;
  readonly artifacts_url: string;
  readonly cancel_url: string;
  readonly rerun_url: string;
}