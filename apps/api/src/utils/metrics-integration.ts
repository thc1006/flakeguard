/**
 * Metrics Integration Helpers
 * 
 * Helper functions to integrate metrics collection into existing
 * FlakeGuard handlers and services following consistent patterns.
 */

import {
  recordHttpRequest,
  recordIngestionRequest,
  recordParseResult,
  recordGitHubWebhook,
  recordGitHubApiCall,
  recordTestsProcessed,
  recordFlakeDetection,
  recordQuarantineAction,
  recordDatabaseQuery,
  httpRequestsInProgress,
} from './metrics.js';

import { logger } from './logger.js';

// ============================================================================
// HTTP Request Tracking
// ============================================================================

/**
 * Middleware wrapper for automatic HTTP request metrics
 * Use this to wrap route handlers for automatic metrics collection
 */
export function withRequestMetrics<T extends any[], R>(
  handler: (...args: T) => Promise<R>,
  routeName: string
) {
  return async (...args: T): Promise<R> => {
    const request = args[0] as any; // FastifyRequest
    const reply = args[1] as any;   // FastifyReply
    const method = request.method;
    
    // Track request start
    httpRequestsInProgress.inc({ method, route: routeName });
    const startTime = Date.now();
    
    try {
      const result = await handler(...args);
      
      // Record successful request
      const duration = Date.now() - startTime;
      recordHttpRequest(method, routeName, reply.statusCode || 200, duration);
      
      return result;
    } catch (error) {
      // Record failed request
      const duration = Date.now() - startTime;
      const statusCode = reply.statusCode || 500;
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
      
      recordHttpRequest(method, routeName, statusCode, duration, errorType);
      throw error;
    }
  };
}

// ============================================================================
// Ingestion Pipeline Metrics
// ============================================================================

/**
 * Track ingestion request with timing
 */
export function trackIngestionRequest(
  repository: string,
  contentType: string,
  startTime: number,
  success: boolean
): void {
  const duration = Date.now() - startTime;
  const status = success ? 'success' : 'failure';
  
  recordIngestionRequest(repository, contentType, status, duration);
  
  logger.debug({
    repository,
    contentType,
    status,
    duration,
  }, 'Ingestion request completed');
}

/**
 * Track JUnit parsing with detailed metrics
 */
export function trackParseResult(
  repository: string,
  framework: string,
  success: boolean,
  startTime: number,
  testCounts?: { passed: number; failed: number; skipped: number }
): void {
  const duration = Date.now() - startTime;
  const result = success ? 'success' : 'failure';
  
  recordParseResult(repository, framework, result, duration);
  
  if (success && testCounts) {
    recordTestsProcessed(repository, testCounts);
  }
  
  logger.debug({
    repository,
    framework,
    result,
    duration,
    testCounts,
  }, 'Parse result recorded');
}

// ============================================================================
// GitHub Integration Metrics
// ============================================================================

/**
 * Track GitHub webhook processing
 */
export function trackGitHubWebhook(
  eventType: string,
  repository: string,
  action: string,
  startTime: number,
  success: boolean
): void {
  const duration = Date.now() - startTime;
  const status = success ? 'success' : 'failure';
  
  recordGitHubWebhook(eventType, repository, action, status, duration);
  
  logger.debug({
    eventType,
    repository,
    action,
    status,
    duration,
  }, 'GitHub webhook processed');
}

/**
 * Track GitHub API calls with rate limit info
 */
export function trackGitHubApiCall(
  endpoint: string,
  method: string,
  statusCode: number,
  repository: string,
  startTime: number,
  rateLimitRemaining?: number,
  rateLimitReset?: number
): void {
  const duration = Date.now() - startTime;
  
  recordGitHubApiCall(
    endpoint,
    method,
    statusCode,
    repository,
    duration,
    rateLimitRemaining,
    rateLimitReset
  );
  
  if (rateLimitRemaining !== undefined && rateLimitRemaining < 100) {
    logger.warn({
      endpoint,
      repository,
      rateLimitRemaining,
      rateLimitReset,
    }, 'GitHub API rate limit running low');
  }
}

// ============================================================================
// Business Logic Metrics
// ============================================================================

/**
 * Track flake detection with severity analysis
 */
export function trackFlakeDetection(
  repository: string,
  flakinessScore: number,
  testName?: string
): void {
  // Determine severity based on flakiness score
  let severity: 'low' | 'medium' | 'high';
  if (flakinessScore < 0.3) {
    severity = 'low';
  } else if (flakinessScore < 0.7) {
    severity = 'medium';
  } else {
    severity = 'high';
  }
  
  recordFlakeDetection(repository, severity, flakinessScore);
  
  logger.info({
    repository,
    testName,
    flakinessScore,
    severity,
  }, 'Flake detection recorded');
}

/**
 * Track quarantine actions
 */
export function trackQuarantineAction(
  repository: string,
  action: 'suggest' | 'apply' | 'remove',
  reason: string,
  testName?: string
): void {
  recordQuarantineAction(repository, action, reason);
  
  logger.info({
    repository,
    testName,
    action,
    reason,
  }, 'Quarantine action recorded');
}

// ============================================================================
// Database Query Metrics
// ============================================================================

/**
 * Wrapper for database operations with automatic metrics
 */
export async function withDatabaseMetrics<T>(
  operation: () => Promise<T>,
  operationType: string,
  tableName: string
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await operation();
    const duration = Date.now() - startTime;
    
    recordDatabaseQuery(operationType, tableName, 'success', duration);
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    recordDatabaseQuery(operationType, tableName, 'failure', duration);
    
    logger.error({
      operation: operationType,
      table: tableName,
      duration,
      error: error instanceof Error ? error.message : String(error),
    }, 'Database operation failed');
    
    throw error;
  }
}

// ============================================================================
// Metrics Context Helper
// ============================================================================

/**
 * Extract repository info from various sources
 */
export function extractRepositoryInfo(context: any): string {
  // Try different possible locations for repository information
  if (typeof context === 'string') {
    return context;
  }
  
  if (context?.repository) {
    if (typeof context.repository === 'string') {
      return context.repository;
    }
    if (context.repository.full_name) {
      return context.repository.full_name;
    }
    if (context.repository.owner && context.repository.name) {
      return `${context.repository.owner}/${context.repository.name}`;
    }
  }
  
  if (context?.params?.owner && context?.params?.repo) {
    return `${context.params.owner}/${context.params.repo}`;
  }
  
  return 'unknown';
}

/**
 * Create metrics context from request
 */
export function createMetricsContext(request: any) {
  return {
    repository: extractRepositoryInfo(request),
    method: request.method,
    route: request.routerPath || request.url,
    correlationId: request.headers['x-correlation-id'] || 'unknown',
    userAgent: request.headers['user-agent'] || 'unknown',
  };
}

// ============================================================================
// Error Handling with Metrics
// ============================================================================

/**
 * Enhanced error handler that includes metrics
 */
export function createMetricsErrorHandler(context: { repository: string; operation: string }) {
  return (error: unknown) => {
    const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
    
    logger.error({
      ...context,
      errorType,
      error: error instanceof Error ? error.message : String(error),
    }, 'Operation failed with metrics tracking');
    
    // Additional error-specific metrics could be added here
    throw error;
  };
}

// ============================================================================
// Integration Examples
// ============================================================================

/**
 * Example: Wrap an ingestion handler with comprehensive metrics
 */
export function wrapIngestionHandler<T extends any[], R>(
  handler: (...args: T) => Promise<R>,
  operationName: string
) {
  return withRequestMetrics(async (...args: T): Promise<R> => {
    const request = args[0] as any;
    const context = createMetricsContext(request);
    const startTime = Date.now();
    
    try {
      const result = await handler(...args);
      
      // Track successful ingestion
      trackIngestionRequest(context.repository, 'application/xml', startTime, true);
      
      return result;
    } catch (error) {
      // Track failed ingestion
      trackIngestionRequest(context.repository, 'application/xml', startTime, false);
      throw createMetricsErrorHandler({ repository: context.repository, operation: operationName })(error);
    }
  }, operationName);
}

/**
 * Example: Wrap a GitHub webhook handler
 */
export function wrapWebhookHandler<T extends any[], R>(
  handler: (...args: T) => Promise<R>,
  eventType: string
) {
  return async (...args: T): Promise<R> => {
    const payload = args[0] as any;
    const repository = extractRepositoryInfo(payload);
    const action = payload.action || 'unknown';
    const startTime = Date.now();
    
    try {
      const result = await handler(...args);
      
      trackGitHubWebhook(eventType, repository, action, startTime, true);
      
      return result;
    } catch (error) {
      trackGitHubWebhook(eventType, repository, action, startTime, false);
      throw error;
    }
  };
}