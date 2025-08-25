import { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { buildApp } from '../../app.js';

describe('/v1/quarantine routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/quarantine/policy', () => {
    it('should return default quarantine policy', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/quarantine/policy',
      });

      expect(response.statusCode).toBe(200);
      const policy = JSON.parse(response.payload);
      
      expect(policy).toHaveProperty('warnThreshold');
      expect(policy).toHaveProperty('quarantineThreshold');
      expect(policy).toHaveProperty('minRunsForQuarantine');
      expect(policy).toHaveProperty('minRecentFailures');
      expect(policy).toHaveProperty('lookbackDays');
      expect(policy).toHaveProperty('rollingWindowSize');
      
      expect(policy.warnThreshold).toBe(0.3);
      expect(policy.quarantineThreshold).toBe(0.6);
    });
  });

  describe('POST /v1/quarantine/plan', () => {
    it('should return 404 for non-existent repository', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: {
          repositoryId: 'non-existent-repo-id',
        },
      });

      expect(response.statusCode).toBe(404);
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Not Found');
    });

    it('should validate request body schema', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: {
          // Missing repositoryId
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should accept custom policy parameters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: {
          repositoryId: 'test-repo-id',
          policy: {
            warnThreshold: 0.2,
            quarantineThreshold: 0.5,
            minRunsForQuarantine: 3,
          },
          lookbackDays: 14,
          includeAnnotations: false,
        },
      });

      // Should fail with 404 since repository doesn't exist, but request should be valid
      expect(response.statusCode).toBe(404);
      const result = JSON.parse(response.payload);
      expect(result.message).toContain('Repository with ID test-repo-id not found');
    });

    it('should validate policy threshold ranges', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: {
          repositoryId: 'test-repo-id',
          policy: {
            warnThreshold: 1.5, // Invalid: > 1
            quarantineThreshold: -0.1, // Invalid: < 0
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate lookbackDays range', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: {
          repositoryId: 'test-repo-id',
          lookbackDays: 100, // Invalid: > 90
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate minimum values for policy parameters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: {
          repositoryId: 'test-repo-id',
          policy: {
            minRunsForQuarantine: 0, // Invalid: < 1
            rollingWindowSize: 5, // Invalid: < 10
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle missing optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: {
          repositoryId: 'test-repo-id',
          // All other fields optional
        },
      });

      // Should fail with 404 since repository doesn't exist, but request should be valid
      expect(response.statusCode).toBe(404);
    });
  });

  describe('response format validation', () => {
    it('should return properly structured error response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: {
          repositoryId: 'non-existent',
        },
      });

      expect(response.statusCode).toBe(404);
      const result = JSON.parse(response.payload);
      
      expect(result).toHaveProperty('statusCode', 404);
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('message');
    });

    it('should handle malformed JSON gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: '{"invalid": json}',
        headers: {
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should enforce content-type for POST requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/quarantine/plan',
        payload: 'repositoryId=test',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('integration scenarios', () => {
    it('should handle concurrent requests', async () => {
      const requests = Array.from({ length: 3 }, () => 
        app.inject({
          method: 'GET',
          url: '/v1/quarantine/policy',
        })
      );

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.statusCode).toBe(200);
      });
    });

    it('should respect rate limiting', async () => {
      // This test would need rate limiting configured in test environment
      // For now, just verify the endpoint is accessible
      const response = await app.inject({
        method: 'GET',
        url: '/v1/quarantine/policy',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('OpenAPI documentation', () => {
    it('should include quarantine routes in Swagger documentation', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.payload);
      
      expect(spec.paths).toHaveProperty('/v1/quarantine/plan');
      expect(spec.paths).toHaveProperty('/v1/quarantine/policy');
      
      // Check that POST /v1/quarantine/plan has proper schema
      const planEndpoint = spec.paths['/v1/quarantine/plan'];
      expect(planEndpoint).toHaveProperty('post');
      expect(planEndpoint.post).toHaveProperty('requestBody');
      expect(planEndpoint.post).toHaveProperty('responses');
      
      // Check response schemas
      expect(planEndpoint.post.responses).toHaveProperty('200');
      expect(planEndpoint.post.responses).toHaveProperty('400');
      expect(planEndpoint.post.responses).toHaveProperty('404');
    });

    it('should have proper tags for organization', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/documentation/json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.payload);
      
      const planEndpoint = spec.paths['/v1/quarantine/plan'].post;
      const policyEndpoint = spec.paths['/v1/quarantine/policy'].get;
      
      expect(planEndpoint.tags).toContain('Quarantine');
      expect(policyEndpoint.tags).toContain('Quarantine');
    });
  });
});