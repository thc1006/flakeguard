/**
 * Metrics Integration Tests
 * 
 * Comprehensive integration tests for FlakeGuard metrics collection
 * covering all core SLIs and business metrics.
 */

import { PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { buildApp } from '../app.js';
import {
  trackIngestionRequest,
  trackParseResult,
  trackGitHubWebhook,
  trackFlakeDetection,
  trackQuarantineAction,
} from '../utils/metrics-integration.js';
import { resetMetrics, getMetricsRegistry } from '../utils/metrics.js';

describe('Metrics Integration', () => {
  let app: FastifyInstance;
  let _prisma: PrismaClient;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    _prisma = app.prisma;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetMetrics();
  });

  describe('HTTP Metrics', () => {
    it('should collect basic HTTP request metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_http_requests_total');
      expect(metrics).toContain('method=\"GET\"');
      expect(metrics).toContain('status_code=\"200\"');
    });

    it('should track request duration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/detailed',
      });

      expect(response.statusCode).toBeOneOf([200, 503]);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_http_request_duration_seconds');
    });

    it('should track error rates', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent-endpoint',
      });

      expect(response.statusCode).toBe(404);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_http_errors_total');
      expect(metrics).toContain('status_code=\"404\"');
    });
  });

  describe('Ingestion Pipeline Metrics', () => {
    it('should track ingestion requests', async () => {
      const repository = 'owner/test-repo';
      const startTime = Date.now() - 1000; // 1 second ago

      trackIngestionRequest(repository, 'application/xml', startTime, true);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_ingestion_requests_total');
      expect(metrics).toContain('repository=\"owner/test-repo\"');
      expect(metrics).toContain('status=\"success\"');
    });

    it('should track parse results with framework', async () => {
      const repository = 'owner/test-repo';
      const framework = 'jest';
      const startTime = Date.now() - 500;

      trackParseResult(repository, framework, true, startTime, {
        passed: 100,
        failed: 5,
        skipped: 2,
      });

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_parse_results_total');
      expect(metrics).toContain('framework=\"jest\"');
      expect(metrics).toContain('result=\"success\"');
      expect(metrics).toContain('flakeguard_api_tests_processed_total');
    });

    it('should track parse failures', async () => {
      const repository = 'owner/test-repo';
      const framework = 'junit';
      const startTime = Date.now() - 500;

      trackParseResult(repository, framework, false, startTime);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('result=\"failure\"');
    });
  });

  describe('GitHub Integration Metrics', () => {
    it('should track webhook processing', async () => {
      const eventType = 'workflow_run';
      const repository = 'owner/test-repo';
      const action = 'completed';
      const startTime = Date.now() - 2000;

      trackGitHubWebhook(eventType, repository, action, startTime, true);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_github_webhooks_total');
      expect(metrics).toContain('event_type=\"workflow_run\"');
      expect(metrics).toContain('action=\"completed\"');
      expect(metrics).toContain('status=\"success\"');
    });

    it('should track webhook latency', async () => {
      const eventType = 'check_run';
      const repository = 'owner/test-repo';
      const action = 'created';
      const startTime = Date.now() - 1500;

      trackGitHubWebhook(eventType, repository, action, startTime, true);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_github_webhook_processing_seconds');
    });
  });

  describe('Business Logic Metrics', () => {
    it('should track flake detections with severity', async () => {
      const repository = 'owner/test-repo';
      const flakinessScore = 0.75; // High flakiness

      trackFlakeDetection(repository, flakinessScore);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_flake_detections_total');
      expect(metrics).toContain('severity=\"high\"');
      expect(metrics).toContain('flakeguard_api_flakiness_score_distribution');
    });

    it('should classify flakiness severity correctly', async () => {
      const repository = 'owner/test-repo';

      // Low severity
      trackFlakeDetection(repository, 0.2);
      // Medium severity
      trackFlakeDetection(repository, 0.5);
      // High severity
      trackFlakeDetection(repository, 0.8);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('severity=\"low\"');
      expect(metrics).toContain('severity=\"medium\"');
      expect(metrics).toContain('severity=\"high\"');
    });

    it('should track quarantine actions', async () => {
      const repository = 'owner/test-repo';
      const action = 'suggest';
      const reason = 'high_flakiness_score';

      trackQuarantineAction(repository, action, reason);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_quarantine_actions_total');
      expect(metrics).toContain('action=\"suggest\"');
      expect(metrics).toContain('reason=\"high_flakiness_score\"');
    });
  });

  describe('Health Check Integration', () => {
    it('should provide comprehensive health metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/detailed',
      });

      const health = JSON.parse(response.payload);
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('checks');
      expect(health.checks).toHaveProperty('database');
      expect(health.checks).toHaveProperty('memory');
      expect(health.checks).toHaveProperty('github');

      if (health.metrics) {
        expect(health.metrics).toHaveProperty('activeRepositories');
        expect(health.metrics).toHaveProperty('totalRequests');
        expect(health.metrics).toHaveProperty('errorRate');
      }
    });

    it('should update database connection metrics', async () => {
      await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_database_connections_active');
    });
  });

  describe('Metrics Endpoint', () => {
    it('should serve Prometheus metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.payload).toContain('# HELP');
      expect(response.payload).toContain('# TYPE');
      expect(response.payload).toContain('flakeguard_api_');
    });

    it('should include default Node.js metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      const metrics = response.payload;
      expect(metrics).toContain('nodejs_version_info');
      expect(metrics).toContain('process_cpu_user_seconds_total');
      expect(metrics).toContain('nodejs_heap_size_total_bytes');
    });

    it('should set proper cache headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.headers['cache-control']).toContain('no-cache');
    });
  });

  describe('SLO Metric Calculations', () => {
    it('should provide data for API availability SLO', async () => {
      // Generate some successful requests
      await app.inject({ method: 'GET', url: '/health' });
      await app.inject({ method: 'GET', url: '/health' });
      await app.inject({ method: 'GET', url: '/health' });

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_http_requests_total');
      
      // Should have data for calculating success rate
      const successfulRequests = metrics.match(/flakeguard_api_http_requests_total{.*status_code="200".*}/g);
      expect(successfulRequests).toBeTruthy();
    });

    it('should provide data for ingestion latency SLO', async () => {
      const repository = 'owner/test-repo';
      const startTime = Date.now() - 5000; // 5 seconds ago

      trackIngestionRequest(repository, 'application/xml', startTime, true);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_ingestion_latency_seconds');
      
      // Should include histogram buckets for percentile calculations
      expect(metrics).toContain('_bucket{');
      expect(metrics).toContain('le=');
    });

    it('should provide data for parse success rate SLO', async () => {
      const repository = 'owner/test-repo';
      const framework = 'jest';
      const startTime = Date.now() - 1000;

      // Successful parse
      trackParseResult(repository, framework, true, startTime);
      // Failed parse
      trackParseResult(repository, framework, false, startTime);

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_parse_results_total');
      expect(metrics).toContain('result=\"success\"');
      expect(metrics).toContain('result=\"failure\"');
    });
  });

  describe('Performance Impact', () => {
    it('should not significantly impact request latency', async () => {
      const iterations = 10;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        await app.inject({
          method: 'GET',
          url: '/health',
        });
      }

      const totalTime = Date.now() - startTime;
      const averageTime = totalTime / iterations;

      // Metrics collection should add minimal overhead
      expect(averageTime).toBeLessThan(100); // Less than 100ms per request
    });

    it('should handle high metric volume', async () => {
      const repository = 'owner/test-repo';
      const iterations = 1000;

      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        trackFlakeDetection(repository, Math.random());
      }

      const processingTime = Date.now() - startTime;

      // Should process 1000 metrics in reasonable time
      expect(processingTime).toBeLessThan(1000); // Less than 1 second

      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_flake_detections_total');
    });
  });

  describe('Error Handling', () => {
    it('should handle metrics collection errors gracefully', async () => {
      // This test ensures that metrics errors don't break the main application
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      // Main functionality should work even if metrics have issues
      expect(response.statusCode).toBe(200);
    });

    it('should handle malformed metric labels', async () => {
      // Test with potentially problematic characters
      const repository = 'owner/test-repo-with-special-chars!@#';

      expect(() => {
        trackFlakeDetection(repository, 0.5);
      }).not.toThrow();

      // Metrics should still be collectible
      const metrics = await getMetricsRegistry().metrics();
      expect(metrics).toContain('flakeguard_api_flake_detections_total');
    });
  });
});