/**
 * GitHub Webhook Processor Tests - P3 Implementation
 * 
 * Unit tests for the P3 artifact ingestion processor that handles
 * GitHub webhook events and processes JUnit XML results.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { createGitHubWebhookProcessor } from '../github-webhook.processor.js';
import type { GitHubEventJob } from '../../../api/src/routes/github-webhook.js';

// Mock dependencies
vi.mock('@flakeguard/shared', () => ({
  createOctokitHelpers: vi.fn(() => ({
    listRunArtifacts: vi.fn(),
    downloadArtifactZip: vi.fn(),
  })),
}));

vi.mock('../../../api/src/ingestion/parsers/junit-parser.js', () => ({
  parseJUnitXMLFile: vi.fn(),
}));

vi.mock('node-stream-zip', () => {
  return {
    __esModule: true,
    default: {
      async: vi.fn().mockImplementation(() => ({
        extract: vi.fn(),
        entries: vi.fn(),
        close: vi.fn(),
      })),
    },
  };
});

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('path', () => ({
  join: vi.fn(),
  extname: vi.fn(),
}));

vi.mock('os', () => ({
  tmpdir: vi.fn(),
}));

describe('GitHub Webhook Processor - P3', () => {
  let processor: ReturnType<typeof createGitHubWebhookProcessor>;
  let mockPrisma: any;
  let mockOctokitHelpers: any;
  let mockJob: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Prisma
    mockPrisma = {
      $transaction: vi.fn(),
      workflowRun: {
        upsert: vi.fn(),
      },
      testCase: {
        upsert: vi.fn(),
      },
      occurrence: {
        create: vi.fn(),
      },
    };

    // Mock Octokit helpers
    mockOctokitHelpers = {
      listRunArtifacts: vi.fn(),
      downloadArtifactZip: vi.fn(),
    };

    const { createOctokitHelpers } = require('@flakeguard/shared');
    createOctokitHelpers.mockReturnValue(mockOctokitHelpers);

    // Mock Job
    mockJob = {
      id: 'test-job-id',
      updateProgress: vi.fn(),
      data: {} as GitHubEventJob,
    };

    processor = createGitHubWebhookProcessor(mockPrisma as PrismaClient);
  });

  describe('Event Processing', () => {
    it('should process workflow_run completed events', async () => {
      const jobData: GitHubEventJob = {
        eventType: 'workflow_run',
        deliveryId: 'test-delivery-id',
        repositoryId: 1234,
        repositoryFullName: 'owner/repo',
        installationId: 5678,
        action: 'completed',
        payload: {
          workflow_run: {
            id: 98765,
            head_sha: 'abc123',
            head_branch: 'main',
            run_number: 42,
            conclusion: 'success',
            html_url: 'https://github.com/owner/repo/actions/runs/98765',
          },
        },
        receivedAt: new Date().toISOString(),
      };

      mockJob.data = jobData;

      // Mock artifacts
      const mockArtifacts = [
        {
          id: 1,
          name: 'test-results',
          expired: false,
        },
      ];

      mockOctokitHelpers.listRunArtifacts.mockResolvedValue(mockArtifacts);
      mockOctokitHelpers.downloadArtifactZip.mockResolvedValue('/tmp/artifact.zip');

      // Mock parser
      const { parseJUnitXMLFile } = require('../../../api/src/ingestion/parsers/junit-parser.js');
      parseJUnitXMLFile.mockResolvedValue({
        testSuites: {
          suites: [
            {
              name: 'TestSuite',
              tests: 2,
              failures: 1,
              errors: 0,
              skipped: 0,
              time: 1.5,
              timestamp: '2023-01-01T00:00:00Z',
              testCases: [
                {
                  name: 'testPass',
                  className: 'com.example.Test',
                  time: 0.5,
                  status: 'passed',
                },
                {
                  name: 'testFail',
                  className: 'com.example.Test',
                  time: 1.0,
                  status: 'failed',
                  failure: {
                    message: 'Assertion failed',
                    type: 'AssertionError',
                    stackTrace: 'at line 123',
                  },
                },
              ],
            },
          ],
        },
      });

      // Mock database operations
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrisma);
      });

      mockPrisma.workflowRun.upsert.mockResolvedValue({ id: 98765, repoId: 1 });
      mockPrisma.testCase.upsert.mockResolvedValue({ id: 'test-case-id' });
      mockPrisma.occurrence.create.mockResolvedValue({ id: 'occurrence-id' });

      // Mock ZIP extraction
      const StreamZip = require('node-stream-zip').default;
      const mockZip = {
        extract: vi.fn(),
        entries: vi.fn().mockResolvedValue({
          'test-results.xml': { name: 'test-results.xml', isDirectory: false },
        }),
        close: vi.fn(),
      };
      StreamZip.async.mockReturnValue(mockZip);

      const path = require('path');
      path.join.mockReturnValue('/tmp/test-results.xml');
      path.extname.mockReturnValue('.xml');

      const result = await processor(mockJob as Job<GitHubEventJob>);

      expect(result.success).toBe(true);
      expect(result.processedArtifacts).toBe(1);
      expect(result.totalTests).toBe(2);
      expect(result.failedTests).toBe(1);
      expect(mockJob.updateProgress).toHaveBeenCalledTimes(4);
      expect(mockOctokitHelpers.listRunArtifacts).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        runId: 98765,
        installationId: 5678,
      });
    });

    it('should skip non-workflow_run events', async () => {
      const jobData: GitHubEventJob = {
        eventType: 'pull_request',
        deliveryId: 'test-delivery-id',
        repositoryFullName: 'owner/repo',
        installationId: 5678,
        action: 'opened',
        payload: {},
        receivedAt: new Date().toISOString(),
      };

      mockJob.data = jobData;

      const result = await processor(mockJob as Job<GitHubEventJob>);

      expect(result.success).toBe(true);
      expect(result.processedArtifacts).toBe(0);
      expect(result.totalTests).toBe(0);
      expect(mockOctokitHelpers.listRunArtifacts).not.toHaveBeenCalled();
    });

    it('should skip workflow_run events that are not completed', async () => {
      const jobData: GitHubEventJob = {
        eventType: 'workflow_run',
        deliveryId: 'test-delivery-id',
        repositoryFullName: 'owner/repo',
        installationId: 5678,
        action: 'in_progress',
        payload: {
          workflow_run: { id: 12345 },
        },
        receivedAt: new Date().toISOString(),
      };

      mockJob.data = jobData;

      const result = await processor(mockJob as Job<GitHubEventJob>);

      expect(result.success).toBe(true);
      expect(result.processedArtifacts).toBe(0);
      expect(mockOctokitHelpers.listRunArtifacts).not.toHaveBeenCalled();
    });

    it('should handle no test artifacts found', async () => {
      const jobData: GitHubEventJob = {
        eventType: 'workflow_run',
        deliveryId: 'test-delivery-id',
        repositoryFullName: 'owner/repo',
        installationId: 5678,
        action: 'completed',
        payload: {
          workflow_run: { id: 12345 },
        },
        receivedAt: new Date().toISOString(),
      };

      mockJob.data = jobData;

      // Mock no test artifacts
      mockOctokitHelpers.listRunArtifacts.mockResolvedValue([
        {
          id: 1,
          name: 'build-logs', // Not a test artifact
          expired: false,
        },
      ]);

      const result = await processor(mockJob as Job<GitHubEventJob>);

      expect(result.success).toBe(true);
      expect(result.processedArtifacts).toBe(0);
      expect(result.totalTests).toBe(0);
    });

    it('should filter expired artifacts', async () => {
      const jobData: GitHubEventJob = {
        eventType: 'workflow_run',
        deliveryId: 'test-delivery-id',
        repositoryFullName: 'owner/repo',
        installationId: 5678,
        action: 'completed',
        payload: {
          workflow_run: { id: 12345 },
        },
        receivedAt: new Date().toISOString(),
      };

      mockJob.data = jobData;

      mockOctokitHelpers.listRunArtifacts.mockResolvedValue([
        {
          id: 1,
          name: 'test-results',
          expired: true, // Should be filtered out
        },
        {
          id: 2,
          name: 'junit-results',
          expired: false, // Should be processed
        },
      ]);

      mockOctokitHelpers.downloadArtifactZip.mockResolvedValue('/tmp/artifact.zip');

      // Mock parser to return empty results
      const { parseJUnitXMLFile } = require('../../../api/src/ingestion/parsers/junit-parser.js');
      parseJUnitXMLFile.mockResolvedValue({
        testSuites: { suites: [] },
      });

      // Mock ZIP extraction
      const StreamZip = require('node-stream-zip').default;
      StreamZip.async.mockReturnValue({
        extract: vi.fn(),
        entries: vi.fn().mockResolvedValue({}),
        close: vi.fn(),
      });

      mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

      const result = await processor(mockJob as Job<GitHubEventJob>);

      expect(result.success).toBe(true);
      expect(result.processedArtifacts).toBe(1); // Only one non-expired artifact
      expect(mockOctokitHelpers.downloadArtifactZip).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        artifactId: 2, // Only the non-expired artifact
        installationId: 5678,
      });
    });

    it('should handle errors in artifact processing gracefully', async () => {
      const jobData: GitHubEventJob = {
        eventType: 'workflow_run',
        deliveryId: 'test-delivery-id',
        repositoryFullName: 'owner/repo',
        installationId: 5678,
        action: 'completed',
        payload: {
          workflow_run: { id: 12345 },
        },
        receivedAt: new Date().toISOString(),
      };

      mockJob.data = jobData;

      mockOctokitHelpers.listRunArtifacts.mockResolvedValue([
        { id: 1, name: 'test-results', expired: false },
      ]);

      mockOctokitHelpers.downloadArtifactZip.mockRejectedValue(
        new Error('Download failed')
      );

      mockPrisma.$transaction.mockImplementation(async (callback) => callback(mockPrisma));

      const result = await processor(mockJob as Job<GitHubEventJob>);

      expect(result.success).toBe(true);
      expect(result.processedArtifacts).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to process artifact test-results');
    });
  });

  describe('Database Operations', () => {
    it('should upsert TestCase and create Occurrence records', async () => {
      const jobData: GitHubEventJob = {
        eventType: 'workflow_run',
        deliveryId: 'test-delivery-id',
        repositoryFullName: 'owner/repo',
        installationId: 5678,
        action: 'completed',
        payload: {
          workflow_run: {
            id: 12345,
            head_sha: 'abc123',
            head_branch: 'main',
            run_number: 1,
            conclusion: 'failure',
          },
        },
        receivedAt: new Date().toISOString(),
      };

      mockJob.data = jobData;

      mockOctokitHelpers.listRunArtifacts.mockResolvedValue([
        { id: 1, name: 'junit-results', expired: false },
      ]);
      mockOctokitHelpers.downloadArtifactZip.mockResolvedValue('/tmp/artifact.zip');

      const { parseJUnitXMLFile } = require('../../../api/src/ingestion/parsers/junit-parser.js');
      parseJUnitXMLFile.mockResolvedValue({
        testSuites: {
          suites: [
            {
              name: 'ExampleSuite',
              tests: 1,
              failures: 1,
              errors: 0,
              skipped: 0,
              time: 2.0,
              timestamp: '2023-01-01T00:00:00Z',
              testCases: [
                {
                  name: 'testMethod',
                  className: 'com.example.ExampleTest',
                  time: 2.0,
                  status: 'failed',
                  failure: {
                    message: 'Expected true but was false',
                    type: 'AssertionError',
                    stackTrace: 'java.lang.AssertionError: Expected true but was false\n\tat ExampleTest.java:15',
                  },
                },
              ],
            },
          ],
        },
      });

      // Mock ZIP extraction
      const StreamZip = require('node-stream-zip').default;
      StreamZip.async.mockReturnValue({
        extract: vi.fn(),
        entries: vi.fn().mockResolvedValue({
          'results.xml': { name: 'results.xml', isDirectory: false },
        }),
        close: vi.fn(),
      });

      const path = require('path');
      path.extname.mockReturnValue('.xml');

      // Setup database transaction mock
      let transactionCallback: any;
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        transactionCallback = callback;
        return callback(mockPrisma);
      });

      mockPrisma.workflowRun.upsert.mockResolvedValue({ id: 12345, repoId: 1 });
      mockPrisma.testCase.upsert.mockResolvedValue({ id: 'test-case-uuid' });
      mockPrisma.occurrence.create.mockResolvedValue({ id: 'occurrence-uuid' });

      const result = await processor(mockJob as Job<GitHubEventJob>);

      expect(result.success).toBe(true);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.workflowRun.upsert).toHaveBeenCalledWith({
        where: { id: 12345 },
        update: {
          conclusion: 'failure',
          updatedAt: expect.any(Date),
        },
        create: expect.objectContaining({
          id: 12345,
          repoId: 0, // Default value in current implementation
          runId: 12345,
          status: 'completed',
          conclusion: 'failure',
        }),
      });

      expect(mockPrisma.testCase.upsert).toHaveBeenCalledWith({
        where: {
          repoId_suite_className_name: {
            repoId: 1,
            suite: 'ExampleSuite',
            className: 'com.example.ExampleTest',
            name: 'testMethod',
          },
        },
        update: {
          ownerTeam: null,
        },
        create: {
          repoId: 1,
          suite: 'ExampleSuite',
          className: 'com.example.ExampleTest',
          name: 'testMethod',
          file: null,
          ownerTeam: null,
        },
      });

      expect(mockPrisma.occurrence.create).toHaveBeenCalledWith({
        data: {
          testId: 'test-case-uuid',
          runId: 12345,
          status: 'failed',
          durationMs: 2000, // 2.0 seconds * 1000
          failureMsgSignature: 'Expected true but was false',
          failureStackDigest: 'java.lang.AssertionError: Expected true but was false\n\tat ExampleTest.java:15',
          attempt: 1,
          createdAt: expect.any(Date),
        },
      });
    });
  });
});