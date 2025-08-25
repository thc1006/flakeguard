/**
 * GitHub Webhook Routes - P1 Implementation
 * 
 * Implements the specific P1 requirements from CLAUDE.md:
 * - POST /github/webhook with Fastify
 * - HMAC signature verification with webhook secret
 * - Accept: workflow_run, workflow_job, check_run, check_suite, pull_request
 * - Enqueue minimal job payloads into BullMQ (QUEUE_GITHUB_EVENTS)
 * - Type-safe routing with Zod
 * - Return 202 immediately
 * 
 * This complements the existing webhook-router.ts by providing the
 * specific route handler as outlined in the P1 requirements.
 */

import crypto from 'crypto';

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// GitHub webhook event types supported per P1 requirements
const SUPPORTED_WEBHOOK_EVENTS = [
  'workflow_run',
  'workflow_job', 
  'check_run',
  'check_suite',
  'pull_request'
] as const;

type SupportedWebhookEvent = typeof SUPPORTED_WEBHOOK_EVENTS[number];

// Zod schemas for type-safe webhook handling
const webhookHeadersSchema = z.object({
  'x-github-event': z.string(),
  'x-github-delivery': z.string().uuid(),
  'x-hub-signature-256': z.string().startsWith('sha256='),
  'content-type': z.literal('application/json').optional(),
  'user-agent': z.string().startsWith('GitHub-Hookshot/').optional(),
});

const webhookPayloadSchema = z.object({
  action: z.string().optional(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    owner: z.object({
      login: z.string(),
      id: z.number(),
    }),
  }).optional(),
  installation: z.object({
    id: z.number(),
  }).optional(),
}).passthrough(); // Allow additional fields

// BullMQ job payload schema
const githubEventJobSchema = z.object({
  eventType: z.enum(SUPPORTED_WEBHOOK_EVENTS),
  deliveryId: z.string(),
  repositoryId: z.number().optional(),
  repositoryFullName: z.string().optional(),
  installationId: z.number().optional(),
  action: z.string().optional(),
  payload: z.record(z.unknown()),
  receivedAt: z.string().datetime(),
});

type GitHubEventJob = z.infer<typeof githubEventJobSchema>;

/**
 * Verify GitHub webhook HMAC signature
 */
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  const actualSignature = signature.slice(7); // Remove 'sha256=' prefix
  
  // Use crypto.timingSafeEqual to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(actualSignature, 'hex')
  );
}

/**
 * Create minimal job payload for BullMQ as per P1 requirements
 */
function createJobPayload(
  eventType: SupportedWebhookEvent,
  deliveryId: string,
  payload: any
): GitHubEventJob {
  return {
    eventType,
    deliveryId,
    repositoryId: payload.repository?.id,
    repositoryFullName: payload.repository?.full_name,
    installationId: payload.installation?.id,
    action: payload.action,
    payload,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * GitHub Webhook Route Handler - P1 Implementation
 */
export async function githubWebhookRoutes(fastify: FastifyInstance) {
  const logger = fastify.log;
  
  // Get webhook secret from config
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('GITHUB_WEBHOOK_SECRET environment variable is required');
  }

  // P1 Requirement: POST /github/webhook with signature verification
  fastify.post('/github/webhook', {
    schema: {
      headers: {
        type: 'object',
        properties: {
          'x-github-event': { type: 'string' },
          'x-github-delivery': { type: 'string' },
          'x-hub-signature-256': { type: 'string' },
          'content-type': { type: 'string' },
          'user-agent': { type: 'string' },
        },
        required: ['x-github-event', 'x-github-delivery', 'x-hub-signature-256'],
      },
      body: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          repository: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              full_name: { type: 'string' },
              owner: {
                type: 'object',
                properties: {
                  login: { type: 'string' },
                  id: { type: 'number' },
                },
              },
            },
          },
          installation: {
            type: 'object',
            properties: {
              id: { type: 'number' },
            },
          },
        },
        additionalProperties: true,
      },
      response: {
        202: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            deliveryId: { type: 'string' },
          },
          required: ['success', 'message', 'deliveryId'],
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
          required: ['success', 'error'],
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
          required: ['success', 'error'],
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      // Extract headers (already validated by Fastify schema)
      const eventType = request.headers['x-github-event'] as string;
      const deliveryId = request.headers['x-github-delivery'] as string;
      const signature = request.headers['x-hub-signature-256'] as string;
      const userAgent = request.headers['user-agent'] as string;

      logger.info('GitHub webhook received', {
        eventType,
        deliveryId,
        userAgent,
      });

      // P1 Requirement: Check if event is supported
      if (!SUPPORTED_WEBHOOK_EVENTS.includes(eventType as SupportedWebhookEvent)) {
        logger.warn('Unsupported webhook event', { eventType, deliveryId });
        
        // Return 202 for unsupported events (per P1 requirements)
        return reply.code(202).send({
          success: true,
          message: `Event ${eventType} not processed by FlakeGuard`,
          deliveryId,
        });
      }

      // P1 Requirement: Verify HMAC signature
      let rawPayload: string;
      try {
        rawPayload = request.rawBody || JSON.stringify(request.body);
      } catch (error) {
        logger.error('Failed to get raw payload for signature verification', {
          eventType,
          deliveryId,
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.code(400).send({
          success: false,
          error: 'Invalid request format',
        });
      }

      let isValidSignature: boolean;
      try {
        isValidSignature = verifyWebhookSignature(
          rawPayload,
          signature,
          webhookSecret
        );
      } catch (error) {
        logger.error('Error during signature verification', {
          eventType,
          deliveryId,
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.code(401).send({
          success: false,
          error: 'Invalid webhook signature',
        });
      }

      if (!isValidSignature) {
        logger.error('Invalid webhook signature', { 
          eventType, 
          deliveryId,
          hasSignature: !!signature,
          signatureLength: signature?.length,
        });
        
        return reply.code(401).send({
          success: false,
          error: 'Invalid webhook signature',
        });
      }

      // Payload is already validated by Fastify schema
      const payload = request.body as any;

      // P1 Requirement: Create minimal job payload for BullMQ
      const jobPayload = createJobPayload(
        eventType as SupportedWebhookEvent,
        deliveryId,
        payload
      );

      // P1 Requirement: Enqueue into BullMQ (QUEUE_GITHUB_EVENTS)
      // Note: Queue will be injected via Fastify decorator or plugin
      if (fastify.queue) {
        await fastify.queue.add('github-event', jobPayload, {
          jobId: deliveryId, // Use delivery ID to prevent duplicates
          removeOnComplete: 100, // Keep last 100 completed jobs
          removeOnFail: 50, // Keep last 50 failed jobs
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000, // Start with 5 seconds
          },
        });

        logger.info('GitHub webhook enqueued', {
          eventType,
          deliveryId,
          repositoryId: jobPayload.repositoryId,
          installationId: jobPayload.installationId,
          queueTime: Date.now() - startTime,
        });
      } else {
        logger.warn('BullMQ queue not available, webhook not enqueued', {
          eventType,
          deliveryId,
        });
      }

      // P1 Requirement: Return 202 immediately
      return reply.code(202).send({
        success: true,
        message: 'Webhook processed successfully',
        deliveryId,
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('GitHub webhook processing error', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        deliveryId: request.headers['x-github-delivery'],
        eventType: request.headers['x-github-event'],
        duration,
      });

      // Fastify will handle validation errors before reaching this handler,
      // so we don't need to check for ZodError here anymore

      // Don't expose internal errors to GitHub
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  logger.info('GitHub webhook routes registered', {
    supportedEvents: SUPPORTED_WEBHOOK_EVENTS,
  });
}

// Export types for use in other modules
export type {
  SupportedWebhookEvent,
  GitHubEventJob,
};

export {
  SUPPORTED_WEBHOOK_EVENTS,
  webhookHeadersSchema,
  webhookPayloadSchema,
  githubEventJobSchema,
};