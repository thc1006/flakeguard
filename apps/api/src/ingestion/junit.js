/**
 * Main JUnit XML Ingestion Service for FlakeGuard
 * Provides comprehensive artifact processing with streaming, retry logic, and error handling
 */
import { EventEmitter } from 'events';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import StreamZip from 'node-stream-zip';
import { logger } from '../utils/logger.js';
import { TestIngestionRepository } from './database.js';
import { parseJUnitXMLFile } from './parsers/junit-parser.js';
import { IngestionException, DownloadFailedException, ParsingFailedException } from './types.js';
import { createArtifactFilter, createJUnitXMLFilter, createRetryableFetch, withRetry, validateArtifactSource, sanitizeFileName, generateCorrelationId, ensureDirectoryExists, cleanupTempFiles, DEFAULT_RETRY_CONFIG, createSizeLimiter, createTimeoutStream } from './utils.js';
const pipelineAsync = promisify(pipeline);
// ============================================================================
// Configuration Constants
// ============================================================================
const DEFAULT_CONFIG = {
    maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
    timeoutMs: 5 * 60 * 1000, // 5 minutes
    concurrency: 3,
    streamingEnabled: true,
    retryConfig: DEFAULT_RETRY_CONFIG
};
// ============================================================================
// Main Ingestion Service
// ============================================================================
export class JUnitIngestionService extends EventEmitter {
    tempDir;
    prisma;
    githubHelpers;
    dbRepository;
    constructor(prisma, githubHelpers) {
        super();
        this.tempDir = join(tmpdir(), 'flakeguard-ingestion');
        this.prisma = prisma;
        this.githubHelpers = githubHelpers;
        if (this.prisma) {
            this.dbRepository = new TestIngestionRepository(this.prisma);
        }
    }
    /**
     * Main ingestion method with comprehensive error handling and streaming
     */
    async ingest(parameters) {
        const startTime = Date.now();
        const correlationId = parameters.correlationId || generateCorrelationId();
        const config = { ...DEFAULT_CONFIG, ...parameters.config };
        logger.info(`Starting JUnit ingestion [${correlationId}]`, {
            repository: `${config.repository.owner}/${config.repository.repo}`,
            artifactCount: config.artifacts.length,
            expectedFormat: config.expectedFormat
        });
        // Validate configuration
        await this.validateConfiguration(config);
        const stats = {
            totalFiles: 0,
            processedFiles: 0,
            failedFiles: 0,
            totalTests: 0,
            totalFailures: 0,
            totalErrors: 0,
            totalSkipped: 0,
            processingTimeMs: 0,
            downloadTimeMs: 0
        };
        const results = [];
        const errors = [];
        const tempFiles = [];
        try {
            // Phase 1: Discovery - Filter and validate artifacts
            this.emit('progress', {
                phase: 'discovery',
                processed: 0,
                total: config.artifacts.length,
                details: { correlationId }
            });
            const validArtifacts = await this.filterAndValidateArtifacts(config.artifacts, config);
            if (validArtifacts.length === 0) {
                logger.warn('No valid artifacts found to process', { correlationId });
                return this.createResult(false, [], stats, errors, correlationId);
            }
            logger.info(`Found ${validArtifacts.length} valid artifacts to process`, { correlationId });
            // Phase 2: Download and process artifacts with controlled concurrency
            const processingResults = await this.processArtifactsConcurrently(validArtifacts, config, correlationId);
            results.push(...processingResults.results);
            errors.push(...processingResults.errors);
            tempFiles.push(...processingResults.tempFiles);
            // Phase 3: Database persistence
            if (this.dbRepository && results.length > 0) {
                await this.persistResults(results, config, correlationId);
            }
            // Calculate final statistics
            this.calculateFinalStats(results, stats);
            stats.processingTimeMs = Date.now() - startTime;
            this.emit('progress', {
                phase: 'complete',
                processed: results.length,
                total: validArtifacts.length,
                details: {
                    correlationId,
                    totalTests: stats.totalTests,
                    totalFailures: stats.totalFailures
                }
            });
            const success = results.length > 0 && errors.length === 0;
            logger.info(`JUnit ingestion completed [${correlationId}]`, {
                success,
                processedFiles: stats.processedFiles,
                totalTests: stats.totalTests,
                totalFailures: stats.totalFailures,
                processingTimeMs: stats.processingTimeMs,
                errors: errors.length
            });
            return this.createResult(success, results, stats, errors, correlationId);
        }
        catch (error) {
            const ingestionError = this.handleUnexpectedError(error, correlationId);
            errors.push(ingestionError);
            return this.createResult(false, results, stats, errors, correlationId);
        }
        finally {
            // Cleanup temporary files
            await this.cleanupTempFiles(tempFiles);
        }
    }
    /**
     * Ingest artifacts from GitHub Actions workflow run
     */
    async ingestFromGitHub(params) {
        const { owner, repo, runId, installationId, repositoryId, expectedFormat, config = {} } = params;
        const correlationId = generateCorrelationId();
        logger.info(`Starting GitHub artifact ingestion [${correlationId}]`, {
            owner, repo, runId, installationId
        });
        if (!this.githubHelpers) {
            throw new Error('GitHub helpers not configured for GitHub ingestion');
        }
        try {
            // List artifacts from GitHub
            const artifacts = await this.githubHelpers.listArtifacts(owner, repo, runId, installationId);
            logger.info(`Found ${artifacts.length} GitHub artifacts`, { correlationId });
            if (artifacts.length === 0) {
                return this.createResult(true, [], {
                    totalFiles: 0,
                    processedFiles: 0,
                    failedFiles: 0,
                    totalTests: 0,
                    totalFailures: 0,
                    totalErrors: 0,
                    totalSkipped: 0,
                    processingTimeMs: 0,
                    downloadTimeMs: 0
                }, [], correlationId);
            }
            // Filter test result artifacts
            const testArtifacts = artifacts.filter(artifact => this.isTestResultArtifact(artifact.name) &&
                !artifact.expired &&
                (artifact.name.toLowerCase().includes('.xml') || artifact.name.toLowerCase().includes('.zip')));
            logger.info(`Found ${testArtifacts.length} test result artifacts`, { correlationId });
            if (testArtifacts.length === 0) {
                return this.createResult(true, [], {
                    totalFiles: 0,
                    processedFiles: 0,
                    failedFiles: 0,
                    totalTests: 0,
                    totalFailures: 0,
                    totalErrors: 0,
                    totalSkipped: 0,
                    processingTimeMs: 0,
                    downloadTimeMs: 0
                }, [], correlationId);
            }
            // Generate download URLs and create artifact sources
            const artifactSources = [];
            for (const artifact of testArtifacts) {
                try {
                    const downloadInfo = await this.githubHelpers.generateArtifactDownloadUrl(owner, repo, artifact.id, installationId);
                    artifactSources.push({
                        url: downloadInfo.downloadUrl,
                        name: artifact.name,
                        downloadUrl: downloadInfo.downloadUrl,
                        size: downloadInfo.sizeInBytes,
                        expiresAt: new Date(downloadInfo.expiresAt)
                    });
                }
                catch (error) {
                    logger.warn(`Failed to generate download URL for artifact ${artifact.name}`, {
                        error: error.message,
                        correlationId
                    });
                }
            }
            // Perform ingestion
            const repository = {
                owner,
                repo,
                runId
            };
            const ingestionParams = {
                correlationId,
                config: {
                    repository,
                    artifacts: artifactSources,
                    expectedFormat,
                    ...config
                }
            };
            return await this.ingest(ingestionParams);
        }
        catch (error) {
            logger.error(`GitHub artifact ingestion failed [${correlationId}]`, {
                error: error.message,
                owner, repo, runId
            });
            return this.createResult(false, [], {
                totalFiles: 0,
                processedFiles: 0,
                failedFiles: 0,
                totalTests: 0,
                totalFailures: 0,
                totalErrors: 0,
                totalSkipped: 0,
                processingTimeMs: 0,
                downloadTimeMs: 0
            }, [{
                    type: 'GITHUB_API_ERROR',
                    message: `GitHub ingestion failed: ${error.message}`,
                    timestamp: new Date()
                }], correlationId);
        }
    }
    // ============================================================================
    // Artifact Processing Methods
    // ============================================================================
    /**
     * Filter and validate artifacts
     */
    async filterAndValidateArtifacts(artifacts, config) {
        const filter = createArtifactFilter({
            maxSizeBytes: config.maxFileSizeBytes
        });
        const validArtifacts = [];
        for (const artifact of artifacts) {
            // Validate artifact structure
            const validationErrors = validateArtifactSource(artifact);
            if (validationErrors.length > 0) {
                this.emit('warning', 'Invalid artifact', {
                    artifact: artifact.name,
                    errors: validationErrors
                });
                continue;
            }
            // Apply filter
            if (filter(artifact)) {
                validArtifacts.push(artifact);
            }
            else {
                this.emit('warning', 'Artifact filtered out', { artifact: artifact.name });
            }
        }
        return validArtifacts;
    }
    /**
     * Process artifacts with controlled concurrency
     */
    async processArtifactsConcurrently(artifacts, config, correlationId) {
        const results = [];
        const errors = [];
        const tempFiles = [];
        const concurrency = config.concurrency || DEFAULT_CONFIG.concurrency;
        // Process artifacts in batches
        for (let i = 0; i < artifacts.length; i += concurrency) {
            const batch = artifacts.slice(i, i + concurrency);
            const batchPromises = batch.map(async (artifact, index) => {
                try {
                    const result = await this.processArtifact(artifact, config, correlationId);
                    results.push(...result.results);
                    tempFiles.push(...result.tempFiles);
                    this.emit('progress', {
                        phase: 'parse',
                        processed: i + index + 1,
                        total: artifacts.length,
                        fileName: artifact.name
                    });
                }
                catch (error) {
                    const ingestionError = this.convertToIngestionError(error, artifact.name);
                    errors.push(ingestionError);
                    this.emit('error', ingestionError);
                }
            });
            await Promise.allSettled(batchPromises);
        }
        return { results, errors, tempFiles };
    }
    /**
     * Process a single artifact (download, extract, parse)
     */
    async processArtifact(artifact, config, correlationId) {
        const startTime = Date.now();
        logger.debug(`Processing artifact: ${artifact.name} [${correlationId}]`);
        const results = [];
        const tempFiles = [];
        try {
            // Download artifact
            const downloadedFile = await this.downloadArtifact(artifact, config);
            tempFiles.push(downloadedFile);
            // Extract or process directly based on file type
            const extractedFiles = await this.extractArtifact(downloadedFile, artifact.name);
            tempFiles.push(...extractedFiles);
            // Parse XML files
            for (const filePath of extractedFiles) {
                try {
                    const parseResult = await this.parseXMLFile(filePath, artifact.name, config);
                    results.push(parseResult);
                    this.emit('artifact-processed', parseResult);
                }
                catch (parseError) {
                    logger.warn(`Failed to parse ${filePath}:`, parseError);
                    // Continue processing other files
                }
            }
            const processingTime = Date.now() - startTime;
            logger.debug(`Completed artifact processing: ${artifact.name} (${processingTime}ms)`);
            return { results, tempFiles };
        }
        catch (error) {
            logger.error(`Failed to process artifact ${artifact.name}:`, error);
            throw error;
        }
    }
    // ============================================================================
    // Download Methods
    // ============================================================================
    /**
     * Download artifact with retry logic
     */
    async downloadArtifact(artifact, config) {
        const downloadUrl = artifact.downloadUrl || artifact.url;
        const sanitizedName = sanitizeFileName(artifact.name);
        const tempFilePath = join(this.tempDir, `${Date.now()}_${sanitizedName}`);
        await ensureDirectoryExists(tempFilePath);
        const retryConfig = config.retryConfig || DEFAULT_RETRY_CONFIG;
        const fetch = createRetryableFetch(retryConfig);
        try {
            return await withRetry(async (attempt) => {
                logger.debug(`Downloading ${artifact.name} (attempt ${attempt})`);
                // Check if URL has expired (GitHub artifact URLs expire after 1 minute)
                if (artifact.expiresAt && artifact.expiresAt < new Date()) {
                    throw new DownloadFailedException('Artifact download URL has expired', artifact.name);
                }
                const response = await fetch(downloadUrl, {
                    signal: AbortSignal.timeout(config.timeoutMs || DEFAULT_CONFIG.timeoutMs)
                });
                const fileStream = createWriteStream(tempFilePath);
                const responseStream = response.body;
                if (!responseStream) {
                    throw new DownloadFailedException('No response body received', artifact.name);
                }
                // Add size and timeout limits
                const sizeLimiter = createSizeLimiter(config.maxFileSizeBytes || DEFAULT_CONFIG.maxFileSizeBytes);
                const timeoutStream = createTimeoutStream(config.timeoutMs || DEFAULT_CONFIG.timeoutMs);
                await pipelineAsync(responseStream, sizeLimiter, timeoutStream, fileStream);
                logger.debug(`Downloaded ${artifact.name} to ${tempFilePath}`);
                return tempFilePath;
            }, retryConfig);
        }
        catch (error) {
            throw new DownloadFailedException(`Failed to download artifact: ${error instanceof Error ? error.message : String(error)}`, artifact.name, error instanceof Error ? error : new Error(String(error)));
        }
    }
    // ============================================================================
    // Extraction Methods
    // ============================================================================
    /**
     * Extract files from archive or return single file
     */
    async extractArtifact(filePath, artifactName) {
        const extension = filePath.toLowerCase().split('.').pop();
        switch (extension) {
            case 'zip':
                return this.extractZipFile(filePath, artifactName);
            case 'xml':
                return [filePath]; // Return as-is for direct XML files
            default:
                logger.warn(`Unsupported file extension: ${extension} for ${artifactName}`);
                return [];
        }
    }
    /**
     * Extract ZIP file with streaming and filtering
     */
    async extractZipFile(zipPath, artifactName) {
        const extractedFiles = [];
        const xmlFilter = createJUnitXMLFilter();
        try {
            const zip = new StreamZip.async({ file: zipPath });
            const entries = await zip.entries();
            for (const [name, entry] of Object.entries(entries)) {
                const entryInfo = {
                    name,
                    size: entry.size,
                    isFile: !entry.isDirectory,
                    isDirectory: entry.isDirectory,
                    lastModified: entry.time
                };
                if (xmlFilter(entryInfo)) {
                    const extractPath = join(this.tempDir, `extracted_${Date.now()}_${sanitizeFileName(name)}`);
                    await ensureDirectoryExists(extractPath);
                    await zip.extract(name, extractPath);
                    extractedFiles.push(extractPath);
                }
            }
            await zip.close();
            logger.debug(`Extracted ${extractedFiles.length} XML files from ${artifactName}`);
            return extractedFiles;
        }
        catch (error) {
            throw new IngestionException('EXTRACTION_FAILED', `Failed to extract ZIP file: ${error instanceof Error ? error.message : String(error)}`, undefined, artifactName, error instanceof Error ? error : new Error(String(error)));
        }
    }
    // ============================================================================
    // Parsing Methods
    // ============================================================================
    /**
     * Parse XML file to test results
     */
    async parseXMLFile(filePath, artifactName, config) {
        const startTime = Date.now();
        const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'unknown';
        try {
            logger.debug(`Parsing XML file: ${fileName}`);
            const parseResult = await parseJUnitXMLFile(filePath, {
                expectedFormat: config.expectedFormat,
                formatConfig: config.formatConfig
            });
            const processingTime = Date.now() - startTime;
            const { size } = await import('fs/promises').then(fs => fs.stat(filePath));
            const result = {
                fileName,
                format: parseResult.format,
                testSuites: parseResult.testSuites,
                processingTimeMs: processingTime,
                fileSizeBytes: size,
                warnings: parseResult.warnings
            };
            logger.debug(`Parsed ${fileName}: ${result.testSuites.tests} tests, ${result.testSuites.failures} failures`);
            return result;
        }
        catch (error) {
            throw new ParsingFailedException(`Failed to parse XML file: ${error instanceof Error ? error.message : String(error)}`, fileName, error instanceof Error ? error : new Error(String(error)));
        }
    }
    // ============================================================================
    // Database Persistence
    // ============================================================================
    /**
     * Persist test results to database
     */
    async persistResults(results, config, correlationId) {
        if (!this.dbRepository || !this.prisma) {
            logger.warn('Database repository not available, skipping persistence', { correlationId });
            return;
        }
        this.emit('progress', {
            phase: 'persist',
            processed: 0,
            total: results.length,
            details: { correlationId }
        });
        try {
            // Find repository record
            const repository = await this.prisma.repository.findFirst({
                where: {
                    owner: config.repository.owner,
                    name: config.repository.repo
                }
            });
            if (!repository) {
                logger.error('Repository not found in database', {
                    owner: config.repository.owner,
                    repo: config.repository.repo,
                    correlationId
                });
                return;
            }
            let processedCount = 0;
            for (const result of results) {
                try {
                    await this.dbRepository.processJUnitTestSuites(result.testSuites, {
                        ...config.repository,
                        repositoryId: repository.id
                    });
                    processedCount++;
                    this.emit('progress', {
                        phase: 'persist',
                        processed: processedCount,
                        total: results.length,
                        fileName: result.fileName,
                        details: { correlationId }
                    });
                }
                catch (error) {
                    logger.error(`Failed to persist test results for ${result.fileName}`, {
                        error: error.message,
                        correlationId
                    });
                }
            }
            logger.info(`Persisted ${processedCount}/${results.length} test result files`, { correlationId });
        }
        catch (error) {
            logger.error('Failed to persist results to database', {
                error: error.message,
                correlationId
            });
        }
    }
    // ============================================================================
    // Validation Methods
    // ============================================================================
    /**
     * Validate ingestion configuration
     */
    async validateConfiguration(config) {
        const errors = [];
        // Validate repository context
        if (!config.repository.owner || !config.repository.repo) {
            errors.push('Repository owner and name are required');
        }
        // Validate artifacts
        if (!config.artifacts || config.artifacts.length === 0) {
            errors.push('At least one artifact is required');
        }
        // Validate timeouts and limits
        if (config.timeoutMs && config.timeoutMs <= 0) {
            errors.push('Timeout must be positive');
        }
        if (config.maxFileSizeBytes && config.maxFileSizeBytes <= 0) {
            errors.push('Max file size must be positive');
        }
        if (config.concurrency && (config.concurrency <= 0 || config.concurrency > 10)) {
            errors.push('Concurrency must be between 1 and 10');
        }
        if (errors.length > 0) {
            throw new IngestionException('VALIDATION_FAILED', `Configuration validation failed: ${errors.join(', ')}`, { errors });
        }
    }
    // ============================================================================
    // Utility Methods
    // ============================================================================
    /**
     * Check if artifact name indicates test results
     */
    isTestResultArtifact(name) {
        const lowerName = name.toLowerCase();
        return /test.*results?|junit|surefire|coverage/.test(lowerName);
    }
    /**
     * Calculate final statistics from results
     */
    calculateFinalStats(results, stats) {
        stats.totalFiles = results.length;
        stats.processedFiles = results.length;
        stats.failedFiles = 0; // Errors are tracked separately
        for (const result of results) {
            const { testSuites } = result;
            stats.totalTests += testSuites.tests;
            stats.totalFailures += testSuites.failures;
            stats.totalErrors += testSuites.errors;
            stats.totalSkipped += testSuites.skipped;
        }
    }
    /**
     * Create standardized result object
     */
    createResult(success, results, stats, errors, correlationId) {
        return {
            success,
            results,
            stats,
            errors,
            correlationId
        };
    }
    /**
     * Convert generic error to IngestionError
     */
    convertToIngestionError(error, fileName) {
        if (error instanceof IngestionException) {
            return error.toIngestionError();
        }
        if (error instanceof Error) {
            let type = 'PARSING_FAILED';
            if (error.message.includes('timeout')) {
                type = 'TIMEOUT';
            }
            else if (error.message.includes('network') || error.message.includes('fetch')) {
                type = 'NETWORK_ERROR';
            }
            else if (error.message.includes('size')) {
                type = 'FILE_TOO_LARGE';
            }
            return {
                type,
                message: error.message,
                fileName,
                cause: error,
                timestamp: new Date()
            };
        }
        return {
            type: 'PARSING_FAILED',
            message: String(error),
            fileName,
            timestamp: new Date()
        };
    }
    /**
     * Handle unexpected errors
     */
    handleUnexpectedError(error, correlationId) {
        logger.error(`Unexpected error in ingestion [${correlationId}]:`, error);
        return {
            type: 'PARSING_FAILED',
            message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
            details: { correlationId },
            cause: error instanceof Error ? error : new Error(String(error)),
            timestamp: new Date()
        };
    }
    /**
     * Cleanup temporary files
     */
    async cleanupTempFiles(tempFiles) {
        if (tempFiles.length > 0) {
            logger.debug(`Cleaning up ${tempFiles.length} temporary files`);
            await cleanupTempFiles(tempFiles);
        }
    }
}
// ============================================================================
// Convenience Functions
// ============================================================================
/**
 * Create ingestion service instance
 */
export function createIngestionService(prisma, githubHelpers) {
    return new JUnitIngestionService(prisma, githubHelpers);
}
/**
 * Quick ingestion function for simple use cases
 */
export async function ingestJUnitArtifacts(artifacts, repository, options) {
    const service = createIngestionService(options?.prisma, options?.githubHelpers);
    const parameters = {
        config: {
            repository,
            artifacts,
            expectedFormat: options?.expectedFormat,
            formatConfig: options?.formatConfig,
            retryConfig: options?.retryConfig
        }
    };
    return service.ingest(parameters);
}
/**
 * Ingest from GitHub Actions artifact URLs
 */
export async function ingestFromGitHubArtifacts(artifactUrls, repository, options) {
    const artifacts = artifactUrls.map((url, index) => ({
        url,
        name: `artifact-${index}`,
        // GitHub artifact URLs expire after 1 minute
        expiresAt: new Date(Date.now() + 60 * 1000)
    }));
    return ingestJUnitArtifacts(artifacts, repository, options);
}
/**
 * Direct GitHub ingestion using workflow run ID
 */
export async function ingestFromGitHubWorkflowRun(params) {
    const service = createIngestionService(params.prisma, params.githubHelpers);
    return service.ingestFromGitHub(params);
}
//# sourceMappingURL=junit.js.map