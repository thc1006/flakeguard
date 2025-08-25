/**
 * Main JUnit XML Ingestion Service for FlakeGuard
 * Provides comprehensive artifact processing with streaming, retry logic, and error handling
 */
import { EventEmitter } from 'events';
import type { PrismaClient } from '@prisma/client';
import { GitHubHelpers } from '../github/helpers.js';
import type { IngestionParameters, IngestionResult, IngestionConfig, FileProcessingResult, IngestionError, ArtifactSource, RepositoryContext, RetryConfig, JUnitFormat, AsyncIngestionResult } from './types.js';
export interface IngestionEvents {
    'progress': (progress: {
        phase: 'discovery' | 'download' | 'extract' | 'parse' | 'persist' | 'complete';
        processed: number;
        total: number;
        fileName?: string;
        details?: Record<string, any>;
    }) => void;
    'artifact-processed': (result: FileProcessingResult) => void;
    'error': (error: IngestionError) => void;
    'warning': (warning: string, context?: Record<string, unknown>) => void;
}
export declare class JUnitIngestionService extends EventEmitter {
    private readonly tempDir;
    private readonly prisma?;
    private readonly githubHelpers?;
    private readonly dbRepository?;
    constructor(prisma?: PrismaClient, githubHelpers?: GitHubHelpers);
    /**
     * Main ingestion method with comprehensive error handling and streaming
     */
    ingest<T extends JUnitFormat = JUnitFormat>(parameters: IngestionParameters<T>): Promise<IngestionResult>;
    /**
     * Ingest artifacts from GitHub Actions workflow run
     */
    ingestFromGitHub(params: {
        owner: string;
        repo: string;
        runId: number;
        installationId: number;
        repositoryId: string;
        expectedFormat?: JUnitFormat;
        config?: Partial<IngestionConfig>;
    }): Promise<IngestionResult>;
    /**
     * Filter and validate artifacts
     */
    private filterAndValidateArtifacts;
    /**
     * Process artifacts with controlled concurrency
     */
    private processArtifactsConcurrently;
    /**
     * Process a single artifact (download, extract, parse)
     */
    private processArtifact;
    /**
     * Download artifact with retry logic
     */
    private downloadArtifact;
    /**
     * Extract files from archive or return single file
     */
    private extractArtifact;
    /**
     * Extract ZIP file with streaming and filtering
     */
    private extractZipFile;
    /**
     * Parse XML file to test results
     */
    private parseXMLFile;
    /**
     * Persist test results to database
     */
    private persistResults;
    /**
     * Validate ingestion configuration
     */
    private validateConfiguration;
    /**
     * Check if artifact name indicates test results
     */
    private isTestResultArtifact;
    /**
     * Calculate final statistics from results
     */
    private calculateFinalStats;
    /**
     * Create standardized result object
     */
    private createResult;
    /**
     * Convert generic error to IngestionError
     */
    private convertToIngestionError;
    /**
     * Handle unexpected errors
     */
    private handleUnexpectedError;
    /**
     * Cleanup temporary files
     */
    private cleanupTempFiles;
}
/**
 * Create ingestion service instance
 */
export declare function createIngestionService(prisma?: PrismaClient, githubHelpers?: GitHubHelpers): JUnitIngestionService;
/**
 * Quick ingestion function for simple use cases
 */
export declare function ingestJUnitArtifacts<T extends JUnitFormat = JUnitFormat>(artifacts: ArtifactSource[], repository: RepositoryContext, options?: {
    expectedFormat?: T;
    formatConfig?: any;
    retryConfig?: RetryConfig;
    prisma?: PrismaClient;
    githubHelpers?: GitHubHelpers;
}): AsyncIngestionResult<T>;
/**
 * Ingest from GitHub Actions artifact URLs
 */
export declare function ingestFromGitHubArtifacts(artifactUrls: string[], repository: RepositoryContext, options?: {
    expectedFormat?: JUnitFormat;
    retryConfig?: RetryConfig;
    prisma?: PrismaClient;
    githubHelpers?: GitHubHelpers;
}): Promise<IngestionResult>;
/**
 * Direct GitHub ingestion using workflow run ID
 */
export declare function ingestFromGitHubWorkflowRun(params: {
    owner: string;
    repo: string;
    runId: number;
    installationId: number;
    repositoryId: string;
    expectedFormat?: JUnitFormat;
    prisma?: PrismaClient;
    githubHelpers?: GitHubHelpers;
    config?: Partial<IngestionConfig>;
}): Promise<IngestionResult>;
//# sourceMappingURL=junit.d.ts.map