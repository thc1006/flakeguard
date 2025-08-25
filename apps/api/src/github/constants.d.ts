/**
 * GitHub App Integration Constants
 *
 * Centralized configuration for GitHub API endpoints, action types,
 * error codes, rate limiting, and webhook event types.
 *
 * Provides consistent constants across the application for:
 * - GitHub REST API endpoints and paths
 * - Check run and workflow action configurations
 * - Error codes and standardized messages
 * - Rate limiting thresholds and intervals
 * - Webhook event type mappings
 */
import type { CheckRunAction } from './types.js';
export declare const GITHUB_API: {
    readonly BASE_URL: "https://api.github.com";
    readonly ACCEPT_HEADER: "application/vnd.github+json";
    readonly VERSION: "2022-11-28";
    readonly USER_AGENT: "FlakeGuard-GitHub-App/1.0";
    readonly TIMEOUT: 30000;
};
export declare const GITHUB_ENDPOINTS: {
    readonly APP: "/app";
    readonly APP_INSTALLATIONS: "/app/installations";
    readonly INSTALLATION_TOKEN: "/app/installations/{installation_id}/access_tokens";
    readonly INSTALLATION_REPOS: "/installation/repositories";
    readonly REPO: "/repos/{owner}/{repo}";
    readonly REPO_COLLABORATORS: "/repos/{owner}/{repo}/collaborators/{username}";
    readonly REPO_INSTALLATION: "/repos/{owner}/{repo}/installation";
    readonly CHECK_RUNS: "/repos/{owner}/{repo}/check-runs";
    readonly CHECK_RUN: "/repos/{owner}/{repo}/check-runs/{check_run_id}";
    readonly CHECK_RUNS_FOR_REF: "/repos/{owner}/{repo}/commits/{ref}/check-runs";
    readonly CHECK_SUITES: "/repos/{owner}/{repo}/check-suites";
    readonly CHECK_SUITE: "/repos/{owner}/{repo}/check-suites/{check_suite_id}";
    readonly WORKFLOWS: "/repos/{owner}/{repo}/actions/workflows";
    readonly WORKFLOW_RUNS: "/repos/{owner}/{repo}/actions/runs";
    readonly WORKFLOW_RUN: "/repos/{owner}/{repo}/actions/runs/{run_id}";
    readonly WORKFLOW_RUN_RERUN: "/repos/{owner}/{repo}/actions/runs/{run_id}/rerun";
    readonly WORKFLOW_RUN_RERUN_FAILED: "/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs";
    readonly WORKFLOW_RUN_CANCEL: "/repos/{owner}/{repo}/actions/runs/{run_id}/cancel";
    readonly WORKFLOW_JOBS: "/repos/{owner}/{repo}/actions/runs/{run_id}/jobs";
    readonly WORKFLOW_JOB: "/repos/{owner}/{repo}/actions/jobs/{job_id}";
    readonly WORKFLOW_JOB_RERUN: "/repos/{owner}/{repo}/actions/jobs/{job_id}/rerun";
    readonly ARTIFACTS: "/repos/{owner}/{repo}/actions/artifacts";
    readonly RUN_ARTIFACTS: "/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts";
    readonly ARTIFACT: "/repos/{owner}/{repo}/actions/artifacts/{artifact_id}";
    readonly ARTIFACT_DOWNLOAD: "/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}";
    readonly ISSUES: "/repos/{owner}/{repo}/issues";
    readonly ISSUE: "/repos/{owner}/{repo}/issues/{issue_number}";
    readonly PULL_REQUESTS: "/repos/{owner}/{repo}/pulls";
    readonly PULL_REQUEST: "/repos/{owner}/{repo}/pulls/{pull_number}";
    readonly ISSUE_COMMENTS: "/repos/{owner}/{repo}/issues/{issue_number}/comments";
    readonly PULL_REQUEST_COMMENTS: "/repos/{owner}/{repo}/pulls/{pull_number}/comments";
    readonly COMMIT_COMMENTS: "/repos/{owner}/{repo}/commits/{commit_sha}/comments";
    readonly REFS: "/repos/{owner}/{repo}/git/refs";
    readonly REF: "/repos/{owner}/{repo}/git/refs/{ref}";
    readonly COMMITS: "/repos/{owner}/{repo}/commits";
    readonly COMMIT: "/repos/{owner}/{repo}/commits/{ref}";
    readonly RATE_LIMIT: "/rate_limit";
};
export declare const CHECK_RUN_ACTION_CONFIGS: {
    readonly quarantine: {
        readonly label: "Quarantine Test";
        readonly description: "Mark this test as flaky and quarantine it from affecting CI";
        readonly identifier: CheckRunAction;
        readonly icon: "🔒";
        readonly severity: "warning";
        readonly requiresConfirmation: true;
    };
    readonly rerun_failed: {
        readonly label: "Rerun Failed Jobs";
        readonly description: "Rerun only the failed jobs in this workflow";
        readonly identifier: CheckRunAction;
        readonly icon: "🔄";
        readonly severity: "info";
        readonly requiresConfirmation: false;
    };
    readonly open_issue: {
        readonly label: "Open Issue";
        readonly description: "Create a GitHub issue to track this flaky test";
        readonly identifier: CheckRunAction;
        readonly icon: "📋";
        readonly severity: "info";
        readonly requiresConfirmation: false;
    };
    readonly dismiss_flake: {
        readonly label: "Dismiss as Flaky";
        readonly description: "Mark this failure as not flaky and proceed normally";
        readonly identifier: CheckRunAction;
        readonly icon: "✅";
        readonly severity: "success";
        readonly requiresConfirmation: true;
    };
    readonly mark_stable: {
        readonly label: "Mark as Stable";
        readonly description: "Remove flaky designation and mark test as stable";
        readonly identifier: CheckRunAction;
        readonly icon: "🎯";
        readonly severity: "success";
        readonly requiresConfirmation: false;
    };
};
export declare const WEBHOOK_EVENTS: {
    readonly CHECK_RUN: "check_run";
    readonly CHECK_SUITE: "check_suite";
    readonly WORKFLOW_RUN: "workflow_run";
    readonly WORKFLOW_JOB: "workflow_job";
    readonly PUSH: "push";
    readonly PULL_REQUEST: "pull_request";
    readonly ISSUES: "issues";
    readonly ISSUE_COMMENT: "issue_comment";
    readonly INSTALLATION: "installation";
    readonly INSTALLATION_REPOSITORIES: "installation_repositories";
    readonly REPOSITORY: "repository";
    readonly MEMBER: "member";
    readonly TEAM: "team";
};
export declare const SUPPORTED_WEBHOOK_EVENTS: readonly ["check_run", "check_suite", "workflow_run", "workflow_job", "push", "pull_request", "issues", "installation"];
export declare const ERROR_MESSAGES: {
    readonly UNAUTHORIZED: "Authentication required. Please provide valid credentials.";
    readonly FORBIDDEN: "Access denied. Insufficient permissions for this operation.";
    readonly INVALID_TOKEN: "The provided access token is invalid or malformed.";
    readonly TOKEN_EXPIRED: "The access token has expired. Please refresh your token.";
    readonly VALIDATION_ERROR: "Request validation failed. Please check your input.";
    readonly INVALID_PAYLOAD: "The request payload is malformed or invalid.";
    readonly MISSING_REQUIRED_FIELD: "A required field is missing from the request.";
    readonly INVALID_WEBHOOK_SIGNATURE: "Webhook signature verification failed.";
    readonly RESOURCE_NOT_FOUND: "The requested resource could not be found.";
    readonly RESOURCE_ALREADY_EXISTS: "A resource with this identifier already exists.";
    readonly RESOURCE_CONFLICT: "The operation conflicts with the current resource state.";
    readonly RESOURCE_GONE: "The requested resource is no longer available.";
    readonly GITHUB_API_ERROR: "An error occurred while communicating with GitHub API.";
    readonly GITHUB_RATE_LIMITED: "GitHub API rate limit exceeded. Please retry later.";
    readonly GITHUB_SERVICE_UNAVAILABLE: "GitHub API is currently unavailable.";
    readonly INSTALLATION_NOT_FOUND: "GitHub App installation not found for this repository.";
    readonly REPOSITORY_NOT_ACCESSIBLE: "Repository is not accessible with current permissions.";
    readonly WORKFLOW_NOT_FOUND: "The specified workflow could not be found.";
    readonly WORKFLOW_RUN_NOT_FOUND: "The specified workflow run could not be found.";
    readonly WORKFLOW_JOB_NOT_FOUND: "The specified workflow job could not be found.";
    readonly WORKFLOW_CANNOT_RERUN: "This workflow run cannot be rerun at this time.";
    readonly WORKFLOW_ALREADY_CANCELLED: "The workflow run has already been cancelled.";
    readonly CHECK_RUN_NOT_FOUND: "The specified check run could not be found.";
    readonly CHECK_RUN_ACTION_NOT_SUPPORTED: "The requested check run action is not supported.";
    readonly CHECK_RUN_ALREADY_COMPLETED: "The check run has already been completed.";
    readonly ARTIFACT_NOT_FOUND: "The specified artifact could not be found.";
    readonly ARTIFACT_EXPIRED: "The artifact has expired and is no longer available.";
    readonly ARTIFACT_TOO_LARGE: "The artifact exceeds the maximum download size limit.";
    readonly DOWNLOAD_FAILED: "Failed to download the artifact due to a network error.";
    readonly INTERNAL_SERVER_ERROR: "An unexpected server error occurred.";
    readonly SERVICE_UNAVAILABLE: "The service is temporarily unavailable.";
    readonly TIMEOUT: "The request timed out. Please try again.";
    readonly RATE_LIMITED: "Rate limit exceeded. Please slow down your requests.";
};
export declare const RATE_LIMITS: {
    readonly GITHUB_API_AUTHENTICATED: 5000;
    readonly GITHUB_API_UNAUTHENTICATED: 60;
    readonly GITHUB_API_SEARCH: 30;
    readonly GITHUB_API_GRAPHQL: 5000;
    readonly WEBHOOK_ENDPOINT: 1000;
    readonly CHECK_RUN_OPERATIONS: 100;
    readonly WORKFLOW_OPERATIONS: 50;
    readonly ARTIFACT_OPERATIONS: 200;
    readonly WINDOW_1_MINUTE: 60000;
    readonly WINDOW_5_MINUTES: 300000;
    readonly WINDOW_15_MINUTES: 900000;
    readonly WINDOW_1_HOUR: 3600000;
    readonly MAX_RETRIES: 3;
    readonly RETRY_DELAY_BASE: 1000;
    readonly RETRY_DELAY_MAX: 30000;
    readonly EXPONENTIAL_BACKOFF_FACTOR: 2;
};
export declare const TIMEOUTS: {
    readonly GITHUB_API_DEFAULT: 30000;
    readonly GITHUB_API_DOWNLOAD: 300000;
    readonly GITHUB_API_UPLOAD: 600000;
    readonly WEBHOOK_PROCESSING: 45000;
    readonly WEBHOOK_SIGNATURE_VALIDATION: 5000;
    readonly DATABASE_QUERY: 30000;
    readonly DATABASE_TRANSACTION: 60000;
    readonly CACHE_GET: 1000;
    readonly CACHE_SET: 5000;
    readonly ARTIFACT_ANALYSIS: 180000;
    readonly LOG_PARSING: 120000;
};
export declare const PAGINATION: {
    readonly DEFAULT_PAGE: 1;
    readonly DEFAULT_PER_PAGE: 30;
    readonly MAX_PER_PAGE: 100;
    readonly MIN_PER_PAGE: 1;
};
export declare const CHECK_RUN_STATUS_ICONS: {
    readonly queued: "⏳";
    readonly in_progress: "🔄";
    readonly completed: "✅";
};
export declare const CHECK_RUN_CONCLUSION_ICONS: {
    readonly success: "✅";
    readonly failure: "❌";
    readonly neutral: "⚪";
    readonly cancelled: "⏹️";
    readonly skipped: "⏭️";
    readonly timed_out: "⏰";
    readonly action_required: "⚠️";
};
export declare const CHECK_RUN_CONCLUSION_COLORS: {
    readonly success: "#28a745";
    readonly failure: "#dc3545";
    readonly neutral: "#6c757d";
    readonly cancelled: "#6f42c1";
    readonly skipped: "#007bff";
    readonly timed_out: "#fd7e14";
    readonly action_required: "#ffc107";
};
export declare const ARTIFACT_TYPES: {
    readonly TEST_RESULTS: "test-results";
    readonly COVERAGE_REPORT: "coverage-report";
    readonly LOGS: "logs";
    readonly SCREENSHOTS: "screenshots";
};
export declare const ARTIFACT_MIME_TYPES: {
    readonly "test-results": "application/json";
    readonly "coverage-report": "text/html";
    readonly logs: "text/plain";
    readonly screenshots: "image/png";
};
export declare const ARTIFACT_MAX_SIZES: {
    readonly "test-results": number;
    readonly "coverage-report": number;
    readonly logs: number;
    readonly screenshots: number;
};
export declare const GITHUB_APP_PERMISSIONS: {
    readonly actions: "write";
    readonly checks: "write";
    readonly contents: "read";
    readonly issues: "write";
    readonly metadata: "read";
    readonly pull_requests: "write";
    readonly statuses: "read";
    readonly members: "read";
    readonly team_discussions: "read";
};
export declare const REQUIRED_WEBHOOK_EVENTS: readonly ["check_run", "check_suite", "workflow_run", "workflow_job", "pull_request", "push", "installation", "installation_repositories"];
export declare const FLAKE_DETECTION: {
    readonly MIN_RUNS_FOR_ANALYSIS: 5;
    readonly FLAKY_THRESHOLD: 0.15;
    readonly HIGH_CONFIDENCE_THRESHOLD: 0.8;
    readonly MEDIUM_CONFIDENCE_THRESHOLD: 0.5;
    readonly ANALYSIS_WINDOW_DAYS: 30;
    readonly RECENT_FAILURES_WINDOW_DAYS: 7;
    readonly COMMON_FLAKE_PATTERNS: readonly ["timeout", "connection refused", "network error", "race condition", "timing", "intermittent", "flaky", "unstable"];
};
export declare const METRICS: {
    readonly HTTP_REQUESTS_TOTAL: "flakeguard_http_requests_total";
    readonly HTTP_REQUEST_DURATION: "flakeguard_http_request_duration_seconds";
    readonly WEBHOOK_EVENTS_TOTAL: "flakeguard_webhook_events_total";
    readonly WEBHOOK_PROCESSING_DURATION: "flakeguard_webhook_processing_duration_seconds";
    readonly GITHUB_API_CALLS_TOTAL: "flakeguard_github_api_calls_total";
    readonly GITHUB_API_ERRORS_TOTAL: "flakeguard_github_api_errors_total";
    readonly GITHUB_RATE_LIMIT_REMAINING: "flakeguard_github_rate_limit_remaining";
    readonly CHECK_RUNS_CREATED: "flakeguard_check_runs_created_total";
    readonly FLAKY_TESTS_DETECTED: "flakeguard_flaky_tests_detected_total";
    readonly LABELS: {
        readonly METHOD: "method";
        readonly PATH: "path";
        readonly STATUS_CODE: "status_code";
        readonly EVENT_TYPE: "event_type";
        readonly ENDPOINT: "endpoint";
        readonly ERROR_CODE: "error_code";
        readonly REPOSITORY: "repository";
        readonly INSTALLATION_ID: "installation_id";
    };
};
export declare const HEALTH_CHECK_NAMES: {
    readonly DATABASE: "database";
    readonly REDIS: "redis";
    readonly GITHUB_API: "github_api";
    readonly WORKER_QUEUE: "worker_queue";
};
export declare const CACHE_KEYS: {
    readonly INSTALLATION_TOKEN: "github:installation_token:{installation_id}";
    readonly REPOSITORY_INFO: "github:repo:{owner}:{repo}";
    readonly CHECK_RUN: "github:check_run:{check_run_id}";
    readonly WORKFLOW_RUN: "github:workflow_run:{run_id}";
    readonly FLAKE_ANALYSIS: "flake:analysis:{test_name}:{repository}";
    readonly RATE_LIMIT_STATUS: "github:rate_limit:{installation_id}";
};
export declare const CACHE_TTL: {
    readonly INSTALLATION_TOKEN: 3300;
    readonly REPOSITORY_INFO: 300;
    readonly CHECK_RUN: 60;
    readonly WORKFLOW_RUN: 30;
    readonly FLAKE_ANALYSIS: 1800;
    readonly RATE_LIMIT_STATUS: 60;
};
export declare const ENV_KEYS: {
    readonly GITHUB_APP_ID: "GITHUB_APP_ID";
    readonly GITHUB_PRIVATE_KEY: "GITHUB_PRIVATE_KEY";
    readonly GITHUB_PRIVATE_KEY_PATH: "GITHUB_PRIVATE_KEY_PATH";
    readonly GITHUB_WEBHOOK_SECRET: "GITHUB_WEBHOOK_SECRET";
    readonly GITHUB_CLIENT_ID: "GITHUB_CLIENT_ID";
    readonly GITHUB_CLIENT_SECRET: "GITHUB_CLIENT_SECRET";
    readonly PORT: "PORT";
    readonly HOST: "HOST";
    readonly NODE_ENV: "NODE_ENV";
    readonly LOG_LEVEL: "LOG_LEVEL";
    readonly DATABASE_URL: "DATABASE_URL";
    readonly REDIS_URL: "REDIS_URL";
    readonly WEBHOOK_URL: "WEBHOOK_URL";
    readonly API_BASE_URL: "API_BASE_URL";
};
//# sourceMappingURL=constants.d.ts.map