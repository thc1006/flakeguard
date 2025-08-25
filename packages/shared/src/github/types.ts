/**
 * GitHub API rate limiting and resilience types
 * Implements comprehensive types for P18 - Rate Limit & Resilience
 */

import type { RequestError } from '@octokit/request-error';
import type { Octokit } from '@octokit/rest';
import type { Logger } from 'pino';

// =============================================================================
// RATE LIMITING TYPES
// =============================================================================

export interface RateLimitInfo {
  /** Remaining requests in current window */
  readonly remaining: number;
  /** Total limit for current window */
  readonly limit: number;
  /** Timestamp when rate limit resets */
  readonly resetAt: Date;
  /** Seconds until reset */
  readonly resetInSeconds: number;
  /** Current resource being tracked (core, graphql, search, etc.) */
  readonly resource: string;
  /** Whether we're currently rate limited */
  readonly isLimited: boolean;
}

export interface RateLimitConfig {
  /** Enable rate limit tracking and enforcement */
  readonly enabled: boolean;
  /** Percentage of rate limit to reserve (0-100) */
  readonly reservePercentage: number;
  /** Minimum requests to keep in reserve */
  readonly minReserveRequests: number;
  /** Enable proactive throttling when approaching limits */
  readonly enableThrottling: boolean;
  /** Throttle when remaining drops below this percentage */
  readonly throttleThresholdPercent: number;
  /** Maximum delay in milliseconds for throttling */
  readonly maxThrottleDelayMs: number;
}

export interface SecondaryRateLimitConfig {
  /** Enable secondary rate limit handling */
  readonly enabled: boolean;
  /** Maximum number of retry attempts */
  readonly maxRetries: number;
  /** Base delay in milliseconds for exponential backoff */
  readonly baseDelayMs: number;
  /** Maximum delay in milliseconds */
  readonly maxDelayMs: number;
  /** Jitter factor (0-1) for randomizing delays */
  readonly jitterFactor: number;
  /** Multiplier for exponential backoff */
  readonly backoffMultiplier: number;
}

// =============================================================================
// CIRCUIT BREAKER TYPES
// =============================================================================

export const CIRCUIT_BREAKER_STATES = ['closed', 'open', 'half-open'] as const;
export type CircuitBreakerState = typeof CIRCUIT_BREAKER_STATES[number];

export interface CircuitBreakerConfig {
  /** Enable circuit breaker pattern */
  readonly enabled: boolean;
  /** Number of failures to trigger open state */
  readonly failureThreshold: number;
  /** Time window in milliseconds for failure counting */
  readonly failureTimeWindowMs: number;
  /** Timeout in milliseconds for open state */
  readonly openTimeoutMs: number;
  /** Number of test requests in half-open state */
  readonly halfOpenMaxCalls: number;
  /** Success ratio required to close circuit (0-1) */
  readonly successThreshold: number;
}

export interface CircuitBreakerStatus {
  readonly state: CircuitBreakerState;
  readonly failureCount: number;
  readonly lastFailureAt: Date | null;
  readonly nextAttemptAt: Date | null;
  readonly halfOpenAttempts: number;
  readonly totalRequests: number;
  readonly totalFailures: number;
}

// =============================================================================
// RETRY AND BACKOFF TYPES
// =============================================================================

export interface RetryConfig {
  /** Enable retry mechanism */
  readonly enabled: boolean;
  /** Maximum number of retry attempts */
  readonly maxAttempts: number;
  /** Base delay in milliseconds */
  readonly baseDelayMs: number;
  /** Maximum delay in milliseconds */
  readonly maxDelayMs: number;
  /** Exponential backoff multiplier */
  readonly multiplier: number;
  /** Jitter factor for randomizing delays */
  readonly jitterFactor: number;
  /** HTTP status codes that should trigger retry */
  readonly retryableStatusCodes: readonly number[];
  /** Error types that should trigger retry */
  readonly retryableErrors: readonly string[];
}

export interface RetryAttempt {
  readonly attemptNumber: number;
  readonly delayMs: number;
  readonly error: RequestError | Error;
  readonly timestamp: Date;
}

// =============================================================================
// TIMEOUT AND RESILIENCE TYPES
// =============================================================================

export interface TimeoutConfig {
  /** Request timeout in milliseconds */
  readonly requestTimeoutMs: number;
  /** Connection timeout in milliseconds */
  readonly connectionTimeoutMs: number;
  /** Enable timeout enforcement */
  readonly enabled: boolean;
}

export interface RequestQueueConfig {
  /** Enable request queuing */
  readonly enabled: boolean;
  /** Maximum queue size */
  readonly maxSize: number;
  /** Maximum wait time in queue (milliseconds) */
  readonly maxWaitTimeMs: number;
  /** Priority levels for requests */
  readonly priorities: readonly ('low' | 'normal' | 'high' | 'critical')[];
}

// =============================================================================
// METRICS AND MONITORING TYPES
// =============================================================================

export interface ApiMetrics {
  /** Total API requests made */
  readonly totalRequests: number;
  /** Total API failures */
  readonly totalFailures: number;
  /** Success rate (0-1) */
  readonly successRate: number;
  /** Average response time in milliseconds */
  readonly avgResponseTimeMs: number;
  /** P95 response time in milliseconds */
  readonly p95ResponseTimeMs: number;
  /** P99 response time in milliseconds */
  readonly p99ResponseTimeMs: number;
  /** Current rate limit status */
  readonly rateLimitStatus: RateLimitInfo;
  /** Circuit breaker status */
  readonly circuitBreakerStatus: CircuitBreakerStatus;
  /** Last 24 hours request count */
  readonly requestsLast24h: number;
  /** Last 24 hours failure count */
  readonly failuresLast24h: number;
}

export interface RequestMetrics {
  readonly method: string;
  readonly endpoint: string;
  readonly startTime: Date;
  endTime?: Date;
  duration?: number;
  success: boolean;
  statusCode?: number;
  error?: RequestError | Error;
  retryAttempts: RetryAttempt[];
  rateLimitInfo?: RateLimitInfo;
  circuitBreakerState?: CircuitBreakerState;
}

// =============================================================================
// SECURITY TYPES
// =============================================================================

export interface SecurityConfig {
  /** Enable request sanitization */
  readonly sanitizeRequests: boolean;
  /** Enable response validation */
  readonly validateResponses: boolean;
  /** Enable audit logging */
  readonly auditLogging: boolean;
  /** Sensitive fields to redact from logs */
  readonly sensitiveFields: readonly string[];
  /** Enable webhook signature verification */
  readonly verifyWebhookSignatures: boolean;
}

export interface AuditLogEntry {
  readonly timestamp: Date;
  readonly requestId: string;
  readonly method: string;
  readonly endpoint: string;
  readonly userAgent?: string;
  readonly installationId?: number;
  readonly success: boolean;
  readonly duration: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

// =============================================================================
// ARTIFACT HANDLING TYPES
// =============================================================================

export interface ArtifactDownloadConfig {
  /** Enable artifact download resilience */
  readonly enabled: boolean;
  /** Maximum download size in bytes */
  readonly maxSizeBytes: number;
  /** Download timeout in milliseconds */
  readonly timeoutMs: number;
  /** Number of retry attempts for failed downloads */
  readonly maxRetries: number;
  /** Enable streaming download */
  readonly useStreaming: boolean;
  /** Chunk size for streaming in bytes */
  readonly streamChunkSize: number;
}

export interface ArtifactUrlInfo {
  readonly url: string;
  readonly expiresAt: Date;
  readonly isExpired: boolean;
  readonly timeToExpiryMs: number;
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export interface GitHubApiConfig {
  /** GitHub App configuration */
  readonly app: {
    readonly appId: number;
    readonly privateKey: string;
    readonly installationId?: number;
  };
  /** Rate limiting configuration */
  readonly rateLimit: RateLimitConfig;
  /** Secondary rate limit configuration */
  readonly secondaryRateLimit: SecondaryRateLimitConfig;
  /** Circuit breaker configuration */
  readonly circuitBreaker: CircuitBreakerConfig;
  /** Retry configuration */
  readonly retry: RetryConfig;
  /** Timeout configuration */
  readonly timeout: TimeoutConfig;
  /** Request queue configuration */
  readonly requestQueue: RequestQueueConfig;
  /** Security configuration */
  readonly security: SecurityConfig;
  /** Artifact download configuration */
  readonly artifactDownload: ArtifactDownloadConfig;
  /** Logger instance */
  readonly logger: Logger;
  /** Enable debug mode */
  readonly debug: boolean;
}

// =============================================================================
// API WRAPPER TYPES
// =============================================================================

export interface GitHubApiWrapper {
  /** Get underlying Octokit instance */
  readonly octokit: Octokit;
  /** Get current metrics */
  readonly metrics: ApiMetrics;
  /** Get current rate limit status */
  readonly rateLimitStatus: RateLimitInfo;
  /** Get circuit breaker status */
  readonly circuitBreakerStatus: CircuitBreakerStatus;
  
  /** Make authenticated API request with resilience */
  request<T = any>(options: RequestOptions): Promise<T>;
  
  /** Download artifact with retry and validation */
  downloadArtifact(options: ArtifactDownloadOptions): Promise<Buffer>;
  
  /** Stream artifact download with resilience */
  streamArtifact(options: ArtifactStreamOptions): AsyncIterable<Buffer>;
  
  /** Validate webhook signature */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
  
  /** Gracefully close wrapper and clean up resources */
  close(): Promise<void>;
}

export interface RequestOptions {
  readonly method: string;
  readonly endpoint: string;
  readonly data?: any;
  readonly headers?: Record<string, string>;
  readonly priority?: 'low' | 'normal' | 'high' | 'critical';
  readonly timeout?: number;
  readonly skipCache?: boolean;
}

export interface ArtifactDownloadOptions {
  readonly artifactId: number;
  readonly owner: string;
  readonly repo: string;
  readonly maxRetries?: number;
  readonly timeout?: number;
}

export interface ArtifactStreamOptions extends ArtifactDownloadOptions {
  readonly chunkSize?: number;
  readonly signal?: AbortSignal;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export const API_ERROR_CODES = [
  'RATE_LIMITED',
  'CIRCUIT_BREAKER_OPEN',
  'REQUEST_TIMEOUT',
  'QUEUE_FULL',
  'AUTHENTICATION_FAILED',
  'PERMISSION_DENIED',
  'ARTIFACT_EXPIRED',
  'ARTIFACT_TOO_LARGE',
  'WEBHOOK_VERIFICATION_FAILED',
  'CONFIGURATION_INVALID',
  'NETWORK_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ApiErrorCode = typeof API_ERROR_CODES[number];

export class GitHubApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode?: number;
  public readonly retryable: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options?: {
      statusCode?: number;
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'GitHubApiError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.retryable = options?.retryable ?? false;
    this.context = options?.context;
    
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}

// =============================================================================
// DEFAULT CONFIGURATIONS
// =============================================================================

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: true,
  reservePercentage: 10,
  minReserveRequests: 100,
  enableThrottling: true,
  throttleThresholdPercent: 20,
  maxThrottleDelayMs: 60000,
} as const;

export const DEFAULT_SECONDARY_RATE_LIMIT_CONFIG: SecondaryRateLimitConfig = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 300000, // 5 minutes
  jitterFactor: 0.1,
  backoffMultiplier: 2,
} as const;

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  enabled: true,
  failureThreshold: 5,
  failureTimeWindowMs: 60000, // 1 minute
  openTimeoutMs: 300000, // 5 minutes
  halfOpenMaxCalls: 3,
  successThreshold: 0.5,
} as const;

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  enabled: true,
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  jitterFactor: 0.1,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'],
} as const;

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  requestTimeoutMs: 30000,
  connectionTimeoutMs: 10000,
  enabled: true,
} as const;

export const DEFAULT_REQUEST_QUEUE_CONFIG: RequestQueueConfig = {
  enabled: true,
  maxSize: 1000,
  maxWaitTimeMs: 60000,
  priorities: ['low', 'normal', 'high', 'critical'],
} as const;

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  sanitizeRequests: true,
  validateResponses: true,
  auditLogging: true,
  sensitiveFields: ['token', 'password', 'secret', 'key', 'authorization'],
  verifyWebhookSignatures: true,
} as const;

export const DEFAULT_ARTIFACT_DOWNLOAD_CONFIG: ArtifactDownloadConfig = {
  enabled: true,
  maxSizeBytes: 100 * 1024 * 1024, // 100MB
  timeoutMs: 300000, // 5 minutes
  maxRetries: 3,
  useStreaming: true,
  streamChunkSize: 64 * 1024, // 64KB
} as const;