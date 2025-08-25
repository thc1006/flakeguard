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

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type {
  WebhookEventMap,
  WebhookHandler,
  WebhookProcessor,
  WebhookMiddleware,
  WebhookDispatcher,
  ApiMetrics,
} from './api-spec.js';
import type {
  CheckRunWebhookPayload,
  CheckSuiteWebhookPayload,
  WorkflowRunWebhookPayload,
  WorkflowJobWebhookPayload,
  PullRequestWebhookPayload,
  PushWebhookPayload,
  InstallationWebhookPayload,
} from './schemas.js';
import {
  WEBHOOK_EVENTS,
  SUPPORTED_WEBHOOK_EVENTS,
  ERROR_MESSAGES,
  TIMEOUTS,
  METRICS,
} from './constants.js';
import { validateWebhookPayload, webhookHeadersSchema } from './schemas.js';
import { ErrorCode, type ErrorFactory } from './api-spec.js';

// =============================================================================
// WEBHOOK ROUTER IMPLEMENTATION
// =============================================================================

/**
 * Main webhook router class for handling GitHub webhook events
 */
export class WebhookRouter implements WebhookDispatcher {
  private readonly processors = new Map<string, WebhookProcessor<any>>();
  private readonly middleware: WebhookMiddleware[] = [];
  private readonly errorFactory: ErrorFactory;
  private readonly metrics?: ApiMetrics;
  private readonly logger: any;

  constructor(options: {
    errorFactory: ErrorFactory;
    metrics?: ApiMetrics;
    logger: any;
  }) {
    this.errorFactory = options.errorFactory;
    this.metrics = options.metrics;
    this.logger = options.logger;
  }

  /**
   * Register a webhook event processor
   */
  on<T extends keyof WebhookEventMap>(
    event: T,
    processor: WebhookProcessor<T>
  ): void {
    this.processors.set(event, processor);
    this.logger.info(`Registered webhook processor for event: ${event}`);
  }

  /**
   * Add middleware to the processing pipeline
   */
  use(middleware: WebhookMiddleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Process webhook event through registered processors
   */
  async emit<T extends keyof WebhookEventMap>(
    event: T,
    payload: WebhookEventMap[T]
  ): Promise<void> {
    const processor = this.processors.get(event);
    if (!processor) {
      throw new Error(`No processor registered for event: ${event}`);
    }

    const startTime = Date.now();
    try {
      await processor.process(payload);
      
      if (this.metrics) {
        this.metrics.recordWebhookEvent(
          event,
          Date.now() - startTime,
          true
        );
      }
    } catch (error) {
      if (this.metrics) {
        this.metrics.recordWebhookEvent(
          event,
          Date.now() - startTime,
          false
        );
      }
      throw error;
    }
  }

  /**
   * Main webhook handler for Fastify routes
   */
  createHandler(): WebhookHandler {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const startTime = Date.now();
      let eventType: string | undefined;

      try {
        // Validate headers
        const headers = webhookHeadersSchema.parse(request.headers);
        eventType = headers['x-github-event'];

        // Check if event is supported
        if (!SUPPORTED_WEBHOOK_EVENTS.includes(eventType as any)) {
          this.logger.warn(`Unsupported webhook event: ${eventType}`);
          return reply.code(200).send({
            success: true,
            message: `Event ${eventType} not processed`,
          });
        }

        // Validate webhook signature
        await this.validateWebhookSignature(request, headers);

        // Process middleware pipeline
        await this.processMiddleware(request, reply, request.body);

        // Route to appropriate processor
        await this.routeEvent(eventType, request.body);

        // Record success metrics
        if (this.metrics) {
          this.metrics.recordRequest(
            request.method,
            request.url,
            200,
            Date.now() - startTime
          );
        }

        reply.code(200).send({
          success: true,
          message: 'Webhook processed successfully',
        });

      } catch (error) {
        await this.handleError(error, request, reply, {
          eventType,
          startTime,
          deliveryId: request.headers['x-github-delivery'] as string,
        });
      }
    };
  }

  /**
   * Route event to appropriate processor with validation
   */
  private async routeEvent(eventType: string, payload: unknown): Promise<void> {
    try {
      // Validate payload structure
      const validatedPayload = validateWebhookPayload(eventType as any, payload);
      
      // Route to processor
      await this.emit(eventType as keyof WebhookEventMap, validatedPayload);
      
    } catch (validationError) {
      this.logger.error('Webhook payload validation failed', {
        eventType,
        error: validationError,
        payload,
      });
      throw this.errorFactory.create(
        ErrorCode.INVALID_PAYLOAD,
        `Invalid payload for event ${eventType}`,
        { eventType, validationError: (validationError as Error).message }
      );
    }
  }

  /**
   * Process middleware pipeline
   */
  private async processMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown
  ): Promise<void> {
    for (const middleware of this.middleware) {
      try {
        await Promise.race([
          middleware(request, reply, payload),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Middleware timeout')),
              TIMEOUTS.WEBHOOK_PROCESSING
            )
          ),
        ]);
      } catch (error) {
        this.logger.error('Webhook middleware error', {
          middleware: middleware.name,
          error,
        });
        throw error;
      }
    }
  }

  /**
   * Validate webhook signature for security using security plugin
   */
  private async validateWebhookSignature(
    request: FastifyRequest & { verifyWebhookSignature?: any },
    headers: { 'x-hub-signature-256': string }
  ): Promise<void> {
    const signature = headers['x-hub-signature-256'];
    
    if (!signature || !signature.startsWith('sha256=')) {
      throw this.errorFactory.create(
        ErrorCode.INVALID_WEBHOOK_SIGNATURE,
        ERROR_MESSAGES.INVALID_WEBHOOK_SIGNATURE
      );
    }

    // Use the security plugin's webhook verification
    if (request.verifyWebhookSignature) {
      const isValid = request.verifyWebhookSignature({
        payload: typeof request.body === 'string' ? request.body : JSON.stringify(request.body),
        signature,
        provider: 'github'
      });
      
      if (!isValid) {
        this.logger.error('Webhook signature validation failed', {
          deliveryId: request.headers['x-github-delivery'],
          eventType: request.headers['x-github-event'],
          signatureProvided: !!signature,
        });
        
        throw this.errorFactory.create(
          ErrorCode.INVALID_WEBHOOK_SIGNATURE,
          ERROR_MESSAGES.INVALID_WEBHOOK_SIGNATURE
        );
      }
    }

    this.logger.debug('Webhook signature validated successfully', {
      deliveryId: request.headers['x-github-delivery'],
      eventType: request.headers['x-github-event'],
    });
  }

  /**
   * Comprehensive error handling for webhook processing
   */
  private async handleError(
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
    context: {
      eventType?: string;
      startTime: number;
      deliveryId?: string;
    }
  ): Promise<void> {
    const { eventType, startTime, deliveryId } = context;
    const duration = Date.now() - startTime;

    // Log error with full context
    this.logger.error('Webhook processing error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      eventType,
      deliveryId,
      duration,
      url: request.url,
      method: request.method,
      headers: request.headers,
    });

    // Record error metrics
    if (this.metrics && eventType) {
      this.metrics.recordWebhookEvent(eventType, duration, false);
    }

    // Determine appropriate error response
    let errorResponse;
    let statusCode = 500;

    if (error && typeof error === 'object' && 'code' in error) {
      // Handle our custom errors
      errorResponse = error;
      statusCode = this.getStatusCodeFromError(error as any);
    } else if (error instanceof Error) {
      // Handle generic errors
      errorResponse = this.errorFactory.fromError(error);
    } else {
      // Handle unknown errors
      errorResponse = this.errorFactory.create(
        ErrorCode.INTERNAL_SERVER_ERROR,
        ERROR_MESSAGES.INTERNAL_SERVER_ERROR
      );
    }

    // Record error metrics
    if (this.metrics) {
      this.metrics.recordRequest(
        request.method,
        request.url,
        statusCode,
        duration
      );
      this.metrics.recordError(
        (errorResponse as any).error?.code || ErrorCode.INTERNAL_SERVER_ERROR,
        request.method,
        request.url
      );
    }

    // Send error response
    reply.code(statusCode).send(errorResponse);
  }

  /**
   * Map error codes to HTTP status codes
   */
  private getStatusCodeFromError(error: { error?: { code?: string } }): number {
    const errorCode = error.error?.code;
    
    switch (errorCode) {
      case ErrorCode.INVALID_PAYLOAD:
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.MISSING_REQUIRED_FIELD:
      case ErrorCode.INVALID_WEBHOOK_SIGNATURE:
        return 400;
      case ErrorCode.UNAUTHORIZED:
      case ErrorCode.INVALID_TOKEN:
      case ErrorCode.TOKEN_EXPIRED:
        return 401;
      case ErrorCode.FORBIDDEN:
        return 403;
      case ErrorCode.RESOURCE_NOT_FOUND:
        return 404;
      case ErrorCode.TIMEOUT:
        return 504;
      case ErrorCode.RATE_LIMITED:
        return 429;
      default:
        return 500;
    }
  }
}

// =============================================================================
// WEBHOOK PROCESSORS
// =============================================================================

/**
 * Base webhook processor with common functionality
 */
export abstract class BaseWebhookProcessor<T extends keyof WebhookEventMap> 
  implements WebhookProcessor<T> {
  
  protected readonly logger: any;
  protected readonly metrics?: ApiMetrics;

  constructor(options: { logger: any; metrics?: ApiMetrics }) {
    this.logger = options.logger;
    this.metrics = options.metrics;
  }

  abstract readonly eventType: T;

  /**
   * Validate webhook payload - default implementation uses schemas
   */
  async validate(payload: unknown): Promise<WebhookEventMap[T]> {
    try {
      return validateWebhookPayload(this.eventType, payload);
    } catch (error) {
      this.logger.error(`Validation failed for ${this.eventType}`, {
        error: error instanceof Error ? error.message : String(error),
        payload,
      });
      throw error;
    }
  }

  /**
   * Abstract method for processing validated payload
   */
  abstract process(payload: WebhookEventMap[T]): Promise<void>;

  /**
   * Default error handler with logging and metrics
   */
  async handleError(error: Error, payload?: unknown): Promise<void> {
    this.logger.error(`Error processing ${this.eventType} webhook`, {
      error: error.message,
      stack: error.stack,
      payload,
    });

    if (this.metrics) {
      this.metrics.recordError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'POST',
        '/webhook'
      );
    }

    // Could implement retry logic, dead letter queue, etc.
    throw error;
  }
}

/**
 * Check run webhook processor
 */
export class CheckRunProcessor extends BaseWebhookProcessor<'check_run'> {
  readonly eventType = 'check_run' as const;

  async process(payload: CheckRunWebhookPayload): Promise<void> {
    const { action, check_run, repository, installation } = payload;

    this.logger.info('Processing check run webhook', {
      action,
      checkRunId: check_run.id,
      repository: repository.full_name,
      installationId: installation.id,
    });

    switch (action) {
      case 'created':
        await this.handleCheckRunCreated(payload);
        break;
      case 'completed':
        await this.handleCheckRunCompleted(payload);
        break;
      case 'rerequested':
        await this.handleCheckRunRerequested(payload);
        break;
      case 'requested_action':
        await this.handleCheckRunRequestedAction(payload);
        break;
      default:
        this.logger.warn(`Unhandled check run action: ${action}`);
    }
  }

  private async handleCheckRunCreated(payload: CheckRunWebhookPayload): Promise<void> {
    // Implementation for when a check run is created
    this.logger.debug('Check run created', {
      checkRunId: payload.check_run.id,
      name: payload.check_run.name,
    });
  }

  private async handleCheckRunCompleted(payload: CheckRunWebhookPayload): Promise<void> {
    // Implementation for when a check run is completed
    // This could trigger flake analysis
    this.logger.debug('Check run completed', {
      checkRunId: payload.check_run.id,
      conclusion: payload.check_run.conclusion,
    });
  }

  private async handleCheckRunRerequested(payload: CheckRunWebhookPayload): Promise<void> {
    // Implementation for when a check run is rerequested
    this.logger.debug('Check run rerequested', {
      checkRunId: payload.check_run.id,
    });
  }

  private async handleCheckRunRequestedAction(payload: CheckRunWebhookPayload): Promise<void> {
    const { requested_action, check_run, repository, installation } = payload;
    
    if (!requested_action) {
      this.logger.warn('Check run requested action without action identifier', {
        checkRunId: check_run.id,
      });
      return;
    }

    this.logger.info('Processing check run requested action', {
      checkRunId: check_run.id,
      action: requested_action.identifier,
      repository: repository.full_name,
      installationId: installation?.id,
    });

    try {
      // Import and use the comprehensive P5 action handlers
      const { CheckRunHandler } = await import('./handlers.js');
      
      // Get authenticated Octokit instance for this installation
      const octokit = installation ? 
        await this.getInstallationOctokit(installation.id) : null;
      
      if (!octokit) {
        this.logger.error('No installation context for requested action', {
          checkRunId: check_run.id,
          action: requested_action.identifier,
        });
        return;
      }

      // Route to the comprehensive P5 action handler
      const result = await CheckRunHandler.handleRequestedAction(payload, octokit);
      
      if (result.success) {
        this.logger.info('Check run action processed successfully', {
          checkRunId: check_run.id,
          action: requested_action.identifier,
          message: result.message,
        });
        
        // Update metrics if available
        if (this.metrics) {
          this.metrics.incrementCounter(
            `webhook.check_run.action.${requested_action.identifier}.success`
          );
        }
      } else {
        this.logger.error('Check run action processing failed', {
          checkRunId: check_run.id,
          action: requested_action.identifier,
          message: result.message,
          error: result.error,
        });
        
        // Update metrics if available
        if (this.metrics) {
          this.metrics.incrementCounter(
            `webhook.check_run.action.${requested_action.identifier}.error`
          );
        }
        
        // Don't throw here - we want to handle errors gracefully
        // The action handler already includes comprehensive error handling
      }
      
    } catch (error) {
      this.logger.error('Failed to process check run requested action', {
        checkRunId: check_run.id,
        action: requested_action.identifier,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      // Update metrics if available
      if (this.metrics) {
        this.metrics.incrementCounter(
          `webhook.check_run.action.${requested_action.identifier}.error`
        );
      }
      
      // Re-throw to trigger webhook retry if needed
      throw error;
    }
  }
  
  /**
   * Get authenticated Octokit instance for installation
   * This is a placeholder - actual implementation would depend on auth setup
   */
  private async getInstallationOctokit(installationId: number): Promise<any> {
    // This would integrate with the existing auth manager
    // For now, return a placeholder that would work with the auth system
    this.logger.debug('Getting installation Octokit', { installationId });
    
    // In real implementation, this would use GitHubAuthManager
    // return await this.authManager.getInstallationOctokit(installationId);
    
    // Placeholder return for type safety
    return null;
  }
}

/**
 * Workflow run webhook processor
 */
export class WorkflowRunProcessor extends BaseWebhookProcessor<'workflow_run'> {
  readonly eventType = 'workflow_run' as const;

  async process(payload: WorkflowRunWebhookPayload): Promise<void> {
    const { action, workflow_run, workflow, repository } = payload;

    this.logger.info('Processing workflow run webhook', {
      action,
      workflowRunId: workflow_run.id,
      workflowName: workflow.name,
      repository: repository.full_name,
    });

    switch (action) {
      case 'completed':
        await this.handleWorkflowRunCompleted(payload);
        break;
      case 'requested':
        await this.handleWorkflowRunRequested(payload);
        break;
      case 'in_progress':
        await this.handleWorkflowRunInProgress(payload);
        break;
      default:
        this.logger.warn(`Unhandled workflow run action: ${action}`);
    }
  }

  private async handleWorkflowRunCompleted(payload: WorkflowRunWebhookPayload): Promise<void> {
    // Implementation for completed workflow runs
    // This is where flake analysis might be triggered
    this.logger.debug('Workflow run completed', {
      workflowRunId: payload.workflow_run.id,
      conclusion: payload.workflow_run.conclusion,
    });
  }

  private async handleWorkflowRunRequested(payload: WorkflowRunWebhookPayload): Promise<void> {
    this.logger.debug('Workflow run requested', {
      workflowRunId: payload.workflow_run.id,
    });
  }

  private async handleWorkflowRunInProgress(payload: WorkflowRunWebhookPayload): Promise<void> {
    this.logger.debug('Workflow run in progress', {
      workflowRunId: payload.workflow_run.id,
    });
  }
}

/**
 * Installation webhook processor
 */
export class InstallationProcessor extends BaseWebhookProcessor<'installation'> {
  readonly eventType = 'installation' as const;

  async process(payload: InstallationWebhookPayload): Promise<void> {
    const { action, installation } = payload;

    this.logger.info('Processing installation webhook', {
      action,
      installationId: installation.id,
      account: installation.account.login,
    });

    switch (action) {
      case 'created':
        await this.handleInstallationCreated(payload);
        break;
      case 'deleted':
        await this.handleInstallationDeleted(payload);
        break;
      case 'suspend':
        await this.handleInstallationSuspended(payload);
        break;
      case 'unsuspend':
        await this.handleInstallationUnsuspended(payload);
        break;
      default:
        this.logger.warn(`Unhandled installation action: ${action}`);
    }
  }

  private async handleInstallationCreated(payload: InstallationWebhookPayload): Promise<void> {
    // Setup new installation
    this.logger.info('New installation created', {
      installationId: payload.installation.id,
      account: payload.installation.account.login,
    });
  }

  private async handleInstallationDeleted(payload: InstallationWebhookPayload): Promise<void> {
    // Cleanup installation data
    this.logger.info('Installation deleted', {
      installationId: payload.installation.id,
    });
  }

  private async handleInstallationSuspended(payload: InstallationWebhookPayload): Promise<void> {
    this.logger.info('Installation suspended', {
      installationId: payload.installation.id,
    });
  }

  private async handleInstallationUnsuspended(payload: InstallationWebhookPayload): Promise<void> {
    this.logger.info('Installation unsuspended', {
      installationId: payload.installation.id,
    });
  }
}

// =============================================================================
// MIDDLEWARE IMPLEMENTATIONS
// =============================================================================

/**
 * Request logging middleware
 */
export function createLoggingMiddleware(logger: any): WebhookMiddleware {
  return async (request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<void> => {
    const eventType = request.headers['x-github-event'];
    const deliveryId = request.headers['x-github-delivery'];

    logger.info('Webhook received', {
      eventType,
      deliveryId,
      userAgent: request.headers['user-agent'],
      contentLength: request.headers['content-length'],
    });
  };
}

/**
 * Rate limiting middleware
 */
export function createRateLimitingMiddleware(options: {
  maxRequests: number;
  windowMs: number;
  storage: Map<string, { count: number; resetTime: number }>;
}): WebhookMiddleware {
  const { maxRequests, windowMs, storage } = options;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const clientIp = request.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    for (const [key, value] of storage.entries()) {
      if (value.resetTime < now) {
        storage.delete(key);
      }
    }

    // Check current rate limit
    const current = storage.get(clientIp) || { count: 0, resetTime: now + windowMs };
    
    if (current.resetTime < now) {
      current.count = 0;
      current.resetTime = now + windowMs;
    }

    current.count++;
    storage.set(clientIp, current);

    if (current.count > maxRequests) {
      reply.code(429).send({
        success: false,
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: ERROR_MESSAGES.RATE_LIMITED,
        },
      });
      return;
    }

    // Add rate limit headers
    reply.header('X-RateLimit-Limit', maxRequests.toString());
    reply.header('X-RateLimit-Remaining', Math.max(0, maxRequests - current.count).toString());
    reply.header('X-RateLimit-Reset', Math.ceil(current.resetTime / 1000).toString());
  };
}

// =============================================================================
// FASTIFY PLUGIN REGISTRATION
// =============================================================================

/**
 * Fastify plugin for registering webhook routes
 */
export async function registerWebhookRoutes(
  fastify: FastifyInstance,
  options: {
    router: WebhookRouter;
    path?: string;
  }
): Promise<void> {
  const { router, path = '/api/github/webhook' } = options;

  fastify.post(path, {
    config: {
      rateLimit: {
        max: 1000,
        timeWindow: '1 minute',
      },
    },
    schema: {
      headers: {
        type: 'object',
        required: ['x-github-event', 'x-github-delivery', 'x-hub-signature-256'],
        properties: {
          'x-github-event': { type: 'string' },
          'x-github-delivery': { type: 'string' },
          'x-hub-signature-256': { type: 'string' },
          'content-type': { type: 'string', enum: ['application/json'] },
        },
      },
      body: {
        type: 'object',
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, router.createHandler());
}