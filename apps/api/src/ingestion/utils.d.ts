/**
 * Comprehensive utility functions for JUnit XML ingestion
 * Includes artifact filtering, stream processing, retry logic, and security utilities
 */
import { Transform } from 'stream';
import type { ArtifactSource, FileFilter, RetryConfig, IngestionError, IngestionErrorType, JUnitFormat } from './types.js';
/**
 * Supported file extensions for test result files
 */
declare const SUPPORTED_EXTENSIONS: readonly [".xml", ".zip", ".tar.gz", ".tgz"];
export type SupportedExtension = typeof SUPPORTED_EXTENSIONS[number];
/**
 * Check if artifact name matches test result patterns
 */
export declare const isTestResultArtifact: (artifactName: string) => boolean;
/**
 * Check if file has supported extension
 */
export declare const hasSupportedExtension: (fileName: string) => boolean;
/**
 * Extract file extension with type safety
 */
export declare const getFileExtension: (fileName: string) => SupportedExtension | null;
/**
 * Comprehensive artifact filter
 */
export declare const createArtifactFilter: (options?: {
    includePatterns?: RegExp[];
    excludePatterns?: RegExp[];
    maxSizeBytes?: number;
    requiredExtensions?: SupportedExtension[];
}) => (artifact: ArtifactSource) => boolean;
/**
 * Default filter for XML files in ZIP archives
 */
export declare const createXMLFileFilter: (options?: {
    maxDepth?: number;
    excludeDirs?: string[];
    requireTestInPath?: boolean;
}) => FileFilter;
/**
 * Filter for potential JUnit XML files based on naming conventions
 */
export declare const createJUnitXMLFilter: () => FileFilter;
/**
 * Create a transform stream that buffers chunks to a specific size
 */
export declare const createChunkBuffer: (targetChunkSize?: number) => Transform;
/**
 * Create a size-limiting transform stream
 */
export declare const createSizeLimiter: (maxSizeBytes: number) => Transform;
/**
 * Create a timeout transform stream
 */
export declare const createTimeoutStream: (timeoutMs: number) => Transform;
/**
 * Default retry configuration
 */
export declare const DEFAULT_RETRY_CONFIG: RetryConfig;
/**
 * Calculate delay for retry attempt with exponential backoff and jitter
 */
export declare const calculateRetryDelay: (attempt: number, config?: RetryConfig) => number;
/**
 * Sleep utility for delays
 */
export declare const sleep: (ms: number) => Promise<void>;
/**
 * Retry function with exponential backoff
 */
export declare function withRetry<T>(operation: (attempt: number) => Promise<T>, config?: RetryConfig): Promise<T>;
/**
 * Create a retryable HTTP fetch function
 */
export declare const createRetryableFetch: (config?: RetryConfig) => (url: string, options?: RequestInit) => Promise<Response>;
/**
 * Validate URL for security and correctness
 */
export declare const validateUrl: (urlString: string) => {
    isValid: boolean;
    error?: string;
};
/**
 * Detect JUnit format from file name and path
 */
export declare const detectFormatFromPath: (filePath: string) => JUnitFormat;
/**
 * Create error with proper typing
 */
export declare const createIngestionError: (type: IngestionErrorType, message: string, details?: Record<string, unknown>, fileName?: string, cause?: Error) => IngestionError;
/**
 * Safely create file path with directory creation
 */
export declare const ensureDirectoryExists: (filePath: string) => Promise<void>;
/**
 * Get file stats safely
 */
export declare const getFileStats: (filePath: string) => Promise<{
    size: number;
    mtime: Date;
} | null>;
/**
 * Clean up temporary files
 */
export declare const cleanupTempFiles: (filePaths: string[]) => Promise<void>;
/**
 * Validate artifact source
 */
export declare const validateArtifactSource: (artifact: ArtifactSource) => string[];
/**
 * Sanitize file name for safe file system usage
 */
export declare const sanitizeFileName: (fileName: string) => string;
/**
 * Generate correlation ID for request tracking
 */
export declare const generateCorrelationId: () => string;
export {};
//# sourceMappingURL=utils.d.ts.map