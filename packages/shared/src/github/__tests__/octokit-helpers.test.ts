/**
 * Octokit Helpers Tests - P2 Implementation
 * 
 * Unit tests for the P2 Octokit helper functions with mocked GitHub API.
 */

import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';

import { TestCrypto } from '../../utils/test-crypto.js';
import { 
  OctokitHelpers, 
  GitHubApiError, 
  ArtifactDownloadError,
  type GitHubArtifact,
  type GitHubJob,
  type GitHubWorkflowRun
} from '../octokit-helpers.js';

// Mock dependencies with proper types
interface MockApp {
  getInstallationOctokit: MockedFunction<(installationId: number) => Promise<MockOctokit>>;
}

interface MockOctokit {
  rest: {
    rateLimit: {
      get: MockedFunction<() => Promise<{ data: { rate: { remaining: number; limit: number; reset: number } } }>>;
    };
    actions: {
      listWorkflowRunArtifacts: MockedFunction<(params: { owner: string; repo: string; run_id: number; per_page: number }) => Promise<{ data: { artifacts: GitHubArtifact[] } }>>;
      downloadArtifact: MockedFunction<(params: { owner: string; repo: string; artifact_id: number; archive_format: string }) => Promise<{ url: string }>>;
      listJobsForWorkflowRun: MockedFunction<(params: { owner: string; repo: string; run_id: number; per_page: number }) => Promise<{ data: { jobs: GitHubJob[] } }>>;
      getWorkflowRun: MockedFunction<(params: { owner: string; repo: string; run_id: number }) => Promise<{ data: GitHubWorkflowRun }>>;
      reRunWorkflowFailedJobs: MockedFunction<(params: { owner: string; repo: string; run_id: number }) => Promise<void>>;
    };
  };
}

vi.mock('@octokit/app', () => ({
  App: vi.fn(),
}));

vi.mock('fs', () => ({
  createWriteStream: vi.fn(),
  mkdtempSync: vi.fn(),
}));

vi.mock('os', () => ({
  tmpdir: vi.fn(),
}));

vi.mock('path', () => ({
  join: vi.fn(),
}));

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}));

// Generate test secrets once for the entire test suite
const testSecrets = {
  privateKey: TestCrypto.generateBase64PrivateKey(), // Base64 encoded for this test
  webhookSecret: TestCrypto.generateWebhookSecret(),
};

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}));

global.fetch = vi.fn();

describe('OctokitHelpers - P2', () => {
  let octokitHelpers: OctokitHelpers;
  let mockOctokit: MockOctokit;
  let mockApp: MockApp;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock Octokit instance
    mockOctokit = {
      rest: {
        rateLimit: {
          get: vi.fn().mockResolvedValue({
            data: {
              rate: {
                remaining: 5000,
                limit: 5000,
                reset: Math.floor(Date.now() / 1000) + 3600,
              },
            },
          }),
        },
        actions: {
          listWorkflowRunArtifacts: vi.fn(),
          downloadArtifact: vi.fn(),
          listJobsForWorkflowRun: vi.fn(),
          getWorkflowRun: vi.fn(),
          reRunWorkflowFailedJobs: vi.fn(),
        },
      },
    };

    // Mock App instance
    mockApp = {
      getInstallationOctokit: vi.fn().mockResolvedValue(mockOctokit),
    };

    // Set up App mock implementation
    const { App } = await import('@octokit/app');
    vi.mocked(App).mockImplementation(() => mockApp as never);

    octokitHelpers = new OctokitHelpers({
      githubAppId: '12345',
      githubAppPrivateKey: testSecrets.privateKey,
      webhookSecret: testSecrets.webhookSecret,
    });
  });

  describe('getOctokitForInstallation', () => {
    it('should return Octokit instance for installation', async () => {
      const result = await octokitHelpers.getOctokitForInstallation(123);

      expect(mockApp.getInstallationOctokit).toHaveBeenCalledWith(123);
      expect(result).toBe(mockOctokit);
    });

    it('should cache Octokit instances', async () => {
      await octokitHelpers.getOctokitForInstallation(123);
      await octokitHelpers.getOctokitForInstallation(123);

      expect(mockApp.getInstallationOctokit).toHaveBeenCalledTimes(1);
    });

    it('should handle rate limit check errors gracefully', async () => {
      mockOctokit.rest.rateLimit.get.mockRejectedValue(new Error('Rate limit check failed'));

      const result = await octokitHelpers.getOctokitForInstallation(123);
      expect(result).toBe(mockOctokit);
    });

    it('should throw GitHubApiError on authentication failure', async () => {
      mockApp.getInstallationOctokit.mockRejectedValue(new Error('Authentication failed'));

      await expect(octokitHelpers.getOctokitForInstallation(123))
        .rejects.toThrow(GitHubApiError);
    });
  });

  describe('listRunArtifacts', () => {
    const testParams = {
      owner: 'test-owner',
      repo: 'test-repo',
      runId: 123456,
      installationId: 789,
    };

    it('should list workflow run artifacts', async () => {
      const mockArtifacts: GitHubArtifact[] = [
        {
          id: 1,
          name: 'test-results',
          size_in_bytes: 1024,
          archive_download_url: 'https://api.github.com/download/1',
          expired: false,
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          expires_at: '2023-01-02T00:00:00Z',
          workflow_run: {
            id: 123456,
            head_sha: 'abc123',
          },
        },
      ];

      mockOctokit.rest.actions.listWorkflowRunArtifacts.mockResolvedValue({
        data: { artifacts: mockArtifacts },
      });

      const result = await octokitHelpers.listRunArtifacts(testParams);

      expect(mockOctokit.rest.actions.listWorkflowRunArtifacts).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        run_id: 123456,
        per_page: 100,
      });
      expect(result).toEqual(mockArtifacts);
    });

    it('should handle API errors', async () => {
      const error = new Error('Not found') as Error & { status: number };
      error.status = 404;
      mockOctokit.rest.actions.listWorkflowRunArtifacts.mockRejectedValue(error);

      await expect(octokitHelpers.listRunArtifacts(testParams))
        .rejects.toThrow(GitHubApiError);
    });

    it('should check rate limits before API calls', async () => {
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            remaining: 5, // Very low
            limit: 5000,
            reset: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      });

      mockOctokit.rest.actions.listWorkflowRunArtifacts.mockRejectedValue(
        new GitHubApiError('Rate limit exceeded', 429)
      );

      await expect(octokitHelpers.listRunArtifacts(testParams))
        .rejects.toThrow(GitHubApiError);
    });
  });

  describe('downloadArtifactZip', () => {
    const testParams = {
      owner: 'test-owner',
      repo: 'test-repo',
      artifactId: 123,
      installationId: 789,
    };

    beforeEach(async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const streamPromises = await import('stream/promises');

      vi.mocked(fs.mkdtempSync).mockReturnValue('/tmp/flakeguard-artifact-test');
      vi.mocked(os.tmpdir).mockReturnValue('/tmp');
      vi.mocked(path.join).mockReturnValue('/tmp/flakeguard-artifact-test/artifact-123.zip');
      vi.mocked(fs.createWriteStream).mockReturnValue({
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
        writable: true,
      } as unknown as NodeJS.WriteStream);
      vi.mocked(streamPromises.pipeline).mockResolvedValue(undefined);
    });

    it('should download artifact and return file path', async () => {
      mockOctokit.rest.actions.downloadArtifact.mockResolvedValue({
        url: 'https://github.com/artifacts/download/123',
      });

      (global.fetch as MockedFunction<typeof fetch>).mockResolvedValue(
        new Response(new ArrayBuffer(1024), {
          status: 200,
          statusText: 'OK',
        })
      );

      const result = await octokitHelpers.downloadArtifactZip(testParams);

      expect(mockOctokit.rest.actions.downloadArtifact).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        artifact_id: 123,
        archive_format: 'zip',
      });
      expect(result).toBe('/tmp/flakeguard-artifact-test/artifact-123.zip');
    });

    it('should handle download errors', async () => {
      mockOctokit.rest.actions.downloadArtifact.mockRejectedValue(
        new Error('Download failed')
      );

      await expect(octokitHelpers.downloadArtifactZip(testParams))
        .rejects.toThrow(ArtifactDownloadError);
    });

    it('should handle HTTP errors in fetch', async () => {
      mockOctokit.rest.actions.downloadArtifact.mockResolvedValue({
        url: 'https://github.com/artifacts/download/123',
      });

      (global.fetch as MockedFunction<typeof fetch>).mockResolvedValue(
        new Response(null, {
          status: 404,
          statusText: 'Not Found',
        })
      );

      await expect(octokitHelpers.downloadArtifactZip(testParams))
        .rejects.toThrow(ArtifactDownloadError);
    });
  });

  describe('listJobsForRun', () => {
    const testParams = {
      owner: 'test-owner',
      repo: 'test-repo',
      runId: 123456,
      installationId: 789,
    };

    it('should list jobs for workflow run', async () => {
      const mockJobs: GitHubJob[] = [
        {
          id: 1,
          name: 'test-job',
          status: 'completed',
          conclusion: 'success',
          started_at: '2023-01-01T00:00:00Z',
          completed_at: '2023-01-01T00:05:00Z',
          runner_id: 123,
          runner_name: 'GitHub Actions 1',
          runner_group_id: 1,
          runner_group_name: 'Default',
          run_id: 123456,
          run_url: 'https://api.github.com/repos/owner/repo/actions/runs/123456',
          steps: [
            {
              name: 'Checkout',
              status: 'completed',
              conclusion: 'success',
              number: 1,
              started_at: '2023-01-01T00:00:00Z',
              completed_at: '2023-01-01T00:01:00Z',
            },
          ],
        },
      ];

      mockOctokit.rest.actions.listJobsForWorkflowRun.mockResolvedValue({
        data: { jobs: mockJobs },
      });

      const result = await octokitHelpers.listJobsForRun(testParams);

      expect(mockOctokit.rest.actions.listJobsForWorkflowRun).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        run_id: 123456,
        per_page: 100,
      });
      expect(result).toEqual(mockJobs);
    });

    it('should handle API errors', async () => {
      mockOctokit.rest.actions.listJobsForWorkflowRun.mockRejectedValue(
        new Error('API error')
      );

      await expect(octokitHelpers.listJobsForRun(testParams))
        .rejects.toThrow(GitHubApiError);
    });
  });

  describe('rerunFailedJobs', () => {
    const testParams = {
      owner: 'test-owner',
      repo: 'test-repo',
      runId: 123456,
      installationId: 789,
    };

    it('should re-run failed jobs', async () => {
      mockOctokit.rest.actions.reRunWorkflowFailedJobs.mockResolvedValue(undefined);

      await octokitHelpers.rerunFailedJobs(testParams);

      expect(mockOctokit.rest.actions.reRunWorkflowFailedJobs).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        run_id: 123456,
      });
    });

    it('should handle API errors', async () => {
      mockOctokit.rest.actions.reRunWorkflowFailedJobs.mockRejectedValue(
        new Error('Re-run failed')
      );

      await expect(octokitHelpers.rerunFailedJobs(testParams))
        .rejects.toThrow(GitHubApiError);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return rate limit status', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 3600;
      mockOctokit.rest.rateLimit.get.mockResolvedValue({
        data: {
          rate: {
            remaining: 4500,
            limit: 5000,
            reset: resetTime,
          },
        },
      });

      const result = await octokitHelpers.getRateLimitStatus(789);

      expect(result).toEqual({
        remaining: 4500,
        limit: 5000,
        reset: new Date(resetTime * 1000),
        resource: 'core',
      });
    });
  });

  describe('clearCache', () => {
    it('should clear cached Octokit instances', async () => {
      await octokitHelpers.getOctokitForInstallation(123);
      octokitHelpers.clearCache();
      await octokitHelpers.getOctokitForInstallation(123);

      expect(mockApp.getInstallationOctokit).toHaveBeenCalledTimes(2);
    });
  });
});