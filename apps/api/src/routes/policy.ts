/**
 * Policy API Routes
 * 
 * REST API endpoints for policy configuration and evaluation.
 * Provides endpoints for loading policy configs and evaluating
 * test results against policies.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { TestResult } from '@flakeguard/shared';
import { PolicyService } from '../policy/service.js';
import { validatePolicyConfig, createPolicyConfig } from '../policy/engine.js';
// Helper to extract installation ID from request
function extractInstallationIdFromRequest(request: FastifyRequest): number | null {
  // Try to get installation ID from headers (for GitHub App requests)
  const installationHeader = request.headers['x-github-installation-id'];
  if (installationHeader && typeof installationHeader === 'string') {
    const id = parseInt(installationHeader, 10);
    if (!isNaN(id)) {
      return id;
    }
  }

  // Try to get from query params (for API requests)
  const query = request.query as any;
  if (query?.installation_id) {
    const id = parseInt(query.installation_id, 10);
    if (!isNaN(id)) {
      return id;
    }
  }

  // Could also check JWT token or other auth mechanisms here
  return null;
}
import { logger } from '../utils/logger.js';

// Request/Response schemas
const evaluatePolicyRequestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  tests: z.array(z.object({
    name: z.string(),
    status: z.enum(['passed', 'failed', 'skipped', 'error']),
    duration: z.number().optional(),
    errorMessage: z.string().optional(),
    stackTrace: z.string().optional(),
    flakeAnalysis: z.object({
      isFlaky: z.boolean(),
      confidence: z.number().min(0).max(1),
      failurePattern: z.string().optional(),
      historicalFailures: z.number().int().min(0),
      totalRuns: z.number().int().min(1),
      failureRate: z.number().min(0).max(1),
      lastFailureAt: z.string().optional(),
      suggestedAction: z.enum(['quarantine', 'warn', 'ignore']).optional(),
    }).optional(),
  })),
  options: z.object({
    ref: z.string().optional(),
    teamContext: z.string().optional(),
    pullRequestLabels: z.array(z.string()).optional(),
  }).optional(),
});

const loadPolicyRequestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().optional(),
});

const validatePolicyRequestSchema = z.object({
  config: z.record(z.any()),
});

const invalidateCacheRequestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

/**
 * Register policy routes
 */
export async function policyRoutes(fastify: FastifyInstance) {
  const policyService = fastify.policyService as PolicyService;

  /**
   * POST /api/v1/policy/evaluate
   * Evaluate policy for a set of test results
   */
  fastify.post<{
    Body: z.infer<typeof evaluatePolicyRequestSchema>;
  }>('/api/v1/policy/evaluate', {
    schema: {
      tags: ['Policy'],
      summary: 'Evaluate policy for test results',
      description: 'Evaluate policy configuration against a set of test results and return recommendations',
      body: {
        type: 'object',
        required: ['owner', 'repo', 'tests'],
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          tests: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'status'],
              properties: {
                name: { type: 'string' },
                status: { type: 'string', enum: ['passed', 'failed', 'skipped', 'error'] },
                duration: { type: 'number' },
                errorMessage: { type: 'string' },
                stackTrace: { type: 'string' },
                flakeAnalysis: {
                  type: 'object',
                  properties: {
                    isFlaky: { type: 'boolean' },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    historicalFailures: { type: 'integer', minimum: 0 },
                    totalRuns: { type: 'integer', minimum: 1 },
                    failureRate: { type: 'number', minimum: 0, maximum: 1 },
                  },
                },
              },
            },
          },
          options: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              teamContext: { type: 'string' },
              pullRequestLabels: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                repositoryId: { type: 'string' },
                policySource: { type: 'string', enum: ['file', 'defaults', 'env'] },
                decisions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      testName: { type: 'string' },
                      action: { type: 'string', enum: ['none', 'warn', 'quarantine'] },
                      reason: { type: 'string' },
                      confidence: { type: 'number' },
                      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                    },
                  },
                },
                evaluatedAt: { type: 'string', format: 'date-time' },
                summary: {
                  type: 'object',
                  properties: {
                    totalTests: { type: 'integer' },
                    actionsRecommended: { type: 'integer' },
                    quarantineCandidates: { type: 'integer' },
                    warnings: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    
    try {
      // Validate request body
      const validatedRequest = evaluatePolicyRequestSchema.parse(request.body);
      
      // Extract installation ID from webhook headers or auth
      const installationId = extractInstallationIdFromRequest(request);
      if (!installationId) {
        return reply.code(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing or invalid GitHub installation ID',
          },
        });
      }

      logger.info('Policy evaluation request received', {
        repository: `${validatedRequest.owner}/${validatedRequest.repo}`,
        testCount: validatedRequest.tests.length,
        installationId,
        userAgent: request.headers['user-agent'],
      });

      // Evaluate policy
      const result = await policyService.evaluatePolicy({
        owner: validatedRequest.owner,
        repo: validatedRequest.repo,
        tests: validatedRequest.tests as TestResult[],
        options: validatedRequest.options,
      }, installationId);

      const duration = Date.now() - startTime;
      
      if (result.success) {
        logger.info('Policy evaluation completed successfully', {
          repository: `${validatedRequest.owner}/${validatedRequest.repo}`,
          duration,
          decisions: result.data!.summary,
        });
        
        return reply.code(200).send(result);
      } else {
        logger.warn('Policy evaluation failed', {
          repository: `${validatedRequest.owner}/${validatedRequest.repo}`,
          duration,
          error: result.error,
        });
        
        const statusCode = getHttpStatusFromErrorCode(result.error!.code);
        return reply.code(statusCode).send(result);
      }

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      logger.error('Policy evaluation endpoint error', {
        duration,
        error: error.message,
        stack: error.stack,
      });

      if (error.name === 'ZodError') {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request format',
            details: error.errors,
          },
        });
      }

      return reply.code(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
    }
  });

  /**
   * GET /api/v1/policy/load
   * Load policy configuration for a repository
   */
  fastify.get<{
    Querystring: z.infer<typeof loadPolicyRequestSchema>;
  }>('/api/v1/policy/load', {
    schema: {
      tags: ['Policy'],
      summary: 'Load policy configuration',
      description: 'Load policy configuration from repository .flakeguard.yml or defaults',
      querystring: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          ref: { type: 'string', description: 'Git reference (branch/tag/commit)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                config: { type: 'object' },
                source: { type: 'string', enum: ['file', 'defaults', 'env'] },
                metadata: {
                  type: 'object',
                  properties: {
                    loadedAt: { type: 'string', format: 'date-time' },
                    repository: { type: 'string' },
                    ref: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Validate query parameters
      const validatedRequest = loadPolicyRequestSchema.parse(request.query);
      
      // Extract installation ID
      const installationId = extractInstallationIdFromRequest(request);
      if (!installationId) {
        return reply.code(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing or invalid GitHub installation ID',
          },
        });
      }

      logger.info('Policy load request received', {
        repository: `${validatedRequest.owner}/${validatedRequest.repo}`,
        ref: validatedRequest.ref,
        installationId,
      });

      // Load policy configuration
      const result = await policyService.loadPolicy(validatedRequest, installationId);

      if (result.success) {
        logger.info('Policy configuration loaded successfully', {
          repository: `${validatedRequest.owner}/${validatedRequest.repo}`,
          source: result.data!.source,
        });
        
        return reply.code(200).send(result);
      } else {
        logger.warn('Policy load failed', {
          repository: `${validatedRequest.owner}/${validatedRequest.repo}`,
          error: result.error,
        });
        
        const statusCode = getHttpStatusFromErrorCode(result.error!.code);
        return reply.code(statusCode).send(result);
      }

    } catch (error: any) {
      logger.error('Policy load endpoint error', {
        error: error.message,
        stack: error.stack,
      });

      if (error.name === 'ZodError') {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: error.errors,
          },
        });
      }

      return reply.code(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
    }
  });

  /**
   * POST /api/v1/policy/validate
   * Validate policy configuration
   */
  fastify.post<{
    Body: z.infer<typeof validatePolicyRequestSchema>;
  }>('/api/v1/policy/validate', {
    schema: {
      tags: ['Policy'],
      summary: 'Validate policy configuration',
      description: 'Validate a policy configuration object against the schema',
      body: {
        type: 'object',
        required: ['config'],
        properties: {
          config: {
            type: 'object',
            description: 'Policy configuration to validate',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                valid: { type: 'boolean' },
                config: { type: 'object' },
                errors: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedRequest = validatePolicyRequestSchema.parse(request.body);
      
      logger.debug('Policy validation request received', {
        hasConfig: !!validatedRequest.config,
      });

      // Validate the policy configuration
      const validation = validatePolicyConfig(validatedRequest.config);
      
      return reply.code(200).send({
        success: true,
        data: {
          valid: validation.success,
          config: validation.data,
          errors: validation.errors,
        },
      });

    } catch (error: any) {
      logger.error('Policy validation endpoint error', {
        error: error.message,
      });

      if (error.name === 'ZodError') {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request format',
            details: error.errors,
          },
        });
      }

      return reply.code(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
    }
  });

  /**
   * DELETE /api/v1/policy/cache
   * Invalidate policy cache for a repository
   */
  fastify.delete<{
    Body: z.infer<typeof invalidateCacheRequestSchema>;
  }>('/api/v1/policy/cache', {
    schema: {
      tags: ['Policy'],
      summary: 'Invalidate policy cache',
      description: 'Clear cached policy configuration for a repository',
      body: {
        type: 'object',
        required: ['owner', 'repo'],
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
        },
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
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const validatedRequest = invalidateCacheRequestSchema.parse(request.body);
      
      logger.info('Policy cache invalidation request received', {
        repository: `${validatedRequest.owner}/${validatedRequest.repo}`,
      });

      // Invalidate cache
      await policyService.invalidatePolicyCache(
        validatedRequest.owner,
        validatedRequest.repo
      );
      
      return reply.code(200).send({
        success: true,
        message: `Policy cache invalidated for ${validatedRequest.owner}/${validatedRequest.repo}`,
      });

    } catch (error: any) {
      logger.error('Policy cache invalidation endpoint error', {
        error: error.message,
      });

      if (error.name === 'ZodError') {
        return reply.code(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request format',
            details: error.errors,
          },
        });
      }

      return reply.code(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
    }
  });

  /**
   * GET /api/v1/policy/stats
   * Get policy engine statistics
   */
  fastify.get('/api/v1/policy/stats', {
    schema: {
      tags: ['Policy'],
      summary: 'Get policy engine statistics',
      description: 'Get policy cache and evaluation statistics',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                cache: {
                  type: 'object',
                  properties: {
                    size: { type: 'integer' },
                    expired: { type: 'integer' },
                    hitsBySource: { type: 'object' },
                  },
                },
                timestamp: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = policyService.getPolicyStats();
      
      return reply.code(200).send({
        success: true,
        data: {
          cache: stats,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      logger.error('Policy stats endpoint error', {
        error: error.message,
      });

      return reply.code(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
    }
  });
}

/**
 * Map error codes to HTTP status codes
 */
function getHttpStatusFromErrorCode(errorCode: string): number {
  switch (errorCode) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION_ERROR':
      return 400;
    case 'GITHUB_API_ERROR':
      return 502;
    default:
      return 500;
  }
}
