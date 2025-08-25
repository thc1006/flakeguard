/**
 * Enhanced GitHub API Wrapper with Rate Limiting and Resilience
 * Implements P18 requirements with comprehensive error handling and monitoring
 */

import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import type { Logger } from 'pino';

import { CircuitBreaker } from './circuit-breaker.js';
import { PrimaryRateLimiter, SecondaryRateLimiter } from './rate-limiter.js';
import { RequestQueue, RequestPrioritizer } from './request-queue.js';
import { ArtifactHandler } from './artifact-handler.js';
import { SecurityManager, TokenManager } from './security.js';

import {
  GitHubApiError,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_SECONDARY_RATE_LIMIT_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_TIMEOUT_CONFIG,
  DEFAULT_REQUEST_QUEUE_CONFIG,
  DEFAULT_SECURITY_CONFIG,
  DEFAULT_ARTIFACT_DOWNLOAD_CONFIG,
} from './types.js';

import type {
  GitHubApiConfig,
  GitHubApiWrapper,
  ApiMetrics,
  RequestOptions,
  ArtifactDownloadOptions,
  ArtifactStreamOptions,
  RequestMetrics,
  RateLimitInfo,
  CircuitBreakerStatus,
} from './types.js';

/**
 * Enhanced GitHub API wrapper with comprehensive resilience patterns
 */
export class EnhancedGitHubApiWrapper implements GitHubApiWrapper {
  public readonly octokit: Octokit;
  
  private readonly app: App;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly primaryRateLimiter: PrimaryRateLimiter;
  private readonly secondaryRateLimiter: SecondaryRateLimiter;
  private readonly requestQueue: RequestQueue;
  private readonly artifactHandler: ArtifactHandler;
  private readonly securityManager: SecurityManager;
  private readonly tokenManager: TokenManager;
  
  private readonly requestMetrics: RequestMetrics[] = [];
  private readonly metricsRetentionMs = 24 * 60 * 60 * 1000; // 24 hours
  private metricsCleanupInterval?: NodeJS.Timeout;
  
  private isShuttingDown = false;

  constructor(private readonly config: GitHubApiConfig) {
    this.config.logger.info(
      { 
        appId: this.config.app.appId,
        features: this.getEnabledFeatures(),
      },
      'Initializing Enhanced GitHub API Wrapper'
    );

    // Initialize GitHub App
    this.app = new App({
      appId: this.config.app.appId,
      privateKey: this.config.app.privateKey,
      log: this.config.logger,
    });

    // Initialize Octokit with installation token if provided
    this.octokit = this.config.app.installationId
      ? new Octokit({
          auth: async () => {
            const installationOctokit = await this.app.getInstallationOctokit(
              this.config.app.installationId!
            );
            return installationOctokit.auth();
          },
          log: this.config.logger,
          request: {
            timeout: this.config.timeout.requestTimeoutMs,
            retries: 0, // We handle retries ourselves
            hook: this.createRequestHook(),
          },
        })
      : new Octokit({
          log: this.config.logger,
          request: {
            timeout: this.config.timeout.requestTimeoutMs,
            retries: 0,
            hook: this.createRequestHook(),
          },
        });

    // Initialize components
    this.circuitBreaker = new CircuitBreaker(this.config.circuitBreaker, this.config.logger);
    this.primaryRateLimiter = new PrimaryRateLimiter(this.config.rateLimit, this.config.logger);
    this.secondaryRateLimiter = new SecondaryRateLimiter(this.config.secondaryRateLimit, this.config.logger);
    this.requestQueue = new RequestQueue(this.config.requestQueue, this.config.logger);
    this.securityManager = new SecurityManager(this.config.security, this.config.logger);
    this.tokenManager = new TokenManager(this.config.logger);
    
    this.artifactHandler = new ArtifactHandler(
      this.config.artifactDownload,
      this.config.logger,
      this.octokit.request
    );

    // Start metrics cleanup interval
    this.startMetricsCleanup();

    this.config.logger.info('Enhanced GitHub API Wrapper initialized successfully');
  }

  /**
   * Get current API metrics
   */
  get metrics(): ApiMetrics {
    const now = Date.now();
    const last24h = now - this.metricsRetentionMs;
    const recentMetrics = this.requestMetrics.filter(m => m.startTime.getTime() > last24h);
    
    const totalRequests = recentMetrics.length;
    const successfulRequests = recentMetrics.filter(m => m.success).length;
    const failedRequests = totalRequests - successfulRequests;
    
    const responseTimes = recentMetrics
      .filter(m => m.duration !== undefined)
      .map(m => m.duration!)
      .sort((a, b) => a - b);
    
    const avgResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length 
      : 0;
    
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);
    
    return {
      totalRequests,
      totalFailures: failedRequests,
      successRate: totalRequests > 0 ? successfulRequests / totalRequests : 1,
      avgResponseTimeMs: avgResponseTime,
      p95ResponseTimeMs: responseTimes[p95Index] || 0,
      p99ResponseTimeMs: responseTimes[p99Index] || 0,
      rateLimitStatus: this.primaryRateLimiter.getRateLimitInfo() || {
        remaining: 5000,
        limit: 5000,
        resetAt: new Date(Date.now() + 3600000),
        resetInSeconds: 3600,
        resource: 'core',
        isLimited: false,
      },
      circuitBreakerStatus: this.circuitBreaker.getStatus(),
      requestsLast24h: totalRequests,
      failuresLast24h: failedRequests,
    };
  }

  /**
   * Get current rate limit status
   */
  get rateLimitStatus(): RateLimitInfo {
    return this.primaryRateLimiter.getRateLimitInfo() || {
      remaining: 5000,
      limit: 5000,
      resetAt: new Date(Date.now() + 3600000),
      resetInSeconds: 3600,
      resource: 'core',
      isLimited: false,
    };
  }

  /**
   * Get circuit breaker status
   */
  get circuitBreakerStatus(): CircuitBreakerStatus {
    return this.circuitBreaker.getStatus();
  }

  /**
   * Make authenticated API request with resilience
   */
  async request<T = any>(options: RequestOptions): Promise<T> {
    if (this.isShuttingDown) {
      throw new GitHubApiError(
        'SERVICE_UNAVAILABLE',
        'API wrapper is shutting down',
        { retryable: false }
      );
    }

    // Validate request
    this.securityManager.validateRequest(options);

    // Determine priority
    const priority = RequestPrioritizer.determinePriority(options);
    const enhancedOptions = { ...options, priority };

    // Queue request with resilience patterns
    return this.requestQueue.enqueue(
      () => this.executeRequestWithResilience(enhancedOptions),
      enhancedOptions
    );
  }

  /**
   * Download artifact with retry and validation
   */
  async downloadArtifact(options: ArtifactDownloadOptions): Promise<Buffer> {
    if (this.isShuttingDown) {
      throw new GitHubApiError(
        'SERVICE_UNAVAILABLE',
        'API wrapper is shutting down',
        { retryable: false }
      );
    }

    return this.artifactHandler.downloadArtifact(options);
  }

  /**
   * Stream artifact download with resilience
   */
  streamArtifact(options: ArtifactStreamOptions): AsyncIterable<Buffer> {
    if (this.isShuttingDown) {
      throw new GitHubApiError(
        'SERVICE_UNAVAILABLE',
        'API wrapper is shutting down',
        { retryable: false }
      );
    }

    return this.artifactHandler.streamArtifact(options);
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    return this.securityManager.verifyWebhookSignature(payload, signature, secret);
  }

  /**
   * Gracefully close wrapper and clean up resources
   */
  async close(): Promise<void> {
    this.isShuttingDown = true;
    this.config.logger.info('Starting GitHub API wrapper shutdown');

    // Clear metrics cleanup interval
    if (this.metricsCleanupInterval) {
      clearInterval(this.metricsCleanupInterval);
    }

    try {
      // Wait for request queue to finish
      await this.requestQueue.shutdown(30000);
      
      // Clear caches
      this.artifactHandler.clearCache();
      this.tokenManager.clearExpiredTokens();
      
      this.config.logger.info('GitHub API wrapper shutdown completed');
    } catch (error) {
      this.config.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error during GitHub API wrapper shutdown'
      );
      throw error;
    }
  }

  /**
   * Execute request with full resilience pattern
   */
  private async executeRequestWithResilience<T>(options: RequestOptions): Promise<T> {
    const requestId = this.generateRequestId();
    const startTime = new Date();
    
    let requestMetric: RequestMetrics = {
      method: options.method,
      endpoint: options.endpoint,
      startTime,
      success: false,
      retryAttempts: [],
    };

    try {
      // Circuit breaker check
      return await this.circuitBreaker.execute(async () => {
        // Rate limit check
        await this.primaryRateLimiter.checkRateLimit();
        
        // Execute with retry logic
        return await this.executeWithRetry(options, requestId);
      }, `${options.method} ${options.endpoint}`);
      
    } catch (error) {
      requestMetric.success = false;
      requestMetric.error = error instanceof Error ? error : new Error(String(error));
      
      if (error instanceof RequestError) {
        requestMetric.statusCode = error.status;
      }

      throw error;
    } finally {
      requestMetric.endTime = new Date();
      requestMetric.duration = requestMetric.endTime.getTime() - startTime.getTime();
      requestMetric.rateLimitInfo = this.primaryRateLimiter.getRateLimitInfo() || undefined;
      requestMetric.circuitBreakerState = this.circuitBreaker.getStatus().state;
      
      this.requestMetrics.push(requestMetric);
      
      // Record audit log
      this.securityManager.recordAuditLog({
        requestId,
        method: options.method,
        endpoint: options.endpoint,
        installationId: this.config.app.installationId,
        success: requestMetric.success,
        duration: requestMetric.duration,
        error: requestMetric.error ? {
          code: requestMetric.error instanceof GitHubApiError ? requestMetric.error.code : 'UNKNOWN',
          message: requestMetric.error.message,
        } : undefined,
      });
    }
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry<T>(options: RequestOptions, requestId: string): Promise<T> {
    const maxAttempts = this.config.retry.maxAttempts;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.config.logger.debug(
          {
            requestId,
            attempt,
            method: options.method,
            endpoint: options.endpoint,
          },
          'Executing API request'
        );

        const response = await this.octokit.request({
          method: options.method as any,
          url: options.endpoint,
          data: options.data,
          headers: {
            ...options.headers,
            'X-Request-ID': requestId,
          },
        });

        // Update rate limits from response headers
        this.updateRateLimits(response.headers, 'core');

        this.config.logger.debug(
          {
            requestId,
            attempt,
            statusCode: response.status,
            rateLimitRemaining: response.headers['x-ratelimit-remaining'],
          },
          'API request completed successfully'
        );

        return response.data;
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          break; // Don't retry on last attempt
        }

        // Handle secondary rate limits
        if (error instanceof RequestError && this.secondaryRateLimiter.isSecondaryRateLimit(error)) {
          const retryAttempt = await this.secondaryRateLimiter.handleSecondaryRateLimit(
            error,
            attempt,
            options.endpoint
          );
          
          // Update metrics
          const currentMetric = this.requestMetrics[this.requestMetrics.length - 1];
          if (currentMetric) {
            currentMetric.retryAttempts = [...currentMetric.retryAttempts, retryAttempt];
          }
          
          continue; // Secondary rate limiter handled the delay
        }

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }

        const delayMs = this.calculateRetryDelay(attempt);
        
        this.config.logger.warn(
          {
            requestId,
            attempt,
            maxAttempts,
            delayMs,
            error: error instanceof Error ? error.message : String(error),
          },
          'Request failed, retrying'
        );

        await this.delay(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Create request hook for Octokit
   */
  private createRequestHook() {
    return (request: any, options: any) => {
      const sanitizedOptions = this.securityManager.sanitizeRequest(options);
      
      this.config.logger.debug(
        {
          method: sanitizedOptions.method,
          url: sanitizedOptions.url,
          headers: this.securityManager.sanitizeRequest(options.headers || {}),
        },
        'Making GitHub API request'
      );

      return request(options).then(
        (response: any) => {
          // Update rate limits
          this.updateRateLimits(response.headers, 'core');
          
          const sanitizedResponse = this.config.debug 
            ? this.securityManager.sanitizeResponse(response.data)
            : '[RESPONSE_DATA_HIDDEN]';
            
          this.config.logger.debug(
            {
              status: response.status,
              rateLimitRemaining: response.headers['x-ratelimit-remaining'],
              rateLimitReset: response.headers['x-ratelimit-reset'],
              response: sanitizedResponse,
            },
            'GitHub API request completed'
          );

          return response;
        },
        (error: any) => {
          if (error instanceof RequestError) {
            // Update rate limits even on error
            if (error.response?.headers) {
              this.updateRateLimits(error.response.headers, 'core');
            }
            
            this.config.logger.error(
              {
                status: error.status,
                message: error.message,
                rateLimitRemaining: error.response?.headers?.['x-ratelimit-remaining'],
              },
              'GitHub API request failed'
            );
          }
          
          throw error;
        }
      );
    };
  }

  /**
   * Update rate limits from response headers
   */
  private updateRateLimits(headers: Record<string, any>, resource: string): void {
    this.primaryRateLimiter.updateRateLimit(headers, resource);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof RequestError) {
      return this.config.retry.retryableStatusCodes.includes(error.status);
    }

    if (error.code && this.config.retry.retryableErrors.includes(error.code)) {
      return true;
    }

    return false;
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.config.retry.baseDelayMs;
    const maxDelay = this.config.retry.maxDelayMs;
    const multiplier = this.config.retry.multiplier;
    const jitterFactor = this.config.retry.jitterFactor;

    const exponentialDelay = baseDelay * Math.pow(multiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * jitterFactor * (Math.random() - 0.5);
    const finalDelay = Math.max(0, cappedDelay + jitter);

    return Math.floor(finalDelay);
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get enabled features
   */
  private getEnabledFeatures(): string[] {
    const features: string[] = [];
    
    if (this.config.rateLimit.enabled) features.push('rate-limiting');
    if (this.config.circuitBreaker.enabled) features.push('circuit-breaker');
    if (this.config.retry.enabled) features.push('retry-logic');
    if (this.config.requestQueue.enabled) features.push('request-queue');
    if (this.config.security.auditLogging) features.push('audit-logging');
    if (this.config.artifactDownload.enabled) features.push('artifact-download');
    
    return features;
  }

  /**
   * Start metrics cleanup interval
   */
  private startMetricsCleanup(): void {
    this.metricsCleanupInterval = setInterval(() => {
      const cutoff = Date.now() - this.metricsRetentionMs;
      const initialLength = this.requestMetrics.length;
      
      // Remove old metrics
      while (this.requestMetrics.length > 0 && 
             this.requestMetrics[0].startTime.getTime() < cutoff) {
        this.requestMetrics.shift();
      }
      
      const removed = initialLength - this.requestMetrics.length;
      if (removed > 0) {
        this.config.logger.debug(
          { removedMetrics: removed, remainingMetrics: this.requestMetrics.length },
          'Cleaned up old request metrics'
        );
      }
      
      // Also cleanup other components
      this.tokenManager.clearExpiredTokens();
      this.artifactHandler.cleanupExpiredUrls();
      
    }, 60000); // Run every minute
  }
}

/**
 * Factory function to create GitHub API wrapper with default configuration
 */
export function createGitHubApiWrapper(
  appConfig: {
    appId: number;
    privateKey: string;
    installationId?: number;
  },
  logger: Logger,
  overrides: Partial<GitHubApiConfig> = {}
): EnhancedGitHubApiWrapper {
  const config: GitHubApiConfig = {
    app: appConfig,
    rateLimit: { ...DEFAULT_RATE_LIMIT_CONFIG, ...overrides.rateLimit },
    secondaryRateLimit: { ...DEFAULT_SECONDARY_RATE_LIMIT_CONFIG, ...overrides.secondaryRateLimit },
    circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...overrides.circuitBreaker },
    retry: { ...DEFAULT_RETRY_CONFIG, ...overrides.retry },
    timeout: { ...DEFAULT_TIMEOUT_CONFIG, ...overrides.timeout },
    requestQueue: { ...DEFAULT_REQUEST_QUEUE_CONFIG, ...overrides.requestQueue },
    security: { ...DEFAULT_SECURITY_CONFIG, ...overrides.security },
    artifactDownload: { ...DEFAULT_ARTIFACT_DOWNLOAD_CONFIG, ...overrides.artifactDownload },
    logger,
    debug: overrides.debug || false,
  };

  return new EnhancedGitHubApiWrapper(config);
}

/**
 * Utility to create wrapper from environment variables
 */
export function createGitHubApiWrapperFromEnv(logger: Logger): EnhancedGitHubApiWrapper {
  const appId = parseInt(process.env.GITHUB_APP_ID || '0', 10);
  const privateKey = process.env.GITHUB_PRIVATE_KEY || '';
  const installationId = process.env.GITHUB_INSTALLATION_ID 
    ? parseInt(process.env.GITHUB_INSTALLATION_ID, 10)
    : undefined;

  if (!appId || !privateKey) {
    throw new GitHubApiError(
      'CONFIGURATION_INVALID',
      'Missing required GitHub App configuration (GITHUB_APP_ID, GITHUB_PRIVATE_KEY)',
      { retryable: false }
    );
  }

  return createGitHubApiWrapper(
    { appId, privateKey, installationId },
    logger,
    {
      debug: process.env.NODE_ENV === 'development',
    }
  );
}