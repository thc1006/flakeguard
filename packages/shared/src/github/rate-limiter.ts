/**
 * Rate Limiter implementation for GitHub API
 * Handles primary and secondary rate limits with intelligent throttling
 */

import type { Logger } from 'pino';
import type { RequestError } from '@octokit/request-error';
import { GitHubApiError } from './types.js';

import type {
  RateLimitConfig,
  SecondaryRateLimitConfig,
  RateLimitInfo,
  RetryAttempt,
} from './types.js';

/**
 * Primary rate limiter for GitHub API
 * Tracks and enforces primary rate limits (5000/hour for GitHub Apps)
 */
export class PrimaryRateLimiter {
  private currentLimits: Map<string, RateLimitInfo> = new Map();
  private readonly pendingRequests = new Map<string, Promise<void>>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Check if request should be throttled based on current rate limits
   */
  async checkRateLimit(resource: string = 'core'): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const limitInfo = this.currentLimits.get(resource);
    if (!limitInfo) {
      return; // No rate limit info available yet
    }

    if (this.shouldThrottle(limitInfo)) {
      const delayMs = this.calculateThrottleDelay(limitInfo);
      
      this.logger.warn(
        {
          resource,
          remaining: limitInfo.remaining,
          limit: limitInfo.limit,
          resetAt: limitInfo.resetAt,
          delayMs,
        },
        'Rate limit throttling request'
      );

      await this.delay(delayMs);
    }
  }

  /**
   * Update rate limit info from GitHub API response headers
   */
  updateRateLimit(headers: Record<string, string>, resource: string = 'core'): void {
    const limit = parseInt(headers['x-ratelimit-limit'] || '0', 10);
    const remaining = parseInt(headers['x-ratelimit-remaining'] || '0', 10);
    const reset = parseInt(headers['x-ratelimit-reset'] || '0', 10);
    
    if (limit === 0 || reset === 0) {
      return; // Invalid or missing rate limit headers
    }

    const resetAt = new Date(reset * 1000);
    const resetInSeconds = Math.max(0, Math.floor((resetAt.getTime() - Date.now()) / 1000));
    const isLimited = remaining <= this.getReserveThreshold(limit);

    const rateLimitInfo: RateLimitInfo = {
      remaining,
      limit,
      resetAt,
      resetInSeconds,
      resource,
      isLimited,
    };

    this.currentLimits.set(resource, rateLimitInfo);

    this.logger.debug(
      {
        resource,
        remaining,
        limit,
        resetAt,
        isLimited,
      },
      'Updated rate limit info'
    );

    // Log warning if approaching limits
    if (isLimited) {
      this.logger.warn(
        {
          resource,
          remaining,
          limit,
          resetAt,
          reserveThreshold: this.getReserveThreshold(limit),
        },
        'Approaching GitHub API rate limit'
      );
    }
  }

  /**
   * Get current rate limit info for resource
   */
  getRateLimitInfo(resource: string = 'core'): RateLimitInfo | null {
    return this.currentLimits.get(resource) || null;
  }

  /**
   * Get all rate limit information
   */
  getAllRateLimits(): Map<string, RateLimitInfo> {
    return new Map(this.currentLimits);
  }

  /**
   * Check if we should throttle requests
   */
  private shouldThrottle(limitInfo: RateLimitInfo): boolean {
    if (!this.config.enableThrottling) {
      return false;
    }

    const usedPercentage = ((limitInfo.limit - limitInfo.remaining) / limitInfo.limit) * 100;
    return usedPercentage >= (100 - this.config.throttleThresholdPercent);
  }

  /**
   * Calculate throttle delay based on rate limit status
   */
  private calculateThrottleDelay(limitInfo: RateLimitInfo): number {
    const remainingPercent = (limitInfo.remaining / limitInfo.limit) * 100;
    const throttleIntensity = Math.max(0, (this.config.throttleThresholdPercent - remainingPercent) / this.config.throttleThresholdPercent);
    
    const baseDelay = Math.min(
      this.config.maxThrottleDelayMs,
      (limitInfo.resetInSeconds * 1000) / Math.max(1, limitInfo.remaining)
    );

    return Math.floor(baseDelay * throttleIntensity);
  }

  /**
   * Get reserve threshold for rate limit
   */
  private getReserveThreshold(limit: number): number {
    const percentageReserve = Math.floor((limit * this.config.reservePercentage) / 100);
    return Math.max(percentageReserve, this.config.minReserveRequests);
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Secondary rate limiter for abuse prevention
 * Handles 403 responses with Retry-After headers
 */
export class SecondaryRateLimiter {
  private readonly activeDelays = new Map<string, Promise<void>>();

  constructor(
    private readonly config: SecondaryRateLimitConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Handle secondary rate limit (403 with Retry-After)
   */
  async handleSecondaryRateLimit(
    error: RequestError,
    attemptNumber: number,
    endpoint: string
  ): Promise<RetryAttempt> {
    if (!this.config.enabled) {
      throw error;
    }

    if (attemptNumber > this.config.maxRetries) {
      this.logger.error(
        {
          endpoint,
          attemptNumber,
          maxRetries: this.config.maxRetries,
          error: error.message,
        },
        'Secondary rate limit max retries exceeded'
      );
      
      throw new GitHubApiError(
        'RATE_LIMITED',
        `Secondary rate limit exceeded after ${this.config.maxRetries} retries`,
        {
          statusCode: error.status,
          retryable: false,
          context: { endpoint, attemptNumber, originalError: error.message },
          cause: error,
        }
      );
    }

    const retryAfter = this.extractRetryAfter(error);
    const delayMs = this.calculateBackoffDelay(attemptNumber, retryAfter);

    this.logger.warn(
      {
        endpoint,
        attemptNumber,
        delayMs,
        retryAfter,
        error: error.message,
      },
      'Secondary rate limit hit, backing off'
    );

    // Apply delay with deduplication by endpoint
    await this.applyDelay(endpoint, delayMs);

    return {
      attemptNumber,
      delayMs,
      error,
      timestamp: new Date(),
    };
  }

  /**
   * Check if error is secondary rate limit
   */
  isSecondaryRateLimit(error: RequestError): boolean {
    return error.status === 403 && (
      error.message.toLowerCase().includes('rate limit') ||
      error.message.toLowerCase().includes('abuse') ||
      error.response?.headers?.['retry-after'] !== undefined
    );
  }

  /**
   * Extract retry-after value from error response
   */
  private extractRetryAfter(error: RequestError): number | null {
    const retryAfter = error.response?.headers?.['retry-after'];
    
    if (typeof retryAfter === 'string') {
      const seconds = parseInt(retryAfter, 10);
      return isNaN(seconds) ? null : seconds * 1000;
    }
    
    return null;
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attemptNumber: number, retryAfter: number | null): number {
    let delayMs: number;

    if (retryAfter !== null) {
      // Use Retry-After header if available
      delayMs = retryAfter;
    } else {
      // Calculate exponential backoff
      delayMs = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attemptNumber - 1);
    }

    // Apply maximum delay cap
    delayMs = Math.min(delayMs, this.config.maxDelayMs);

    // Apply jitter to prevent thundering herd
    const jitter = delayMs * this.config.jitterFactor * (Math.random() - 0.5);
    delayMs = Math.max(0, delayMs + jitter);

    return Math.floor(delayMs);
  }

  /**
   * Apply delay with deduplication
   */
  private async applyDelay(endpoint: string, delayMs: number): Promise<void> {
    // Check if there's already an active delay for this endpoint
    const existingDelay = this.activeDelays.get(endpoint);
    if (existingDelay) {
      this.logger.debug(
        { endpoint, delayMs },
        'Reusing existing delay for endpoint'
      );
      return existingDelay;
    }

    // Create new delay promise
    const delayPromise = new Promise<void>(resolve => {
      setTimeout(() => {
        this.activeDelays.delete(endpoint);
        resolve();
      }, delayMs);
    });

    this.activeDelays.set(endpoint, delayPromise);
    return delayPromise;
  }
}

/**
 * Jittered exponential backoff utility
 */
export class ExponentialBackoff {
  constructor(
    private readonly baseDelayMs: number = 1000,
    private readonly maxDelayMs: number = 30000,
    private readonly multiplier: number = 2,
    private readonly jitterFactor: number = 0.1,
    private readonly logger?: Logger
  ) {}

  /**
   * Calculate delay for attempt number
   */
  calculateDelay(attemptNumber: number): number {
    const exponentialDelay = this.baseDelayMs * Math.pow(this.multiplier, attemptNumber - 1);
    const cappedDelay = Math.min(exponentialDelay, this.maxDelayMs);
    
    // Apply jitter
    const jitter = cappedDelay * this.jitterFactor * (Math.random() - 0.5);
    const finalDelay = Math.max(0, cappedDelay + jitter);

    this.logger?.debug(
      {
        attemptNumber,
        exponentialDelay,
        cappedDelay,
        jitter,
        finalDelay,
      },
      'Calculated exponential backoff delay'
    );

    return Math.floor(finalDelay);
  }

  /**
   * Execute function with exponential backoff
   */
  async execute<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3,
    shouldRetry?: (error: any) => boolean
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          break; // Don't delay on last attempt
        }

        if (shouldRetry && !shouldRetry(error)) {
          throw error; // Don't retry if predicate says no
        }

        const delayMs = this.calculateDelay(attempt);
        
        this.logger?.warn(
          {
            attempt,
            maxAttempts,
            delayMs,
            error: error instanceof Error ? error.message : String(error),
          },
          'Operation failed, retrying with exponential backoff'
        );

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }
}

/**
 * Rate limit metrics collector
 */
export class RateLimitMetrics {
  private readonly requests: Array<{
    timestamp: Date;
    resource: string;
    remaining: number;
    limit: number;
  }> = [];

  private readonly throttleEvents: Array<{
    timestamp: Date;
    resource: string;
    delayMs: number;
    remaining: number;
  }> = [];

  constructor(private readonly logger: Logger) {}

  /**
   * Record rate limit usage
   */
  recordRequest(resource: string, remaining: number, limit: number): void {
    this.requests.push({
      timestamp: new Date(),
      resource,
      remaining,
      limit,
    });

    // Keep only last 1000 requests
    if (this.requests.length > 1000) {
      this.requests.shift();
    }
  }

  /**
   * Record throttle event
   */
  recordThrottle(resource: string, delayMs: number, remaining: number): void {
    this.throttleEvents.push({
      timestamp: new Date(),
      resource,
      delayMs,
      remaining,
    });

    // Keep only last 100 throttle events
    if (this.throttleEvents.length > 100) {
      this.throttleEvents.shift();
    }
  }

  /**
   * Get rate limit consumption stats
   */
  getConsumptionStats(windowMs: number, resource: string = 'core'): {
    requestCount: number;
    avgRemaining: number;
    minRemaining: number;
    throttleCount: number;
    totalThrottleTime: number;
  } {
    const windowStart = new Date(Date.now() - windowMs);
    
    const windowRequests = this.requests.filter(
      r => r.timestamp > windowStart && r.resource === resource
    );
    
    const windowThrottles = this.throttleEvents.filter(
      t => t.timestamp > windowStart && t.resource === resource
    );

    const remainingValues = windowRequests.map(r => r.remaining);
    
    return {
      requestCount: windowRequests.length,
      avgRemaining: remainingValues.length > 0 ? remainingValues.reduce((a, b) => a + b, 0) / remainingValues.length : 0,
      minRemaining: remainingValues.length > 0 ? Math.min(...remainingValues) : 0,
      throttleCount: windowThrottles.length,
      totalThrottleTime: windowThrottles.reduce((sum, t) => sum + t.delayMs, 0),
    };
  }

  /**
   * Export metrics for monitoring
   */
  exportMetrics(): Record<string, any> {
    const hour = 60 * 60 * 1000;
    const coreStats = this.getConsumptionStats(hour, 'core');
    const searchStats = this.getConsumptionStats(hour, 'search');
    const graphqlStats = this.getConsumptionStats(hour, 'graphql');

    return {
      rateLimitConsumption: {
        core: coreStats,
        search: searchStats,
        graphql: graphqlStats,
      },
      lastHourSummary: {
        totalRequests: coreStats.requestCount + searchStats.requestCount + graphqlStats.requestCount,
        totalThrottleTime: coreStats.totalThrottleTime + searchStats.totalThrottleTime + graphqlStats.totalThrottleTime,
        totalThrottleEvents: coreStats.throttleCount + searchStats.throttleCount + graphqlStats.throttleCount,
      },
    };
  }
}