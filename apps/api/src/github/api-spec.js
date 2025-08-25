/**
 * GitHub App API Contract and Integration Patterns
 *
 * Defines RESTful API contracts for GitHub App integration including:
 * - Webhook endpoint structures and payload handling
 * - Check run management operations with actions
 * - Workflow re-run operations interface
 * - Artifact listing and download URL generation
 * - Consistent error handling and response formats
 *
 * Follows RESTful principles, HTTP semantics, and security best practices.
 */
/**
 * HTTP status code mapping for error codes
 */
export const ERROR_HTTP_STATUS_MAP = {
    // 401 Unauthorized
    ["UNAUTHORIZED" /* ErrorCode.UNAUTHORIZED */]: 401,
    ["INVALID_TOKEN" /* ErrorCode.INVALID_TOKEN */]: 401,
    ["TOKEN_EXPIRED" /* ErrorCode.TOKEN_EXPIRED */]: 401,
    // 403 Forbidden
    ["FORBIDDEN" /* ErrorCode.FORBIDDEN */]: 403,
    ["INSTALLATION_NOT_FOUND" /* ErrorCode.INSTALLATION_NOT_FOUND */]: 403,
    ["REPOSITORY_NOT_ACCESSIBLE" /* ErrorCode.REPOSITORY_NOT_ACCESSIBLE */]: 403,
    // 400 Bad Request
    ["VALIDATION_ERROR" /* ErrorCode.VALIDATION_ERROR */]: 400,
    ["INVALID_PAYLOAD" /* ErrorCode.INVALID_PAYLOAD */]: 400,
    ["MISSING_REQUIRED_FIELD" /* ErrorCode.MISSING_REQUIRED_FIELD */]: 400,
    ["INVALID_WEBHOOK_SIGNATURE" /* ErrorCode.INVALID_WEBHOOK_SIGNATURE */]: 400,
    // 404 Not Found
    ["RESOURCE_NOT_FOUND" /* ErrorCode.RESOURCE_NOT_FOUND */]: 404,
    ["WORKFLOW_NOT_FOUND" /* ErrorCode.WORKFLOW_NOT_FOUND */]: 404,
    ["WORKFLOW_RUN_NOT_FOUND" /* ErrorCode.WORKFLOW_RUN_NOT_FOUND */]: 404,
    ["WORKFLOW_JOB_NOT_FOUND" /* ErrorCode.WORKFLOW_JOB_NOT_FOUND */]: 404,
    ["CHECK_RUN_NOT_FOUND" /* ErrorCode.CHECK_RUN_NOT_FOUND */]: 404,
    ["ARTIFACT_NOT_FOUND" /* ErrorCode.ARTIFACT_NOT_FOUND */]: 404,
    // 409 Conflict
    ["RESOURCE_ALREADY_EXISTS" /* ErrorCode.RESOURCE_ALREADY_EXISTS */]: 409,
    ["RESOURCE_CONFLICT" /* ErrorCode.RESOURCE_CONFLICT */]: 409,
    ["WORKFLOW_ALREADY_CANCELLED" /* ErrorCode.WORKFLOW_ALREADY_CANCELLED */]: 409,
    // 410 Gone
    ["RESOURCE_GONE" /* ErrorCode.RESOURCE_GONE */]: 410,
    ["ARTIFACT_EXPIRED" /* ErrorCode.ARTIFACT_EXPIRED */]: 410,
    // 413 Payload Too Large
    ["ARTIFACT_TOO_LARGE" /* ErrorCode.ARTIFACT_TOO_LARGE */]: 413,
    // 422 Unprocessable Entity
    ["CHECK_RUN_ACTION_NOT_SUPPORTED" /* ErrorCode.CHECK_RUN_ACTION_NOT_SUPPORTED */]: 422,
    ["CHECK_RUN_ALREADY_COMPLETED" /* ErrorCode.CHECK_RUN_ALREADY_COMPLETED */]: 422,
    ["WORKFLOW_CANNOT_RERUN" /* ErrorCode.WORKFLOW_CANNOT_RERUN */]: 422,
    // 429 Too Many Requests
    ["GITHUB_RATE_LIMITED" /* ErrorCode.GITHUB_RATE_LIMITED */]: 429,
    ["RATE_LIMITED" /* ErrorCode.RATE_LIMITED */]: 429,
    // 500 Internal Server Error
    ["INTERNAL_SERVER_ERROR" /* ErrorCode.INTERNAL_SERVER_ERROR */]: 500,
    ["GITHUB_API_ERROR" /* ErrorCode.GITHUB_API_ERROR */]: 500,
    ["DOWNLOAD_FAILED" /* ErrorCode.DOWNLOAD_FAILED */]: 500,
    // 503 Service Unavailable
    ["SERVICE_UNAVAILABLE" /* ErrorCode.SERVICE_UNAVAILABLE */]: 503,
    ["GITHUB_SERVICE_UNAVAILABLE" /* ErrorCode.GITHUB_SERVICE_UNAVAILABLE */]: 503,
    // 504 Gateway Timeout
    ["TIMEOUT" /* ErrorCode.TIMEOUT */]: 504,
};
//# sourceMappingURL=api-spec.js.map