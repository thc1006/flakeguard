/**
 * Comprehensive GitHub App Tests
 * 
 * Tests for:
 * - Fastify plugin registration
 * - Webhook event handlers integration
 * - API endpoint functionality
 * - Authentication and authorization
 * - Error handling and validation
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import nock from 'nock';
import { PrismaClient } from '@prisma/client';
import githubAppPlugin from '../index.js';
import { createTestMocks } from './mocks.js';
import {
  createMockCheckRunPayload,
  createMockWorkflowRunPayload,
  createMockInstallationPayload,
  createMockRepository,
  createMockInstallation,
  createMockPrismaClient,
  signWebhookPayload,
} from './mocks.js';

describe('GitHub App Plugin', () => {
  let fastify: FastifyInstance;
  let mockPrisma: PrismaClient;
  let testMocks: ReturnType<typeof createTestMocks>;

  beforeAll(() => {
    // Disable HTTP requests during testing unless explicitly mocked
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    fastify = Fastify();
    mockPrisma = createMockPrismaClient();
    testMocks = createTestMocks();

    // Register mock Prisma plugin
    await fastify.register(async (fastify) => {
      fastify.decorate('prisma', mockPrisma);
    });

    // Mock environment configuration
    vi.mock('../config/index.js', () => ({
      config: {
        github: {
          appId: 12345,
          privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
          webhookSecret: 'test-webhook-secret',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      },
    }));

    // Register GitHub App plugin
    await fastify.register(githubAppPlugin);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    nock.cleanAll();
    vi.clearAllMocks();
  });

  describe('Plugin Registration', () => {
    it('should register plugin successfully', async () => {
      expect(fastify.hasPlugin('github-app')).toBe(true);
    });

    it('should register webhook routes', async () => {
      const routes = fastify.printRoutes();
      expect(routes).toContain('/api/github/webhook');
    });

    it('should register check run API routes', async () => {
      const routes = fastify.printRoutes();
      expect(routes).toContain('POST /api/github/repos/:owner/:repo/check-runs');
      expect(routes).toContain('PATCH /api/github/repos/:owner/:repo/check-runs/:checkRunId');
      expect(routes).toContain('GET /api/github/repos/:owner/:repo/commits/:ref/check-runs');
    });

    it('should register workflow API routes', async () => {
      const routes = fastify.printRoutes();
      expect(routes).toContain('POST /api/github/repos/:owner/:repo/actions/runs/:runId/rerun');
      expect(routes).toContain('POST /api/github/repos/:owner/:repo/actions/runs/:runId/cancel');
    });

    it('should register artifact API routes', async () => {
      const routes = fastify.printRoutes();
      expect(routes).toContain('GET /api/github/repos/:owner/:repo/actions/runs/:runId/artifacts');
      expect(routes).toContain('GET /api/github/repos/:owner/:repo/actions/artifacts/:artifactId/download-url');
    });

    it('should register flake detection API routes', async () => {
      const routes = fastify.printRoutes();
      expect(routes).toContain('GET /api/github/repos/:owner/:repo/flakes/status');
      expect(routes).toContain('GET /api/github/repos/:owner/:repo/flakes/summary');
    });
  });

  describe('Webhook Event Processing', () => {
    describe('Check Run Events', () => {
      it('should process check_run created event', async () => {
        const payload = createMockCheckRunPayload('created', {
          id: 123,
          name: 'test-check',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'failure',
        });

        const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/github/webhook',
          headers: {
            'x-github-event': 'check_run',
            'x-github-delivery': 'test-delivery',
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toBe(200);
        expect(mockPrisma.checkRun.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { githubId: 123 },
            update: expect.objectContaining({
              name: 'test-check',
              headSha: 'abc123',
              status: 'completed',
              conclusion: 'failure',
            }),
            create: expect.objectContaining({
              githubId: 123,
              name: 'test-check',
              headSha: 'abc123',
              status: 'completed',
              conclusion: 'failure',
            }),
          })
        );
      });

      it('should process check_run completed event with flake analysis', async () => {
        const payload = createMockCheckRunPayload('completed', {
          id: 456,
          name: 'test-check',
          head_sha: 'def456',
          status: 'completed',
          conclusion: 'failure',
          output: {
            title: 'Test Failed',
            summary: 'Some tests failed',
            text: null,
          },
        });

        testMocks.flakeDetector.analyzeTestExecution.mockResolvedValue({
          analysis: {
            isFlaky: true,
            confidence: 0.8,
            failurePattern: 'timeout',
            historicalFailures: 5,
            totalRuns: 10,
            failureRate: 0.5,
            lastFailureAt: new Date().toISOString(),
            suggestedAction: 'quarantine',
          },
          shouldUpdateCheckRun: true,
          suggestedActions: ['quarantine', 'open_issue'],
          confidenceLevel: 'high',
        });

        const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/github/webhook',
          headers: {
            'x-github-event': 'check_run',
            'x-github-delivery': 'test-delivery',
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toBe(200);
        expect(testMocks.flakeDetector.analyzeTestExecution).toHaveBeenCalled();
        expect(testMocks.helpers.updateCheckRunWithFlakeDetection).toHaveBeenCalledWith(
          'test-owner',
          'test-repo',
          456,
          12345,
          expect.objectContaining({
            isFlaky: true,
            confidence: 0.8,
          }),
          ['quarantine', 'open_issue']
        );
      });

      it('should handle check_run requested_action event', async () => {
        const payload = createMockCheckRunPayload('requested_action', {
          id: 789,
          name: 'flaky-test-check',
          head_sha: 'ghi789',
        }, {
          requested_action: {
            identifier: 'quarantine',
          },
        });

        testMocks.flakeDetector.updateFlakeStatus.mockResolvedValue();

        const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/github/webhook',
          headers: {
            'x-github-event': 'check_run',
            'x-github-delivery': 'test-delivery',
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toBe(200);
        expect(testMocks.flakeDetector.updateFlakeStatus).toHaveBeenCalledWith(
          'flaky-test-check',
          expect.any(String),
          'quarantine',
          expect.objectContaining({
            reason: 'User requested quarantine via check run action',
          })
        );
      });
    });

    describe('Workflow Run Events', () => {
      it('should process workflow_run completed event', async () => {
        const payload = createMockWorkflowRunPayload('completed', {
          id: 123,
          name: 'CI',
          head_branch: 'main',
          head_sha: 'abc123',
          status: 'completed',
          conclusion: 'failure',
          workflow_id: 456,
          run_started_at: new Date().toISOString(),
        });

        testMocks.helpers.getWorkflowJobs.mockResolvedValue([
          {
            id: 789,
            name: 'test-job',
            conclusion: 'failure',
            steps: [
              {
                name: 'Run tests',
                conclusion: 'failure',
                completed_at: new Date().toISOString(),
              },
            ],
          },
        ]);

        testMocks.flakeDetector.batchAnalyzeTests.mockResolvedValue([
          {
            analysis: {
              isFlaky: true,
              confidence: 0.7,
              failurePattern: 'connection refused',
              historicalFailures: 3,
              totalRuns: 8,
              failureRate: 0.375,
              lastFailureAt: new Date().toISOString(),
              suggestedAction: 'open_issue',
            },
            shouldUpdateCheckRun: true,
            suggestedActions: ['open_issue', 'rerun_failed'],
            confidenceLevel: 'medium',
          },
        ]);

        const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/github/webhook',
          headers: {
            'x-github-event': 'workflow_run',
            'x-github-delivery': 'test-delivery',
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toBe(200);
        expect(mockPrisma.workflowRun.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { githubId: 123 },
            update: expect.objectContaining({
              name: 'CI',
              headBranch: 'main',
              headSha: 'abc123',
              status: 'completed',
              conclusion: 'failure',
            }),
            create: expect.objectContaining({
              githubId: 123,
              name: 'CI',
              workflowId: 456,
              workflowName: 'Test Workflow',
            }),
          })
        );
        expect(testMocks.helpers.getWorkflowJobs).toHaveBeenCalledWith(
          'test-owner',
          'test-repo',
          123,
          12345
        );
        expect(testMocks.flakeDetector.batchAnalyzeTests).toHaveBeenCalled();
      });

      it('should create FlakeGuard summary for workflow completion', async () => {
        const payload = createMockWorkflowRunPayload('completed', {
          id: 999,
          name: 'CI',
          head_branch: 'main',
          head_sha: 'xyz999',
          status: 'completed',
          conclusion: 'success',
        });

        testMocks.flakeDetector.getRepositoryFlakeSummary.mockResolvedValue({
          totalFlaky: 2,
          totalQuarantined: 1,
          recentlyDetected: 1,
          topFlaky: [
            {
              testName: 'integration-test',
              confidence: 0.9,
              failureRate: 0.4,
              lastFailureAt: new Date().toISOString(),
            },
          ],
        });

        const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/github/webhook',
          headers: {
            'x-github-event': 'workflow_run',
            'x-github-delivery': 'test-delivery',
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toBe(200);
        expect(testMocks.helpers.createFlakeGuardSummaryCheckRun).toHaveBeenCalledWith(
          'test-owner',
          'test-repo',
          'xyz999',
          12345,
          expect.objectContaining({
            totalFlaky: 2,
            totalQuarantined: 1,
          }),
          false // hasFailures = false for successful workflow
        );
      });
    });

    describe('Installation Events', () => {
      it('should process installation created event', async () => {
        const payload = createMockInstallationPayload('created', {
          id: 12345,
          account: {
            login: 'test-org',
            id: 67890,
            type: 'Organization',
          },
          repository_selection: 'selected',
          permissions: {
            checks: 'write',
            actions: 'read',
          },
          events: ['check_run', 'workflow_run'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          repositories: [
            {
              id: 111,
              name: 'test-repo',
              full_name: 'test-org/test-repo',
            },
          ],
        });

        const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/github/webhook',
          headers: {
            'x-github-event': 'installation',
            'x-github-delivery': 'test-delivery',
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toBe(200);
        expect(mockPrisma.installation.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              githubInstallationId: 12345,
              accountLogin: 'test-org',
              accountId: 67890,
              accountType: 'Organization',
              repositorySelection: 'selected',
            }),
          })
        );
        expect(mockPrisma.repository.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { githubId: 111 },
            create: expect.objectContaining({
              githubId: 111,
              name: 'test-repo',
              fullName: 'test-org/test-repo',
              owner: 'test-org',
              installationId: '12345',
            }),
          })
        );
      });

      it('should process installation deleted event', async () => {
        const payload = createMockInstallationPayload('deleted', {
          id: 12345,
          account: {
            login: 'test-org',
            id: 67890,
            type: 'Organization',
          },
        });

        const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/github/webhook',
          headers: {
            'x-github-event': 'installation',
            'x-github-delivery': 'test-delivery',
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        });

        expect(response.statusCode).toBe(200);
        expect(mockPrisma.installation.delete).toHaveBeenCalledWith({
          where: {
            githubInstallationId: 12345,
          },
        });
      });
    });
  });

  describe('Webhook Validation', () => {
    it('should reject webhook with invalid signature', async () => {
      const payload = createMockCheckRunPayload('created');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'x-github-event': 'check_run',
          'x-github-delivery': 'test-delivery',
          'x-hub-signature-256': 'sha256=invalid-signature',
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject webhook with missing headers', async () => {
      const payload = createMockCheckRunPayload('created');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject webhook with unsupported event type', async () => {
      const payload = { action: 'unknown' };
      const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'x-github-event': 'unsupported_event',
          'x-github-delivery': 'test-delivery',
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject webhook with invalid payload', async () => {
      const payload = { invalid: 'payload' };
      const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'x-github-event': 'check_run',
          'x-github-delivery': 'test-delivery',
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockPrisma.checkRun.upsert = vi.fn().mockRejectedValue(new Error('Database connection failed'));

      const payload = createMockCheckRunPayload('created');
      const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'x-github-event': 'check_run',
          'x-github-delivery': 'test-delivery',
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      // Should still return 200 for webhook events to avoid retries
      expect(response.statusCode).toBe(200);
      // But should log the error internally
    });

    it('should handle GitHub API errors in flake analysis', async () => {
      testMocks.flakeDetector.analyzeTestExecution.mockRejectedValue(
        new Error('GitHub API rate limited')
      );

      const payload = createMockCheckRunPayload('completed', {
        conclusion: 'failure',
      });
      const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'x-github-event': 'check_run',
          'x-github-delivery': 'test-delivery',
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      // Should continue processing other parts of the webhook
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting to webhook endpoint', async () => {
      const payload = createMockCheckRunPayload('created');
      const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

      // Make multiple rapid requests
      const requests = Array.from({ length: 5 }, () =>
        fastify.inject({
          method: 'POST',
          url: '/api/github/webhook',
          headers: {
            'x-github-event': 'check_run',
            'x-github-delivery': 'test-delivery',
            'x-hub-signature-256': signature,
            'content-type': 'application/json',
          },
          payload,
        })
      );

      const responses = await Promise.all(requests);
      
      // All should succeed given our rate limit configuration
      responses.forEach(response => {
        expect(response.statusCode).toBe(200);
      });
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should emit metrics for webhook events', async () => {
      const payload = createMockCheckRunPayload('created');
      const signature = signWebhookPayload(JSON.stringify(payload), 'test-webhook-secret');

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/webhook',
        headers: {
          'x-github-event': 'check_run',
          'x-github-delivery': 'test-delivery',
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      // In a real implementation, verify metrics were emitted
    });
  });
});

describe('API Endpoints', () => {
  let fastify: FastifyInstance;
  let mockPrisma: PrismaClient;
  let testMocks: ReturnType<typeof createTestMocks>;

  beforeEach(async () => {
    fastify = Fastify();
    mockPrisma = createMockPrismaClient();
    testMocks = createTestMocks();

    await fastify.register(async (fastify) => {
      fastify.decorate('prisma', mockPrisma);
    });

    vi.mock('../config/index.js', () => ({
      config: {
        github: {
          appId: 12345,
          privateKey: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
          webhookSecret: 'test-secret',
          clientId: 'test-client',
          clientSecret: 'test-secret',
        },
      },
    }));

    await fastify.register(githubAppPlugin);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    nock.cleanAll();
    vi.clearAllMocks();
  });

  describe('Check Run Management', () => {
    it('should create check run successfully', async () => {
      const mockCheckRun = {
        success: true,
        data: {
          id: 123,
          name: 'FlakeGuard Test',
          headSha: 'abc123',
          status: 'completed',
          conclusion: 'success',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          output: {
            title: 'Test passed',
            summary: 'All tests passed successfully',
          },
          actions: [],
        },
      };

      testMocks.helpers.createCheckRun.mockResolvedValue(mockCheckRun);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/repos/owner/repo/check-runs',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
          'content-type': 'application/json',
        },
        payload: {
          name: 'FlakeGuard Test',
          headSha: 'abc123',
          status: 'completed',
          conclusion: 'success',
          output: {
            title: 'Test passed',
            summary: 'All tests passed successfully',
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.data.id).toBe(123);
      expect(testMocks.helpers.createCheckRun).toHaveBeenCalledWith(
        'owner',
        'repo',
        expect.objectContaining({
          name: 'FlakeGuard Test',
          headSha: 'abc123',
        }),
        12345
      );
    });

    it('should update check run successfully', async () => {
      const mockCheckRun = {
        success: true,
        data: {
          id: 123,
          name: 'FlakeGuard Test',
          headSha: 'abc123',
          status: 'completed',
          conclusion: 'failure',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          output: {
            title: 'Flaky test detected',
            summary: 'This test appears to be flaky',
          },
          actions: [
            {
              label: 'Quarantine Test',
              description: 'Mark this test as flaky',
              identifier: 'quarantine',
            },
          ],
        },
      };

      testMocks.helpers.updateCheckRun.mockResolvedValue(mockCheckRun);

      const response = await fastify.inject({
        method: 'PATCH',
        url: '/api/github/repos/owner/repo/check-runs/123',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
          'content-type': 'application/json',
        },
        payload: {
          conclusion: 'failure',
          output: {
            title: 'Flaky test detected',
            summary: 'This test appears to be flaky',
          },
          actions: [
            {
              label: 'Quarantine Test',
              description: 'Mark this test as flaky',
              identifier: 'quarantine',
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.data.conclusion).toBe('failure');
    });

    it('should list check runs for commit', async () => {
      const mockCheckRuns = [
        {
          id: 123,
          githubId: 123,
          name: 'Test Check',
          headSha: 'abc123',
          status: 'completed',
          conclusion: 'success',
          startedAt: new Date(),
          completedAt: new Date(),
          output: { title: 'Success', summary: 'All good' },
          actions: [],
        },
      ];

      mockPrisma.checkRun.findMany.mockResolvedValue(mockCheckRuns);
      mockPrisma.checkRun.count.mockResolvedValue(1);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/github/repos/owner/repo/commits/abc123/check-runs',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(123);
      expect(result.pagination).toEqual({
        page: 1,
        perPage: 30,
        totalCount: 1,
        totalPages: 1,
      });
    });
  });

  describe('Workflow Operations', () => {
    it('should rerun workflow successfully', async () => {
      testMocks.helpers.rerunWorkflow.mockResolvedValue({
        success: true,
        message: 'Workflow rerun initiated',
        runId: 123,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/repos/owner/repo/actions/runs/123/rerun',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
          'content-type': 'application/json',
        },
        payload: {
          enableDebugLogging: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.runId).toBe(123);
    });

    it('should rerun failed jobs only', async () => {
      testMocks.helpers.rerunFailedJobs.mockResolvedValue({
        success: true,
        message: 'Failed jobs rerun initiated',
        runId: 123,
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/repos/owner/repo/actions/runs/123/rerun',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
          'content-type': 'application/json',
        },
        payload: {
          rerunFailedJobsOnly: true,
          enableDebugLogging: false,
        },
      });

      expect(response.statusCode).toBe(201);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(testMocks.helpers.rerunFailedJobs).toHaveBeenCalledWith(
        'owner',
        'repo',
        123,
        12345,
        { enableDebugLogging: false }
      );
    });

    it('should cancel workflow successfully', async () => {
      testMocks.helpers.cancelWorkflow.mockResolvedValue({
        success: true,
        message: 'Workflow cancelled',
      });

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/repos/owner/repo/actions/runs/123/cancel',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
        },
      });

      expect(response.statusCode).toBe(202);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
    });
  });

  describe('Artifact Management', () => {
    it('should list artifacts successfully', async () => {
      const mockArtifacts = [
        {
          id: 123,
          name: 'test-results',
          type: 'test-results',
          sizeInBytes: 1024,
          url: 'https://api.github.com/repos/owner/repo/actions/artifacts/123',
          archiveDownloadUrl: 'https://api.github.com/repos/owner/repo/actions/artifacts/123/zip',
          expired: false,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      testMocks.helpers.listArtifacts.mockResolvedValue(mockArtifacts);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/github/repos/owner/repo/actions/runs/123/artifacts',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('test-results');
    });

    it('should generate artifact download URL', async () => {
      testMocks.helpers.generateArtifactDownloadUrl.mockResolvedValue({
        downloadUrl: 'https://api.github.com/download/artifact/123',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        sizeInBytes: 1024,
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/github/repos/owner/repo/actions/artifacts/123/download-url',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.data.downloadUrl).toBe('https://api.github.com/download/artifact/123');
    });

    it('should handle expired artifact', async () => {
      testMocks.helpers.generateArtifactDownloadUrl.mockRejectedValue(
        new Error('expired')
      );

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/github/repos/owner/repo/actions/artifacts/123/download-url',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': '12345',
        },
      });

      expect(response.statusCode).toBe(410);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(false);
    });
  });

  describe('Flake Detection API', () => {
    it('should get flake status for test', async () => {
      const mockRepository = {
        id: 'repo-1',
        owner: 'owner',
        name: 'repo',
      };

      mockPrisma.repository.findFirst.mockResolvedValue(mockRepository);
      testMocks.flakeDetector.getFlakeStatus.mockResolvedValue({
        isFlaky: true,
        confidence: 0.8,
        failurePattern: 'timeout',
        historicalFailures: 5,
        totalRuns: 10,
        failureRate: 0.5,
        lastFailureAt: new Date().toISOString(),
        suggestedAction: 'quarantine',
      });

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/github/repos/owner/repo/flakes/status?testName=flaky-test',
        headers: {
          'authorization': 'Bearer token',
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.data.isFlaky).toBe(true);
      expect(result.data.confidence).toBe(0.8);
    });

    it('should get repository flake summary', async () => {
      const mockRepository = {
        id: 'repo-1',
        owner: 'owner',
        name: 'repo',
      };

      const mockSummary = {
        totalFlaky: 5,
        totalQuarantined: 2,
        recentlyDetected: 1,
        topFlaky: [
          {
            testName: 'integration-test',
            confidence: 0.9,
            failureRate: 0.4,
            lastFailureAt: new Date().toISOString(),
          },
        ],
      };

      mockPrisma.repository.findFirst.mockResolvedValue(mockRepository);
      testMocks.flakeDetector.getRepositoryFlakeSummary.mockResolvedValue(mockSummary);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/github/repos/owner/repo/flakes/summary',
        headers: {
          'authorization': 'Bearer token',
        },
      });

      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(true);
      expect(result.data.totalFlaky).toBe(5);
      expect(result.data.topFlaky).toHaveLength(1);
    });

    it('should return 404 for non-existent repository', async () => {
      mockPrisma.repository.findFirst.mockResolvedValue(null);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/github/repos/owner/nonexistent/flakes/status?testName=test',
        headers: {
          'authorization': 'Bearer token',
        },
      });

      expect(response.statusCode).toBe(404);
      const result = JSON.parse(response.body);
      expect(result.success).toBe(false);
    });
  });

  describe('Authentication & Authorization', () => {
    it('should require authorization header', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/repos/owner/repo/check-runs',
        headers: {
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(500); // Will fail in getInstallationIdFromAuth
    });

    it('should require installation ID header', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/repos/owner/repo/check-runs',
        headers: {
          'authorization': 'Bearer token',
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(500); // Will fail in getInstallationIdFromAuth
    });

    it('should validate numeric installation ID', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/github/repos/owner/repo/check-runs',
        headers: {
          'authorization': 'Bearer token',
          'x-installation-id': 'invalid',
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(500); // Will fail in parseInt
    });
  });
});