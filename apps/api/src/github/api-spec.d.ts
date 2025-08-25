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
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { WebhookEventMap, CheckRunAction, FlakeGuardCheckRun, TestArtifact, ApiResponse, PaginatedResponse, CreateCheckRunParams, UpdateCheckRunParams } from './types.js';
/**
 * Webhook endpoint contract for processing GitHub events
 */
export interface WebhookEndpointSpec {
    readonly path: '/api/github/webhook';
    readonly method: 'POST';
    readonly headers: {
        readonly 'x-github-event': string;
        readonly 'x-github-delivery': string;
        readonly 'x-hub-signature-256': string;
        readonly 'content-type': 'application/json';
    };
    readonly body: unknown;
    readonly response: {
        readonly 200: {
            success: true;
            message: string;
        };
        readonly 400: {
            success: false;
            error: {
                code: string;
                message: string;
            };
        };
        readonly 401: {
            success: false;
            error: {
                code: string;
                message: string;
            };
        };
        readonly 500: {
            success: false;
            error: {
                code: string;
                message: string;
            };
        };
    };
}
/**
 * Webhook payload processing interface
 */
export interface WebhookProcessor<T extends keyof WebhookEventMap> {
    readonly eventType: T;
    validate(payload: unknown): Promise<WebhookEventMap[T]>;
    process(payload: WebhookEventMap[T]): Promise<void>;
    handleError(error: Error, payload?: unknown): Promise<void>;
}
/**
 * Generic webhook handler signature
 */
export interface WebhookHandler {
    (request: FastifyRequest, reply: FastifyReply): Promise<void>;
}
/**
 * Webhook event routing configuration
 */
export interface WebhookRoute<T extends keyof WebhookEventMap> {
    readonly event: T;
    readonly processor: WebhookProcessor<T>;
    readonly middleware?: ReadonlyArray<WebhookMiddleware>;
}
/**
 * Webhook middleware interface
 */
export interface WebhookMiddleware {
    (request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<void>;
}
/**
 * Check run creation endpoint specification
 */
export interface CreateCheckRunEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/check-runs';
    readonly method: 'POST';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
    };
    readonly body: CreateCheckRunParams;
    readonly response: {
        readonly 201: ApiResponse<FlakeGuardCheckRun>;
        readonly 400: ApiResponse<never>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 422: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Check run update endpoint specification
 */
export interface UpdateCheckRunEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/check-runs/:checkRunId';
    readonly method: 'PATCH';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly checkRunId: string;
    };
    readonly body: Omit<UpdateCheckRunParams, 'checkRunId'>;
    readonly response: {
        readonly 200: ApiResponse<FlakeGuardCheckRun>;
        readonly 400: ApiResponse<never>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 422: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Check run retrieval endpoint specification
 */
export interface GetCheckRunEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/check-runs/:checkRunId';
    readonly method: 'GET';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly checkRunId: string;
    };
    readonly response: {
        readonly 200: ApiResponse<FlakeGuardCheckRun>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Check run listing endpoint specification
 */
export interface ListCheckRunsEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/commits/:ref/check-runs';
    readonly method: 'GET';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly ref: string;
    };
    readonly querystring: {
        readonly page?: number;
        readonly perPage?: number;
        readonly status?: 'queued' | 'in_progress' | 'completed';
        readonly conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
    };
    readonly response: {
        readonly 200: PaginatedResponse<FlakeGuardCheckRun>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Check run action handler interface
 */
export interface CheckRunActionHandler {
    readonly action: CheckRunAction;
    handle(checkRunId: number, repository: {
        owner: string;
        repo: string;
    }, context: CheckRunActionContext): Promise<ApiResponse<FlakeGuardCheckRun>>;
}
/**
 * Check run action execution context
 */
export interface CheckRunActionContext {
    readonly installationId: number;
    readonly sender: {
        readonly login: string;
        readonly id: number;
        readonly type: 'User' | 'Bot';
    };
    readonly metadata?: Record<string, unknown>;
}
/**
 * Workflow re-run endpoint specification
 */
export interface RerunWorkflowEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/actions/runs/:runId/rerun';
    readonly method: 'POST';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly runId: string;
    };
    readonly body: {
        readonly enableDebugLogging?: boolean;
        readonly rerunFailedJobsOnly?: boolean;
    };
    readonly response: {
        readonly 201: {
            success: true;
            message: string;
            runId: number;
        };
        readonly 400: ApiResponse<never>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 422: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Workflow job re-run endpoint specification
 */
export interface RerunWorkflowJobEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/actions/jobs/:jobId/rerun';
    readonly method: 'POST';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly jobId: string;
    };
    readonly body: {
        readonly enableDebugLogging?: boolean;
    };
    readonly response: {
        readonly 201: {
            success: true;
            message: string;
            jobId: number;
        };
        readonly 400: ApiResponse<never>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 422: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Workflow cancellation endpoint specification
 */
export interface CancelWorkflowEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/actions/runs/:runId/cancel';
    readonly method: 'POST';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly runId: string;
    };
    readonly response: {
        readonly 202: {
            success: true;
            message: string;
        };
        readonly 400: ApiResponse<never>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 409: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Workflow operations service interface
 */
export interface WorkflowOperationsService {
    rerunWorkflow(owner: string, repo: string, runId: number, options?: {
        enableDebugLogging?: boolean;
        rerunFailedJobsOnly?: boolean;
    }): Promise<{
        success: true;
        message: string;
        runId: number;
    }>;
    rerunWorkflowJob(owner: string, repo: string, jobId: number, options?: {
        enableDebugLogging?: boolean;
    }): Promise<{
        success: true;
        message: string;
        jobId: number;
    }>;
    cancelWorkflow(owner: string, repo: string, runId: number): Promise<{
        success: true;
        message: string;
    }>;
}
/**
 * Artifact listing endpoint specification
 */
export interface ListArtifactsEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/actions/runs/:runId/artifacts';
    readonly method: 'GET';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly runId: string;
    };
    readonly querystring: {
        readonly page?: number;
        readonly perPage?: number;
        readonly name?: string;
        readonly type?: 'test-results' | 'coverage-report' | 'logs' | 'screenshots';
    };
    readonly response: {
        readonly 200: PaginatedResponse<TestArtifact>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Artifact download URL generation endpoint specification
 */
export interface GetArtifactDownloadUrlSpec {
    readonly path: '/api/github/repos/:owner/:repo/actions/artifacts/:artifactId/download-url';
    readonly method: 'GET';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly artifactId: string;
    };
    readonly response: {
        readonly 200: {
            success: true;
            data: {
                downloadUrl: string;
                expiresAt: string;
                sizeInBytes: number;
            };
        };
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 410: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Artifact streaming download endpoint specification
 */
export interface DownloadArtifactEndpointSpec {
    readonly path: '/api/github/repos/:owner/:repo/actions/artifacts/:artifactId/download';
    readonly method: 'GET';
    readonly params: {
        readonly owner: string;
        readonly repo: string;
        readonly artifactId: string;
    };
    readonly headers: {
        readonly 'range'?: string;
    };
    readonly response: {
        readonly 200: ReadableStream<Uint8Array>;
        readonly 206: ReadableStream<Uint8Array>;
        readonly 401: ApiResponse<never>;
        readonly 403: ApiResponse<never>;
        readonly 404: ApiResponse<never>;
        readonly 410: ApiResponse<never>;
        readonly 416: ApiResponse<never>;
        readonly 500: ApiResponse<never>;
    };
}
/**
 * Artifact management service interface
 */
export interface ArtifactService {
    listArtifacts(owner: string, repo: string, runId: number, options?: {
        page?: number;
        perPage?: number;
        name?: string;
        type?: 'test-results' | 'coverage-report' | 'logs' | 'screenshots';
    }): Promise<PaginatedResponse<TestArtifact>>;
    generateDownloadUrl(owner: string, repo: string, artifactId: number): Promise<{
        downloadUrl: string;
        expiresAt: string;
        sizeInBytes: number;
    }>;
    downloadArtifact(owner: string, repo: string, artifactId: number, range?: {
        start?: number;
        end?: number;
    }): Promise<ReadableStream<Uint8Array>>;
    getArtifactMetadata(owner: string, repo: string, artifactId: number): Promise<TestArtifact>;
}
/**
 * Standard error response format
 */
export interface ErrorResponse {
    readonly success: false;
    readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details?: Record<string, unknown>;
        readonly timestamp?: string;
        readonly traceId?: string;
    };
}
/**
 * Error code enumeration for consistent error handling
 */
export declare const enum ErrorCode {
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    INVALID_TOKEN = "INVALID_TOKEN",
    TOKEN_EXPIRED = "TOKEN_EXPIRED",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    INVALID_PAYLOAD = "INVALID_PAYLOAD",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
    INVALID_WEBHOOK_SIGNATURE = "INVALID_WEBHOOK_SIGNATURE",
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
    RESOURCE_ALREADY_EXISTS = "RESOURCE_ALREADY_EXISTS",
    RESOURCE_CONFLICT = "RESOURCE_CONFLICT",
    RESOURCE_GONE = "RESOURCE_GONE",
    GITHUB_API_ERROR = "GITHUB_API_ERROR",
    GITHUB_RATE_LIMITED = "GITHUB_RATE_LIMITED",
    GITHUB_SERVICE_UNAVAILABLE = "GITHUB_SERVICE_UNAVAILABLE",
    INSTALLATION_NOT_FOUND = "INSTALLATION_NOT_FOUND",
    REPOSITORY_NOT_ACCESSIBLE = "REPOSITORY_NOT_ACCESSIBLE",
    WORKFLOW_NOT_FOUND = "WORKFLOW_NOT_FOUND",
    WORKFLOW_RUN_NOT_FOUND = "WORKFLOW_RUN_NOT_FOUND",
    WORKFLOW_JOB_NOT_FOUND = "WORKFLOW_JOB_NOT_FOUND",
    WORKFLOW_CANNOT_RERUN = "WORKFLOW_CANNOT_RERUN",
    WORKFLOW_ALREADY_CANCELLED = "WORKFLOW_ALREADY_CANCELLED",
    CHECK_RUN_NOT_FOUND = "CHECK_RUN_NOT_FOUND",
    CHECK_RUN_ACTION_NOT_SUPPORTED = "CHECK_RUN_ACTION_NOT_SUPPORTED",
    CHECK_RUN_ALREADY_COMPLETED = "CHECK_RUN_ALREADY_COMPLETED",
    ARTIFACT_NOT_FOUND = "ARTIFACT_NOT_FOUND",
    ARTIFACT_EXPIRED = "ARTIFACT_EXPIRED",
    ARTIFACT_TOO_LARGE = "ARTIFACT_TOO_LARGE",
    DOWNLOAD_FAILED = "DOWNLOAD_FAILED",
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
    TIMEOUT = "TIMEOUT",
    RATE_LIMITED = "RATE_LIMITED"
}
/**
 * HTTP status code mapping for error codes
 */
export declare const ERROR_HTTP_STATUS_MAP: Record<ErrorCode, number>;
/**
 * Error factory for creating consistent error responses
 */
export interface ErrorFactory {
    create(code: ErrorCode, message?: string, details?: Record<string, unknown>): ErrorResponse;
    fromError(error: Error, code?: ErrorCode, details?: Record<string, unknown>): ErrorResponse;
    validation(field: string, message: string, value?: unknown): ErrorResponse;
    notFound(resource: string, identifier: string | number): ErrorResponse;
    forbidden(resource: string, action: string): ErrorResponse;
    rateLimit(resetTime?: Date, remaining?: number): ErrorResponse;
}
/**
 * Idempotency key configuration for safe retries
 */
export interface IdempotencyConfig {
    readonly keyHeader: 'Idempotency-Key';
    readonly keyGenerator: () => string;
    readonly ttlSeconds: number;
    readonly storage: IdempotencyStorage;
}
/**
 * Idempotency storage interface
 */
export interface IdempotencyStorage {
    get(key: string): Promise<IdempotencyResult | null>;
    set(key: string, result: IdempotencyResult, ttlSeconds: number): Promise<void>;
    delete(key: string): Promise<void>;
}
/**
 * Stored idempotency result
 */
export interface IdempotencyResult {
    readonly statusCode: number;
    readonly headers: Record<string, string>;
    readonly body: unknown;
    readonly timestamp: string;
}
/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
    readonly windowMs: number;
    readonly maxRequests: number;
    readonly skipSuccessfulRequests?: boolean;
    readonly skipFailedRequests?: boolean;
    readonly keyGenerator: (request: FastifyRequest) => string;
    readonly storage: RateLimitStorage;
}
/**
 * Rate limit storage interface
 */
export interface RateLimitStorage {
    incr(key: string): Promise<{
        totalHits: number;
        timeToExpire: number;
    }>;
    decrement(key: string): Promise<void>;
    reset(key: string): Promise<void>;
}
/**
 * Webhook signature validation interface
 */
export interface WebhookSignatureValidator {
    validate(payload: string, signature: string, secret: string): Promise<boolean>;
}
/**
 * GitHub App authentication interface
 */
export interface GitHubAppAuth {
    generateJWT(): Promise<string>;
    getInstallationToken(installationId: number): Promise<{
        token: string;
        expiresAt: string;
        permissions: Record<string, 'read' | 'write' | 'admin'>;
    }>;
    validateInstallationAccess(installationId: number, owner: string, repo?: string): Promise<boolean>;
}
/**
 * Request context for authenticated operations
 */
export interface AuthenticatedContext {
    readonly installationId: number;
    readonly permissions: Record<string, 'read' | 'write' | 'admin'>;
    readonly repositories: ReadonlyArray<{
        readonly id: number;
        readonly name: string;
        readonly fullName: string;
    }> | 'all';
}
/**
 * API metrics interface
 */
export interface ApiMetrics {
    recordRequest(method: string, path: string, statusCode: number, duration: number): void;
    recordWebhookEvent(eventType: string, processingTime: number, success: boolean): void;
    recordGitHubApiCall(endpoint: string, statusCode: number, duration: number, rateLimitRemaining?: number): void;
    recordError(errorCode: ErrorCode, method: string, path: string): void;
}
/**
 * Health check interface
 */
export interface HealthCheck {
    readonly name: string;
    check(): Promise<{
        healthy: boolean;
        details?: Record<string, unknown>;
    }>;
}
/**
 * System health status
 */
export interface SystemHealth {
    readonly status: 'healthy' | 'degraded' | 'unhealthy';
    readonly checks: Record<string, {
        readonly status: 'pass' | 'warn' | 'fail';
        readonly details?: Record<string, unknown>;
        readonly timestamp: string;
    }>;
    readonly timestamp: string;
}
export type { WebhookEventMap, CheckRunAction, FlakeGuardCheckRun, TestArtifact, ApiResponse, PaginatedResponse, RepositoryInfo, CreateCheckRunParams, UpdateCheckRunParams, } from './types.js';
//# sourceMappingURL=api-spec.d.ts.map