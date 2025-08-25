/**
 * Comprehensive TypeScript interfaces for GitHub App integration
 * Provides strict typing for webhook events, check runs, and artifact management
 */
import type { CheckRunEvent, CheckSuiteEvent, WorkflowRunEvent, WorkflowJobEvent, PullRequestEvent, PushEvent, IssuesEvent, InstallationEvent } from '@octokit/webhooks-types';
export interface GitHubAppConfig {
    readonly appId: number;
    readonly privateKey: string;
    readonly webhookSecret: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly installationId?: number;
}
export interface GitHubAppCredentials {
    readonly appId: number;
    readonly privateKey: string;
    readonly installationId: number;
}
export type SupportedWebhookEvent = CheckRunEvent | CheckSuiteEvent | WorkflowRunEvent | WorkflowJobEvent | PullRequestEvent | PushEvent | IssuesEvent | InstallationEvent;
/**
 * Conditional type for webhook payload discrimination
 */
export type WebhookPayload<T extends string> = T extends 'check_run' ? CheckRunEvent : T extends 'check_suite' ? CheckSuiteEvent : T extends 'workflow_run' ? WorkflowRunEvent : T extends 'workflow_job' ? WorkflowJobEvent : T extends 'pull_request' ? PullRequestEvent : T extends 'push' ? PushEvent : T extends 'issues' ? IssuesEvent : T extends 'installation' ? InstallationEvent : never;
export declare const CHECK_RUN_ACTIONS: readonly ["quarantine", "rerun_failed", "open_issue", "dismiss_flake", "mark_stable"];
export type CheckRunAction = typeof CHECK_RUN_ACTIONS[number];
export declare const CHECK_RUN_CONCLUSIONS: readonly ["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"];
export type CheckRunConclusion = typeof CHECK_RUN_CONCLUSIONS[number];
export declare const CHECK_RUN_STATUS: readonly ["queued", "in_progress", "completed"];
export type CheckRunStatus = typeof CHECK_RUN_STATUS[number];
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
export declare const WORKFLOW_RUN_CONCLUSIONS: readonly ["success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"];
export type WorkflowRunConclusion = typeof WORKFLOW_RUN_CONCLUSIONS[number];
export declare const WORKFLOW_RUN_STATUS: readonly ["queued", "in_progress", "completed", "waiting", "requested", "pending"];
export type WorkflowRunStatus = typeof WORKFLOW_RUN_STATUS[number];
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
export interface TestResult {
    readonly name: string;
    readonly status: 'passed' | 'failed' | 'skipped';
    readonly duration?: number;
    readonly errorMessage?: string;
    readonly stackTrace?: string;
    readonly flakeAnalysis?: FlakeAnalysis;
}
export interface ArtifactMetadata {
    readonly id: number;
    readonly name: string;
    readonly sizeInBytes: number;
    readonly url: string;
    readonly archiveDownloadUrl: string;
    readonly expired: boolean;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly updatedAt: string;
}
export interface TestArtifact extends ArtifactMetadata {
    readonly type: 'test-results' | 'coverage-report' | 'logs' | 'screenshots';
    readonly testResults?: ReadonlyArray<TestResult>;
}
/**
 * Generic API response wrapper
 */
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
/**
 * Mapped type for paginated responses
 */
export type PaginatedResponse<T> = ApiResponse<ReadonlyArray<T>> & {
    readonly pagination: {
        readonly page: number;
        readonly perPage: number;
        readonly totalCount: number;
        readonly totalPages: number;
    };
};
/**
 * Repository information with strict typing
 */
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
/**
 * Generic constraint for webhook event handlers
 */
export interface WebhookHandler<T extends keyof WebhookEventMap> {
    (payload: WebhookEventMap[T]): Promise<void> | void;
}
/**
 * Mapped type for webhook event handlers
 */
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
/**
 * Type-safe webhook event dispatcher
 */
export interface WebhookDispatcher {
    on<T extends keyof WebhookEventMap>(event: T, handler: WebhookHandler<T>): void;
    emit<T extends keyof WebhookEventMap>(event: T, payload: WebhookEventMap[T]): Promise<void>;
}
export interface CreateCheckRunParams {
    readonly owner: string;
    readonly repo: string;
    readonly name: string;
    readonly headSha: string;
    readonly status?: CheckRunStatus;
    readonly conclusion?: CheckRunConclusion;
    readonly startedAt?: string;
    readonly completedAt?: string;
    readonly output?: {
        readonly title: string;
        readonly summary: string;
        readonly text?: string;
    };
    readonly actions?: ReadonlyArray<{
        readonly label: string;
        readonly description: string;
        readonly identifier: CheckRunAction;
    }>;
}
export interface UpdateCheckRunParams {
    readonly checkRunId: number;
    readonly status?: CheckRunStatus;
    readonly conclusion?: CheckRunConclusion;
    readonly completedAt?: string;
    readonly output?: {
        readonly title: string;
        readonly summary: string;
        readonly text?: string;
    };
    readonly actions?: ReadonlyArray<{
        readonly label: string;
        readonly description: string;
        readonly identifier: CheckRunAction;
    }>;
}
export interface GitHubClient {
    readonly checks: {
        create(params: CreateCheckRunParams): Promise<ApiResponse<FlakeGuardCheckRun>>;
        update(params: UpdateCheckRunParams): Promise<ApiResponse<FlakeGuardCheckRun>>;
        get(checkRunId: number): Promise<ApiResponse<FlakeGuardCheckRun>>;
        list(owner: string, repo: string, ref: string): Promise<PaginatedResponse<FlakeGuardCheckRun>>;
    };
    readonly artifacts: {
        list(owner: string, repo: string, runId: number): Promise<PaginatedResponse<TestArtifact>>;
        download(artifactId: number): Promise<ApiResponse<ArrayBuffer>>;
    };
    readonly repos: {
        get(owner: string, repo: string): Promise<ApiResponse<RepositoryInfo>>;
    };
}
export interface AppInstallation {
    readonly id: number;
    readonly account: {
        readonly login: string;
        readonly id: number;
        readonly type: 'User' | 'Organization';
    };
    readonly repositorySelection: 'all' | 'selected';
    readonly permissions: Record<string, 'read' | 'write' | 'admin'>;
    readonly events: ReadonlyArray<string>;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly suspendedAt: string | null;
}
export interface InstallationToken {
    readonly token: string;
    readonly expiresAt: string;
    readonly permissions: Record<string, 'read' | 'write' | 'admin'>;
    readonly repositorySelection: 'all' | 'selected';
    readonly repositories?: ReadonlyArray<{
        readonly id: number;
        readonly name: string;
        readonly fullName: string;
    }>;
}
export interface GitHubAppAuth {
    generateJWT(): Promise<string>;
    getInstallationToken(installationId: number): Promise<InstallationToken>;
    validateInstallationAccess(installationId: number, owner: string, repo?: string): Promise<boolean>;
    getInstallationClient(installationId: number): Promise<any>;
    getAuthenticatedContext(installationId: number): Promise<AuthenticatedContext>;
    verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
    getInstallation(installationId: number): Promise<AppInstallation>;
}
export interface AuthenticatedContext {
    readonly installationId: number;
    readonly permissions: Record<string, 'read' | 'write' | 'admin'>;
    readonly repositories: ReadonlyArray<{
        readonly id: number;
        readonly name: string;
        readonly fullName: string;
    }> | 'all';
}
export declare class GitHubApiError extends Error {
    readonly status: number;
    readonly response?: Record<string, unknown> | undefined;
    constructor(message: string, status: number, response?: Record<string, unknown> | undefined);
}
export declare class WebhookValidationError extends Error {
    readonly payload?: unknown | undefined;
    constructor(message: string, payload?: unknown | undefined);
}
/**
 * Extract repository information from webhook payload
 */
export type ExtractRepository<T> = T extends {
    repository: infer R;
} ? R : never;
/**
 * Extract installation information from webhook payload
 */
export type ExtractInstallation<T> = T extends {
    installation: infer I;
} ? I : never;
/**
 * Conditional type for event-specific data extraction
 */
export type ExtractEventData<T extends keyof WebhookEventMap, K extends string> = WebhookEventMap[T] extends Record<K, infer R> ? R : never;
/**
 * Type guard for webhook event discrimination
 */
export declare function isWebhookEvent<T extends keyof WebhookEventMap>(event: string, payload: unknown): payload is WebhookEventMap[T];
/**
 * Webhook payload type aliases for easier usage
 */
export type CheckRunWebhookPayload = CheckRunEvent;
export type CheckSuiteWebhookPayload = CheckSuiteEvent;
export type WorkflowRunWebhookPayload = WorkflowRunEvent;
export type WorkflowJobWebhookPayload = WorkflowJobEvent;
export type PullRequestWebhookPayload = PullRequestEvent;
export type PushWebhookPayload = PushEvent;
export type InstallationWebhookPayload = InstallationEvent;
export type { CheckRunEvent, CheckSuiteEvent, WorkflowRunEvent, WorkflowJobEvent, PullRequestEvent, PushEvent, IssuesEvent, InstallationEvent, } from '@octokit/webhooks-types';
//# sourceMappingURL=types.d.ts.map