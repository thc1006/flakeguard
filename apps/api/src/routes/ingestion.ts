/**
 * Ingestion API Routes
 * 
 * RESTful endpoints for JUnit artifact ingestion management including:
 * - Manual ingestion triggering with comprehensive validation
 * - Asynchronous job status monitoring and progress tracking
 * - Ingestion history with advanced filtering and pagination
 * - Error handling with detailed diagnostics and recovery options
 * - OpenAPI documentation with examples and schemas
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type, Static } from '@sinclair/typebox';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { 
  GitHubArtifactsIntegration,
  createGitHubArtifactsIntegration,
  ArtifactFilter,
  IngestionJobConfig,
  validateArtifactFilter
} from '../ingestion/github-integration.js';
import { JUnitIngestionService } from '../ingestion/junit.js';
import { GitHubAuthManager } from '../github/auth.js';
import { GitHubHelpers } from '../github/helpers.js';
import { generateCorrelationId } from '../ingestion/utils.js';
import { QueueNames, JobPriorities } from '@flakeguard/shared';
import { logger } from '../utils/logger.js';

// ============================================================================
// Request/Response Schemas
// ============================================================================

// Process Artifacts Request Schema
const ProcessArtifactsRequestSchema = Type.Object({
  workflowRunId: Type.Number({ 
    minimum: 1,
    description: 'GitHub workflow run ID to process artifacts from'
  }),
  repository: Type.Object({
    owner: Type.String({ 
      minLength: 1,
      description: 'Repository owner (organization or user)'
    }),
    repo: Type.String({ 
      minLength: 1,
      description: 'Repository name'
    })
  }),
  installationId: Type.Number({ 
    minimum: 1,
    description: 'GitHub App installation ID'
  }),
  filter: Type.Optional(Type.Object({
    namePatterns: Type.Optional(Type.Array(Type.String(), {
      description: 'Artifact name patterns to match'
    })),
    extensions: Type.Optional(Type.Array(Type.String(), {
      description: 'File extensions to include (e.g., [".xml", ".zip"])'
    })),
    maxSizeBytes: Type.Optional(Type.Number({ 
      minimum: 1,
      description: 'Maximum artifact size in bytes'
    })),
    minSizeBytes: Type.Optional(Type.Number({ 
      minimum: 0,
      description: 'Minimum artifact size in bytes'
    })),
    notExpired: Type.Optional(Type.Boolean({
      description: 'Only include non-expired artifacts'
    }))
  })),
  priority: Type.Optional(Type.Union([
    Type.Literal('low'),
    Type.Literal('normal'),
    Type.Literal('high'),
    Type.Literal('critical')
  ], {
    description: 'Job processing priority',
    default: 'normal'
  })),
  correlationId: Type.Optional(Type.String({
    description: 'Optional correlation ID for tracking'
  }))
});

// Process Artifacts Response Schema
const ProcessArtifactsResponseSchema = Type.Object({
  jobId: Type.String({ description: 'Unique job identifier' }),
  status: Type.Literal('queued'),
  message: Type.String(),
  correlationId: Type.String(),
  estimatedCompletionTime: Type.String({ format: 'date-time' }),
  statusUrl: Type.String({ description: 'URL to check job status' }),
  artifactCount: Type.Number({ description: 'Number of artifacts to process' })
});

// Job Status Response Schema
const JobStatusResponseSchema = Type.Object({
  jobId: Type.String(),
  status: Type.Union([
    Type.Literal('queued'),
    Type.Literal('processing'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled')
  ]),
  progress: Type.Optional(Type.Object({
    phase: Type.Union([
      Type.Literal('download'),
      Type.Literal('extract'),
      Type.Literal('parse'),
      Type.Literal('complete')
    ]),
    processed: Type.Number(),
    total: Type.Number(),
    percentage: Type.Number({ minimum: 0, maximum: 100 })
  })),
  result: Type.Optional(Type.Object({
    success: Type.Boolean(),
    processedArtifacts: Type.Number(),
    totalTests: Type.Number(),
    totalFailures: Type.Number(),
    totalErrors: Type.Number(),
    processingTimeMs: Type.Number(),
    errors: Type.Array(Type.String())
  })),
  createdAt: Type.String({ format: 'date-time' }),
  startedAt: Type.Optional(Type.String({ format: 'date-time' })),
  completedAt: Type.Optional(Type.String({ format: 'date-time' })),
  errorMessage: Type.Optional(Type.String())
});

// Ingestion History Query Schema
const IngestionHistoryQuerySchema = Type.Object({
  repository: Type.Optional(Type.String({ description: 'Filter by repository (owner/repo)' })),
  status: Type.Optional(Type.Union([
    Type.Literal('queued'),
    Type.Literal('processing'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled')
  ])),
  fromDate: Type.Optional(Type.String({ 
    format: 'date',
    description: 'Filter jobs from this date (ISO format)'
  })),
  toDate: Type.Optional(Type.String({ 
    format: 'date',
    description: 'Filter jobs to this date (ISO format)'
  })),
  limit: Type.Optional(Type.Number({ 
    minimum: 1,
    maximum: 100,
    default: 20,
    description: 'Number of results to return'
  })),
  offset: Type.Optional(Type.Number({ 
    minimum: 0,
    default: 0,
    description: 'Number of results to skip'
  })),
  orderBy: Type.Optional(Type.Union([
    Type.Literal('createdAt'),
    Type.Literal('completedAt'),
    Type.Literal('testCount'),
    Type.Literal('processingTime')
  ], { default: 'createdAt' })),
  orderDirection: Type.Optional(Type.Union([
    Type.Literal('asc'),
    Type.Literal('desc')
  ], { default: 'desc' }))
});

// Ingestion History Response Schema
const IngestionHistoryResponseSchema = Type.Object({
  jobs: Type.Array(JobStatusResponseSchema),
  pagination: Type.Object({
    total: Type.Number(),
    limit: Type.Number(),
    offset: Type.Number(),
    hasMore: Type.Boolean()
  })
});

// Type definitions
type ProcessArtifactsRequest = Static<typeof ProcessArtifactsRequestSchema>;
type ProcessArtifactsResponse = Static<typeof ProcessArtifactsResponseSchema>;
type JobStatusResponse = Static<typeof JobStatusResponseSchema>;
type IngestionHistoryQuery = Static<typeof IngestionHistoryQuerySchema>;
type IngestionHistoryResponse = Static<typeof IngestionHistoryResponseSchema>;

// ============================================================================
// Route Handler Class
// ============================================================================

class IngestionRouteHandler {
  private readonly prisma: PrismaClient;
  private readonly ingestionQueue: Queue;
  private readonly authManager: GitHubAuthManager;
  private readonly helpers: GitHubHelpers;
  private readonly artifactsIntegration: GitHubArtifactsIntegration;

  constructor(
    prisma: PrismaClient,
    ingestionQueue: Queue,
    authManager: GitHubAuthManager,
    helpers: GitHubHelpers
  ) {
    this.prisma = prisma;
    this.ingestionQueue = ingestionQueue;
    this.authManager = authManager;
    this.helpers = helpers;
    
    // Create artifacts integration
    const ingestionService = new JUnitIngestionService();
    this.artifactsIntegration = createGitHubArtifactsIntegration(
      authManager,
      helpers,
      ingestionService,
      prisma
    );
  }

  // ==========================================================================
  // Route Handlers
  // ==========================================================================

  /**
   * POST /api/ingestion/process
   * Process artifacts for a workflow run
   */
  async processArtifacts(
    request: FastifyRequest<{ Body: ProcessArtifactsRequest }>,
    reply: FastifyReply
  ): Promise<ProcessArtifactsResponse> {
    const { body } = request;
    const correlationId = body.correlationId || generateCorrelationId();
    
    logger.info('Processing artifacts request', {
      correlationId,
      workflowRunId: body.workflowRunId,
      repository: body.repository
    });

    try {
      // Validate request
      await this.validateProcessRequest(body);

      // Check if job already exists for this workflow run
      const existingJob = await this.findExistingJob(
        body.workflowRunId,
        body.repository.owner,
        body.repository.repo
      );

      if (existingJob && ['queued', 'processing'].includes(existingJob.status)) {
        return {
          jobId: existingJob.id,
          status: 'queued',
          message: 'Job already queued for this workflow run',
          correlationId: existingJob.correlationId || correlationId,
          estimatedCompletionTime: new Date(
            existingJob.createdAt.getTime() + 10 * 60 * 1000
          ).toISOString(),
          statusUrl: `/api/ingestion/status/${existingJob.id}`,
          artifactCount: existingJob.artifactCount || 0
        };
      }

      // Preview artifacts to get count
      const artifactsPreview = await this.artifactsIntegration.listWorkflowArtifacts(
        body.repository.owner,
        body.repository.repo,
        body.workflowRunId,
        body.installationId,
        body.filter
      );

      if (artifactsPreview.totalCount === 0) {
        await reply.status(404);
        throw new Error('No test artifacts found for the specified workflow run');
      }

      // Create job configuration
      const jobConfig: IngestionJobConfig = {
        workflowRunId: body.workflowRunId,
        repository: body.repository,
        installationId: body.installationId,
        filter: body.filter,
        correlationId,
        priority: body.priority || 'normal'
      };

      // Queue the job
      const jobId = await this.queueIngestionJob(jobConfig, artifactsPreview.totalCount);

      const estimatedCompletionTime = new Date(
        Date.now() + Math.max(2 * 60 * 1000, artifactsPreview.totalCount * 30 * 1000)
      );

      logger.info('Ingestion job queued', {
        jobId,
        correlationId,
        artifactCount: artifactsPreview.totalCount
      });

      return {
        jobId,
        status: 'queued',
        message: `Queued processing of ${artifactsPreview.totalCount} artifacts`,
        correlationId,
        estimatedCompletionTime: estimatedCompletionTime.toISOString(),
        statusUrl: `/api/ingestion/status/${jobId}`,
        artifactCount: artifactsPreview.totalCount
      };

    } catch (error: any) {
      logger.error('Failed to process artifacts request', {
        correlationId,
        error: error.message
      });

      const statusCode = error.message.includes('not found') ? 404 : 400;
      await reply.status(statusCode);
      
      throw error;
    }
  }

  /**
   * GET /api/ingestion/status/:jobId
   * Check ingestion job status
   */
  async getJobStatus(
    request: FastifyRequest<{ Params: { jobId: string } }>,
    reply: FastifyReply
  ): Promise<JobStatusResponse> {
    const { jobId } = request.params;
    
    logger.debug('Getting job status', { jobId });

    try {
      // Get job from database
      const job = await this.prisma.ingestionJob.findUnique({
        where: { id: jobId }
      });

      if (!job) {
        await reply.status(404);
        throw new Error(`Job not found: ${jobId}`);
      }

      // Get additional status from queue if job is active
      let queueJob = null;
      if (['queued', 'processing'].includes(job.status)) {
        try {
          queueJob = await this.ingestionQueue.getJob(jobId);
        } catch {
          // Job might not be in queue anymore
        }
      }

      const response: JobStatusResponse = {
        jobId: job.id,
        status: job.status as any,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        errorMessage: job.errorMessage || undefined
      };

      // Add progress information if available
      if (queueJob?.progress) {
        const progress = queueJob.progress as any;
        response.progress = {
          phase: progress.phase || 'processing',
          processed: progress.processed || 0,
          total: progress.total || 1,
          percentage: Math.round(((progress.processed || 0) / (progress.total || 1)) * 100)
        };
      }

      // Add result information if completed
      if (job.status === 'completed' || job.status === 'failed') {
        response.result = {
          success: job.status === 'completed',
          processedArtifacts: job.artifactCount || 0,
          totalTests: job.testCount || 0,
          totalFailures: job.failureCount || 0,
          totalErrors: job.errorCount || 0,
          processingTimeMs: job.processingTimeMs || 0,
          errors: (job.metadata as any)?.errors || []
        };
      }

      return response;

    } catch (error: any) {
      logger.error('Failed to get job status', {
        jobId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * GET /api/ingestion/history
   * List ingestion history with pagination
   */
  async getIngestionHistory(
    request: FastifyRequest<{ Querystring: IngestionHistoryQuery }>,
    reply: FastifyReply
  ): Promise<IngestionHistoryResponse> {
    const query = request.query;
    
    logger.debug('Getting ingestion history', { query });

    try {
      // Build where clause
      const where: any = {};
      
      if (query.repository) {
        const [owner, repo] = query.repository.split('/');
        if (owner && repo) {
          where.repository = {
            owner,
            name: repo
          };
        }
      }

      if (query.status) {
        where.status = query.status;
      }

      if (query.fromDate || query.toDate) {
        where.createdAt = {};
        if (query.fromDate) {
          where.createdAt.gte = new Date(query.fromDate);
        }
        if (query.toDate) {
          where.createdAt.lte = new Date(query.toDate + 'T23:59:59.999Z');
        }
      }

      // Get total count
      const totalCount = await this.prisma.ingestionJob.count({ where });

      // Get paginated results
      const limit = query.limit || 20;
      const offset = query.offset || 0;
      const orderBy = query.orderBy || 'createdAt';
      const orderDirection = query.orderDirection || 'desc';

      const jobs = await this.prisma.ingestionJob.findMany({
        where,
        orderBy: { [orderBy]: orderDirection },
        take: limit,
        skip: offset,
        include: {
          repository: {
            select: {
              owner: true,
              name: true,
              fullName: true
            }
          }
        }
      });

      // Convert to response format
      const jobResponses: JobStatusResponse[] = jobs.map(job => ({
        jobId: job.id,
        status: job.status as any,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        errorMessage: job.errorMessage || undefined,
        result: job.status === 'completed' || job.status === 'failed' ? {
          success: job.status === 'completed',
          processedArtifacts: job.artifactCount || 0,
          totalTests: job.testCount || 0,
          totalFailures: job.failureCount || 0,
          totalErrors: job.errorCount || 0,
          processingTimeMs: job.processingTimeMs || 0,
          errors: (job.metadata as any)?.errors || []
        } : undefined
      }));

      return {
        jobs: jobResponses,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount
        }
      };

    } catch (error: any) {
      logger.error('Failed to get ingestion history', {
        query,
        error: error.message
      });
      
      throw error;
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Validate process request
   */
  private async validateProcessRequest(request: ProcessArtifactsRequest): Promise<void> {
    const errors: string[] = [];

    // Validate workflow run exists and is accessible
    try {
      const client = await this.authManager.getInstallationClient(request.installationId);
      await client.rest.actions.getWorkflowRun({
        owner: request.repository.owner,
        repo: request.repository.repo,
        run_id: request.workflowRunId
      });
    } catch (error: any) {
      if (error.status === 404) {
        errors.push('Workflow run not found or not accessible');
      } else {
        errors.push('Failed to validate workflow run access');
      }
    }

    // Validate artifact filter
    if (request.filter) {
      const filterErrors = validateArtifactFilter(request.filter);
      errors.push(...filterErrors);
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Find existing job for workflow run
   */
  private async findExistingJob(
    workflowRunId: number,
    owner: string,
    repo: string
  ): Promise<any> {
    return this.prisma.ingestionJob.findFirst({
      where: {
        workflowRunId: workflowRunId.toString(),
        repository: {
          owner,
          name: repo
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  /**
   * Queue ingestion job
   */
  private async queueIngestionJob(
    config: IngestionJobConfig,
    artifactCount: number
  ): Promise<string> {
    const jobId = config.correlationId || generateCorrelationId();
    
    // Create database record
    await this.prisma.ingestionJob.create({
      data: {
        id: jobId,
        repositoryId: await this.getRepositoryId(config.repository, config.installationId),
        workflowRunId: config.workflowRunId.toString(),
        status: 'queued',
        artifactCount,
        correlationId: config.correlationId,
        metadata: {
          filter: config.filter,
          priority: config.priority
        },
        createdAt: new Date()
      }
    });

    // Add to queue
    await this.ingestionQueue.add(
      'process-artifacts',
      config,
      {
        jobId,
        priority: this.getPriorityValue(config.priority || 'normal'),
        delay: 0,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    );

    return jobId;
  }

  /**
   * Get repository ID
   */
  private async getRepositoryId(
    repository: { owner: string; repo: string },
    installationId: number
  ): Promise<string> {
    const repo = await this.prisma.repository.findFirst({
      where: {
        owner: repository.owner,
        name: repository.repo,
        installationId: installationId.toString()
      }
    });

    if (!repo) {
      throw new Error(`Repository ${repository.owner}/${repository.repo} not found`);
    }

    return repo.id;
  }

  /**
   * Convert priority to numeric value
   */
  private getPriorityValue(priority: string): number {
    switch (priority) {
      case 'critical':
        return JobPriorities.CRITICAL;
      case 'high':
        return JobPriorities.HIGH;
      case 'normal':
        return JobPriorities.NORMAL;
      case 'low':
        return JobPriorities.LOW;
      default:
        return JobPriorities.NORMAL;
    }
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export async function ingestionRoutes(
  fastify: FastifyInstance,
  options: {
    prefix?: string;
  } = {}
): Promise<void> {
  const prisma = fastify.prisma;
  const authManager = fastify.githubAuth;
  const helpers = fastify.githubHelpers;
  const ingestionQueue = fastify.ingestionQueue;

  const handler = new IngestionRouteHandler(
    prisma,
    ingestionQueue,
    authManager,
    helpers
  );

  // Register schemas for OpenAPI documentation
  fastify.addSchema({
    $id: 'ProcessArtifactsRequest',
    ...ProcessArtifactsRequestSchema
  });

  fastify.addSchema({
    $id: 'ProcessArtifactsResponse',
    ...ProcessArtifactsResponseSchema
  });

  fastify.addSchema({
    $id: 'JobStatusResponse',
    ...JobStatusResponseSchema
  });

  fastify.addSchema({
    $id: 'IngestionHistoryResponse',
    ...IngestionHistoryResponseSchema
  });

  // Process artifacts endpoint
  fastify.post('/process', {
    schema: {
      description: 'Process GitHub Actions artifacts for JUnit ingestion',
      tags: ['ingestion'],
      body: { $ref: 'ProcessArtifactsRequest#' },
      response: {
        200: { $ref: 'ProcessArtifactsResponse#' },
        400: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, handler.processArtifacts.bind(handler));

  // Job status endpoint
  fastify.get('/status/:jobId', {
    schema: {
      description: 'Get ingestion job status and progress',
      tags: ['ingestion'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Job identifier' }
        }
      },
      response: {
        200: { $ref: 'JobStatusResponse#' },
        404: {
          type: 'object',
          properties: {
            statusCode: { type: 'number' },
            error: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  }, handler.getJobStatus.bind(handler));

  // Ingestion history endpoint
  fastify.get('/history', {
    schema: {
      description: 'Get ingestion job history with filtering and pagination',
      tags: ['ingestion'],
      querystring: IngestionHistoryQuerySchema,
      response: {
        200: { $ref: 'IngestionHistoryResponse#' }
      }
    }
  }, handler.getIngestionHistory.bind(handler));

  logger.info('Ingestion routes registered');
}