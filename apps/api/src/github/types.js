/**
 * Comprehensive TypeScript interfaces for GitHub App integration
 * Provides strict typing for webhook events, check runs, and artifact management
 */
// =============================================================================
// CHECK RUN TYPES
// =============================================================================
export const CHECK_RUN_ACTIONS = [
    'quarantine',
    'rerun_failed',
    'open_issue',
    'dismiss_flake',
    'mark_stable',
];
export const CHECK_RUN_CONCLUSIONS = [
    'success',
    'failure',
    'neutral',
    'cancelled',
    'skipped',
    'timed_out',
    'action_required',
];
export const CHECK_RUN_STATUS = ['queued', 'in_progress', 'completed'];
// =============================================================================
// WORKFLOW AND JOB TYPES
// =============================================================================
export const WORKFLOW_RUN_CONCLUSIONS = [
    'success',
    'failure',
    'neutral',
    'cancelled',
    'skipped',
    'timed_out',
    'action_required',
];
export const WORKFLOW_RUN_STATUS = [
    'queued',
    'in_progress',
    'completed',
    'waiting',
    'requested',
    'pending',
];
// =============================================================================
// ERROR TYPES
// =============================================================================
export class GitHubApiError extends Error {
    status;
    response;
    constructor(message, status, response) {
        super(message);
        this.status = status;
        this.response = response;
        this.name = 'GitHubApiError';
    }
}
export class WebhookValidationError extends Error {
    payload;
    constructor(message, payload) {
        super(message);
        this.payload = payload;
        this.name = 'WebhookValidationError';
    }
}
/**
 * Type guard for webhook event discrimination
 */
export function isWebhookEvent(event, payload) {
    return typeof payload === 'object' && payload !== null;
}
//# sourceMappingURL=types.js.map