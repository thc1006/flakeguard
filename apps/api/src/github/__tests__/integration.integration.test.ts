/**
 * Integration Tests for GitHub API Interactions
 * 
 * Tests GitHub API responses, webhook processing, and state changes
 */

import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { testDb, testRedis } from '../../__tests__/setup/integration.setup.js';
import { GitHubAuthManager } from '../auth.js';
import { createFlakeDetector } from '../flake-detector.js';
import { CheckRunHandler, WorkflowRunHandler } from '../handlers.js';
import { GitHubHelpers } from '../helpers.js';
import type {
  CheckRunWebhookPayload,
  WorkflowRunWebhookPayload,
  GitHubRepository,
  GitHubInstallation,
} from '../types.js';

// Mock GitHub API base URL
const GITHUB_API_BASE = 'https://api.github.com';

describe('GitHub Integration Tests', () => {
  let prisma: PrismaClient;
  let authManager: GitHubAuthManager;
  let helpers: GitHubHelpers;
  let checkRunHandler: CheckRunHandler;
  let workflowRunHandler: WorkflowRunHandler;
  let ingestionQueue: Queue;

  // Test fixtures
  const mockInstallation: GitHubInstallation = {
    id: 12345,
    account: {
      login: 'test-org',
      id: 67890,
      type: 'Organization',
      avatar_url: 'https://github.com/images/avatars/test-org.png',
    },
  };

  const mockRepository: GitHubRepository = {
    id: 123456789,
    name: 'flakeguard-test',
    full_name: 'test-org/flakeguard-test',
    owner: {
      login: 'test-org',
      id: 67890,
      type: 'Organization',
      avatar_url: 'https://github.com/images/avatars/test-org.png',
    },
    private: false,
    html_url: 'https://github.com/test-org/flakeguard-test',
    clone_url: 'https://github.com/test-org/flakeguard-test.git',
    default_branch: 'main',
  };

  beforeEach(async () => {
    prisma = testDb.prisma;
    
    // Set up test environment
    process.env.GITHUB_APP_ID = 'test-app-id';
    process.env.GITHUB_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKB
-----END PRIVATE KEY-----`;
    process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';

    // Initialize components
    authManager = new GitHubAuthManager();
    helpers = new GitHubHelpers(authManager);
    ingestionQueue = new Queue('test-ingestion', { connection: testRedis.client });
    
    checkRunHandler = new CheckRunHandler({
      prisma,
      authManager,
      helpers,
      flakeDetector: createFlakeDetector({ prisma }),
      ingestionQueue,
    });

    workflowRunHandler = new WorkflowRunHandler({
      prisma,
      authManager,
      helpers,
      ingestionQueue,
    });

    // Clear any existing HTTP mocks
    nock.cleanAll();
  });

  afterEach(async () => {
    // Clean up HTTP mocks
    nock.cleanAll();
    
    // Clean up queues
    await ingestionQueue.close();
  });

  describe('Check Run Handler', () => {
    it('should process check run created webhook', async () => {
      const payload: CheckRunWebhookPayload = {
        action: 'created',
        check_run: {
          id: 987654321,
          name: 'CI Tests',
          status: 'queued',
          conclusion: null,
          started_at: '2023-10-01T10:00:00Z',
          completed_at: null,
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654321',
          check_suite: {
            id: 111222333,
            head_branch: 'main',
            head_sha: 'abc123def456',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'CI Tests',
            summary: 'Running automated tests...',
            text: null,
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
      };

      // Mock GitHub App authentication
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      // Process the webhook
      await checkRunHandler.process(payload);

      // Verify check run was stored in database
      const storedCheckRun = await prisma.checkRun.findFirst({
        where: { externalId: '987654321' },
        include: { repository: true },
      });

      expect(storedCheckRun).toBeDefined();
      expect(storedCheckRun!.name).toBe('CI Tests');
      expect(storedCheckRun!.status).toBe('queued');
      expect(storedCheckRun!.repository.name).toBe('flakeguard-test');
    });

    it('should process check run completed webhook and trigger flake detection', async () => {
      // First, seed a repository in the database
      const repository = await testDb.seedRepository({
        externalId: mockRepository.id.toString(),
        name: mockRepository.name,
        fullName: mockRepository.full_name,
        owner: mockRepository.owner.login,
        installationId: mockInstallation.id,
      });

      const payload: CheckRunWebhookPayload = {
        action: 'completed',
        check_run: {
          id: 987654321,
          name: 'CI Tests',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2023-10-01T10:00:00Z',
          completed_at: '2023-10-01T10:05:00Z',
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654321',
          check_suite: {
            id: 111222333,
            head_branch: 'main',
            head_sha: 'abc123def456',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'CI Tests Failed',
            summary: '3 tests failed out of 25 total',
            text: 'Some tests are showing flaky behavior',
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
      };

      // Mock GitHub App authentication
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      // Mock GitHub API call to get repository details
      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test')
        .reply(200, mockRepository);

      // Mock artifacts list API call
      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test/actions/artifacts')
        .query({ 
          per_page: 100,
          name: 'test-results'
        })
        .reply(200, {
          total_count: 1,
          artifacts: [{
            id: 456789,
            name: 'test-results',
            size_in_bytes: 12345,
            created_at: '2023-10-01T10:05:00Z',
            expired: false,
            workflow_run: {
              id: 789012345,
              head_sha: 'abc123def456',
            },
          }],
        });

      // Process the webhook
      await checkRunHandler.process(payload);

      // Verify check run was updated in database
      const storedCheckRun = await prisma.checkRun.findFirst({
        where: { externalId: '987654321' },
      });

      expect(storedCheckRun).toBeDefined();
      expect(storedCheckRun!.status).toBe('completed');
      expect(storedCheckRun!.conclusion).toBe('failure');

      // Verify that ingestion job was queued (check queue size)
      const jobCounts = await ingestionQueue.getJobCounts();
      expect(jobCounts.waiting + jobCounts.active).toBeGreaterThan(0);
    });

    it('should handle check run re-run requests', async () => {
      const payload: CheckRunWebhookPayload = {
        action: 'rerequested',
        check_run: {
          id: 987654321,
          name: 'CI Tests',
          status: 'queued',
          conclusion: null,
          started_at: '2023-10-01T10:10:00Z',
          completed_at: null,
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654321',
          check_suite: {
            id: 111222333,
            head_branch: 'main',
            head_sha: 'abc123def456',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'CI Tests (Re-run)',
            summary: 'Re-running tests...',
            text: null,
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
      };

      // Mock GitHub App authentication
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      // Process the webhook
      await checkRunHandler.process(payload);

      // Verify re-run was tracked
      const storedCheckRun = await prisma.checkRun.findFirst({
        where: { externalId: '987654321' },
      });

      expect(storedCheckRun).toBeDefined();
      expect(storedCheckRun!.status).toBe('queued');
      // Should have incremented rerun count or similar tracking
    });

    it('should handle requested action for flaky test quarantine', async () => {
      const payload: CheckRunWebhookPayload = {
        action: 'requested_action',
        check_run: {
          id: 987654321,
          name: 'FlakeGuard Analysis',
          status: 'completed',
          conclusion: 'neutral',
          started_at: '2023-10-01T10:00:00Z',
          completed_at: '2023-10-01T10:05:00Z',
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654321',
          check_suite: {
            id: 111222333,
            head_branch: 'main',
            head_sha: 'abc123def456',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'Flaky Tests Detected',
            summary: 'Found 2 flaky tests that may need quarantine',
            text: 'Click actions below to manage flaky tests',
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
        requested_action: {
          identifier: 'quarantine_flaky_tests',
        },
      };

      // Mock GitHub App authentication
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      // Mock check run update API call
      nock(GITHUB_API_BASE)
        .patch('/repos/test-org/flakeguard-test/check-runs/987654321')
        .reply(200, {
          id: 987654321,
          name: 'FlakeGuard Analysis',
          status: 'completed',
          conclusion: 'neutral',
        });

      // Process the webhook
      await checkRunHandler.process(payload);

      // Verify action was processed
      expect(nock.isDone()).toBe(true);
    });
  });

  describe('Workflow Run Handler', () => {
    it('should process workflow run completed webhook', async () => {
      const payload: WorkflowRunWebhookPayload = {
        action: 'completed',
        workflow_run: {
          id: 789012345,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          created_at: '2023-10-01T10:00:00Z',
          updated_at: '2023-10-01T10:05:00Z',
          html_url: 'https://github.com/test-org/flakeguard-test/actions/runs/789012345',
          head_branch: 'main',
          head_sha: 'abc123def456',
          run_number: 42,
          run_attempt: 1,
          workflow: {
            id: 555666777,
            name: 'CI',
            path: '.github/workflows/ci.yml',
          },
          triggering_actor: {
            login: 'developer',
            id: 98765,
            type: 'User',
            avatar_url: 'https://github.com/images/avatars/developer.png',
          },
          pull_requests: [],
        },
        repository: mockRepository,
        workflow: {
          id: 555666777,
          name: 'CI',
          path: '.github/workflows/ci.yml',
        },
      };

      // Mock GitHub App authentication
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      // Mock workflow run jobs API call
      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test/actions/runs/789012345/jobs')
        .reply(200, {
          total_count: 2,
          jobs: [
            {
              id: 111111111,
              name: 'test-unit',
              status: 'completed',
              conclusion: 'success',
              started_at: '2023-10-01T10:01:00Z',
              completed_at: '2023-10-01T10:03:00Z',
            },
            {
              id: 222222222,
              name: 'test-integration',
              status: 'completed',
              conclusion: 'failure',
              started_at: '2023-10-01T10:01:00Z',
              completed_at: '2023-10-01T10:04:00Z',
            },
          ],
        });

      // Mock artifacts list API call
      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test/actions/runs/789012345/artifacts')
        .reply(200, {
          total_count: 1,
          artifacts: [{
            id: 456789,
            name: 'test-results',
            size_in_bytes: 12345,
            created_at: '2023-10-01T10:05:00Z',
            expired: false,
            workflow_run: {
              id: 789012345,
              head_sha: 'abc123def456',
            },
          }],
        });

      // Process the webhook
      await workflowRunHandler.process(payload);

      // Verify workflow run was stored in database
      const storedRun = await prisma.workflowRun.findFirst({
        where: { externalId: '789012345' },
        include: { repository: true },
      });

      expect(storedRun).toBeDefined();
      expect(storedRun!.name).toBe('CI');
      expect(storedRun!.status).toBe('completed');
      expect(storedRun!.conclusion).toBe('success');
      expect(storedRun!.runNumber).toBe(42);
    });

    it('should handle workflow run failure with artifact processing', async () => {
      // Seed repository first
      const repository = await testDb.seedRepository({
        externalId: mockRepository.id.toString(),
        name: mockRepository.name,
        fullName: mockRepository.full_name,
        owner: mockRepository.owner.login,
        installationId: mockInstallation.id,
      });

      const payload: WorkflowRunWebhookPayload = {
        action: 'completed',
        workflow_run: {
          id: 789012346,
          name: 'CI',
          status: 'completed',
          conclusion: 'failure',
          created_at: '2023-10-01T11:00:00Z',
          updated_at: '2023-10-01T11:10:00Z',
          html_url: 'https://github.com/test-org/flakeguard-test/actions/runs/789012346',
          head_branch: 'feature/new-feature',
          head_sha: 'def456ghi789',
          run_number: 43,
          run_attempt: 1,
          workflow: {
            id: 555666777,
            name: 'CI',
            path: '.github/workflows/ci.yml',
          },
          triggering_actor: {
            login: 'developer',
            id: 98765,
            type: 'User',
            avatar_url: 'https://github.com/images/avatars/developer.png',
          },
          pull_requests: [{
            id: 334455,
            number: 123,
            head: {
              sha: 'def456ghi789',
              ref: 'feature/new-feature',
            },
            base: {
              sha: 'abc123def456',
              ref: 'main',
            },
          }],
        },
        repository: mockRepository,
        workflow: {
          id: 555666777,
          name: 'CI',
          path: '.github/workflows/ci.yml',
        },
      };

      // Mock GitHub App authentication
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      // Mock workflow run jobs with failures
      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test/actions/runs/789012346/jobs')
        .reply(200, {
          total_count: 3,
          jobs: [
            {
              id: 111111112,
              name: 'test-unit',
              status: 'completed',
              conclusion: 'success',
              started_at: '2023-10-01T11:01:00Z',
              completed_at: '2023-10-01T11:03:00Z',
            },
            {
              id: 222222223,
              name: 'test-integration',
              status: 'completed',
              conclusion: 'failure',
              started_at: '2023-10-01T11:01:00Z',
              completed_at: '2023-10-01T11:06:00Z',
            },
            {
              id: 333333334,
              name: 'test-e2e',
              status: 'completed',
              conclusion: 'failure',
              started_at: '2023-10-01T11:03:00Z',
              completed_at: '2023-10-01T11:08:00Z',
            },
          ],
        });

      // Mock artifacts with test results
      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test/actions/runs/789012346/artifacts')
        .reply(200, {
          total_count: 2,
          artifacts: [
            {
              id: 456790,
              name: 'test-results-integration',
              size_in_bytes: 15678,
              created_at: '2023-10-01T11:06:30Z',
              expired: false,
              workflow_run: {
                id: 789012346,
                head_sha: 'def456ghi789',
              },
            },
            {
              id: 456791,
              name: 'test-results-e2e',
              size_in_bytes: 23456,
              created_at: '2023-10-01T11:08:30Z',
              expired: false,
              workflow_run: {
                id: 789012346,
                head_sha: 'def456ghi789',
              },
            },
          ],
        });

      // Process the webhook
      await workflowRunHandler.process(payload);

      // Verify workflow run with failures was stored
      const storedRun = await prisma.workflowRun.findFirst({
        where: { externalId: '789012346' },
        include: { repository: true },
      });

      expect(storedRun).toBeDefined();
      expect(storedRun!.conclusion).toBe('failure');
      expect(storedRun!.repositoryId).toBe(repository.id);

      // Verify ingestion jobs were queued for artifacts
      const jobCounts = await ingestionQueue.getJobCounts();
      expect(jobCounts.waiting + jobCounts.active).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle GitHub API rate limiting gracefully', async () => {
      const payload: CheckRunWebhookPayload = {
        action: 'completed',
        check_run: {
          id: 987654322,
          name: 'CI Tests',
          status: 'completed',
          conclusion: 'success',
          started_at: '2023-10-01T10:00:00Z',
          completed_at: '2023-10-01T10:05:00Z',
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654322',
          check_suite: {
            id: 111222334,
            head_branch: 'main',
            head_sha: 'abc123def456',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'CI Tests Passed',
            summary: 'All tests completed successfully',
            text: null,
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
      };

      // Mock GitHub App authentication success
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      // Mock rate limit response
      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test')
        .reply(403, {
          message: 'API rate limit exceeded',
          documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting',
        }, {
          'X-RateLimit-Limit': '5000',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.floor(Date.now() / 1000 + 3600).toString(),
        });

      // Should not throw error, but handle gracefully
      await expect(checkRunHandler.process(payload)).resolves.not.toThrow();

      // Check run should still be stored even if API calls fail
      const storedCheckRun = await prisma.checkRun.findFirst({
        where: { externalId: '987654322' },
      });

      expect(storedCheckRun).toBeDefined();
    });

    it('should handle invalid installation credentials', async () => {
      const payload: CheckRunWebhookPayload = {
        action: 'created',
        check_run: {
          id: 987654323,
          name: 'CI Tests',
          status: 'queued',
          conclusion: null,
          started_at: '2023-10-01T10:00:00Z',
          completed_at: null,
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654323',
          check_suite: {
            id: 111222335,
            head_branch: 'main',
            head_sha: 'abc123def456',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'CI Tests',
            summary: 'Running automated tests...',
            text: null,
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
      };

      // Mock authentication failure
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(401, {
          message: 'Bad credentials',
          documentation_url: 'https://docs.github.com/rest',
        });

      // Should not throw error, but handle gracefully
      await expect(checkRunHandler.process(payload)).resolves.not.toThrow();

      // Basic storage should still work even without API access
      const storedCheckRun = await prisma.checkRun.findFirst({
        where: { externalId: '987654323' },
      });

      expect(storedCheckRun).toBeDefined();
    });

    it('should handle malformed webhook payloads', async () => {
      const malformedPayload = {
        action: 'completed',
        // Missing required check_run field
        repository: mockRepository,
        installation: mockInstallation,
      } as any;

      // Should handle malformed payload gracefully
      await expect(checkRunHandler.process(malformedPayload))
        .rejects.toThrow(); // Should throw validation error
    });
  });

  describe('Database State Changes', () => {
    it('should correctly update repository installation mapping', async () => {
      const payload: CheckRunWebhookPayload = {
        action: 'created',
        check_run: {
          id: 987654324,
          name: 'CI Tests',
          status: 'queued',
          conclusion: null,
          started_at: '2023-10-01T10:00:00Z',
          completed_at: null,
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654324',
          check_suite: {
            id: 111222336,
            head_branch: 'main',
            head_sha: 'abc123def456',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'CI Tests',
            summary: 'Running automated tests...',
            text: null,
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
      };

      // Process webhook
      await checkRunHandler.process(payload);

      // Verify repository was created/updated with correct installation
      const repository = await prisma.repository.findFirst({
        where: { fullName: 'test-org/flakeguard-test' },
      });

      expect(repository).toBeDefined();
      expect(repository!.installationId).toBe(12345);
      expect(repository!.externalId).toBe(mockRepository.id.toString());
      expect(repository!.isActive).toBe(true);
    });

    it('should create test runs and results from completed workflow', async () => {
      // Seed repository
      const repository = await testDb.seedRepository({
        externalId: mockRepository.id.toString(),
        name: mockRepository.name,
        fullName: mockRepository.full_name,
        owner: mockRepository.owner.login,
        installationId: mockInstallation.id,
      });

      const payload: WorkflowRunWebhookPayload = {
        action: 'completed',
        workflow_run: {
          id: 789012347,
          name: 'Test Suite',
          status: 'completed',
          conclusion: 'failure',
          created_at: '2023-10-01T12:00:00Z',
          updated_at: '2023-10-01T12:15:00Z',
          html_url: 'https://github.com/test-org/flakeguard-test/actions/runs/789012347',
          head_branch: 'main',
          head_sha: 'ghi789jkl012',
          run_number: 44,
          run_attempt: 1,
          workflow: {
            id: 555666778,
            name: 'Test Suite',
            path: '.github/workflows/test.yml',
          },
          triggering_actor: {
            login: 'developer',
            id: 98765,
            type: 'User',
            avatar_url: 'https://github.com/images/avatars/developer.png',
          },
          pull_requests: [],
        },
        repository: mockRepository,
        workflow: {
          id: 555666778,
          name: 'Test Suite',
          path: '.github/workflows/test.yml',
        },
      };

      // Mock required API calls
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test/actions/runs/789012347/jobs')
        .reply(200, {
          total_count: 1,
          jobs: [{
            id: 444444444,
            name: 'run-tests',
            status: 'completed',
            conclusion: 'failure',
            started_at: '2023-10-01T12:01:00Z',
            completed_at: '2023-10-01T12:14:00Z',
          }],
        });

      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test/actions/runs/789012347/artifacts')
        .reply(200, {
          total_count: 0,
          artifacts: [],
        });

      // Process webhook
      await workflowRunHandler.process(payload);

      // Verify workflow run was created
      const workflowRun = await prisma.workflowRun.findFirst({
        where: { externalId: '789012347' },
      });

      expect(workflowRun).toBeDefined();
      expect(workflowRun!.repositoryId).toBe(repository.id);
      expect(workflowRun!.conclusion).toBe('failure');
      expect(workflowRun!.runNumber).toBe(44);
    });
  });

  describe('Queue Integration', () => {
    it('should queue ingestion jobs for artifacts', async () => {
      // Seed repository
      const repository = await testDb.seedRepository({
        externalId: mockRepository.id.toString(),
        name: mockRepository.name,
        fullName: mockRepository.full_name,
        owner: mockRepository.owner.login,
        installationId: mockInstallation.id,
      });

      const payload: CheckRunWebhookPayload = {
        action: 'completed',
        check_run: {
          id: 987654325,
          name: 'CI Tests',
          status: 'completed',
          conclusion: 'success',
          started_at: '2023-10-01T10:00:00Z',
          completed_at: '2023-10-01T10:05:00Z',
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654325',
          check_suite: {
            id: 111222337,
            head_branch: 'main',
            head_sha: 'mno345pqr678',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'CI Tests Passed',
            summary: 'All tests completed successfully',
            text: null,
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
      };

      // Mock API calls
      nock(GITHUB_API_BASE)
        .post('/app/installations/12345/access_tokens')
        .reply(200, {
          token: 'ghs_test_token_123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });

      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test')
        .reply(200, mockRepository);

      nock(GITHUB_API_BASE)
        .get('/repos/test-org/flakeguard-test/actions/artifacts')
        .query({ per_page: 100, name: 'test-results' })
        .reply(200, {
          total_count: 2,
          artifacts: [
            {
              id: 456792,
              name: 'test-results',
              size_in_bytes: 12345,
              created_at: '2023-10-01T10:05:00Z',
              expired: false,
              workflow_run: {
                id: 789012348,
                head_sha: 'mno345pqr678',
              },
            },
            {
              id: 456793,
              name: 'test-results-coverage',
              size_in_bytes: 67890,
              created_at: '2023-10-01T10:05:30Z',
              expired: false,
              workflow_run: {
                id: 789012348,
                head_sha: 'mno345pqr678',
              },
            },
          ],
        });

      // Process webhook
      await checkRunHandler.process(payload);

      // Verify jobs were queued
      const jobs = await ingestionQueue.getJobs(['waiting', 'active']);
      expect(jobs.length).toBeGreaterThan(0);

      // Check job data structure
      const job = jobs.find(j => j.data.artifactId === 456792);
      expect(job).toBeDefined();
      expect(job!.data).toMatchObject({
        repositoryId: repository.id,
        artifactId: 456792,
        workflowRunId: 789012348,
        correlationId: expect.any(String),
      });
    });

    it('should handle queue failures gracefully', async () => {
      // Mock queue to throw error
      const mockQueue = {
        add: vi.fn().mockRejectedValue(new Error('Queue connection failed')),
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0 }),
        close: vi.fn(),
      } as any;

      const handlerWithFailingQueue = new CheckRunHandler({
        prisma,
        authManager,
        helpers,
        flakeDetector: createFlakeDetector({ prisma }),
        ingestionQueue: mockQueue,
      });

      const payload: CheckRunWebhookPayload = {
        action: 'completed',
        check_run: {
          id: 987654326,
          name: 'CI Tests',
          status: 'completed',
          conclusion: 'success',
          started_at: '2023-10-01T10:00:00Z',
          completed_at: '2023-10-01T10:05:00Z',
          html_url: 'https://github.com/test-org/flakeguard-test/runs/987654326',
          check_suite: {
            id: 111222338,
            head_branch: 'main',
            head_sha: 'stu901vwx234',
          },
          app: {
            id: 12345,
            name: 'FlakeGuard CI',
          },
          output: {
            title: 'CI Tests Passed',
            summary: 'All tests completed successfully',
            text: null,
          },
          pull_requests: [],
        },
        repository: mockRepository,
        installation: mockInstallation,
      };

      // Should not throw, should handle queue failures gracefully
      await expect(handlerWithFailingQueue.process(payload)).resolves.not.toThrow();

      // Check run should still be stored despite queue failure
      const storedCheckRun = await prisma.checkRun.findFirst({
        where: { externalId: '987654326' },
      });

      expect(storedCheckRun).toBeDefined();
      expect(mockQueue.add).toHaveBeenCalled();
    });
  });
});