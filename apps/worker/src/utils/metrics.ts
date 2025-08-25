/**
 * Prometheus Metrics for FlakeGuard Worker
 * 
 * Comprehensive metrics collection for monitoring worker performance,
 * queue health, job processing rates, and system reliability.
 */

import { register, collectDefaultMetrics, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { config } from '../config/index.js';
import { logger } from './logger.js';
import { METRICS_CONFIG } from '@flakeguard/shared';

// Initialize default metrics collection
collectDefaultMetrics({
  register,
  prefix: 'flakeguard_worker_',
  labels: METRICS_CONFIG.DEFAULT_LABELS,
});

// ============================================================================
// Job Processing Metrics
// ============================================================================

export const jobsProcessedTotal = new Counter({
  name: 'flakeguard_worker_jobs_processed_total',
  help: 'Total number of jobs processed',
  labelNames: ['queue', 'status', 'priority'],
});

export const jobProcessingDuration = new Histogram({
  name: 'flakeguard_worker_job_processing_duration_seconds',
  help: 'Time spent processing jobs',
  labelNames: ['queue', 'status'],
  buckets: METRICS_CONFIG.HISTOGRAM_BUCKETS,
});

export const jobsInProgress = new Gauge({
  name: 'flakeguard_worker_jobs_in_progress',
  help: 'Number of jobs currently being processed',
  labelNames: ['queue'],
});

export const jobRetries = new Counter({
  name: 'flakeguard_worker_job_retries_total',
  help: 'Total number of job retries',
  labelNames: ['queue', 'error_type'],
});

// ============================================================================
// Queue Health Metrics
// ============================================================================

export const queueSize = new Gauge({
  name: 'flakeguard_worker_queue_size',
  help: 'Number of jobs in queue by status',
  labelNames: ['queue', 'status'],
});

export const queueThroughput = new Summary({
  name: 'flakeguard_worker_queue_throughput',
  help: 'Jobs processed per second over time window',
  labelNames: ['queue'],
  percentiles: [0.5, 0.95, 0.99],
  maxAgeSeconds: 600,
  ageBuckets: 10,
});

export const deadLetterQueueSize = new Gauge({
  name: 'flakeguard_worker_dlq_size',
  help: 'Number of jobs in dead letter queue',
  labelNames: ['queue'],
});

// ============================================================================
// Worker Health Metrics
// ============================================================================

export const workerHealth = new Gauge({
  name: 'flakeguard_worker_health',
  help: 'Worker health status (1 = healthy, 0 = unhealthy)',
  labelNames: ['worker_name'],
});

export const workerConcurrency = new Gauge({
  name: 'flakeguard_worker_concurrency',
  help: 'Current worker concurrency level',
  labelNames: ['queue'],
});

export const workerMemoryUsage = new Gauge({
  name: 'flakeguard_worker_memory_usage_bytes',
  help: 'Worker memory usage in bytes',
  labelNames: ['type'], // heap_used, heap_total, rss, external
});

export const workerCpuUsage = new Gauge({
  name: 'flakeguard_worker_cpu_usage_percent',
  help: 'Worker CPU usage percentage',
});

// ============================================================================
// GitHub API Metrics
// ============================================================================

export const githubApiCalls = new Counter({
  name: 'flakeguard_worker_github_api_calls_total',
  help: 'Total GitHub API calls made',
  labelNames: ['endpoint', 'method', 'status_code'],
});

export const githubApiDuration = new Histogram({
  name: 'flakeguard_worker_github_api_duration_seconds',
  help: 'GitHub API call duration',
  labelNames: ['endpoint', 'method'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export const githubRateLimitRemaining = new Gauge({
  name: 'flakeguard_worker_github_rate_limit_remaining',
  help: 'Remaining GitHub API rate limit',
  labelNames: ['rate_limit_type'], // primary, secondary, search
});

export const githubRateLimitReset = new Gauge({
  name: 'flakeguard_worker_github_rate_limit_reset_timestamp',
  help: 'GitHub API rate limit reset timestamp',
  labelNames: ['rate_limit_type'],
});

// ============================================================================
// Flakiness Analysis Metrics
// ============================================================================

export const testsAnalyzed = new Counter({
  name: 'flakeguard_worker_tests_analyzed_total',
  help: 'Total number of tests analyzed for flakiness',
  labelNames: ['repository'],
});

export const flakyTestsDetected = new Counter({
  name: 'flakeguard_worker_flaky_tests_detected_total',
  help: 'Total number of flaky tests detected',
  labelNames: ['repository', 'severity'], // low, medium, high
});

export const flakinessScore = new Histogram({
  name: 'flakeguard_worker_flakiness_score',
  help: 'Distribution of flakiness scores',
  labelNames: ['repository'],
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
});

export const analysisProcessingTime = new Histogram({
  name: 'flakeguard_worker_analysis_processing_time_seconds',
  help: 'Time spent processing flakiness analysis',
  labelNames: ['repository'],
  buckets: METRICS_CONFIG.HISTOGRAM_BUCKETS,
});

// ============================================================================
// Database Metrics
// ============================================================================

export const databaseQueries = new Counter({
  name: 'flakeguard_worker_database_queries_total',
  help: 'Total database queries executed',
  labelNames: ['operation', 'table', 'status'],
});

export const databaseQueryDuration = new Histogram({
  name: 'flakeguard_worker_database_query_duration_seconds',
  help: 'Database query execution time',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

export const databaseConnections = new Gauge({
  name: 'flakeguard_worker_database_connections',
  help: 'Current database connections',
  labelNames: ['pool_status'], // active, idle, pending
});

// ============================================================================
// Artifact Processing Metrics
// ============================================================================

export const artifactsProcessed = new Counter({
  name: 'flakeguard_worker_artifacts_processed_total',
  help: 'Total artifacts processed',
  labelNames: ['repository', 'artifact_type', 'status'],
});

export const artifactSize = new Histogram({
  name: 'flakeguard_worker_artifact_size_bytes',
  help: 'Size of processed artifacts in bytes',
  labelNames: ['artifact_type'],
  buckets: [1024, 10240, 102400, 1048576, 10485760, 104857600], // 1KB to 100MB
});

export const artifactProcessingTime = new Histogram({
  name: 'flakeguard_worker_artifact_processing_time_seconds',
  help: 'Time spent processing artifacts',
  labelNames: ['artifact_type'],
  buckets: METRICS_CONFIG.HISTOGRAM_BUCKETS,
});

export const testResultsParsed = new Counter({
  name: 'flakeguard_worker_test_results_parsed_total',
  help: 'Total test results parsed from artifacts',
  labelNames: ['repository', 'test_framework'],
});

// ============================================================================
// System Resource Metrics
// ============================================================================

export const systemLoad = new Gauge({
  name: 'flakeguard_worker_system_load_average',
  help: 'System load average',
  labelNames: ['period'], // 1m, 5m, 15m
});

export const fileDescriptors = new Gauge({
  name: 'flakeguard_worker_file_descriptors_open',
  help: 'Number of open file descriptors',
});

export const eventLoopLag = new Histogram({
  name: 'flakeguard_worker_event_loop_lag_seconds',
  help: 'Event loop lag measurement',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

// ============================================================================
// Metrics Collection Functions
// ============================================================================

/**
 * Record job completion metrics
 */
export function recordJobCompletion(
  queue: string,
  status: 'completed' | 'failed',
  priority: string,
  durationMs: number,
  errorType?: string
): void {
  jobsProcessedTotal.inc({ queue, status, priority });
  jobProcessingDuration.observe({ queue, status }, durationMs / 1000);
  
  if (status === 'failed' && errorType) {
    jobRetries.inc({ queue, error_type: errorType });
  }
  
  jobsInProgress.dec({ queue });
}

/**
 * Update queue size metrics
 */
export function updateQueueMetrics(
  queue: string,
  waiting: number,
  active: number,
  completed: number,
  failed: number,
  delayed: number
): void {
  queueSize.set({ queue, status: 'waiting' }, waiting);
  queueSize.set({ queue, status: 'active' }, active);
  queueSize.set({ queue, status: 'completed' }, completed);
  queueSize.set({ queue, status: 'failed' }, failed);
  queueSize.set({ queue, status: 'delayed' }, delayed);
}

/**
 * Record GitHub API call metrics
 */
export function recordGitHubApiCall(
  endpoint: string,
  method: string,
  statusCode: number,
  durationMs: number,
  rateLimitRemaining?: number,
  rateLimitReset?: number
): void {
  githubApiCalls.inc({ endpoint, method, status_code: statusCode.toString() });
  githubApiDuration.observe({ endpoint, method }, durationMs / 1000);
  
  if (rateLimitRemaining !== undefined) {
    githubRateLimitRemaining.set({ rate_limit_type: 'primary' }, rateLimitRemaining);
  }
  
  if (rateLimitReset !== undefined) {
    githubRateLimitReset.set({ rate_limit_type: 'primary' }, rateLimitReset);
  }
}

/**
 * Record flakiness analysis metrics
 */
export function recordFlakinessAnalysis(
  repository: string,
  testsAnalyzedCount: number,
  flakyTestsCount: number,
  averageScore: number,
  processingTimeMs: number
): void {
  testsAnalyzed.inc({ repository }, testsAnalyzedCount);
  flakyTestsDetected.inc({ repository, severity: 'medium' }, flakyTestsCount);
  flakinessScore.observe({ repository }, averageScore);
  analysisProcessingTime.observe({ repository }, processingTimeMs / 1000);
}

/**
 * Update system resource metrics
 */
export function updateSystemMetrics(): void {
  const memUsage = process.memoryUsage();
  workerMemoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
  workerMemoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
  workerMemoryUsage.set({ type: 'rss' }, memUsage.rss);
  workerMemoryUsage.set({ type: 'external' }, memUsage.external);
  
  const cpuUsage = process.cpuUsage();
  const totalCpuTime = cpuUsage.user + cpuUsage.system;
  workerCpuUsage.set(totalCpuTime / 1000000); // Convert to seconds
}

/**
 * Initialize metrics collection with periodic updates
 */
export function initializeMetricsCollection(): void {
  if (!config.metrics.enabled) {
    logger.info('Metrics collection disabled');
    return;
  }
  
  logger.info({ port: config.metrics.port }, 'Initializing metrics collection');
  
  // Update system metrics periodically
  setInterval(() => {
    try {
      updateSystemMetrics();
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error updating system metrics');
    }
  }, METRICS_CONFIG.COLLECTION_INTERVAL_MS);
  
  // Set initial health status
  workerHealth.set({ worker_name: config.workerName }, 1);
  
  logger.info('Metrics collection initialized');
}

/**
 * Get metrics registry for HTTP endpoint
 */
export function getMetricsRegistry() {
  return register;
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  register.resetMetrics();
}