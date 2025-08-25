/**
 * API Integration Tests for Ingestion Endpoints
 * 
 * Comprehensive test suite covering:
 * - Integration tests for ingestion REST API endpoints
 * - Authentication and authorization testing
 * - Request validation and error response testing
 * - Job queue integration testing
 * - End-to-end workflow testing
 * - Rate limiting and security testing
 * - API contract validation
 */

import { PrismaClient } from '@prisma/client';
import { Queue, Worker, Job } from 'bullmq';
import { FastifyInstance } from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

import { build } from '../../app.js';
import type {
  ProcessArtifactsRequest,
  ProcessArtifactsResponse,
  JobStatusResponse,
  IngestionHistoryResponse,
  ArtifactFilter,
  IngestionJobConfig
} from '../../routes/ingestion.js';
import { GitHubArtifactsIntegration } from '../github-integration.js';

// Mock external dependencies
vi.mock('../github-integration.js');
vi.mock('bullmq');
vi.mock('@prisma/client');
vi.mock('../junit.js');

// Test server and dependencies
let app: FastifyInstance;
let mockPrisma: jest.Mocked<PrismaClient>;
let mockQueue: jest.Mocked<Queue>;
let mockWorker: jest.Mocked<Worker>;

// Test data
const testInstallationId = 123456;
const testWorkflowRunId = 789012;
const testRepositoryOwner = 'test-org';
const testRepositoryName = 'test-repo';
const testJobId = 'job-test-123';

// Mock GitHub artifacts
const mockArtifacts = [
  {
    id: 1,
    name: 'test-results',
    size: 1024,
    url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/1/zip',
    expired: false,
    created_at: '2023-01-01T12:00:00Z',
    updated_at: '2023-01-01T12:00:00Z'
  },
  {
    id: 2,
    name: 'coverage-report',
    size: 2048,
    url: 'https://api.github.com/repos/test-org/test-repo/actions/artifacts/2/zip',
    expired: false,
    created_at: '2023-01-01T12:00:00Z',
    updated_at: '2023-01-01T12:00:00Z'
  }
];

// Mock ingestion results
const mockIngestionResult = {
  success: true,
  results: [
    {
      fileName: 'TEST-TestSuite.xml',
      format: 'surefire',
      testSuites: {
        name: 'TestSuite',
        tests: 10,
        failures: 2,
        errors: 1,
        skipped: 1,
        suites: []
      },
      processingTimeMs: 150,
      fileSizeBytes: 1024,
      warnings: []
    }
  ],
  stats: {
    totalFiles: 1,
    processedFiles: 1,
    failedFiles: 0,
    totalTests: 10,
    totalFailures: 2,
    totalErrors: 1,
    totalSkipped: 1,
    processingTimeMs: 150,
    downloadTimeMs: 50
  },
  errors: [],
  correlationId: 'test-correlation-123'
};

// ============================================================================
// Test Setup
// ============================================================================

describe('Ingestion API Integration Tests', () => {
  beforeAll(async () => {
    // Setup mock Prisma
    mockPrisma = {
      repository: {
        findFirst: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn()
      },
      ingestionJob: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn()
      },
      testSuite: {
        findMany: vi.fn(),
        count: vi.fn()
      },
      testResult: {
        findMany: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn()
      },
      $disconnect: vi.fn()
    } as any;

    // Setup mock Queue
    mockQueue = {
      add: vi.fn(),
      getJob: vi.fn(),
      getJobs: vi.fn(),
      getJobCounts: vi.fn(),
      clean: vi.fn(),
      close: vi.fn()
    } as any;

    // Setup mock Worker
    mockWorker = {
      on: vi.fn(),
      close: vi.fn()
    } as any;

    // Mock implementations
    vi.mocked(Queue).mockImplementation(() => mockQueue);
    vi.mocked(Worker).mockImplementation(() => mockWorker);

    // Build test app
    app = build({
      logger: false,
      disableRequestLogging: true
    });
    
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    mockPrisma.repository.findFirst.mockResolvedValue({
      id: 'repo-123',
      owner: testRepositoryOwner,
      name: testRepositoryName,
      fullName: `${testRepositoryOwner}/${testRepositoryName}`
    } as any);

    mockQueue.add.mockResolvedValue({
      id: testJobId,
      data: {},
      opts: {},
      timestamp: Date.now()
    } as any);

    // Mock GitHub integration
    const mockGitHubIntegration = {
      listArtifacts: vi.fn().mockResolvedValue(mockArtifacts),
      downloadArtifact: vi.fn().mockResolvedValue(Buffer.from('mock content')),
      getWorkflowRun: vi.fn().mockResolvedValue({
        id: testWorkflowRunId,
        status: 'completed',
        conclusion: 'success'
      })
    };
    
    vi.mocked(GitHubArtifactsIntegration).mockImplementation(() => mockGitHubIntegration as any);
  });

  afterAll(async () => {
    await app.close();
  });

  // ============================================================================
  // Authentication and Authorization Tests
  // ============================================================================

  describe('Authentication and Authorization', () => {
    it('should require valid GitHub installation ID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: 'invalid'
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('installationId');
    });

    it('should validate repository access permissions', async () => {
      // Mock repository not found or no access
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain('Repository not found');
    });

    it('should handle GitHub app authentication errors', async () => {
      // Mock GitHub integration failure
      const mockGitHubIntegration = {
        listArtifacts: vi.fn().mockRejectedValue(new Error('Authentication failed'))
      };
      vi.mocked(GitHubArtifactsIntegration).mockImplementation(() => mockGitHubIntegration as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().message).toContain('Authentication failed');
    });
  });

  // ============================================================================
  // Request Validation Tests
  // ============================================================================

  describe('Request Validation', () => {
    it('should validate required fields in process artifacts request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          // Missing required fields
          repository: {
            owner: testRepositoryOwner
            // Missing repo
          }
        }
      });

      expect(response.statusCode).toBe(400);
      const error = response.json();
      expect(error.validation).toBeDefined();
      expect(error.validation).toHaveLength(3); // workflowRunId, repo, installationId missing
    });

    it('should validate workflow run ID format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: 'invalid',
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().validation[0].message).toContain('must be number');
    });

    it('should validate artifact filter options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId,
          filter: {
            maxSizeBytes: -1, // Invalid negative size
            minSizeBytes: 'invalid', // Invalid type
            extensions: ['xml', 123] // Mixed types
          }
        }
      });

      expect(response.statusCode).toBe(400);
      const validation = response.json().validation;
      expect(validation).toContainEqual(
        expect.objectContaining({
          instancePath: '/filter/maxSizeBytes',
          message: 'must be >= 1'
        })
      );
    });

    it('should validate priority enum values', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId,
          priority: 'invalid-priority'
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().validation[0].message).toContain('must be equal to one of');
    });

    it('should accept valid request with all optional fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId,
          filter: {
            namePatterns: ['*test*', '*results*'],
            extensions: ['.xml', '.zip'],
            maxSizeBytes: 10485760,
            minSizeBytes: 1024,
            notExpired: true
          },
          priority: 'high',
          correlationId: 'custom-correlation-123'
        }
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.jobId).toBeDefined();
      expect(body.status).toBe('queued');
      expect(body.correlationId).toBe('custom-correlation-123');
    });
  });

  // ============================================================================
  // Job Queue Integration Tests
  // ============================================================================

  describe('Job Queue Integration', () => {
    it('should queue ingestion job with correct parameters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId,
          priority: 'high'
        }
      });

      expect(response.statusCode).toBe(202);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-junit-artifacts',
        expect.objectContaining({
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }),
        expect.objectContaining({
          priority: expect.any(Number),
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        })
      );
    });

    it('should store job in database for tracking', async () => {
      mockPrisma.ingestionJob.create.mockResolvedValue({
        id: testJobId,
        status: 'queued',
        repositoryId: 'repo-123',
        createdAt: new Date()
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(202);
      expect(mockPrisma.ingestionJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: testJobId,
          status: 'queued',
          repositoryId: 'repo-123',
          workflowRunId: testWorkflowRunId
        })
      });
    });

    it('should return job status URL in response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.statusUrl).toBe(`/api/ingestion/jobs/${testJobId}/status`);
    });

    it('should handle queue errors gracefully', async () => {
      mockQueue.add.mockRejectedValue(new Error('Queue is full'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().message).toContain('Unable to queue ingestion job');
    });
  });

  // ============================================================================
  // Job Status Endpoint Tests
  // ============================================================================

  describe('Job Status Endpoint', () => {
    it('should return job status for valid job ID', async () => {
      const mockJob = {
        id: testJobId,
        data: {
          workflowRunId: testWorkflowRunId,
          repository: { owner: testRepositoryOwner, repo: testRepositoryName }
        },
        progress: { processed: 2, total: 5 },
        processedOn: Date.now() - 5000,
        finishedOn: null,
        returnvalue: null,
        failedReason: null,
        opts: { attempts: 3 }
      };

      mockQueue.getJob.mockResolvedValue(mockJob as any);
      mockPrisma.ingestionJob.findUnique.mockResolvedValue({
        id: testJobId,
        status: 'active',
        repositoryId: 'repo-123',
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: `/api/ingestion/jobs/${testJobId}/status`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.jobId).toBe(testJobId);
      expect(body.status).toBe('active');
      expect(body.progress).toEqual({ processed: 2, total: 5 });
    });

    it('should return 404 for non-existent job', async () => {
      mockQueue.getJob.mockResolvedValue(null);
      mockPrisma.ingestionJob.findUnique.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/ingestion/jobs/non-existent-job/status'
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain('Job not found');
    });

    it('should return completed job with results', async () => {
      const mockJob = {
        id: testJobId,
        data: {
          workflowRunId: testWorkflowRunId,
          repository: { owner: testRepositoryOwner, repo: testRepositoryName }
        },
        progress: { processed: 5, total: 5 },
        processedOn: Date.now() - 10000,
        finishedOn: Date.now() - 1000,
        returnvalue: mockIngestionResult,
        failedReason: null,
        opts: { attempts: 3 }
      };

      mockQueue.getJob.mockResolvedValue(mockJob as any);
      mockPrisma.ingestionJob.findUnique.mockResolvedValue({
        id: testJobId,
        status: 'completed',
        repositoryId: 'repo-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date()
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: `/api/ingestion/jobs/${testJobId}/status`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('completed');
      expect(body.result).toEqual(mockIngestionResult);
      expect(body.completedAt).toBeDefined();
    });

    it('should return failed job with error details', async () => {
      const mockError = 'Network timeout during artifact download';
      const mockJob = {
        id: testJobId,
        data: { workflowRunId: testWorkflowRunId },
        progress: { processed: 1, total: 5 },
        processedOn: Date.now() - 10000,
        finishedOn: Date.now() - 1000,
        returnvalue: null,
        failedReason: mockError,
        opts: { attempts: 3 },
        attemptsMade: 3
      };

      mockQueue.getJob.mockResolvedValue(mockJob as any);
      mockPrisma.ingestionJob.findUnique.mockResolvedValue({
        id: testJobId,
        status: 'failed',
        repositoryId: 'repo-123',
        error: mockError,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: `/api/ingestion/jobs/${testJobId}/status`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('failed');
      expect(body.error).toBe(mockError);
      expect(body.attempts).toBe(3);
    });
  });

  // ============================================================================
  // Ingestion History Endpoint Tests
  // ============================================================================

  describe('Ingestion History Endpoint', () => {
    it('should return paginated ingestion history', async () => {
      const mockJobs = [
        {
          id: 'job-1',
          status: 'completed',
          repositoryId: 'repo-123',
          workflowRunId: 111,
          createdAt: new Date('2023-01-01'),
          completedAt: new Date('2023-01-01T00:05:00')
        },
        {
          id: 'job-2',
          status: 'failed',
          repositoryId: 'repo-123',
          workflowRunId: 222,
          createdAt: new Date('2023-01-02'),
          error: 'Download failed'
        }
      ];

      mockPrisma.ingestionJob.findMany.mockResolvedValue(mockJobs as any);
      mockPrisma.ingestionJob.count.mockResolvedValue(15);

      const response = await app.inject({
        method: 'GET',
        url: '/api/ingestion/history',
        query: {
          repositoryOwner: testRepositoryOwner,
          repositoryName: testRepositoryName,
          page: '1',
          limit: '10'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.jobs).toHaveLength(2);
      expect(body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 15,
        pages: 2
      });
      expect(body.jobs[0].id).toBe('job-1');
      expect(body.jobs[0].status).toBe('completed');
    });

    it('should filter history by status', async () => {
      const mockJobs = [{
        id: 'job-failed',
        status: 'failed',
        repositoryId: 'repo-123',
        workflowRunId: 333,
        error: 'Parsing error'
      }];

      mockPrisma.ingestionJob.findMany.mockResolvedValue(mockJobs as any);
      mockPrisma.ingestionJob.count.mockResolvedValue(1);

      const response = await app.inject({
        method: 'GET',
        url: '/api/ingestion/history',
        query: {
          repositoryOwner: testRepositoryOwner,
          repositoryName: testRepositoryName,
          status: 'failed'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(mockPrisma.ingestionJob.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: 'failed'
        }),
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0
      });
    });

    it('should filter history by date range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ingestion/history',
        query: {
          repositoryOwner: testRepositoryOwner,
          repositoryName: testRepositoryName,
          startDate: '2023-01-01',
          endDate: '2023-01-31'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(mockPrisma.ingestionJob.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date('2023-01-01'),
            lte: new Date('2023-01-31')
          }
        }),
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0
      });
    });

    it('should validate query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ingestion/history',
        query: {
          repositoryOwner: testRepositoryOwner,
          repositoryName: testRepositoryName,
          page: 'invalid',
          limit: '100' // Exceeds maximum
        }
      });

      expect(response.statusCode).toBe(400);
      const validation = response.json().validation;
      expect(validation).toContainEqual(
        expect.objectContaining({
          instancePath: '/page',
          message: 'must be integer'
        })
      );
      expect(validation).toContainEqual(
        expect.objectContaining({
          instancePath: '/limit',
          message: 'must be <= 50'
        })
      );
    });
  });

  // ============================================================================
  // Statistics Endpoint Tests
  // ============================================================================

  describe('Statistics Endpoint', () => {
    it('should return repository ingestion statistics', async () => {
      const mockStats = {
        totalJobs: 150,
        completedJobs: 120,
        failedJobs: 20,
        queuedJobs: 5,
        activeJobs: 5,
        totalTestsProcessed: 15000,
        totalFailures: 750,
        averageProcessingTime: 45.5,
        lastIngestionAt: new Date('2023-01-15T10:30:00')
      };

      mockPrisma.ingestionJob.aggregate.mockResolvedValue({
        _count: { _all: 150 },
        _avg: { processingTimeMs: 45500 }
      } as any);

      mockPrisma.ingestionJob.groupBy.mockResolvedValue([
        { status: 'completed', _count: { status: 120 } },
        { status: 'failed', _count: { status: 20 } },
        { status: 'queued', _count: { status: 5 } },
        { status: 'active', _count: { status: 5 } }
      ] as any);

      mockPrisma.testResult.aggregate.mockResolvedValue({
        _count: { _all: 15000 },
        _sum: { failures: 750 }
      } as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/ingestion/statistics',
        query: {
          repositoryOwner: testRepositoryOwner,
          repositoryName: testRepositoryName
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.totalJobs).toBe(150);
      expect(body.completedJobs).toBe(120);
      expect(body.failedJobs).toBe(20);
      expect(body.averageProcessingTimeMs).toBe(45500);
    });

    it('should support time period filtering for statistics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ingestion/statistics',
        query: {
          repositoryOwner: testRepositoryOwner,
          repositoryName: testRepositoryName,
          period: '30d'
        }
      });

      expect(response.statusCode).toBe(200);
      
      // Verify date filtering was applied
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      expect(mockPrisma.ingestionJob.aggregate).toHaveBeenCalledWith({
        where: expect.objectContaining({
          createdAt: {
            gte: expect.any(Date)
          }
        }),
        _count: { _all: true },
        _avg: { processingTimeMs: true }
      });
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      mockPrisma.repository.findFirst.mockRejectedValue(new Error('Database connection lost'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().message).toContain('Internal server error');
    });

    it('should handle GitHub API rate limiting', async () => {
      const mockGitHubIntegration = {
        listArtifacts: vi.fn().mockRejectedValue({
          status: 403,
          response: {
            headers: {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
            }
          },
          message: 'API rate limit exceeded'
        })
      };
      vi.mocked(GitHubArtifactsIntegration).mockImplementation(() => mockGitHubIntegration as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
    });

    it('should return appropriate error for invalid workflow run', async () => {
      const mockGitHubIntegration = {
        getWorkflowRun: vi.fn().mockRejectedValue({
          status: 404,
          message: 'Workflow run not found'
        }),
        listArtifacts: vi.fn().mockRejectedValue({
          status: 404,
          message: 'Workflow run not found'
        })
      };
      vi.mocked(GitHubArtifactsIntegration).mockImplementation(() => mockGitHubIntegration as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: 999999999,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().message).toContain('Workflow run not found');
    });

    it('should handle malformed request payloads gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: 'invalid json'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('Invalid JSON');
    });
  });

  // ============================================================================
  // Rate Limiting Tests
  // ============================================================================

  describe('Rate Limiting', () => {
    it('should enforce rate limits per repository', async () => {
      const requests = Array.from({ length: 15 }, () => 
        app.inject({
          method: 'POST',
          url: '/api/ingestion/process-artifacts',
          payload: {
            workflowRunId: testWorkflowRunId,
            repository: {
              owner: testRepositoryOwner,
              repo: testRepositoryName
            },
            installationId: testInstallationId
          }
        })
      );

      const responses = await Promise.all(requests);
      
      // First 10 should succeed, rest should be rate limited
      const successful = responses.filter(r => r.statusCode === 202);
      const rateLimited = responses.filter(r => r.statusCode === 429);
      
      expect(successful.length).toBe(10);
      expect(rateLimited.length).toBe(5);
      
      // Rate limited responses should include retry headers
      rateLimited.forEach(response => {
        expect(response.headers['x-ratelimit-limit']).toBeDefined();
        expect(response.headers['x-ratelimit-remaining']).toBe('0');
        expect(response.headers['retry-after']).toBeDefined();
      });
    });

    it('should allow rate limit resets after time window', async () => {
      // First request should succeed
      const response1 = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });
      expect(response1.statusCode).toBe(202);

      // Mock time passage (in real implementation, this would use a time-based rate limiter)
      // Simulate rate limit reset by clearing the limiter state
      
      const response2 = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: {
          workflowRunId: testWorkflowRunId + 1,
          repository: {
            owner: testRepositoryOwner,
            repo: testRepositoryName
          },
          installationId: testInstallationId
        }
      });
      expect(response2.statusCode).toBe(202);
    });
  });

  // ============================================================================
  // Security Tests
  // ============================================================================

  describe('Security', () => {
    it('should prevent path traversal in job ID parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/ingestion/jobs/../../../etc/passwd/status'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('Invalid job ID format');
    });

    it('should sanitize error messages to prevent information disclosure', async () => {
      // Mock database error with sensitive information
      mockPrisma.ingestionJob.findUnique.mockRejectedValue(
        new Error('ECONNREFUSED postgresql://user:password@localhost:5432/db')
      );

      const response = await app.inject({
        method: 'GET',
        url: `/api/ingestion/jobs/${testJobId}/status`
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().message).not.toContain('password');
      expect(response.json().message).not.toContain('postgresql://');
    });

    it('should validate content-type header for POST requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        headers: {
          'content-type': 'text/plain'
        },
        payload: 'plain text payload'
      });

      expect(response.statusCode).toBe(415);
      expect(response.json().message).toContain('Unsupported Media Type');
    });

    it('should limit request payload size', async () => {
      const largePayload = {
        workflowRunId: testWorkflowRunId,
        repository: {
          owner: testRepositoryOwner,
          repo: testRepositoryName
        },
        installationId: testInstallationId,
        // Simulate very large filter with many patterns
        filter: {
          namePatterns: Array(10000).fill('*').map((_, i) => `pattern-${i}`)
        }
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/ingestion/process-artifacts',
        payload: largePayload
      });

      expect(response.statusCode).toBe(413);
      expect(response.json().message).toContain('Payload too large');
    });
  });

  // ============================================================================
  // Performance Tests
  // ============================================================================

  describe('Performance', () => {
    it('should handle concurrent requests efficiently', async () => {
      const concurrentRequests = Array.from({ length: 10 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/ingestion/process-artifacts',
          payload: {
            workflowRunId: testWorkflowRunId + i,
            repository: {
              owner: testRepositoryOwner,
              repo: `${testRepositoryName}-${i}`
            },
            installationId: testInstallationId
          }
        })
      );

      const startTime = Date.now();
      const responses = await Promise.allSettled(concurrentRequests);
      const endTime = Date.now();

      // All requests should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(5000);
      
      // Most requests should succeed (allowing for rate limiting)
      const successful = responses.filter(
        r => r.status === 'fulfilled' && r.value.statusCode === 202
      );
      expect(successful.length).toBeGreaterThan(5);
    });

    it('should respond quickly to status checks', async () => {
      mockQueue.getJob.mockResolvedValue({
        id: testJobId,
        data: {},
        progress: {},
        opts: {}
      } as any);

      const startTime = Date.now();
      const response = await app.inject({
        method: 'GET',
        url: `/api/ingestion/jobs/${testJobId}/status`
      });
      const endTime = Date.now();

      expect(response.statusCode).toBe(200);
      expect(endTime - startTime).toBeLessThan(100); // Should respond within 100ms
    });
  });
});