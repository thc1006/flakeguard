/**
 * GitHub API Service for Worker
 * 
 * Worker-specific GitHub API service that wraps the shared API wrapper
 * with worker-specific functionality and error handling.
 */

import { Octokit } from '@octokit/rest';
import { z } from 'zod';

import { logger } from '../utils/logger.js';
import { recordGitHubApiCall } from '../utils/metrics.js';

// Zod schemas for GitHub API responses
const WorkflowRunArtifactSchema = z.object({
  id: z.number(),
  name: z.string(),
  size_in_bytes: z.number(),
  url: z.string(),
  archive_download_url: z.string(),
  expired: z.boolean(),
  created_at: z.string().optional(),
  expires_at: z.string().optional(),
  updated_at: z.string().optional(),
});

const WorkflowRunArtifactsResponseSchema = z.object({
  data: z.object({
    artifacts: z.array(WorkflowRunArtifactSchema),
    total_count: z.number()
  }),
  status: z.number(),
  headers: z.record(z.unknown())
});

const ArtifactDownloadResponseSchema = z.object({
  data: z.instanceof(ArrayBuffer),
  status: z.number(),
  headers: z.record(z.unknown())
});

// Types
export interface WorkflowRunArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  url: string;
  archive_download_url: string;
  expired: boolean;
  created_at?: string;
  expires_at?: string;
  updated_at?: string;
}

export interface ListArtifactsOptions {
  owner: string;
  repo: string;
  runId: number;
  installationId?: number;
}

export interface DownloadArtifactOptions {
  owner: string;
  repo: string;
  artifactId: number;
  installationId?: number;
}

export interface GitHubApiMetrics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  averageResponseTime: number;
  rateLimitRemaining: number;
  rateLimitReset: Date | null;
}

/**
 * GitHub API Service for worker processes
 */
export class GitHubApiService {
  private readonly octokit: Octokit;
  private metrics: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    responseTimes: number[];
    rateLimitRemaining: number;
    rateLimitReset: Date | null;
  } = {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    responseTimes: [],
    rateLimitRemaining: 5000,
    rateLimitReset: null
  };

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * List workflow run artifacts
   */
  async listWorkflowRunArtifacts(options: ListArtifactsOptions): Promise<WorkflowRunArtifact[]> {
    const startTime = Date.now();
    
    try {
      logger.debug({
        owner: options.owner,
        repo: options.repo,
        runId: options.runId
      }, 'Listing workflow run artifacts');

      const response = await this.octokit.rest.actions.listWorkflowRunArtifacts({
        owner: options.owner,
        repo: options.repo,
        run_id: options.runId,
        per_page: 100
      });

      const duration = Date.now() - startTime;
      this.updateMetrics(true, duration, response.headers);
      recordGitHubApiCall('listWorkflowRunArtifacts', 'GET', response.status, duration);

      // Validate response structure
      const validatedResponse = WorkflowRunArtifactsResponseSchema.parse(response);
      
      const artifacts = validatedResponse.data.artifacts.map(artifact => ({
        ...artifact,
        created_at: artifact.created_at ?? new Date().toISOString(),
        expires_at: artifact.expires_at ?? new Date().toISOString(),
        updated_at: artifact.updated_at ?? new Date().toISOString()
      }));

      logger.debug({
        owner: options.owner,
        repo: options.repo,
        runId: options.runId,
        artifactCount: artifacts.length
      }, 'Successfully listed workflow run artifacts');

      return artifacts;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(false, duration);
      recordGitHubApiCall('listWorkflowRunArtifacts', 'GET', 500, duration);

      if (error instanceof Error && 'status' in error && (error as Error & { status: number }).status === 404) {
        logger.warn({
          owner: options.owner,
          repo: options.repo,
          runId: options.runId
        }, 'Workflow run not found');
        return [];
      }

      if (error instanceof z.ZodError) {
        logger.error({
          error: error.errors,
          owner: options.owner,
          repo: options.repo,
          runId: options.runId
        }, 'Invalid GitHub API response structure for artifacts');
        return [];
      }

      logger.error({
        error: error instanceof Error ? error.message : String(error),
        owner: options.owner,
        repo: options.repo,
        runId: options.runId
      }, 'Failed to list workflow run artifacts');

      throw error;
    }
  }

  /**
   * Download artifact
   */
  async downloadArtifact(options: DownloadArtifactOptions): Promise<ArrayBuffer> {
    const startTime = Date.now();
    
    try {
      logger.debug({
        owner: options.owner,
        repo: options.repo,
        artifactId: options.artifactId
      }, 'Downloading artifact');

      const response = await this.octokit.rest.actions.downloadArtifact({
        owner: options.owner,
        repo: options.repo,
        artifact_id: options.artifactId,
        archive_format: 'zip'
      });

      const duration = Date.now() - startTime;
      this.updateMetrics(true, duration, response.headers);
      recordGitHubApiCall('downloadArtifact', 'GET', response.status, duration);

      // Validate response structure
      const validatedResponse = ArtifactDownloadResponseSchema.parse(response);

      logger.debug({
        owner: options.owner,
        repo: options.repo,
        artifactId: options.artifactId,
        sizeBytes: validatedResponse.data.byteLength
      }, 'Successfully downloaded artifact');

      return validatedResponse.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(false, duration);
      recordGitHubApiCall('downloadArtifact', 'GET', 500, duration);

      if (error instanceof z.ZodError) {
        logger.error({
          error: error.errors,
          owner: options.owner,
          repo: options.repo,
          artifactId: options.artifactId
        }, 'Invalid GitHub API response structure for artifact download');
        throw new Error('Invalid artifact download response');
      }

      logger.error({
        error: error instanceof Error ? error.message : String(error),
        owner: options.owner,
        repo: options.repo,
        artifactId: options.artifactId
      }, 'Failed to download artifact');

      throw error;
    }
  }

  /**
   * Get service metrics
   */
  getMetrics(): GitHubApiMetrics {
    const avgResponseTime = this.metrics.responseTimes.length > 0
      ? this.metrics.responseTimes.reduce((sum, time) => sum + time, 0) / this.metrics.responseTimes.length
      : 0;

    return {
      totalCalls: this.metrics.totalCalls,
      successfulCalls: this.metrics.successfulCalls,
      failedCalls: this.metrics.failedCalls,
      averageResponseTime: avgResponseTime,
      rateLimitRemaining: this.metrics.rateLimitRemaining,
      rateLimitReset: this.metrics.rateLimitReset
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      responseTimes: [],
      rateLimitRemaining: 5000,
      rateLimitReset: null
    };
  }

  /**
   * Update internal metrics
   */
  private updateMetrics(success: boolean, duration: number, headers?: Record<string, unknown>): void {
    this.metrics.totalCalls++;
    
    if (success) {
      this.metrics.successfulCalls++;
    } else {
      this.metrics.failedCalls++;
    }

    this.metrics.responseTimes.push(duration);
    
    // Keep only last 1000 response times to prevent memory bloat
    if (this.metrics.responseTimes.length > 1000) {
      this.metrics.responseTimes = this.metrics.responseTimes.slice(-1000);
    }

    // Update rate limit info from headers if available
    if (headers) {
      const remaining = headers['x-ratelimit-remaining'];
      const reset = headers['x-ratelimit-reset'];

      if (typeof remaining === 'string') {
        this.metrics.rateLimitRemaining = parseInt(remaining, 10) || 0;
      }

      if (typeof reset === 'string') {
        const resetTimestamp = parseInt(reset, 10);
        if (!isNaN(resetTimestamp)) {
          this.metrics.rateLimitReset = new Date(resetTimestamp * 1000);
        }
      }
    }
  }
}

/**
 * Factory function to create GitHub API service
 */
export function createGitHubApiService(octokit: Octokit): GitHubApiService {
  return new GitHubApiService(octokit);
}

/**
 * Create mock GitHub API service for testing
 */
export function createMockGitHubApiService(): GitHubApiService {
  const mockOctokit = {
    rest: {
      actions: {
        listWorkflowRunArtifacts: () => Promise.resolve({
          data: { artifacts: [], total_count: 0 },
          status: 200,
          headers: {
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
          }
        }),
        downloadArtifact: () => Promise.resolve({
          data: new ArrayBuffer(0),
          status: 200,
          headers: {
            'x-ratelimit-remaining': '4998',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
          }
        })
      }
    }
  } as unknown as Octokit;

  return new GitHubApiService(mockOctokit);
}