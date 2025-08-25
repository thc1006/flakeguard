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
// =============================================================================
// GITHUB API BASE CONFIGURATION
// =============================================================================
export const GITHUB_API = {
    BASE_URL: 'https://api.github.com',
    ACCEPT_HEADER: 'application/vnd.github+json',
    VERSION: '2022-11-28',
    USER_AGENT: 'FlakeGuard-GitHub-App/1.0',
    TIMEOUT: 30_000, // 30 seconds
};
// =============================================================================
// GITHUB REST API ENDPOINTS
// =============================================================================
export const GITHUB_ENDPOINTS = {
    // App Authentication
    APP: '/app',
    APP_INSTALLATIONS: '/app/installations',
    INSTALLATION_TOKEN: '/app/installations/{installation_id}/access_tokens',
    INSTALLATION_REPOS: '/installation/repositories',
    // Repository Operations
    REPO: '/repos/{owner}/{repo}',
    REPO_COLLABORATORS: '/repos/{owner}/{repo}/collaborators/{username}',
    REPO_INSTALLATION: '/repos/{owner}/{repo}/installation',
    // Check Runs
    CHECK_RUNS: '/repos/{owner}/{repo}/check-runs',
    CHECK_RUN: '/repos/{owner}/{repo}/check-runs/{check_run_id}',
    CHECK_RUNS_FOR_REF: '/repos/{owner}/{repo}/commits/{ref}/check-runs',
    CHECK_SUITES: '/repos/{owner}/{repo}/check-suites',
    CHECK_SUITE: '/repos/{owner}/{repo}/check-suites/{check_suite_id}',
    // Workflow Operations
    WORKFLOWS: '/repos/{owner}/{repo}/actions/workflows',
    WORKFLOW_RUNS: '/repos/{owner}/{repo}/actions/runs',
    WORKFLOW_RUN: '/repos/{owner}/{repo}/actions/runs/{run_id}',
    WORKFLOW_RUN_RERUN: '/repos/{owner}/{repo}/actions/runs/{run_id}/rerun',
    WORKFLOW_RUN_RERUN_FAILED: '/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs',
    WORKFLOW_RUN_CANCEL: '/repos/{owner}/{repo}/actions/runs/{run_id}/cancel',
    WORKFLOW_JOBS: '/repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
    WORKFLOW_JOB: '/repos/{owner}/{repo}/actions/jobs/{job_id}',
    WORKFLOW_JOB_RERUN: '/repos/{owner}/{repo}/actions/jobs/{job_id}/rerun',
    // Artifacts
    ARTIFACTS: '/repos/{owner}/{repo}/actions/artifacts',
    RUN_ARTIFACTS: '/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts',
    ARTIFACT: '/repos/{owner}/{repo}/actions/artifacts/{artifact_id}',
    ARTIFACT_DOWNLOAD: '/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
    // Issues and Pull Requests
    ISSUES: '/repos/{owner}/{repo}/issues',
    ISSUE: '/repos/{owner}/{repo}/issues/{issue_number}',
    PULL_REQUESTS: '/repos/{owner}/{repo}/pulls',
    PULL_REQUEST: '/repos/{owner}/{repo}/pulls/{pull_number}',
    // Comments
    ISSUE_COMMENTS: '/repos/{owner}/{repo}/issues/{issue_number}/comments',
    PULL_REQUEST_COMMENTS: '/repos/{owner}/{repo}/pulls/{pull_number}/comments',
    COMMIT_COMMENTS: '/repos/{owner}/{repo}/commits/{commit_sha}/comments',
    // Git References
    REFS: '/repos/{owner}/{repo}/git/refs',
    REF: '/repos/{owner}/{repo}/git/refs/{ref}',
    COMMITS: '/repos/{owner}/{repo}/commits',
    COMMIT: '/repos/{owner}/{repo}/commits/{ref}',
    // Rate Limiting
    RATE_LIMIT: '/rate_limit',
};
// =============================================================================
// CHECK RUN ACTION CONFIGURATIONS
// =============================================================================
export const CHECK_RUN_ACTION_CONFIGS = {
    quarantine: {
        label: 'Quarantine Test',
        description: 'Mark this test as flaky and quarantine it from affecting CI',
        identifier: 'quarantine',
        icon: '🔒',
        severity: 'warning',
        requiresConfirmation: true,
    },
    rerun_failed: {
        label: 'Rerun Failed Jobs',
        description: 'Rerun only the failed jobs in this workflow',
        identifier: 'rerun_failed',
        icon: '🔄',
        severity: 'info',
        requiresConfirmation: false,
    },
    open_issue: {
        label: 'Open Issue',
        description: 'Create a GitHub issue to track this flaky test',
        identifier: 'open_issue',
        icon: '📋',
        severity: 'info',
        requiresConfirmation: false,
    },
    dismiss_flake: {
        label: 'Dismiss as Flaky',
        description: 'Mark this failure as not flaky and proceed normally',
        identifier: 'dismiss_flake',
        icon: '✅',
        severity: 'success',
        requiresConfirmation: true,
    },
    mark_stable: {
        label: 'Mark as Stable',
        description: 'Remove flaky designation and mark test as stable',
        identifier: 'mark_stable',
        icon: '🎯',
        severity: 'success',
        requiresConfirmation: false,
    },
};
// =============================================================================
// WEBHOOK EVENT TYPE MAPPINGS
// =============================================================================
export const WEBHOOK_EVENTS = {
    // Check Events
    CHECK_RUN: 'check_run',
    CHECK_SUITE: 'check_suite',
    // Workflow Events  
    WORKFLOW_RUN: 'workflow_run',
    WORKFLOW_JOB: 'workflow_job',
    // Repository Events
    PUSH: 'push',
    PULL_REQUEST: 'pull_request',
    // Issue Events
    ISSUES: 'issues',
    ISSUE_COMMENT: 'issue_comment',
    // Installation Events
    INSTALLATION: 'installation',
    INSTALLATION_REPOSITORIES: 'installation_repositories',
    // Other Events
    REPOSITORY: 'repository',
    MEMBER: 'member',
    TEAM: 'team',
};
export const SUPPORTED_WEBHOOK_EVENTS = [
    WEBHOOK_EVENTS.CHECK_RUN,
    WEBHOOK_EVENTS.CHECK_SUITE,
    WEBHOOK_EVENTS.WORKFLOW_RUN,
    WEBHOOK_EVENTS.WORKFLOW_JOB,
    WEBHOOK_EVENTS.PUSH,
    WEBHOOK_EVENTS.PULL_REQUEST,
    WEBHOOK_EVENTS.ISSUES,
    WEBHOOK_EVENTS.INSTALLATION,
];
// =============================================================================
// ERROR CODES AND MESSAGES
// =============================================================================
export const ERROR_MESSAGES = {
    // Authentication & Authorization
    UNAUTHORIZED: 'Authentication required. Please provide valid credentials.',
    FORBIDDEN: 'Access denied. Insufficient permissions for this operation.',
    INVALID_TOKEN: 'The provided access token is invalid or malformed.',
    TOKEN_EXPIRED: 'The access token has expired. Please refresh your token.',
    // Validation
    VALIDATION_ERROR: 'Request validation failed. Please check your input.',
    INVALID_PAYLOAD: 'The request payload is malformed or invalid.',
    MISSING_REQUIRED_FIELD: 'A required field is missing from the request.',
    INVALID_WEBHOOK_SIGNATURE: 'Webhook signature verification failed.',
    // Resource Management
    RESOURCE_NOT_FOUND: 'The requested resource could not be found.',
    RESOURCE_ALREADY_EXISTS: 'A resource with this identifier already exists.',
    RESOURCE_CONFLICT: 'The operation conflicts with the current resource state.',
    RESOURCE_GONE: 'The requested resource is no longer available.',
    // GitHub API
    GITHUB_API_ERROR: 'An error occurred while communicating with GitHub API.',
    GITHUB_RATE_LIMITED: 'GitHub API rate limit exceeded. Please retry later.',
    GITHUB_SERVICE_UNAVAILABLE: 'GitHub API is currently unavailable.',
    INSTALLATION_NOT_FOUND: 'GitHub App installation not found for this repository.',
    REPOSITORY_NOT_ACCESSIBLE: 'Repository is not accessible with current permissions.',
    // Workflow Operations
    WORKFLOW_NOT_FOUND: 'The specified workflow could not be found.',
    WORKFLOW_RUN_NOT_FOUND: 'The specified workflow run could not be found.',
    WORKFLOW_JOB_NOT_FOUND: 'The specified workflow job could not be found.',
    WORKFLOW_CANNOT_RERUN: 'This workflow run cannot be rerun at this time.',
    WORKFLOW_ALREADY_CANCELLED: 'The workflow run has already been cancelled.',
    // Check Runs
    CHECK_RUN_NOT_FOUND: 'The specified check run could not be found.',
    CHECK_RUN_ACTION_NOT_SUPPORTED: 'The requested check run action is not supported.',
    CHECK_RUN_ALREADY_COMPLETED: 'The check run has already been completed.',
    // Artifacts
    ARTIFACT_NOT_FOUND: 'The specified artifact could not be found.',
    ARTIFACT_EXPIRED: 'The artifact has expired and is no longer available.',
    ARTIFACT_TOO_LARGE: 'The artifact exceeds the maximum download size limit.',
    DOWNLOAD_FAILED: 'Failed to download the artifact due to a network error.',
    // System
    INTERNAL_SERVER_ERROR: 'An unexpected server error occurred.',
    SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
    TIMEOUT: 'The request timed out. Please try again.',
    RATE_LIMITED: 'Rate limit exceeded. Please slow down your requests.',
};
// =============================================================================
// RATE LIMITING CONFIGURATION
// =============================================================================
export const RATE_LIMITS = {
    // GitHub API Rate Limits (per hour)
    GITHUB_API_AUTHENTICATED: 5000,
    GITHUB_API_UNAUTHENTICATED: 60,
    GITHUB_API_SEARCH: 30,
    GITHUB_API_GRAPHQL: 5000,
    // FlakeGuard API Rate Limits (per minute)
    WEBHOOK_ENDPOINT: 1000,
    CHECK_RUN_OPERATIONS: 100,
    WORKFLOW_OPERATIONS: 50,
    ARTIFACT_OPERATIONS: 200,
    // Rate Limit Windows (milliseconds)
    WINDOW_1_MINUTE: 60_000,
    WINDOW_5_MINUTES: 300_000,
    WINDOW_15_MINUTES: 900_000,
    WINDOW_1_HOUR: 3_600_000,
    // Retry Configuration
    MAX_RETRIES: 3,
    RETRY_DELAY_BASE: 1000, // 1 second base delay
    RETRY_DELAY_MAX: 30_000, // 30 seconds max delay
    EXPONENTIAL_BACKOFF_FACTOR: 2,
};
// =============================================================================
// TIMEOUT CONFIGURATIONS
// =============================================================================
export const TIMEOUTS = {
    // GitHub API Timeouts (milliseconds)
    GITHUB_API_DEFAULT: 30_000, // 30 seconds
    GITHUB_API_DOWNLOAD: 300_000, // 5 minutes for downloads
    GITHUB_API_UPLOAD: 600_000, // 10 minutes for uploads
    // Webhook Processing Timeouts
    WEBHOOK_PROCESSING: 45_000, // 45 seconds
    WEBHOOK_SIGNATURE_VALIDATION: 5_000, // 5 seconds
    // Database Operations
    DATABASE_QUERY: 30_000, // 30 seconds
    DATABASE_TRANSACTION: 60_000, // 1 minute
    // Cache Operations
    CACHE_GET: 1_000, // 1 second
    CACHE_SET: 5_000, // 5 seconds
    // File Operations
    ARTIFACT_ANALYSIS: 180_000, // 3 minutes
    LOG_PARSING: 120_000, // 2 minutes
};
// =============================================================================
// PAGINATION DEFAULTS
// =============================================================================
export const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_PER_PAGE: 30,
    MAX_PER_PAGE: 100,
    MIN_PER_PAGE: 1,
};
// =============================================================================
// CHECK RUN STATUS AND CONCLUSION MAPPINGS
// =============================================================================
export const CHECK_RUN_STATUS_ICONS = {
    queued: '⏳',
    in_progress: '🔄',
    completed: '✅',
};
export const CHECK_RUN_CONCLUSION_ICONS = {
    success: '✅',
    failure: '❌',
    neutral: '⚪',
    cancelled: '⏹️',
    skipped: '⏭️',
    timed_out: '⏰',
    action_required: '⚠️',
};
export const CHECK_RUN_CONCLUSION_COLORS = {
    success: '#28a745',
    failure: '#dc3545',
    neutral: '#6c757d',
    cancelled: '#6f42c1',
    skipped: '#007bff',
    timed_out: '#fd7e14',
    action_required: '#ffc107',
};
// =============================================================================
// ARTIFACT TYPES AND CONFIGURATIONS
// =============================================================================
export const ARTIFACT_TYPES = {
    TEST_RESULTS: 'test-results',
    COVERAGE_REPORT: 'coverage-report',
    LOGS: 'logs',
    SCREENSHOTS: 'screenshots',
};
export const ARTIFACT_MIME_TYPES = {
    [ARTIFACT_TYPES.TEST_RESULTS]: 'application/json',
    [ARTIFACT_TYPES.COVERAGE_REPORT]: 'text/html',
    [ARTIFACT_TYPES.LOGS]: 'text/plain',
    [ARTIFACT_TYPES.SCREENSHOTS]: 'image/png',
};
export const ARTIFACT_MAX_SIZES = {
    [ARTIFACT_TYPES.TEST_RESULTS]: 50 * 1024 * 1024, // 50MB
    [ARTIFACT_TYPES.COVERAGE_REPORT]: 100 * 1024 * 1024, // 100MB
    [ARTIFACT_TYPES.LOGS]: 500 * 1024 * 1024, // 500MB
    [ARTIFACT_TYPES.SCREENSHOTS]: 1024 * 1024 * 1024, // 1GB
};
// =============================================================================
// GITHUB APP PERMISSIONS
// =============================================================================
export const GITHUB_APP_PERMISSIONS = {
    // Repository permissions
    actions: 'write', // Required for workflow operations
    checks: 'write', // Required for check runs
    contents: 'read', // Required for repository access
    issues: 'write', // Required for creating issues
    metadata: 'read', // Required for repository metadata
    pull_requests: 'write', // Required for PR operations
    statuses: 'read', // Required for commit statuses
    // Organization permissions (optional)
    members: 'read', // For user information
    team_discussions: 'read', // For team context
};
export const REQUIRED_WEBHOOK_EVENTS = [
    'check_run',
    'check_suite',
    'workflow_run',
    'workflow_job',
    'pull_request',
    'push',
    'installation',
    'installation_repositories',
];
// =============================================================================
// FLAKE DETECTION CONFIGURATION
// =============================================================================
export const FLAKE_DETECTION = {
    // Thresholds for flake detection
    MIN_RUNS_FOR_ANALYSIS: 5,
    FLAKY_THRESHOLD: 0.15, // 15% failure rate
    HIGH_CONFIDENCE_THRESHOLD: 0.8,
    MEDIUM_CONFIDENCE_THRESHOLD: 0.5,
    // Time windows for analysis
    ANALYSIS_WINDOW_DAYS: 30,
    RECENT_FAILURES_WINDOW_DAYS: 7,
    // Pattern matching
    COMMON_FLAKE_PATTERNS: [
        'timeout',
        'connection refused',
        'network error',
        'race condition',
        'timing',
        'intermittent',
        'flaky',
        'unstable',
    ],
};
// =============================================================================
// MONITORING AND OBSERVABILITY
// =============================================================================
export const METRICS = {
    // Metric names
    HTTP_REQUESTS_TOTAL: 'flakeguard_http_requests_total',
    HTTP_REQUEST_DURATION: 'flakeguard_http_request_duration_seconds',
    WEBHOOK_EVENTS_TOTAL: 'flakeguard_webhook_events_total',
    WEBHOOK_PROCESSING_DURATION: 'flakeguard_webhook_processing_duration_seconds',
    GITHUB_API_CALLS_TOTAL: 'flakeguard_github_api_calls_total',
    GITHUB_API_ERRORS_TOTAL: 'flakeguard_github_api_errors_total',
    GITHUB_RATE_LIMIT_REMAINING: 'flakeguard_github_rate_limit_remaining',
    CHECK_RUNS_CREATED: 'flakeguard_check_runs_created_total',
    FLAKY_TESTS_DETECTED: 'flakeguard_flaky_tests_detected_total',
    // Labels
    LABELS: {
        METHOD: 'method',
        PATH: 'path',
        STATUS_CODE: 'status_code',
        EVENT_TYPE: 'event_type',
        ENDPOINT: 'endpoint',
        ERROR_CODE: 'error_code',
        REPOSITORY: 'repository',
        INSTALLATION_ID: 'installation_id',
    },
};
export const HEALTH_CHECK_NAMES = {
    DATABASE: 'database',
    REDIS: 'redis',
    GITHUB_API: 'github_api',
    WORKER_QUEUE: 'worker_queue',
};
// =============================================================================
// CACHE KEYS AND TTL
// =============================================================================
export const CACHE_KEYS = {
    INSTALLATION_TOKEN: 'github:installation_token:{installation_id}',
    REPOSITORY_INFO: 'github:repo:{owner}:{repo}',
    CHECK_RUN: 'github:check_run:{check_run_id}',
    WORKFLOW_RUN: 'github:workflow_run:{run_id}',
    FLAKE_ANALYSIS: 'flake:analysis:{test_name}:{repository}',
    RATE_LIMIT_STATUS: 'github:rate_limit:{installation_id}',
};
export const CACHE_TTL = {
    INSTALLATION_TOKEN: 3300, // 55 minutes (tokens expire in 1 hour)
    REPOSITORY_INFO: 300, // 5 minutes
    CHECK_RUN: 60, // 1 minute
    WORKFLOW_RUN: 30, // 30 seconds
    FLAKE_ANALYSIS: 1800, // 30 minutes
    RATE_LIMIT_STATUS: 60, // 1 minute
};
// =============================================================================
// ENVIRONMENT VARIABLE KEYS
// =============================================================================
export const ENV_KEYS = {
    // GitHub App Configuration
    GITHUB_APP_ID: 'GITHUB_APP_ID',
    GITHUB_PRIVATE_KEY: 'GITHUB_PRIVATE_KEY',
    GITHUB_PRIVATE_KEY_PATH: 'GITHUB_PRIVATE_KEY_PATH',
    GITHUB_WEBHOOK_SECRET: 'GITHUB_WEBHOOK_SECRET',
    GITHUB_CLIENT_ID: 'GITHUB_CLIENT_ID',
    GITHUB_CLIENT_SECRET: 'GITHUB_CLIENT_SECRET',
    // API Configuration
    PORT: 'PORT',
    HOST: 'HOST',
    NODE_ENV: 'NODE_ENV',
    LOG_LEVEL: 'LOG_LEVEL',
    // Database
    DATABASE_URL: 'DATABASE_URL',
    REDIS_URL: 'REDIS_URL',
    // External Services
    WEBHOOK_URL: 'WEBHOOK_URL',
    API_BASE_URL: 'API_BASE_URL',
};
//# sourceMappingURL=constants.js.map