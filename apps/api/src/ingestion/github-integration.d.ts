/**
 * GitHub Artifacts API Integration Service
 *
 * Provides comprehensive integration with GitHub Actions artifacts API including:
 * - Artifact listing with intelligent filtering for test results
 * - Temporary download URL generation with expiration handling
 * - Streaming download management with retry logic
 * - Integration with existing GitHub authentication and helpers
 * - Rate limiting and error handling for production use
 */
import type { PrismaClient } from '@prisma/client';
import { GitHubAuthManager } from '../github/auth.js';
import { GitHubHelpers } from '../github/helpers.js';
import { JUnitIngestionService } from './junit.js';
import type { RepositoryContext, IngestionResult } from './types.js';
/**
 * GitHub artifact metadata from API
 */
export interface GitHubArtifact {
    readonly id: number;
    readonly name: string;
    readonly size_in_bytes: number;
    readonly url: string;
    readonly archive_download_url: string;
    readonly expired: boolean;
    readonly created_at: string;
    readonly updated_at: string;
    readonly expires_at: string;
    readonly node_id: string;
    readonly workflow_run?: {
        readonly id: number;
        readonly repository_id: number;
        readonly head_repository_id: number;
    };
}
/**
 * Artifact filtering criteria
 */
export interface ArtifactFilter {
    readonly namePatterns?: readonly string[];
    readonly extensions?: readonly string[];
    readonly maxSizeBytes?: number;
    readonly minSizeBytes?: number;
    readonly notExpired?: boolean;
}
/**
 * Workflow artifacts response
 */
export interface WorkflowArtifactsResponse {
    readonly artifacts: readonly GitHubArtifact[];
    readonly totalCount: number;
    readonly hasMore: boolean;
}
/**
 * Download URL with metadata
 */
export interface ArtifactDownloadInfo {
    readonly artifactId: number;
    readonly name: string;
    readonly downloadUrl: string;
    readonly sizeInBytes: number;
    readonly expiresAt: Date;
    readonly createdAt: Date;
}
/**
 * Ingestion job configuration
 */
export interface IngestionJobConfig {
    readonly workflowRunId: number;
    readonly repository: RepositoryContext;
    readonly installationId: number;
    readonly filter?: ArtifactFilter;
    readonly correlationId?: string;
    readonly priority?: 'low' | 'normal' | 'high' | 'critical';
}
/**
 * Ingestion job result
 */
export interface IngestionJobResult {
    readonly jobId: string;
    readonly success: boolean;
    readonly processedArtifacts: number;
    readonly totalTests: number;
    readonly totalFailures: number;
    readonly totalErrors: number;
    readonly processingTimeMs: number;
    readonly errors: readonly string[];
}
export declare class GitHubArtifactsIntegration {
    private readonly authManager;
    private readonly helpers;
    private readonly ingestionService;
    private readonly prisma;
    constructor(authManager: GitHubAuthManager, helpers: GitHubHelpers, ingestionService: JUnitIngestionService, prisma: PrismaClient);
    /**
     * List and filter artifacts for a workflow run
     */
    listWorkflowArtifacts(owner: string, repo: string, workflowRunId: number, installationId: number, filter?: ArtifactFilter): Promise<WorkflowArtifactsResponse>;
    /**
     * Fetch all artifacts with pagination handling
     */
    private fetchAllArtifacts;
    /**
     * Filter artifacts based on criteria
     */
    private filterArtifacts;
    /**
     * Generate temporary download URLs for artifacts
     */
    generateDownloadUrls(owner: string, repo: string, artifactIds: readonly number[], installationId: number): Promise<readonly ArtifactDownloadInfo[]>;
    /**
     * Create batches from array
     */
    private createBatches;
    /**
     * Process workflow run artifacts for JUnit ingestion
     */
    processWorkflowArtifacts(config: IngestionJobConfig): Promise<IngestionJobResult>;
    /**
     * Quick artifact processing for immediate use
     */
    quickProcessArtifacts(owner: string, repo: string, workflowRunId: number, installationId: number, filter?: ArtifactFilter): Promise<IngestionResult>;
    /**
     * Store ingestion record in database
     */
    private storeIngestionRecord;
}
/**
 * Create GitHub artifacts integration instance
 */
export declare function createGitHubArtifactsIntegration(authManager: GitHubAuthManager, helpers: GitHubHelpers, ingestionService: JUnitIngestionService, prisma: PrismaClient): GitHubArtifactsIntegration;
/**
 * Create default artifact filter for test results
 */
export declare function createTestResultsFilter(overrides?: Partial<ArtifactFilter>): ArtifactFilter;
/**
 * Validate artifact filter configuration
 */
export declare function validateArtifactFilter(filter: ArtifactFilter): string[];
//# sourceMappingURL=github-integration.d.ts.map