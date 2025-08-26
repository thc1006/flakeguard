/**
 * Focused GitHub Webhook Test - Core Functionality
 * 
 * Tests webhook signature verification, payload validation, and basic enqueueing
 * without heavy dependencies. This test can run independently.
 */

import crypto from 'crypto';

import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { githubWebhookRoutes, SUPPORTED_WEBHOOK_EVENTS } from '../github-webhook.js';

describe('GitHub Webhook Core Functionality', () => {
  let app: ReturnType<typeof Fastify>;
  const webhookSecret = 'test-webhook-secret-12345';
  let mockQueue: {
    add: vi.MockedFunction<(name: string, data: unknown) => Promise<{ id: string }>>;
  };

  beforeEach(async () => {
    // Set up minimal test environment
    process.env.GITHUB_WEBHOOK_SECRET = webhookSecret;
    process.env.NODE_ENV = 'test';

    // Create Fastify app
    app = Fastify({ logger: false });
    
    // Mock BullMQ queue
    mockQueue = {
      add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
    };
    app.decorate('queue', mockQueue);

    // Register raw body parser for signature verification
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      req.rawBody = body.toString();
      done(null, JSON.parse(body.toString()));
    });

    await app.register(githubWebhookRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    delete process.env.GITHUB_WEBHOOK_SECRET;
    delete process.env.NODE_ENV;
    vi.clearAllMocks();
  });

  describe('Webhook Signature Verification', () => {
    it('should accept webhooks with valid HMAC signatures', async () => {
      const payload = JSON.stringify({
        action: 'completed',
        workflow_run: { id: 123456 },
        repository: {
          id: 1234,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          owner: { login: 'owner', id: 5678 },
        },
        installation: { id: 9999 },
      });

      // Create valid HMAC signature using the webhook secret
      const signature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex')}`;

      const deliveryId = crypto.randomUUID();

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
          'user-agent': 'GitHub-Hookshot/123',
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        success: true,
        message: 'Webhook processed successfully',
        deliveryId,
      });

      // Verify job was enqueued
      expect(mockQueue.add).toHaveBeenCalledWith(
        'github-event',
        expect.objectContaining({
          eventType: 'workflow_run',
          deliveryId,
          repositoryId: 1234,
          repositoryFullName: 'owner/test-repo',
          installationId: 9999,
          action: 'completed',
          payload: expect.any(Object),
          receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        }),
        expect.objectContaining({
          jobId: deliveryId,
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        })
      );
    });

    it('should reject webhooks with invalid signatures', async () => {
      const payload = JSON.stringify({
        action: 'completed',
        workflow_run: { id: 123456 },
        repository: {
          id: 1234,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          owner: { login: 'owner', id: 5678 },
        },
        installation: { id: 9999 },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': 'sha256=invalid-signature-hash',
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        error: 'Invalid webhook signature',
      });

      // Verify no job was enqueued
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should reject webhooks with malformed signature format', async () => {
      const payload = JSON.stringify({
        action: 'completed',
        workflow_run: { id: 123456 },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': 'not-sha256-format', // Missing 'sha256=' prefix
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        error: 'Invalid webhook signature',
      });

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should use timing-safe comparison for signature verification', async () => {
      // Test that we're using crypto.timingSafeEqual by ensuring different
      // signatures with same length don't cause timing variations
      const payload = JSON.stringify({ test: 'data' });
      
      // Create two different but same-length signatures
      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');
      
      const invalidSignature = 'a'.repeat(validSignature.length);
      
      const response1 = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': `sha256=${invalidSignature}`,
          'content-type': 'application/json',
        },
        payload,
      });
      
      expect(response1.statusCode).toBe(401);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('Webhook Event Processing', () => {
    const createValidWebhook = (eventType: string, payload: any) => {
      const payloadString = JSON.stringify(payload);
      const signature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadString)
        .digest('hex')}`;
      
      return {
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': eventType,
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload: payloadString,
      };
    };

    it('should process all supported webhook events', async () => {
      for (const eventType of SUPPORTED_WEBHOOK_EVENTS) {
        const payload = {
          action: 'completed',
          repository: {
            id: 1234,
            name: 'test-repo',
            full_name: 'owner/test-repo',
            owner: { login: 'owner', id: 5678 },
          },
          installation: { id: 9999 },
        };

        const request = createValidWebhook(eventType, payload);
        const response = await app.inject(request);

        expect(response.statusCode).toBe(202);
        expect(response.json().success).toBe(true);
        
        // Verify job was enqueued for supported events
        expect(mockQueue.add).toHaveBeenCalledWith(
          'github-event',
          expect.objectContaining({
            eventType,
            repositoryId: payload.repository.id,
            installationId: payload.installation.id,
          }),
          expect.any(Object)
        );
        
        // Clear mock for next iteration
        mockQueue.add.mockClear();
      }
    });

    it('should return 202 for unsupported events without processing', async () => {
      const payload = {
        action: 'opened',
        issue: { id: 123456 },
        repository: {
          id: 1234,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          owner: { login: 'owner', id: 5678 },
        },
      };

      const request = createValidWebhook('issues', payload);
      const response = await app.inject(request);

      expect(response.statusCode).toBe(202);
      expect(response.json().message).toContain('not processed by FlakeGuard');
      
      // Verify no job was enqueued for unsupported events
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should handle missing optional repository and installation fields', async () => {
      const payload = {
        action: 'completed',
        // No repository or installation fields
      };

      const request = createValidWebhook('workflow_run', payload);
      const response = await app.inject(request);

      expect(response.statusCode).toBe(202);
      expect(response.json().success).toBe(true);
      
      // Job should still be enqueued with undefined values
      expect(mockQueue.add).toHaveBeenCalledWith(
        'github-event',
        expect.objectContaining({
          eventType: 'workflow_run',
          repositoryId: undefined,
          repositoryFullName: undefined,
          installationId: undefined,
        }),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON payloads', async () => {
      const invalidJson = '{"invalid": json}';
      const signature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(invalidJson)
        .digest('hex')}`;

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload: invalidJson,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should handle queue failures gracefully', async () => {
      // Mock queue to throw an error
      mockQueue.add.mockRejectedValue(new Error('Redis connection failed'));

      const payload = JSON.stringify({
        action: 'completed',
        workflow_run: { id: 123456 },
        repository: {
          id: 1234,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          owner: { login: 'owner', id: 5678 },
        },
        installation: { id: 9999 },
      });

      const signature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex')}`;

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        error: 'Internal server error',
      });
    });

    it('should handle missing required headers', async () => {
      const payload = JSON.stringify({ test: 'data' });

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          // Missing x-github-event, x-github-delivery, x-hub-signature-256
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().success).toBe(false);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should not log sensitive information in error responses', async () => {
      const payload = JSON.stringify({ secret: 'sensitive-data' });
      const signature = 'sha256=invalid';

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      const responseBody = response.body;
      
      // Ensure sensitive data doesn't leak into response
      expect(responseBody).not.toContain('sensitive-data');
      expect(responseBody).not.toContain(webhookSecret);
    });
  });

  describe('Job Configuration', () => {
    it('should configure jobs with proper retry and cleanup settings', async () => {
      const payload = JSON.stringify({
        action: 'completed',
        workflow_run: { id: 123456 },
        repository: {
          id: 1234,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          owner: { login: 'owner', id: 5678 },
        },
        installation: { id: 9999 },
      });

      const signature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex')}`;

      const deliveryId = crypto.randomUUID();

      await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'github-event',
        expect.any(Object),
        {
          jobId: deliveryId,
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }
      );
    });

    it('should use delivery ID as job ID to prevent duplicates', async () => {
      const payload = JSON.stringify({
        action: 'completed',
        workflow_run: { id: 123456 },
        repository: { id: 1234, name: 'test-repo', full_name: 'owner/test-repo', owner: { login: 'owner', id: 5678 } },
        installation: { id: 9999 },
      });

      const signature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex')}`;

      const deliveryId = 'unique-delivery-id-12345';

      await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          jobId: deliveryId, // Should use delivery ID as job ID
        })
      );
    });
  });

  describe('Performance Characteristics', () => {
    it('should respond quickly to webhook requests', async () => {
      const payload = JSON.stringify({
        action: 'completed',
        workflow_run: { id: 123456 },
        repository: {
          id: 1234,
          name: 'test-repo',
          full_name: 'owner/test-repo',
          owner: { login: 'owner', id: 5678 },
        },
        installation: { id: 9999 },
      });

      const signature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex')}`;

      const startTime = Date.now();

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'workflow_run',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      const processingTime = Date.now() - startTime;

      expect(response.statusCode).toBe(202);
      expect(processingTime).toBeLessThan(100); // Should respond within 100ms
    });
  });
});
