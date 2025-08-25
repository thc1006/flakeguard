/**
 * Octokit Helpers - P2 Implementation
 * 
 * Implements the specific P2 requirements from CLAUDE.md:
 * - getOctokitForInstallation(installationId)
 * - listRunArtifacts({owner, repo, runId})
 * - downloadArtifactZip({owner, repo, artifactId}) → stream to /tmp and return path
 * - listJobsForRun({owner, repo, runId})
 * - Handle short-lived URLs and basic rate limits
 * 
 * This provides the core GitHub API integration functions needed for
 * artifact processing and workflow analysis in FlakeGuard.
 */

import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';
import { createWriteStream, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';

// GitHub API response types
interface GitHubArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  archive_download_url: string;
  expired: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
  workflow_run: {
    id: number;
    head_sha: string;
  };
}

interface GitHubWorkflowRun {
  id: number;
  name: string | null;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  workflow_id: number;
  run_number: number;
  created_at: string;
  updated_at: string;
}

interface GitHubJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  runner_id: number | null;
  runner_name: string | null;
  runner_group_id: number | null;
  runner_group_name: string | null;
  run_id: number;
  run_url: string;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
    started_at: string | null;
    completed_at: string | null;
  }>;
}

// Configuration interface
interface OctokitHelpersConfig {
  githubAppId: string;
  githubAppPrivateKey: string;
  webhookSecret: string;
  installationId?: string;
}

// Error classes
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export class ArtifactDownloadError extends Error {
  constructor(
    message: string,
    public readonly artifactId: number,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ArtifactDownloadError';
  }
}

/**
 * Octokit Helpers - Core implementation
 */
export class OctokitHelpers {
  private readonly app: App;
  private readonly installationOctokits = new Map<number, Octokit>();
  private readonly rateLimitBuffer = 10; // Keep some requests in reserve

  constructor(config: OctokitHelpersConfig) {
    // Initialize GitHub App
    this.app = new App({
      appId: config.githubAppId,
      privateKey: Buffer.from(config.githubAppPrivateKey, 'base64').toString(),
      webhooks: {
        secret: config.webhookSecret,
      },
    });
  }

  /**
   * P2 Requirement: Get authenticated Octokit instance for installation
   */
  async getOctokitForInstallation(installationId: number): Promise<Octokit> {
    // Check if we have a cached instance
    const cachedOctokit = this.installationOctokits.get(installationId);
    if (cachedOctokit) {
      // Verify the token is still valid by checking rate limits
      try {
        await cachedOctokit.rest.rateLimit.get();
        return cachedOctokit;
      } catch (error) {
        // Token might be expired, remove from cache
        this.installationOctokits.delete(installationId);
      }
    }

    try {
      // Create new authenticated Octokit instance
      const octokit = await this.app.getInstallationOctokit(installationId);
      
      // Cache the instance
      this.installationOctokits.set(installationId, octokit);
      
      return octokit;
    } catch (error) {
      throw new GitHubApiError(
        `Failed to get Octokit for installation ${installationId}`,
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * P2 Requirement: List artifacts for a workflow run
   */
  async listRunArtifacts({
    owner,
    repo,
    runId,
    installationId,
  }: {
    owner: string;
    repo: string;
    runId: number;
    installationId: number;
  }): Promise<GitHubArtifact[]> {
    const octokit = await this.getOctokitForInstallation(installationId);
    
    try {
      // Check rate limits before making request
      await this.checkRateLimit(octokit);

      const response = await octokit.rest.actions.listWorkflowRunArtifacts({
        owner,
        repo,
        run_id: runId,
        per_page: 100, // GitHub's maximum
      });

      return response.data.artifacts as GitHubArtifact[];
    } catch (error) {
      throw new GitHubApiError(
        `Failed to list artifacts for run ${runId} in ${owner}/${repo}`,
        error instanceof Error && 'status' in error ? (error as any).status : undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * P2 Requirement: Download artifact zip to /tmp and return path
   * Handles short-lived URLs by downloading immediately
   */
  async downloadArtifactZip({
    owner,
    repo,
    artifactId,
    installationId,
  }: {
    owner: string;
    repo: string;
    artifactId: number;
    installationId: number;
  }): Promise<string> {
    const octokit = await this.getOctokitForInstallation(installationId);
    
    try {
      // Check rate limits before making request
      await this.checkRateLimit(octokit);

      // Get artifact download URL (this is short-lived!)
      const downloadResponse = await octokit.rest.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: artifactId,
        archive_format: 'zip',
      });

      // Create temporary directory and file path
      const tmpDir = mkdtempSync(join(tmpdir(), 'flakeguard-artifact-'));
      const artifactPath = join(tmpDir, `artifact-${artifactId}.zip`);

      // Download immediately since URL is short-lived
      const response = await fetch(downloadResponse.url, {
        headers: {
          'Authorization': `token ${octokit.rest.request.endpoint.defaults.headers?.authorization?.replace('token ', '') || ''}`,
          'User-Agent': 'FlakeGuard/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Stream the response to file
      const fileStream = createWriteStream(artifactPath);
      
      if (!response.body) {
        throw new Error('No response body from artifact download');
      }

      await pipeline(
        response.body as unknown as Readable,
        fileStream
      );

      return artifactPath;
    } catch (error) {
      throw new ArtifactDownloadError(
        `Failed to download artifact ${artifactId} from ${owner}/${repo}`,
        artifactId,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * P2 Requirement: List jobs for a workflow run
   */
  async listJobsForRun({
    owner,
    repo,
    runId,
    installationId,
  }: {
    owner: string;
    repo: string;
    runId: number;
    installationId: number;
  }): Promise<GitHubJob[]> {
    const octokit = await this.getOctokitForInstallation(installationId);
    
    try {
      // Check rate limits before making request
      await this.checkRateLimit(octokit);

      const response = await octokit.rest.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: runId,
        per_page: 100, // GitHub's maximum
      });

      return response.data.jobs as GitHubJob[];
    } catch (error) {
      throw new GitHubApiError(
        `Failed to list jobs for run ${runId} in ${owner}/${repo}`,
        error instanceof Error && 'status' in error ? (error as any).status : undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get workflow run details
   */
  async getWorkflowRun({
    owner,
    repo,
    runId,
    installationId,
  }: {
    owner: string;
    repo: string;
    runId: number;
    installationId: number;
  }): Promise<GitHubWorkflowRun> {
    const octokit = await this.getOctokitForInstallation(installationId);
    
    try {
      await this.checkRateLimit(octokit);

      const response = await octokit.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });

      return response.data as GitHubWorkflowRun;
    } catch (error) {
      throw new GitHubApiError(
        `Failed to get workflow run ${runId} in ${owner}/${repo}`,
        error instanceof Error && 'status' in error ? (error as any).status : undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Re-run failed jobs in a workflow run
   */
  async rerunFailedJobs({
    owner,
    repo,
    runId,
    installationId,
  }: {
    owner: string;
    repo: string;
    runId: number;
    installationId: number;
  }): Promise<void> {
    const octokit = await this.getOctokitForInstallation(installationId);
    
    try {
      await this.checkRateLimit(octokit);

      await octokit.rest.actions.reRunWorkflowFailedJobs({
        owner,
        repo,
        run_id: runId,
      });
    } catch (error) {
      throw new GitHubApiError(
        `Failed to re-run failed jobs for run ${runId} in ${owner}/${repo}`,
        error instanceof Error && 'status' in error ? (error as any).status : undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Check rate limits and throw if approaching limit
   * P2 Requirement: Handle basic rate limits
   */
  private async checkRateLimit(octokit: Octokit): Promise<void> {
    try {
      const { data: rateLimit } = await octokit.rest.rateLimit.get();
      const remaining = rateLimit.rate.remaining;
      
      if (remaining <= this.rateLimitBuffer) {
        const resetTime = new Date(rateLimit.rate.reset * 1000);
        const waitTime = resetTime.getTime() - Date.now();
        
        if (waitTime > 0) {
          throw new GitHubApiError(
            `Rate limit exceeded. ${remaining} requests remaining. Resets at ${resetTime.toISOString()}`,
            429
          );
        }
      }
    } catch (error) {
      // If we can't check rate limits, log warning but continue
      console.warn('Failed to check GitHub rate limits:', error);
    }
  }

  /**
   * Clean up cached Octokit instances
   */
  clearCache(): void {
    this.installationOctokits.clear();
  }

  /**
   * Get current rate limit status for an installation
   */
  async getRateLimitStatus(installationId: number): Promise<{
    remaining: number;
    limit: number;
    reset: Date;
    resource: string;
  }> {
    const octokit = await this.getOctokitForInstallation(installationId);
    const { data: rateLimit } = await octokit.rest.rateLimit.get();
    
    return {
      remaining: rateLimit.rate.remaining,
      limit: rateLimit.rate.limit,
      reset: new Date(rateLimit.rate.reset * 1000),
      resource: 'core',
    };
  }
}

/**
 * Factory function to create OctokitHelpers from environment variables
 */
export function createOctokitHelpers(): OctokitHelpers {
  const config: OctokitHelpersConfig = {
    githubAppId: process.env.GITHUB_APP_ID || '',
    githubAppPrivateKey: process.env.GITHUB_APP_PRIVATE_KEY_BASE64 || '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    installationId: process.env.GITHUB_APP_INSTALLATION_ID,
  };

  // Validate required config
  if (!config.githubAppId) {
    throw new Error('GITHUB_APP_ID environment variable is required');
  }
  if (!config.githubAppPrivateKey) {
    throw new Error('GITHUB_APP_PRIVATE_KEY_BASE64 environment variable is required');
  }
  if (!config.webhookSecret) {
    throw new Error('GITHUB_WEBHOOK_SECRET environment variable is required');
  }

  return new OctokitHelpers(config);
}

// Export types
export type {
  GitHubArtifact,
  GitHubWorkflowRun,
  GitHubJob,
  OctokitHelpersConfig,
};