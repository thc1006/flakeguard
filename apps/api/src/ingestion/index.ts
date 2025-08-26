/**
 * FlakeGuard JUnit XML Ingestion Service
 * 
 * A comprehensive TypeScript service for ingesting JUnit XML test results from various sources
 * including GitHub Actions artifacts, with support for multiple JUnit formats and robust error handling.
 * 
 * @example
 * ```typescript
 * import { JUnitIngestionService, ingestJUnitArtifacts } from './ingestion';
 * 
 * // Simple ingestion
 * const result = await ingestJUnitArtifacts(
 *   artifacts,
 *   { owner: 'myorg', repo: 'myrepo' },
 *   { expectedFormat: 'surefire' }
 * );
 * 
 * // Advanced usage with service instance
 * const service = new JUnitIngestionService();
 * service.on('progress', (progress) => console.log(progress));
 * const result = await service.ingest({ config: { repository, artifacts } });
 * ```
 */

// ============================================================================
// Core Service Exports
// ============================================================================

export {
  JUnitIngestionService,
  createIngestionService,
  ingestJUnitArtifacts,
  ingestFromGitHubArtifacts
} from './junit.js';

// ============================================================================
// Parser Exports
// ============================================================================

export {
  parseJUnitXML,
  parseJUnitXMLFile,
  parseJUnitXMLString,
  createJUnitParser,
  detectJUnitFormat
} from './parsers/junit-parser.js';

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Core interfaces
  TestCase,
  TestSuite,
  TestSuites,
  TestFailure,
  TestCaseStatus,
  
  // Configuration types
  IngestionParameters,
  IngestionConfig,
  IngestionResult,
  FileProcessingResult,
  IngestionStats,
  
  // Format types
  JUnitFormat,
  FormatDetectionResult,
  FormatSpecificConfig,
  
  // Context types
  ArtifactSource,
  RepositoryContext,
  RetryConfig,
  
  // Error types
  IngestionError,
  IngestionErrorType,
  
  // Stream types
  StreamProcessingOptions,
  ZipEntryInfo,
  FileFilter,
  
  // Utility types
  AsyncIngestionResult,
  ExtractFormatConfig,
  FormatSpecificResult,
  BatchResults
} from './types.js';

// ============================================================================
// Exception Exports
// ============================================================================

export {
  IngestionException,
  DownloadFailedException,
  ParsingFailedException,
  TimeoutException
} from './types.js';

// ============================================================================
// Utility Exports
// ============================================================================

export {
  // Artifact filtering
  isTestResultArtifact,
  hasSupportedExtension,
  getFileExtension,
  createArtifactFilter,
  
  // ZIP filtering
  createXMLFileFilter,
  createJUnitXMLFilter,
  
  // Stream utilities
  createChunkBuffer,
  createSizeLimiter,
  createTimeoutStream,
  
  // Retry utilities
  DEFAULT_RETRY_CONFIG,
  calculateRetryDelay,
  withRetry,
  createRetryableFetch,
  
  // URL validation
  validateUrl,
  
  // Format detection
  detectFormatFromPath,
  
  // File utilities
  ensureDirectoryExists,
  getFileStats,
  cleanupTempFiles,
  sanitizeFileName,
  generateCorrelationId,
  
  // Validation
  validateArtifactSource,
  createIngestionError
} from './utils.js';

// ============================================================================
// Schema Exports
// ============================================================================

export {
  TestCaseSchema,
  TestSuiteSchema,
  TestSuitesSchema,
  IngestionConfigSchema,
  isJUnitFormat,
  isIngestionError
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Supported file extensions for artifacts
 */
export const SUPPORTED_EXTENSIONS = ['.xml', '.zip', '.tar.gz', '.tgz'] as const;

/**
 * Default configuration values
 */
export const DEFAULT_INGESTION_CONFIG = {
  maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
  timeoutMs: 5 * 60 * 1000, // 5 minutes
  concurrency: 3,
  streamingEnabled: true,
  retryConfig: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterEnabled: true
  }
} as const;

/**
 * Supported JUnit formats
 */
export const SUPPORTED_JUNIT_FORMATS = [
  'surefire',   // Maven Surefire
  'gradle',     // Gradle Test Reports  
  'jest',       // Jest JUnit Reporter
  'pytest',     // Pytest JUnit XML
  'phpunit',    // PHPUnit
  'generic'     // Generic JUnit XML
] as const;

// ============================================================================
// Version Info
// ============================================================================

/**
 * FlakeGuard Ingestion Service version
 */
export const VERSION = '1.0.0';

/**
 * Minimum supported Node.js version
 */
export const MIN_NODE_VERSION = '18.0.0';