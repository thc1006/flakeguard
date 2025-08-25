/**
 * Comprehensive Prometheus Metrics for FlakeGuard API
 * 
 * Implements SRE best practices with detailed metrics for:
 * - API request/response patterns
 * - Ingestion pipeline performance
 * - Parse success/failure rates
 * - GitHub API integration metrics
 * - Database query performance
 * - Business metrics (tests processed, flake detections)
 */

import { register, collectDefaultMetrics, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { METRICS_CONFIG } from '@flakeguard/shared';
import { logger } from './logger.js';

// Initialize default metrics collection
collectDefaultMetrics({
  register,
  prefix: 'flakeguard_api_',
  labels: METRICS_CONFIG.DEFAULT_LABELS,
});

// ============================================================================
// HTTP API Metrics
// ============================================================================

export const httpRequestsTotal = new Counter({
  name: 'flakeguard_api_http_requests_total',
  help: 'Total HTTP requests received',
  labelNames: ['method', 'route', 'status_code'],
});

export const httpRequestDuration = new Histogram({
  name: 'flakeguard_api_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30],
});

export const httpRequestsInProgress = new Gauge({
  name: 'flakeguard_api_http_requests_in_progress',
  help: 'Number of HTTP requests currently being processed',
  labelNames: ['method', 'route'],
});

export const httpErrors = new Counter({
  name: 'flakeguard_api_http_errors_total',
  help: 'Total HTTP errors by type',
  labelNames: ['method', 'route', 'error_type', 'status_code'],
});

// ============================================================================
// Ingestion Pipeline Metrics (Core SLIs)
// ============================================================================

export const ingestionRequestsTotal = new Counter({
  name: 'flakeguard_api_ingestion_requests_total',
  help: 'Total ingestion requests received',
  labelNames: ['repository', 'content_type', 'status'],
});

export const ingestionLatency = new Histogram({
  name: 'flakeguard_api_ingestion_latency_seconds',
  help: 'Time from webhook received to test results parsed (P95 SLO: 30s)',
  labelNames: ['repository', 'content_type'],
  buckets: [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300], // Focus on 30s SLO
});

export const parseSuccessRate = new Counter({
  name: 'flakeguard_api_parse_results_total',
  help: 'JUnit XML parsing results (success/failure)',
  labelNames: ['repository', 'framework', 'result'], // result: success|failure
});

export const parseLatency = new Histogram({
  name: 'flakeguard_api_parse_duration_seconds',
  help: 'Time spent parsing test results',
  labelNames: ['repository', 'framework'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const checkRunDelivery = new Histogram({
  name: 'flakeguard_api_check_run_delivery_seconds',
  help: 'Time from parse completion to GitHub Check Run delivery (P95 SLO: 60s)',
  labelNames: ['repository'],
  buckets: [1, 5, 10, 15, 30, 60, 120, 300], // Focus on 60s SLO
});

// ============================================================================
// GitHub Integration Metrics
// ============================================================================

export const githubWebhooksReceived = new Counter({
  name: 'flakeguard_api_github_webhooks_total',
  help: 'GitHub webhooks received',
  labelNames: ['event_type', 'repository', 'action', 'status'],
});

export const githubWebhookLatency = new Histogram({
  name: 'flakeguard_api_github_webhook_processing_seconds',
  help: 'GitHub webhook processing time',
  labelNames: ['event_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

export const githubApiCalls = new Counter({
  name: 'flakeguard_api_github_api_calls_total',
  help: 'GitHub API calls made',
  labelNames: ['endpoint', 'method', 'status_code', 'repository'],
});

export const githubApiDuration = new Histogram({
  name: 'flakeguard_api_github_api_duration_seconds',
  help: 'GitHub API call duration',
  labelNames: ['endpoint', 'method'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export const githubRateLimit = new Gauge({
  name: 'flakeguard_api_github_rate_limit_remaining',
  help: 'GitHub API rate limit remaining',
  labelNames: ['rate_limit_type'],
});

export const githubRateLimitReset = new Gauge({
  name: 'flakeguard_api_github_rate_limit_reset_timestamp',
  help: 'GitHub API rate limit reset timestamp',
  labelNames: ['rate_limit_type'],
});

// ============================================================================
// Database Performance Metrics
// ============================================================================

export const databaseQueries = new Counter({
  name: 'flakeguard_api_database_queries_total',
  help: 'Database queries executed',
  labelNames: ['operation', 'table', 'status'],
});

export const databaseQueryDuration = new Histogram({
  name: 'flakeguard_api_database_query_duration_seconds',
  help: 'Database query execution time',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const databaseConnections = new Gauge({
  name: 'flakeguard_api_database_connections_active',
  help: 'Active database connections',
});

export const databaseConnectionPool = new Gauge({
  name: 'flakeguard_api_database_connection_pool',
  help: 'Database connection pool statistics',
  labelNames: ['pool_status'], // active, idle, pending
});

// ============================================================================
// Business Logic Metrics
// ============================================================================

export const testsProcessed = new Counter({
  name: 'flakeguard_api_tests_processed_total',
  help: 'Total tests processed from ingestion',
  labelNames: ['repository', 'test_status'], // passed, failed, skipped
});

export const flakeDetections = new Counter({
  name: 'flakeguard_api_flake_detections_total',
  help: 'Flaky tests detected',
  labelNames: ['repository', 'severity'], // low, medium, high
});

export const quarantineActions = new Counter({
  name: 'flakeguard_api_quarantine_actions_total',
  help: 'Quarantine actions taken',
  labelNames: ['repository', 'action', 'reason'], // action: suggest, apply, remove
});

export const flakinessScoreDistribution = new Histogram({
  name: 'flakeguard_api_flakiness_score_distribution',
  help: 'Distribution of calculated flakiness scores',
  labelNames: ['repository'],
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
});

export const activeRepositories = new Gauge({
  name: 'flakeguard_api_active_repositories',
  help: 'Number of repositories with recent activity',
});

export const testSuiteSize = new Histogram({
  name: 'flakeguard_api_test_suite_size',
  help: 'Number of tests in processed test suites',
  labelNames: ['repository'],
  buckets: [1, 10, 50, 100, 500, 1000, 5000, 10000],
});

// ============================================================================
// Queue Integration Metrics
// ============================================================================

export const queueJobsEnqueued = new Counter({
  name: 'flakeguard_api_queue_jobs_enqueued_total',
  help: 'Jobs enqueued to background workers',
  labelNames: ['queue_name', 'job_type', 'priority'],
});

export const queueConnectionHealth = new Gauge({
  name: 'flakeguard_api_queue_connection_health',
  help: 'Queue connection health status (1=healthy, 0=unhealthy)',
});

// ============================================================================
// System Resource Metrics
// ============================================================================

export const memoryUsage = new Gauge({
  name: 'flakeguard_api_memory_usage_bytes',
  help: 'Process memory usage',
  labelNames: ['type'], // heap_used, heap_total, rss, external
});

export const eventLoopLag = new Histogram({
  name: 'flakeguard_api_event_loop_lag_seconds',
  help: 'Event loop lag measurement',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

export const fileDescriptors = new Gauge({
  name: 'flakeguard_api_file_descriptors_open',
  help: 'Number of open file descriptors',
});

// ============================================================================
// Metrics Helper Functions
// ============================================================================

/**
 * Record HTTP request metrics
 */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationMs: number,
  errorType?: string
): void {
  const status = statusCode.toString();
  
  httpRequestsTotal.inc({ method, route, status_code: status });
  httpRequestDuration.observe(
    { method, route, status_code: status },
    durationMs / 1000
  );
  
  if (statusCode >= 400 && errorType) {
    httpErrors.inc({
      method,
      route,
      error_type: errorType,
      status_code: status,
    });
  }
  
  httpRequestsInProgress.dec({ method, route });
}

/**
 * Record ingestion pipeline metrics
 */
export function recordIngestionRequest(
  repository: string,
  contentType: string,
  status: 'success' | 'failure',
  latencyMs: number
): void {
  ingestionRequestsTotal.inc({ repository, content_type: contentType, status });
  ingestionLatency.observe(
    { repository, content_type: contentType },
    latencyMs / 1000
  );
}

/**
 * Record parse results (for SLO tracking)
 */
export function recordParseResult(
  repository: string,
  framework: string,
  result: 'success' | 'failure',
  durationMs: number
): void {
  parseSuccessRate.inc({ repository, framework, result });
  parseLatency.observe({ repository, framework }, durationMs / 1000);
}

/**
 * Record GitHub webhook metrics
 */
export function recordGitHubWebhook(
  eventType: string,
  repository: string,
  action: string,
  status: 'success' | 'failure',
  durationMs: number
): void {
  githubWebhooksReceived.inc({ event_type: eventType, repository, action, status });
  githubWebhookLatency.observe({ event_type: eventType }, durationMs / 1000);
}

/**
 * Record GitHub API call metrics
 */
export function recordGitHubApiCall(
  endpoint: string,
  method: string,
  statusCode: number,
  repository: string,
  durationMs: number,
  rateLimitRemaining?: number,
  rateLimitReset?: number
): void {
  githubApiCalls.inc({
    endpoint,
    method,
    status_code: statusCode.toString(),
    repository,
  });
  
  githubApiDuration.observe({ endpoint, method }, durationMs / 1000);
  
  if (rateLimitRemaining !== undefined) {
    githubRateLimit.set({ rate_limit_type: 'primary' }, rateLimitRemaining);
  }
  
  if (rateLimitReset !== undefined) {
    githubRateLimitReset.set({ rate_limit_type: 'primary' }, rateLimitReset);
  }
}

/**
 * Record business metrics
 */
export function recordTestsProcessed(
  repository: string,
  testCounts: { passed: number; failed: number; skipped: number }
): void {
  testsProcessed.inc({ repository, test_status: 'passed' }, testCounts.passed);
  testsProcessed.inc({ repository, test_status: 'failed' }, testCounts.failed);
  testsProcessed.inc({ repository, test_status: 'skipped' }, testCounts.skipped);
  
  testSuiteSize.observe(
    { repository },
    testCounts.passed + testCounts.failed + testCounts.skipped
  );
}

/**
 * Record flake detection
 */
export function recordFlakeDetection(
  repository: string,
  severity: 'low' | 'medium' | 'high',
  flakinessScore: number
): void {
  flakeDetections.inc({ repository, severity });
  flakinessScoreDistribution.observe({ repository }, flakinessScore);
}

/**
 * Record quarantine action
 */
export function recordQuarantineAction(
  repository: string,
  action: 'suggest' | 'apply' | 'remove',
  reason: string
): void {
  quarantineActions.inc({ repository, action, reason });
}

/**
 * Record database query
 */
export function recordDatabaseQuery(
  operation: string,
  table: string,
  status: 'success' | 'failure',
  durationMs: number
): void {
  databaseQueries.inc({ operation, table, status });
  databaseQueryDuration.observe({ operation, table }, durationMs / 1000);
}

/**
 * Update system resource metrics
 */
export function updateSystemMetrics(): void {
  const memUsage = process.memoryUsage();
  memoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
  memoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
  memoryUsage.set({ type: 'rss' }, memUsage.rss);
  memoryUsage.set({ type: 'external' }, memUsage.external);
}

/**
 * Initialize metrics collection
 */
export function initializeApiMetrics(): void {
  logger.info('Initializing API metrics collection');
  
  // Update system metrics periodically
  setInterval(() => {
    try {
      updateSystemMetrics();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error updating system metrics'
      );
    }
  }, METRICS_CONFIG.COLLECTION_INTERVAL_MS);
  
  logger.info('API metrics collection initialized');
}

/**
 * Get metrics registry
 */
export function getMetricsRegistry() {
  return register;
}

/**
 * Reset all metrics (for testing)
 */
export function resetMetrics(): void {
  register.resetMetrics();
}