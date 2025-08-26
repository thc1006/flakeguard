/**
 * GitHub Webhook Event Router
 * 
 * Implements a robust event routing architecture for GitHub webhook events with:
 * - Type-safe event routing and payload processing
 * - Signature validation and security measures
 * - Error handling and retry strategies
 * - Logging and monitoring integration
 * - Middleware pipeline for request processing
 * 
 * Follows security best practices and provides comprehensive error handling
 * for reliable webhook event processing.
 */

import type { FastifyRequest, FastifyReply , FastifyInstance } from 'fastify';

import type {
  WebhookEventMap,
  WebhookRouteHandler,
  WebhookProcessor,
  WebhookMiddleware,
  ApiMetrics,
  ErrorFactory
} from './api-spec.js';
import {
  ErrorCode,
} from './api-spec.js';
// import type {
//   WebhookDispatcher,
// } from './types.js';
import {
  SUPPORTED_WEBHOOK_EVENTS,
  // ERROR_MESSAGES, // Now using inline error messages
  // TIMEOUTS, // Unused for now
} from './constants.js';
// import type {
//   CheckRunWebhookPayload,
//   WorkflowRunWebhookPayload,
//   InstallationWebhookPayload,
// } from './schemas.js';
import type {
  CheckRunEvent,
  WorkflowRunEvent,
  InstallationEvent
} from '@octokit/webhooks-types';
import { validateWebhookPayload, webhookHeadersSchema } from './schemas.js';


// =============================================================================
// WEBHOOK ROUTER IMPLEMENTATION
// =============================================================================

/**
 * Configuration for the webhook router
 */
interface WebhookRouterConfig {
  readonly enableMetrics: boolean;
  readonly validateSignatures: boolean;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly rateLimitWindowMs: number;
  readonly maxRequestsPerWindow: number;
}

/**
 * Default router configuration
 */
const DEFAULT_CONFIG: WebhookRouterConfig = {
  enableMetrics: true,
  validateSignatures: true,
  timeoutMs: 30000, // 30 seconds
  maxRetries: 3,
  rateLimitWindowMs: 60000, // 1 minute
  maxRequestsPerWindow: 100,
};

/**
 * GitHub webhook event router with type-safe event handling
 */
export class WebhookRouter {
  private readonly processors = new Map<keyof WebhookEventMap, WebhookProcessor<any>>();
  private readonly middleware: WebhookMiddleware[] = [];
  private readonly config: WebhookRouterConfig;
  private readonly metrics?: ApiMetrics;
  private readonly errorFactory?: ErrorFactory;

  constructor(
    config: Partial<WebhookRouterConfig> = {},
    metrics?: ApiMetrics,
    errorFactory?: ErrorFactory
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = metrics;
    this.errorFactory = errorFactory;
  }

  /**
   * Register a webhook processor for a specific event type
   */
  register<T extends keyof WebhookEventMap>(
    eventType: T,
    processor: WebhookProcessor<T>
  ): void {
    if (!SUPPORTED_WEBHOOK_EVENTS.includes(eventType as any)) {
      throw new Error(`Unsupported webhook event type: ${String(eventType)}`);
    }

    this.processors.set(eventType, processor);
  }

  /**
   * Add middleware to the processing pipeline
   */
  use(middleware: WebhookMiddleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Remove a registered processor
   */
  unregister<T extends keyof WebhookEventMap>(eventType: T): boolean {
    return this.processors.delete(eventType);
  }

  /**
   * Check if a processor is registered for an event type
   */
  hasProcessor<T extends keyof WebhookEventMap>(eventType: T): boolean {
    return this.processors.has(eventType);
  }

  /**
   * Get registered event types
   */
  getRegisteredEvents(): Array<keyof WebhookEventMap> {
    return Array.from(this.processors.keys());
  }

  /**
   * Clear all registered processors and middleware
   */
  clear(): void {
    this.processors.clear();
    this.middleware.length = 0;
  }

  /**
   * Create a Fastify route handler for webhook endpoints
   */
  createHandler(): WebhookRouteHandler {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const startTime = Date.now();
      let eventType: string | undefined;
      
      try {
        // Extract event type from headers
        eventType = request.headers['x-github-event'] as string;
        
        if (!eventType) {
          await this.handleError(
            new Error('Missing or invalid event type'),
            request,
            reply,
            ErrorCode.MISSING_REQUIRED_FIELD
          );
          return;
        }

        // Validate headers
        const headerValidation = webhookHeadersSchema.safeParse(request.headers);
        if (!headerValidation.success) {
          await this.handleError(
            new Error('Invalid request headers'),
            request,
            reply,
            ErrorCode.VALIDATION_ERROR,
            { validation: headerValidation.error.issues }
          );
          return;
        }

        // Check if we have a processor for this event type
        const processor = this.processors.get(eventType as keyof WebhookEventMap);
        if (!processor) {
          // Silently ignore unsupported events (GitHub sends many we don't care about)
          reply.code(200).send({ message: `Event type ${eventType} ignored` });
          return;
        }

        // Apply middleware
        const rawPayload = request.body;
        for (const middleware of this.middleware) {
          await middleware(request, reply, rawPayload);
          // Check if middleware already sent a response
          if (reply.sent) {
            return;
          }
        }

        // Validate and process the payload
        const validatedPayload = await this.validatePayload(processor, rawPayload, eventType);
        await this.processEvent(processor, validatedPayload, eventType);

        // Record success metrics
        if (this.metrics) {
          const duration = Date.now() - startTime;
          this.metrics.recordWebhookEvent(eventType, duration, true);
        }

        reply.code(200).send({
          message: `Successfully processed ${eventType} event`
        });

      } catch (error) {
        // Record error metrics
        if (this.metrics && eventType) {
          const duration = Date.now() - startTime;
          this.metrics.recordWebhookEvent(eventType, duration, false);
        }

        await this.handleError(error as Error, request, reply, ErrorCode.INTERNAL_SERVER_ERROR);
      }
    };
  }

  /**
   * Register the webhook route with a Fastify instance
   */
  registerRoute(fastify: FastifyInstance, path: string = '/webhook'): void {
    fastify.post(path, {
      config: {
        // rawBody: true // Ensure we get the raw body for signature verification - Not supported in FastifyContextConfig
      }
    }, this.createHandler());
  }

  /**
   * Validate webhook payload using the appropriate processor
   */
  private async validatePayload<T extends keyof WebhookEventMap>(
    processor: WebhookProcessor<T>,
    payload: unknown,
    eventType: string
  ): Promise<WebhookEventMap[T]> {
    try {
      const result = processor.validate(payload);
      return result instanceof Promise ? await result : result;
    } catch (error) {
      throw new Error(`Payload validation failed for ${eventType}: ${(error as Error).message}`);
    }
  }

  /**
   * Process the validated webhook event
   */
  private async processEvent<T extends keyof WebhookEventMap>(
    processor: WebhookProcessor<T>,
    payload: WebhookEventMap[T],
    eventType: string
  ): Promise<void> {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Processing timeout for ${eventType} after ${this.config.timeoutMs}ms`));
        }, this.config.timeoutMs);
      });

      await Promise.race([
        processor.process(payload),
        timeoutPromise
      ]);

    } catch (error) {
      // Let the processor handle its own errors first
      try {
        await processor.handleError(error as Error, payload);
      } catch (handlerError) {
        // If the processor's error handler also fails, we'll throw the original error
        throw error;
      }
      
      // Re-throw the original error for upstream handling
      throw error;
    }
  }

  /**
   * Handle errors consistently with proper HTTP status codes
   */
  private async handleError(
    error: Error,
    request: FastifyRequest,
    reply: FastifyReply,
    errorCode: ErrorCode,
    details?: Record<string, unknown>
  ): Promise<void> {
    if (reply.sent) {
      return;
    }

    let errorResponse;
    
    if (this.errorFactory) {
      errorResponse = this.errorFactory.fromError(error, errorCode, details);
    } else {
      // Fallback error response
      errorResponse = {
        error: {
          code: errorCode,
          message: error.message || 'An unexpected error occurred',
          details,
          timestamp: new Date().toISOString()
        }
      };
    }

    // Determine HTTP status code
    const statusCode = this.getHttpStatusForErrorCode(errorCode);

    // Record error metrics
    if (this.metrics) {
      this.metrics.recordError(errorCode, request.method, request.url);
    }

    reply.code(statusCode).send(errorResponse);
  }

  /**
   * Map error codes to HTTP status codes
   */
  private getHttpStatusForErrorCode(errorCode: ErrorCode): number {
    switch (errorCode) {
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.INVALID_PAYLOAD:
      case ErrorCode.MISSING_REQUIRED_FIELD:
        return 400;
      case ErrorCode.UNAUTHORIZED:
      case ErrorCode.INVALID_WEBHOOK_SIGNATURE:
        return 401;
      case ErrorCode.FORBIDDEN:
        return 403;
      case ErrorCode.RESOURCE_NOT_FOUND:
        return 404;
      case ErrorCode.TIMEOUT:
        return 408;
      case ErrorCode.RATE_LIMITED:
        return 429;
      case ErrorCode.SERVICE_UNAVAILABLE:
        return 503;
      default:
        return 500;
    }
  }
}

// =============================================================================
// WEBHOOK PROCESSOR IMPLEMENTATIONS
// =============================================================================

/**
 * Base class for webhook processors with common functionality
 */
export abstract class BaseWebhookProcessor<T extends keyof WebhookEventMap> 
  implements WebhookProcessor<T> {
  
  abstract readonly eventType: T;
  
  abstract validate(payload: unknown): WebhookEventMap[T] | Promise<WebhookEventMap[T]>;
  abstract process(payload: WebhookEventMap[T]): Promise<void>;
  
  /**
   * Default error handling - can be overridden by subclasses
   */
  async handleError(error: Error, payload?: unknown): Promise<void> {
    console.error(`Error processing ${String(this.eventType)} webhook:`, {
      error: error.message,
      stack: error.stack,
      payload: payload ? JSON.stringify(payload, null, 2).substring(0, 500) : undefined
    });
  }
  
  /**
   * Helper method to extract common fields from GitHub webhook payloads
   */
  protected extractCommonFields(payload: any): {
    action?: string;
    repository?: { owner: { login: string }; name: string };
    installation?: { id: number };
    sender?: { login: string; type: string };
  } {
    return {
      action: payload.action,
      repository: payload.repository,
      installation: payload.installation,
      sender: payload.sender
    };
  }
}

/**
 * Processor for check_run events
 */
export class CheckRunProcessor extends BaseWebhookProcessor<'check_run'> {
  readonly eventType = 'check_run' as const;

  validate(payload: unknown): CheckRunEvent {
    const validated = validateWebhookPayload('check_run', payload);
    // The validated payload from Zod should be compatible with CheckRunEvent
    return validated as CheckRunEvent;
  }

  async process(payload: CheckRunEvent): Promise<void> {
    const { action, repository, installation } = this.extractCommonFields(payload);
    
    console.log(`Processing check_run.${action} for ${repository?.owner.login}/${repository?.name}`, {
      checkRunId: payload.check_run.id,
      name: payload.check_run.name,
      status: payload.check_run.status,
      conclusion: payload.check_run.conclusion,
      installationId: installation?.id
    });

    // TODO: Implement actual check run processing logic
    // This would typically:
    // 1. Analyze the check run results
    // 2. Update test case records
    // 3. Trigger flakiness analysis
    // 4. Queue follow-up actions if needed
  }
}

/**
 * Processor for workflow_run events
 */
export class WorkflowRunProcessor extends BaseWebhookProcessor<'workflow_run'> {
  readonly eventType = 'workflow_run' as const;

  validate(payload: unknown): WorkflowRunEvent {
    const validated = validateWebhookPayload('workflow_run', payload);
    // The validated payload from Zod should be compatible with WorkflowRunEvent
    return validated as WorkflowRunEvent;
  }

  async process(payload: WorkflowRunEvent): Promise<void> {
    const { action, repository, installation } = this.extractCommonFields(payload);
    
    console.log(`Processing workflow_run.${action} for ${repository?.owner.login}/${repository?.name}`, {
      workflowRunId: payload.workflow_run.id,
      workflowName: payload.workflow_run.name,
      status: payload.workflow_run.status,
      conclusion: payload.workflow_run.conclusion,
      installationId: installation?.id
    });

    // TODO: Implement actual workflow run processing logic
    // This would typically:
    // 1. Download and analyze test artifacts if workflow completed
    // 2. Parse JUnit XML files
    // 3. Update test occurrence records
    // 4. Trigger flakiness scoring
    // 5. Create/update check runs with results
  }
}

/**
 * Processor for installation events
 */
export class InstallationProcessor extends BaseWebhookProcessor<'installation'> {
  readonly eventType = 'installation' as const;

  validate(payload: unknown): InstallationEvent {
    return validateWebhookPayload('installation', payload) as InstallationEvent;
  }

  async process(payload: InstallationEvent): Promise<void> {
    const { action, installation } = this.extractCommonFields(payload);
    
    console.log(`Processing installation.${action}`, {
      installationId: installation?.id,
      account: payload.installation.account.login,
      repositoriesCount: payload.repositories?.length || 0
    });

    // TODO: Implement actual installation processing logic
    // This would typically:
    // 1. Update installation records
    // 2. Set up repository access permissions
    // 3. Initialize monitoring for new repositories
    // 4. Clean up data for uninstalled repositories
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a configured webhook router with default processors
 */
export function createWebhookRouter(
  config?: Partial<WebhookRouterConfig>,
  metrics?: ApiMetrics,
  errorFactory?: ErrorFactory
): WebhookRouter {
  const router = new WebhookRouter(config, metrics, errorFactory);
  
  // Register default processors
  router.register('check_run', new CheckRunProcessor());
  router.register('workflow_run', new WorkflowRunProcessor());
  router.register('installation', new InstallationProcessor());
  
  return router;
}

/**
 * Extract installation ID from various webhook payload types
 */
export function extractInstallationId(payload: any): number | null {
  return payload?.installation?.id || null;
}

/**
 * Extract repository information from webhook payloads
 */
export function extractRepositoryInfo(payload: any): { owner: string; name: string } | null {
  const repo = payload?.repository;
  if (!repo?.owner?.login || !repo.name) {
    return null;
  }
  
  return {
    owner: repo.owner.login,
    name: repo.name
  };
}

/**
 * Check if webhook payload represents a completed workflow run
 */
export function isCompletedWorkflowRun(payload: WorkflowRunEvent): boolean {
  return payload.action === 'completed' && 
         payload.workflow_run.status === 'completed';
}

/**
 * Check if webhook payload represents a requested action on a check run
 */
export function isCheckRunRequestedAction(payload: CheckRunEvent): boolean {
  return payload.action === 'requested_action';
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Type guard for check run events
 */
export function isCheckRunEvent(payload: any, eventType: string): payload is CheckRunEvent {
  return eventType === 'check_run' && 
         payload?.check_run?.id !== undefined;
}

/**
 * Type guard for workflow run events
 */
export function isWorkflowRunEvent(payload: any, eventType: string): payload is WorkflowRunEvent {
  return eventType === 'workflow_run' && 
         payload?.workflow_run?.id !== undefined;
}

/**
 * Type guard for installation events
 */
export function isInstallationEvent(payload: any, eventType: string): payload is InstallationEvent {
  return eventType === 'installation' && 
         payload?.installation?.id !== undefined;
}

// =============================================================================
// MIDDLEWARE AND ROUTE REGISTRATION
// =============================================================================

/**
 * Create logging middleware for webhook requests
 */
export function createLoggingMiddleware(logger: any): WebhookMiddleware {
  return async (request, _reply, payload) => {
    const eventType = request.headers['x-github-event'];
    const signature = request.headers['x-hub-signature-256'];
    
    logger.info('Webhook request received', {
      eventType,
      hasSignature: !!signature,
      payloadSize: JSON.stringify(payload).length
    });
  };
}

/**
 * Register webhook routes with a Fastify instance
 */
export async function registerWebhookRoutes(
  fastify: FastifyInstance,
  options: { router: WebhookRouter; path: string }
): Promise<void> {
  const handler = options.router.createHandler();
  
  await fastify.post(options.path, {
    schema: {
      body: {
        type: 'object',
        additionalProperties: true
      }
    }
  }, handler);
}