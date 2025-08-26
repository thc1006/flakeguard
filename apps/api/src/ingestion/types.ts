/**
 * Comprehensive TypeScript interfaces for JUnit XML ingestion service
 * Supports multiple JUnit formats with advanced type safety
 */

import { z } from 'zod';

// ============================================================================
// Core JUnit XML Structure Types
// ============================================================================

/**
 * Base test case status discriminated union
 */
export type TestCaseStatus = 
  | 'passed'
  | 'failed' 
  | 'error'
  | 'skipped'
  | 'flaky';

/**
 * Test case failure/error information
 */
export interface TestFailure {
  readonly type: string;
  readonly message?: string;
  readonly stackTrace?: string;
  readonly systemOut?: string;
  readonly systemErr?: string;
}

/**
 * Core test case interface with strict typing
 */
export interface TestCase {
  readonly name: string;
  readonly className: string;
  readonly time?: number; // execution time in seconds
  readonly status: TestCaseStatus;
  readonly failure?: TestFailure;
  readonly error?: TestFailure;
  readonly skipped?: {
    readonly message?: string;
  };
  readonly systemOut?: string;
  readonly systemErr?: string;
  readonly properties?: Record<string, string>;
}

/**
 * Test suite properties
 */
export interface TestSuiteProperties {
  readonly [key: string]: string;
}

/**
 * Test suite statistics
 */
export interface TestSuiteStats {
  readonly tests: number;
  readonly failures: number;
  readonly errors: number;
  readonly skipped: number;
  readonly time?: number;
  readonly timestamp?: string;
}

/**
 * Individual test suite
 */
export interface TestSuite extends TestSuiteStats {
  readonly name: string;
  readonly id?: string;
  readonly package?: string;
  readonly hostname?: string;
  readonly properties?: TestSuiteProperties;
  readonly testCases: readonly TestCase[];
  readonly systemOut?: string;
  readonly systemErr?: string;
}

/**
 * Root test suites container
 */
export interface TestSuites extends TestSuiteStats {
  readonly name?: string;
  readonly suites: readonly TestSuite[];
}

// ============================================================================
// JUnit Format Detection Types
// ============================================================================

/**
 * Supported JUnit XML formats with conditional parsing
 */
export type JUnitFormat = 
  | 'surefire'    // Maven Surefire
  | 'gradle'      // Gradle Test Reports
  | 'jest'        // Jest JUnit Reporter
  | 'pytest'      // Pytest JUnit XML
  | 'phpunit'     // PHPUnit
  | 'generic';    // Generic JUnit XML

/**
 * Format-specific parser configuration
 */
export type FormatSpecificConfig<T extends JUnitFormat> = 
  T extends 'surefire' ? {
    readonly surefireVersion?: string;
    readonly includeSystemProperties?: boolean;
  } :
  T extends 'gradle' ? {
    readonly gradleVersion?: string;
    readonly includeStandardStreams?: boolean;
  } :
  T extends 'jest' ? {
    readonly jestVersion?: string;
    readonly collectCoverage?: boolean;
  } :
  T extends 'pytest' ? {
    readonly pytestVersion?: string;
    readonly includeProperties?: boolean;
  } :
  T extends 'phpunit' ? {
    readonly phpunitVersion?: string;
    readonly includeCodeCoverage?: boolean;
  } : {
    readonly customAttributes?: string[];
  };

/**
 * Format detection result with confidence score
 */
export interface FormatDetectionResult {
  readonly format: JUnitFormat;
  readonly confidence: number; // 0-1
  readonly indicators: readonly string[];
}

// ============================================================================
// Ingestion Parameter Types
// ============================================================================

/**
 * Artifact source information
 */
export interface ArtifactSource {
  readonly url: string;
  readonly name: string;
  readonly size?: number;
  readonly downloadUrl?: string;
  readonly expiresAt?: Date;
}

/**
 * Repository context for ingestion
 */
export interface RepositoryContext {
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  readonly sha?: string;
  readonly runId?: number;
  readonly jobId?: number;
}

/**
 * Retry configuration with exponential backoff
 */
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly jitterEnabled: boolean;
}

/**
 * Ingestion configuration with generic format support
 */
export interface IngestionConfig<T extends JUnitFormat = JUnitFormat> {
  readonly repository: RepositoryContext;
  readonly artifacts: readonly ArtifactSource[];
  readonly expectedFormat?: T;
  readonly formatConfig?: FormatSpecificConfig<T>;
  readonly retryConfig?: RetryConfig;
  readonly streamingEnabled?: boolean;
  readonly maxFileSizeBytes?: number;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
}

/**
 * Generic ingestion parameters with type constraints
 */
export interface IngestionParameters<T extends JUnitFormat = JUnitFormat> {
  readonly config: IngestionConfig<T>;
  readonly metadata?: Record<string, unknown>;
  readonly correlationId?: string;
}

// ============================================================================
// Result and Error Types
// ============================================================================

/**
 * File processing result
 */
export interface FileProcessingResult {
  readonly fileName: string;
  readonly format: JUnitFormat;
  readonly testSuites: TestSuites;
  readonly processingTimeMs: number;
  readonly fileSizeBytes: number;
  readonly warnings: readonly string[];
}

/**
 * Ingestion statistics
 */
export interface IngestionStats {
  readonly totalFiles: number;
  readonly processedFiles: number;
  readonly failedFiles: number;
  readonly totalTests: number;
  readonly totalFailures: number;
  readonly totalErrors: number;
  readonly totalSkipped: number;
  readonly processingTimeMs: number;
  readonly downloadTimeMs: number;
}

/**
 * Complete ingestion result
 */
export interface IngestionResult {
  readonly success: boolean;
  readonly results: readonly FileProcessingResult[];
  readonly stats: IngestionStats;
  readonly errors: readonly IngestionError[];
  readonly correlationId?: string;
}

// ============================================================================
// Error Types and Exception Hierarchy
// ============================================================================

/**
 * Base ingestion error types
 */
export type IngestionErrorType =
  | 'DOWNLOAD_FAILED'
  | 'EXTRACTION_FAILED' 
  | 'PARSING_FAILED'
  | 'VALIDATION_FAILED'
  | 'TIMEOUT'
  | 'RETRY_EXHAUSTED'
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'NETWORK_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'RATE_LIMITED';

/**
 * Structured ingestion error
 */
export interface IngestionError {
  readonly type: IngestionErrorType;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly fileName?: string;
  readonly cause?: Error;
  readonly retryAttempt?: number;
  readonly timestamp: Date;
}

/**
 * Typed exception classes
 */
export class IngestionException extends Error {
  constructor(
    public readonly errorType: IngestionErrorType,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly fileName?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'IngestionException';
  }

  toIngestionError(): IngestionError {
    return {
      type: this.errorType,
      message: this.message,
      details: this.details,
      fileName: this.fileName,
      cause: this.cause,
      timestamp: new Date()
    };
  }
}

/**
 * Specific exception types with type safety
 */
export class DownloadFailedException extends IngestionException {
  constructor(message: string, fileName?: string, cause?: Error) {
    super('DOWNLOAD_FAILED', message, undefined, fileName, cause);
    this.name = 'DownloadFailedException';
  }
}

export class ParsingFailedException extends IngestionException {
  constructor(message: string, fileName?: string, cause?: Error) {
    super('PARSING_FAILED', message, undefined, fileName, cause);
    this.name = 'ParsingFailedException';
  }
}

export class TimeoutException extends IngestionException {
  constructor(message: string, timeoutMs: number) {
    super('TIMEOUT', message, { timeoutMs });
    this.name = 'TimeoutException';
  }
}

// ============================================================================
// Stream Processing Types
// ============================================================================

/**
 * Stream processing options
 */
export interface StreamProcessingOptions {
  readonly chunkSize?: number;
  readonly highWaterMark?: number;
  readonly encoding?: BufferEncoding;
  readonly objectMode?: boolean;
}

/**
 * ZIP entry information
 */
export interface ZipEntryInfo {
  readonly name: string;
  readonly size: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly lastModified?: Date;
}

/**
 * Filter predicate for files
 */
export type FileFilter = (entry: ZipEntryInfo) => boolean;

// ============================================================================
// Validation Schemas
// ============================================================================

/**
 * Zod schemas for runtime validation
 */
export const TestCaseSchema = z.object({
  name: z.string().min(1),
  className: z.string().min(1),
  time: z.number().nonnegative().optional(),
  status: z.enum(['passed', 'failed', 'error', 'skipped', 'flaky']),
  failure: z.object({
    type: z.string(),
    message: z.string().optional(),
    stackTrace: z.string().optional(),
    systemOut: z.string().optional(),
    systemErr: z.string().optional()
  }).optional(),
  error: z.object({
    type: z.string(),
    message: z.string().optional(),
    stackTrace: z.string().optional(),
    systemOut: z.string().optional(),
    systemErr: z.string().optional()
  }).optional(),
  skipped: z.object({
    message: z.string().optional()
  }).optional(),
  systemOut: z.string().optional(),
  systemErr: z.string().optional(),
  properties: z.record(z.string()).optional()
});

export const TestSuiteSchema = z.object({
  name: z.string().min(1),
  id: z.string().optional(),
  package: z.string().optional(),
  hostname: z.string().optional(),
  tests: z.number().nonnegative(),
  failures: z.number().nonnegative(),
  errors: z.number().nonnegative(),
  skipped: z.number().nonnegative(),
  time: z.number().nonnegative().optional(),
  timestamp: z.string().optional(),
  properties: z.record(z.string()).optional(),
  testCases: z.array(TestCaseSchema),
  systemOut: z.string().optional(),
  systemErr: z.string().optional()
});

export const TestSuitesSchema = z.object({
  name: z.string().optional(),
  tests: z.number().nonnegative(),
  failures: z.number().nonnegative(),
  errors: z.number().nonnegative(),
  skipped: z.number().nonnegative(),
  time: z.number().nonnegative().optional(),
  timestamp: z.string().optional(),
  suites: z.array(TestSuiteSchema)
});

export const IngestionConfigSchema = z.object({
  repository: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().optional(),
    sha: z.string().optional(),
    runId: z.number().optional(),
    jobId: z.number().optional()
  }),
  artifacts: z.array(z.object({
    url: z.string().url(),
    name: z.string().min(1),
    size: z.number().optional(),
    downloadUrl: z.string().url().optional(),
    expiresAt: z.date().optional()
  })),
  expectedFormat: z.enum(['surefire', 'gradle', 'jest', 'pytest', 'phpunit', 'generic']).optional(),
  streamingEnabled: z.boolean().optional(),
  maxFileSizeBytes: z.number().positive().optional(),
  timeoutMs: z.number().positive().optional(),
  concurrency: z.number().positive().max(10).optional()
});

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract format-specific config type
 */
export type ExtractFormatConfig<T> = T extends IngestionConfig<infer F> 
  ? FormatSpecificConfig<F> 
  : never;

/**
 * Conditional result type based on format
 */
export type FormatSpecificResult<T extends JUnitFormat> = 
  FileProcessingResult & {
    readonly format: T;
    readonly formatSpecificData?: FormatSpecificConfig<T>;
  };

/**
 * Mapped type for batch processing results
 */
export type BatchResults<T extends Record<string, JUnitFormat>> = {
  readonly [K in keyof T]: FormatSpecificResult<T[K]>[];
};

/**
 * Promise-based result type for async operations
 */
export type AsyncIngestionResult<T extends JUnitFormat = JUnitFormat> = 
  Promise<IngestionResult & { format?: T }>;

/**
 * Type guard for JUnit format detection
 */
export const isJUnitFormat = (value: string): value is JUnitFormat => {
  return ['surefire', 'gradle', 'jest', 'pytest', 'phpunit', 'generic'].includes(value);
};

/**
 * Type predicate for error checking
 */
export const isIngestionError = (error: unknown): error is IngestionError => {
  return typeof error === 'object' && 
         error !== null && 
         'type' in error && 
         'message' in error && 
         'timestamp' in error;
};