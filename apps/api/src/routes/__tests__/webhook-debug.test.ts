/**
 * Debug webhook signature verification issues
 */

import crypto from 'crypto';

import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { githubWebhookRoutes } from '../github-webhook.js';

describe('Webhook Debug', () => {
  let app: ReturnType<typeof Fastify>;
  const webhookSecret = 'test-secret';

  beforeEach(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = webhookSecret;
    process.env.NODE_ENV = 'test';

    app = Fastify({ logger: true }); // Enable logging to see what's happening
    
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
    delete process.env.NODE_ENV;
  });

  it('should handle signature verification step by step', async () => {
    const payload = JSON.stringify({ test: 'data' });
    const signature = `sha256=${crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex')}`;

    console.log('Payload:', payload);
    console.log('Expected signature:', signature);
    console.log('Webhook secret:', webhookSecret);

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

    console.log('Response status:', response.statusCode);
    console.log('Response body:', response.body);
    
    // This should succeed
    expect(response.statusCode).toBe(202);
  });

  it('should debug invalid signature', async () => {
    const payload = JSON.stringify({ test: 'data' });
    const signature = 'sha256=invalid-hash';

    console.log('Testing invalid signature...');
    console.log('Payload:', payload);
    console.log('Invalid signature:', signature);

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

    console.log('Response status:', response.statusCode);
    console.log('Response body:', response.body);
    
    // This should return 401, but we're getting 500
    expect(response.statusCode).toBe(401);
  });
});
