/**
 * GitHub Webhook Route Tests - P1 Implementation
 * 
 * Unit tests for signature verification pass/fail scenarios as required by P1.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import crypto from 'crypto';
import { githubWebhookRoutes } from '../github-webhook.js';

describe('GitHub Webhook Routes - P1', () => {
  let app: ReturnType<typeof Fastify>;
  const webhookSecret = 'test-webhook-secret';

  beforeEach(async () => {
    // Set up environment
    process.env.GITHUB_WEBHOOK_SECRET = webhookSecret;

    // Create Fastify app with our webhook routes
    app = Fastify({ logger: false });
    
    // Mock BullMQ queue
    app.decorate('queue', {
      add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
    });

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
  });

  describe('Signature Verification', () => {
    it('should accept valid webhook signature', async () => {
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

      // Create valid HMAC signature
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
          'user-agent': 'GitHub-Hookshot/123',
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        success: true,
        message: 'Webhook processed successfully',
        deliveryId: expect.any(String),
      });
    });

    it('should reject invalid webhook signature', async () => {
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
          'x-hub-signature-256': 'sha256=invalid-signature',
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        error: 'Invalid webhook signature',
      });
    });

    it('should reject missing signature', async () => {
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
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject malformed signature', async () => {
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
          'x-hub-signature-256': 'not-sha256-format',
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('Event Processing', () => {
    it('should process supported webhook events', async () => {
      const supportedEvents = ['workflow_run', 'workflow_job', 'check_run', 'check_suite', 'pull_request'];

      for (const eventType of supportedEvents) {
        const payload = JSON.stringify({
          action: 'completed',
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
            'x-github-event': eventType,
            'x-github-delivery': crypto.randomUUID(),
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toBe(202);
        expect(response.json().success).toBe(true);
      }
    });

    it('should return 202 for unsupported events without processing', async () => {
      const payload = JSON.stringify({
        action: 'opened',
        issue: { id: 123456 },
      });

      const signature = `sha256=${crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex')}`;

      const response = await app.inject({
        method: 'POST',
        url: '/github/webhook',
        headers: {
          'x-github-event': 'issues',
          'x-github-delivery': crypto.randomUUID(),
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      expect(response.json().message).toContain('not processed by FlakeGuard');
    });

    it('should enqueue job for supported events', async () => {
      const mockQueue = app.queue as any;
      mockQueue.add.mockClear();

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
        expect.objectContaining({
          eventType: 'workflow_run',
          deliveryId,
          repositoryId: 1234,
          repositoryFullName: 'owner/test-repo',
          installationId: 9999,
          action: 'completed',
          payload: expect.any(Object),
          receivedAt: expect.any(String),
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
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON payload', async () => {
      const payload = 'invalid json';
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

      expect(response.statusCode).toBe(400);
    });

    it('should handle queue errors gracefully', async () => {
      const mockQueue = app.queue as any;
      mockQueue.add.mockRejectedValue(new Error('Queue connection failed'));

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
      expect(response.json().success).toBe(false);
    });
  });
});