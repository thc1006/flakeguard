/**
 * GitHub App Fastify Plugin
 * 
 * Complete Fastify plugin implementation for GitHub App integration including:
 * - Webhook verification and event handling
 * - Check run management endpoints
 * - Workflow operations API
 * - Artifact management endpoints  
 * - Authentication and authorization
 * - Error handling and logging integration
 * - Rate limiting and security measures
 */

// import crypto from 'crypto'; // Unused, handled by security plugin

// import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

import { ErrorCode, type ErrorFactory } from './api-spec.js';
import { GitHubAuthManager, createGitHubAuthManager } from './auth.js';
import {
  // WEBHOOK_EVENTS,
  SUPPORTED_WEBHOOK_EVENTS,
  ERROR_MESSAGES,
  // PAGINATION,
  // RATE_LIMITS,
} from './constants.js';
import { createFlakeDetector } from './flake-detector.js';
import {
  // CheckRunHandler,
  // WorkflowRunHandler,
  // InstallationHandler,
  createWebhookHandlers,
} from './handlers.js';
import { GitHubHelpers, createGitHubHelpers } from './helpers.js';
import {
  githubAppConfigSchema,
  // validateWebhookPayload,
  // webhookHeadersSchema,
  repositoryParamsSchema,
  // checkRunListParamsSchema,
  workflowRunParamsSchema,
} from './schemas.js';
import { 
  WebhookRouter,
  createLoggingMiddleware,
  registerWebhookRoutes,
} from './webhook-router.js';
import type {
  CreateCheckRunParams,
  UpdateCheckRunParams,
} from './types.js';

// Add type declarations for Fastify decorators
declare module 'fastify' {
  interface FastifyInstance {
    githubAuth: GitHubAuthManager;
    githubHelpers: GitHubHelpers;
  }
}

/**
 * Plugin options interface
 */
export interface GitHubAppPluginOptions {
  // Plugin is self-contained and uses global config
}

/**
 * Error factory implementation
 */
class GitHubErrorFactory implements ErrorFactory {
  create(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>
  ) {
    return {
      success: false as const,
      error: {
        code,
        message: message || ERROR_MESSAGES[code] || 'An error occurred',
        details,
        timestamp: new Date().toISOString(),
      },
    };
  }

  fromError(
    error: Error,
    code?: ErrorCode,
    details?: Record<string, unknown>
  ) {
    return this.create(
      code || ErrorCode.INTERNAL_SERVER_ERROR,
      error.message,
      { ...details, stack: error.stack }
    );
  }

  validation(field: string, message: string, value?: unknown) {
    return this.create(
      ErrorCode.VALIDATION_ERROR,
      `Validation failed for field '${field}': ${message}`,
      { field, value }
    );
  }

  notFound(resource: string, identifier: string | number) {
    return this.create(
      ErrorCode.RESOURCE_NOT_FOUND,
      `${resource} with identifier '${identifier}' not found`,
      { resource, identifier }
    );
  }

  forbidden(resource: string, action: string) {
    return this.create(
      ErrorCode.FORBIDDEN,
      `Access denied for action '${action}' on resource '${resource}'`,
      { resource, action }
    );
  }

  rateLimit(resetTime?: Date, remaining?: number) {
    return this.create(
      ErrorCode.RATE_LIMITED,
      ERROR_MESSAGES.RATE_LIMITED,
      {
        resetTime: resetTime?.toISOString(),
        remaining,
      }
    );
  }
}

// Webhook signature validation is now handled by the security plugin

/**
 * Main GitHub App plugin
 */
async function githubAppPlugin(fastify: FastifyInstance, _options: GitHubAppPluginOptions) {
  // Validate GitHub configuration
  const githubConfig = githubAppConfigSchema.parse(config.github);
  
  // Get Prisma instance (assumed to be registered as plugin)
  const prisma = fastify.prisma;
  
  // Initialize core services
  const errorFactory = new GitHubErrorFactory();
  const authManager = createGitHubAuthManager({ 
    config: githubConfig
  });
  const helpers = createGitHubHelpers(authManager);
  const flakeDetector = createFlakeDetector({ prisma });
  // const signatureValidator = new WebhookSignatureValidator(githubConfig.webhookSecret);

  // Initialize webhook router
  const webhookRouter = new WebhookRouter(
    {
      enableMetrics: true,
      validateSignatures: true,
      timeoutMs: 30000,
      maxRetries: 3,
    },
    undefined, // metrics
    errorFactory
  );

  // Add logging middleware
  webhookRouter.use(createLoggingMiddleware(logger));

  // Create and register webhook handlers
  const handlers = createWebhookHandlers({
    prisma,
    authManager,
    helpers,
    flakeDetector,
  });

  webhookRouter.register('check_run', handlers.checkRunHandler);
  webhookRouter.register('workflow_run', handlers.workflowRunHandler);
  webhookRouter.register('installation', handlers.installationHandler);

  // Register webhook routes
  await registerWebhookRoutes(fastify, { 
    router: webhookRouter,
    path: '/api/github/webhook',
  });

  // =============================================================================
  // CHECK RUN MANAGEMENT API
  // =============================================================================

  // Create check run
  fastify.post<{
    Params: { owner: string; repo: string };
    Body: CreateCheckRunParams;
  }>('/api/github/repos/:owner/:repo/check-runs', {
    schema: {
      params: repositoryParamsSchema.pick({ owner: true, repo: true }),
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                name: { type: 'string' },
                headSha: { type: 'string' },
                status: { type: 'string' },
                conclusion: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { owner, repo } = request.params;
      const installationId = await getInstallationIdFromAuth(request);
      
      const result = await helpers.createCheckRun(
        owner,
        repo,
        request.body,
        installationId
      );

      if (!result.success) {
        const statusCode = getStatusCodeFromErrorCode(result.error!.code as ErrorCode);
        return reply.code(statusCode).send(result);
      }

      return reply.code(201).send(result);

    } catch (error) {
      logger.error('Failed to create check run', { error });
      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // Update check run
  fastify.patch<{
    Params: { owner: string; repo: string; checkRunId: string };
    Body: UpdateCheckRunParams;
  }>('/api/github/repos/:owner/:repo/check-runs/:checkRunId', {
    schema: {
      params: {
        type: 'object',
        required: ['owner', 'repo', 'checkRunId'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          checkRunId: { type: 'string', pattern: '^\\d+$' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { owner, repo, checkRunId } = request.params;
      const installationId = await getInstallationIdFromAuth(request);
      
      const result = await helpers.updateCheckRun(
        owner,
        repo,
        parseInt(checkRunId, 10),
        installationId,
        request.body
      );

      if (!result.success) {
        const statusCode = getStatusCodeFromErrorCode(result.error!.code as ErrorCode);
        return reply.code(statusCode).send(result);
      }

      return reply.send(result);

    } catch (error) {
      logger.error('Failed to update check run', { error });
      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // List check runs for commit
  fastify.get<{
    Params: { owner: string; repo: string; ref: string };
    Querystring: { page?: number; perPage?: number; status?: string; conclusion?: string };
  }>('/api/github/repos/:owner/:repo/commits/:ref/check-runs', {
    schema: {
      params: {
        type: 'object',
        required: ['owner', 'repo', 'ref'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          ref: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          perPage: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          status: { type: 'string', enum: ['queued', 'in_progress', 'completed'] },
          conclusion: { 
            type: 'string',
            enum: ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required'],
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { owner, repo, ref } = request.params;
      const { page = 1, perPage = 30, status, conclusion } = request.query;
      // const installationId = await getInstallationIdFromAuth(request);

      // Get check runs from database
      const where: {
        headSha: string;
        repository: { owner: string; name: string };
        status?: string;
        conclusion?: string;
      } = {
        headSha: ref,
        repository: {
          owner,
          name: repo,
        },
      };

      if (status) {where.status = status;}
      if (conclusion) {where.conclusion = conclusion;}

      const [checkRuns, totalCount] = await Promise.all([
        prisma.checkRun.findMany({
          where,
          select: {
            id: true,
            githubId: true,
            name: true,
            headSha: true,
            status: true,
            conclusion: true,
            startedAt: true,
            completedAt: true,
            output: true,
            actions: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * perPage,
          take: perPage,
        }),
        prisma.checkRun.count({ where }),
      ]);

      const totalPages = Math.ceil(totalCount / perPage);

      return reply.send({
        success: true,
        data: checkRuns.map(run => ({
          id: run.githubId,
          name: run.name,
          headSha: run.headSha,
          status: run.status,
          conclusion: run.conclusion,
          startedAt: run.startedAt?.toISOString(),
          completedAt: run.completedAt?.toISOString(),
          output: run.output as unknown,
          actions: run.actions as unknown,
        })),
        pagination: {
          page,
          perPage,
          totalCount,
          totalPages,
        },
      });

    } catch (error) {
      logger.error('Failed to list check runs', { error });
      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // =============================================================================
  // WORKFLOW OPERATIONS API
  // =============================================================================

  // Rerun workflow
  fastify.post<{
    Params: { owner: string; repo: string; runId: string };
    Body: { enableDebugLogging?: boolean; rerunFailedJobsOnly?: boolean };
  }>('/api/github/repos/:owner/:repo/actions/runs/:runId/rerun', {
    schema: {
      params: workflowRunParamsSchema.pick({ owner: true, repo: true, runId: true }),
      body: {
        type: 'object',
        properties: {
          enableDebugLogging: { type: 'boolean', default: false },
          rerunFailedJobsOnly: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { owner, repo, runId } = request.params;
      const { enableDebugLogging, rerunFailedJobsOnly } = request.body;
      const installationId = await getInstallationIdFromAuth(request);
      
      const runIdNumber = parseInt(runId, 10);
      
      const result = rerunFailedJobsOnly
        ? await helpers.rerunFailedJobs(owner, repo, runIdNumber, installationId, {
            enableDebugLogging,
          })
        : await helpers.rerunWorkflow(owner, repo, runIdNumber, installationId, {
            enableDebugLogging,
          });

      return reply.code(201).send(result);

    } catch (error) {
      logger.error('Failed to rerun workflow', { error });
      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // Cancel workflow
  fastify.post<{
    Params: { owner: string; repo: string; runId: string };
  }>('/api/github/repos/:owner/:repo/actions/runs/:runId/cancel', {
    schema: {
      params: workflowRunParamsSchema.pick({ owner: true, repo: true, runId: true }),
    },
  }, async (request, reply) => {
    try {
      const { owner, repo, runId } = request.params;
      const installationId = await getInstallationIdFromAuth(request);
      
      const result = await helpers.cancelWorkflow(
        owner,
        repo,
        parseInt(runId, 10),
        installationId
      );

      return reply.code(202).send(result);

    } catch (error) {
      logger.error('Failed to cancel workflow', { error });
      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // =============================================================================
  // ARTIFACT MANAGEMENT API
  // =============================================================================

  // List artifacts
  fastify.get<{
    Params: { owner: string; repo: string; runId: string };
    Querystring: { page?: number; perPage?: number; name?: string; type?: string };
  }>('/api/github/repos/:owner/:repo/actions/runs/:runId/artifacts', {
    schema: {
      params: workflowRunParamsSchema.pick({ owner: true, repo: true, runId: true }),
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          perPage: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          name: { type: 'string' },
          type: { 
            type: 'string',
            enum: ['test-results', 'coverage-report', 'logs', 'screenshots'],
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { owner, repo, runId } = request.params;
      const { page = 1, perPage = 30, name, type } = request.query;
      const installationId = await getInstallationIdFromAuth(request);
      
      const artifacts = await helpers.listArtifacts(
        owner,
        repo,
        parseInt(runId, 10),
        installationId,
        { page, perPage, name }
      );

      // Filter by type if specified
      const filteredArtifacts = type
        ? artifacts.filter(artifact => artifact.type === type)
        : artifacts;

      return reply.send({
        success: true,
        data: filteredArtifacts,
        pagination: {
          page,
          perPage,
          totalCount: filteredArtifacts.length,
          totalPages: Math.ceil(filteredArtifacts.length / perPage),
        },
      });

    } catch (error) {
      logger.error('Failed to list artifacts', { error });
      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // Get artifact download URL
  fastify.get<{
    Params: { owner: string; repo: string; artifactId: string };
  }>('/api/github/repos/:owner/:repo/actions/artifacts/:artifactId/download-url', {
    schema: {
      params: {
        type: 'object',
        required: ['owner', 'repo', 'artifactId'],
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          artifactId: { type: 'string', pattern: '^\\d+$' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { owner, repo, artifactId } = request.params;
      const installationId = await getInstallationIdFromAuth(request);
      
      const result = await helpers.generateArtifactDownloadUrl(
        owner,
        repo,
        parseInt(artifactId, 10),
        installationId
      );

      return reply.send({
        success: true,
        data: result,
      });

    } catch (error) {
      logger.error('Failed to generate artifact download URL', { error });
      
      if ((error as any).message?.includes('expired')) {
        const errorResponse = errorFactory.create(
          ErrorCode.ARTIFACT_EXPIRED,
          'Artifact has expired and is no longer available'
        );
        return reply.code(410).send(errorResponse);
      }

      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // =============================================================================
  // FLAKE DETECTION API
  // =============================================================================

  // Get flake status for test
  fastify.get<{
    Params: { owner: string; repo: string };
    Querystring: { testName: string };
  }>('/api/github/repos/:owner/:repo/flakes/status', {
    schema: {
      params: repositoryParamsSchema.pick({ owner: true, repo: true }),
      querystring: {
        type: 'object',
        required: ['testName'],
        properties: {
          testName: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { owner, repo } = request.params;
      const { testName } = request.query;
      
      // Get repository record
      const repository = await prisma.repository.findFirst({
        where: { owner, name: repo },
      });

      if (!repository) {
        const errorResponse = errorFactory.notFound('Repository', `${owner}/${repo}`);
        return reply.code(404).send(errorResponse);
      }

      const flakeStatus = await flakeDetector.getFlakeStatus(testName, repository.id);

      return reply.send({
        success: true,
        data: flakeStatus,
      });

    } catch (error) {
      logger.error('Failed to get flake status', { error });
      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // Get repository flake summary
  fastify.get<{
    Params: { owner: string; repo: string };
  }>('/api/github/repos/:owner/:repo/flakes/summary', {
    schema: {
      params: repositoryParamsSchema.pick({ owner: true, repo: true }),
    },
  }, async (request, reply) => {
    try {
      const { owner, repo } = request.params;
      
      // Get repository record
      const repository = await prisma.repository.findFirst({
        where: { owner, name: repo },
      });

      if (!repository) {
        const errorResponse = errorFactory.notFound('Repository', `${owner}/${repo}`);
        return reply.code(404).send(errorResponse);
      }

      const summary = await flakeDetector.getRepositoryFlakeSummary(repository.id);

      return reply.send({
        success: true,
        data: summary,
      });

    } catch (error) {
      logger.error('Failed to get flake summary', { error });
      const errorResponse = errorFactory.fromError(error as Error);
      return reply.code(500).send(errorResponse);
    }
  });

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  /**
   * Extract installation ID from request authentication
   * In a real implementation, this would validate JWT or token
   */
  async function getInstallationIdFromAuth(request: FastifyRequest): Promise<number> {
    // Placeholder implementation
    // In practice, you would extract this from JWT claims or API key metadata
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // For now, assume installation ID is passed in header for simplicity
    const installationId = request.headers['x-installation-id'] as string;
    
    if (!installationId) {
      throw new Error('Missing installation ID');
    }

    return parseInt(installationId, 10);
  }

  /**
   * Map error codes to HTTP status codes
   */
  function getStatusCodeFromErrorCode(errorCode: ErrorCode): number {
    switch (errorCode) {
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.INVALID_PAYLOAD:
      case ErrorCode.MISSING_REQUIRED_FIELD:
        return 400;
      case ErrorCode.UNAUTHORIZED:
      case ErrorCode.INVALID_TOKEN:
      case ErrorCode.TOKEN_EXPIRED:
        return 401;
      case ErrorCode.FORBIDDEN:
      case ErrorCode.INSTALLATION_NOT_FOUND:
        return 403;
      case ErrorCode.RESOURCE_NOT_FOUND:
      case ErrorCode.CHECK_RUN_NOT_FOUND:
        return 404;
      case ErrorCode.RESOURCE_CONFLICT:
        return 409;
      case ErrorCode.ARTIFACT_EXPIRED:
        return 410;
      case ErrorCode.CHECK_RUN_ACTION_NOT_SUPPORTED:
        return 422;
      case ErrorCode.RATE_LIMITED:
      case ErrorCode.GITHUB_RATE_LIMITED:
        return 429;
      case ErrorCode.SERVICE_UNAVAILABLE:
      case ErrorCode.GITHUB_SERVICE_UNAVAILABLE:
        return 503;
      case ErrorCode.TIMEOUT:
        return 504;
      default:
        return 500;
    }
  }

  // Decorate the Fastify instance with GitHub services
  fastify.decorate('githubAuth', authManager);
  fastify.decorate('githubHelpers', helpers);

  logger.info('GitHub App plugin registered successfully', {
    webhookPath: '/api/github/webhook',
    supportedEvents: SUPPORTED_WEBHOOK_EVENTS,
  });
}

/**
 * Export plugin with fastify-plugin wrapper
 */
export default fp(githubAppPlugin, {
  name: 'github-app',
  dependencies: ['prisma'], // Depends on Prisma plugin
});