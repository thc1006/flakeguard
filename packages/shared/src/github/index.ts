/**
 * GitHub API Wrapper with Rate Limiting and Resilience
 * P18 - Rate Limit & Resilience Implementation
 * 
 * This module provides a comprehensive GitHub API integration with:
 * - Rate limiting and throttling
 * - Circuit breaker pattern
 * - Exponential backoff with jitter
 * - Request queuing and prioritization
 * - Artifact download with streaming
 * - Security and audit logging
 * - Comprehensive monitoring and metrics
 */

// Core API Wrapper
export {
  EnhancedGitHubApiWrapper,
  createGitHubApiWrapper,
  createGitHubApiWrapperFromEnv,
} from './api-wrapper.js';

// Circuit Breaker
export {
  CircuitBreaker,
  CircuitBreakerMetrics,
} from './circuit-breaker.js';

// Rate Limiting
export {
  PrimaryRateLimiter,
  SecondaryRateLimiter,
  ExponentialBackoff,
  RateLimitMetrics,
} from './rate-limiter.js';

// Request Queue
export {
  RequestQueue,
  RequestPrioritizer,
} from './request-queue.js';

// Artifact Handling
export {
  ArtifactHandler,
} from './artifact-handler.js';

// Security
export {
  SecurityManager,
  TokenManager,
} from './security.js';

// Test utilities (exported for testing purposes)
export {
  MockGitHubApiWrapper,
  testConfigurations,
  TestUtils,
  exampleTests,
} from './test-config.js';

// Octokit Helpers (P2 requirements)
export {
  OctokitHelpers,
  createOctokitHelpers,
  ArtifactDownloadError,
} from './octokit-helpers.js';

export type {
  GitHubArtifact,
  GitHubWorkflowRun,
  GitHubJob,
  OctokitHelpersConfig,
} from './octokit-helpers.js';

// Example usage patterns - temporarily disabled
// export {
//   GitHubApiExamples,
//   exampleConfigurations,
//   usagePatterns,
// } from './examples.js';

// Types
export type {
  // Configuration Types
  GitHubApiConfig,
  RateLimitConfig,
  SecondaryRateLimitConfig,
  CircuitBreakerConfig,
  RetryConfig,
  TimeoutConfig,
  RequestQueueConfig,
  SecurityConfig,
  ArtifactDownloadConfig,

  // Status and Info Types
  RateLimitInfo,
  CircuitBreakerState,
  CircuitBreakerStatus,
  ArtifactUrlInfo,
  
  // Request Types
  RequestOptions,
  ArtifactDownloadOptions,
  ArtifactStreamOptions,
  
  // Metrics Types
  ApiMetrics,
  RequestMetrics,
  RetryAttempt,
  AuditLogEntry,
  
  // Error Types
  ApiErrorCode,
  
  // Interface Types
  GitHubApiWrapper,
} from './types.js';

// Default configurations
export {
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_SECONDARY_RATE_LIMIT_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_TIMEOUT_CONFIG,
  DEFAULT_REQUEST_QUEUE_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_ARTIFACT_DOWNLOAD_CONFIG,
  CIRCUIT_BREAKER_STATES,
  API_ERROR_CODES,
} from './types.js';

// Export GitHubApiError class separately to avoid conflicts
export { GitHubApiError } from './types.js';

/**
 * Utility functions for common operations
 */

/**
 * Check if error is a GitHub rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  // Use duck typing to check for rate limit errors without circular dependency
  if (error && typeof error === 'object' && 'code' in error) {
    const errorWithCode = error as { code: unknown };
    if (errorWithCode.code === 'RATE_LIMITED') {
      return true;
    }
  }
  
  if (typeof error === 'object' && error !== null && 'status' in error && (error.status === 403 || error.status === 429)) {
    return true;
  }
  
  const message = (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') ? error.message.toLowerCase() : '';
  return message.includes('rate limit') || message.includes('abuse');
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  // Use duck typing to check for retryable errors without circular dependency
  if (error && typeof error === 'object' && 'retryable' in error) {
    const errorWithRetryable = error as { retryable: unknown };
    if (errorWithRetryable.retryable === true) {
      return true;
    }
  }
  
  // Network errors are generally retryable
  const networkErrorCodes = ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'];
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && networkErrorCodes.includes(error.code)) {
    return true;
  }
  
  // HTTP errors that are retryable
  const retryableStatusCodes = [429, 500, 502, 503, 504];
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' && retryableStatusCodes.includes(error.status)) {
    return true;
  }
  
  return false;
}

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000,
  multiplier: number = 2,
  jitterFactor: number = 0.1
): number {
  const exponentialDelay = baseDelayMs * Math.pow(multiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  // Add jitter to prevent thundering herd
  const jitter = cappedDelay * jitterFactor * (Math.random() - 0.5);
  const finalDelay = Math.max(0, cappedDelay + jitter);
  
  return Math.floor(finalDelay);
}

/**
 * Create a simple retry wrapper for functions
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    multiplier?: number;
    jitterFactor?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    multiplier = 2,
    jitterFactor = 0.1,
    shouldRetry = isRetryableError,
  } = options;
  
  let lastError: Error = new Error('Operation failed');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = calculateBackoffDelay(
        attempt,
        baseDelayMs,
        maxDelayMs,
        multiplier,
        jitterFactor
      );

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Parse GitHub rate limit headers
 */
export function parseRateLimitHeaders(headers: Record<string, unknown>): Partial<import('./types.js').RateLimitInfo> {
  const limit = parseInt(String(headers['x-ratelimit-limit'] || '0'), 10);
  const remaining = parseInt(String(headers['x-ratelimit-remaining'] || '0'), 10);
  const reset = parseInt(String(headers['x-ratelimit-reset'] || '0'), 10);
  const resource = String(headers['x-ratelimit-resource'] || 'core');
  
  if (limit === 0 || reset === 0) {
    return {};
  }

  const resetAt = new Date(reset * 1000);
  const resetInSeconds = Math.max(0, Math.floor((resetAt.getTime() - Date.now()) / 1000));
  
  return {
    limit,
    remaining,
    resetAt,
    resetInSeconds,
    resource,
    isLimited: remaining <= Math.floor(limit * 0.1), // Consider limited at 10% remaining
  };
}

/**
 * Format rate limit info for logging
 */
export function formatRateLimitInfo(info: import('./types.js').RateLimitInfo): string {
  const percentage = ((info.limit - info.remaining) / info.limit * 100).toFixed(1);
  const resetTime = new Date(info.resetAt).toISOString();
  
  return `${info.resource}: ${info.remaining}/${info.limit} (${percentage}% used), resets at ${resetTime}`;
}

/**
 * Create a health check function for the API wrapper
 */
export function createHealthCheck(wrapper: import('./types.js').GitHubApiWrapper) {
  return (): {
    healthy: boolean;
    status: string;
    details: {
      circuitBreaker: string;
      rateLimit: string;
      lastRequest?: string;
    };
  } => {
    try {
      const metrics = wrapper.metrics;
      const rateLimitStatus = wrapper.rateLimitStatus;
      const circuitBreakerStatus = wrapper.circuitBreakerStatus;
      
      const healthy = circuitBreakerStatus.state === 'closed' && 
                     !rateLimitStatus.isLimited &&
                     metrics.successRate > 0.9; // 90% success rate threshold
      
      return {
        healthy,
        status: healthy ? 'UP' : 'DOWN',
        details: {
          circuitBreaker: `${circuitBreakerStatus.state} (${circuitBreakerStatus.failureCount} failures)`,
          rateLimit: formatRateLimitInfo(rateLimitStatus),
          lastRequest: metrics.requestsLast24h > 0 ? 'Recent activity' : 'No recent requests',
        },
      };
    } catch (error) {
      return {
        healthy: false,
        status: 'DOWN',
        details: {
          circuitBreaker: 'Unknown',
          rateLimit: 'Unknown',
          lastRequest: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  };
}

/**
 * Development and debugging utilities
 */
export const debug = {
  /**
   * Log rate limit status
   */
  logRateLimit: (wrapper: import('./types.js').GitHubApiWrapper, logger: { debug: (message: string) => void }) => {
    const rateLimitInfo = wrapper.rateLimitStatus;
    logger.debug(formatRateLimitInfo(rateLimitInfo));
  },

  /**
   * Log circuit breaker status
   */
  logCircuitBreaker: (wrapper: import('./types.js').GitHubApiWrapper, logger: { debug: (message: string) => void }) => {
    const status = wrapper.circuitBreakerStatus;
    logger.debug(`Circuit breaker: ${status.state} (${status.failureCount} failures)`);
  },

  /**
   * Log full metrics
   */
  logMetrics: (wrapper: import('./types.js').GitHubApiWrapper, logger: { debug: (data: Record<string, unknown>, message: string) => void }) => {
    const metrics = wrapper.metrics;
    logger.debug({
      requests: metrics.totalRequests,
      failures: metrics.totalFailures,
      successRate: `${(metrics.successRate * 100).toFixed(2)}%`,
      avgResponseTime: `${metrics.avgResponseTimeMs.toFixed(2)}ms`,
      p95ResponseTime: `${metrics.p95ResponseTimeMs.toFixed(2)}ms`,
      rateLimit: formatRateLimitInfo(metrics.rateLimitStatus),
      circuitBreaker: metrics.circuitBreakerStatus.state,
    }, 'GitHub API Wrapper Metrics');
  },

  /**
   * Create a simple test function
   */
  test: async (wrapper: import('./types.js').GitHubApiWrapper): Promise<void> => {
    await wrapper.request({
      method: 'GET',
      endpoint: '/user',
    });
  },
};