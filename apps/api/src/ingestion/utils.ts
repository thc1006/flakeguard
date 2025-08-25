/**
 * Comprehensive utility functions for JUnit XML ingestion
 * Includes artifact filtering, stream processing, retry logic, and security utilities
 */

import { createReadStream, createWriteStream } from 'fs';
import { pipeline, Transform } from 'stream';
import { promisify } from 'util';
import { URL } from 'url';
import type {
  ArtifactSource,
  ZipEntryInfo,
  FileFilter,
  RetryConfig,
  StreamProcessingOptions,
  IngestionError,
  IngestionErrorType,
  JUnitFormat
} from './types.js';

const pipelineAsync = promisify(pipeline);

// ============================================================================
// Artifact Filtering Utilities
// ============================================================================

/**
 * Default artifact name patterns that likely contain test results
 */
const DEFAULT_TEST_RESULT_PATTERNS = [
  /test-results?/i,
  /junit/i,
  /surefire-reports?/i,
  /test-reports?/i,
  /test-output/i,
  /build\/test-results/i,
  /target\/surefire-reports/i,
  /coverage/i
] as const;

/**
 * Supported file extensions for test result files
 */
const SUPPORTED_EXTENSIONS = ['.xml', '.zip', '.tar.gz', '.tgz'] as const;
export type SupportedExtension = typeof SUPPORTED_EXTENSIONS[number];

/**
 * Check if artifact name matches test result patterns
 */
export const isTestResultArtifact = (artifactName: string): boolean => {
  const normalized = artifactName.toLowerCase();
  return DEFAULT_TEST_RESULT_PATTERNS.some(pattern => pattern.test(normalized));
};

/**
 * Check if file has supported extension
 */
export const hasSupportedExtension = (fileName: string): boolean => {
  const normalized = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => normalized.endsWith(ext));
};

/**
 * Extract file extension with type safety
 */
export const getFileExtension = (fileName: string): SupportedExtension | null => {
  const normalized = fileName.toLowerCase();
  const supportedExt = SUPPORTED_EXTENSIONS.find(ext => normalized.endsWith(ext));
  return supportedExt || null;
};

/**
 * Comprehensive artifact filter
 */
export const createArtifactFilter = (options?: {
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
  maxSizeBytes?: number;
  requiredExtensions?: SupportedExtension[];
}) => {
  const {
    includePatterns = DEFAULT_TEST_RESULT_PATTERNS,
    excludePatterns = [],
    maxSizeBytes = 100 * 1024 * 1024, // 100MB default
    requiredExtensions = SUPPORTED_EXTENSIONS
  } = options || {};

  return (artifact: ArtifactSource): boolean => {
    const { name, size } = artifact;
    const normalized = name.toLowerCase();

    // Size check
    if (size && size > maxSizeBytes) {
      return false;
    }

    // Extension check
    if (!requiredExtensions.some(ext => normalized.endsWith(ext))) {
      return false;
    }

    // Exclude patterns check
    if (excludePatterns.some(pattern => pattern.test(normalized))) {
      return false;
    }

    // Include patterns check
    return includePatterns.some(pattern => pattern.test(normalized));
  };
};

// ============================================================================
// ZIP Entry Filtering
// ============================================================================

/**
 * Default filter for XML files in ZIP archives
 */
export const createXMLFileFilter = (options?: {
  maxDepth?: number;
  excludeDirs?: string[];
  requireTestInPath?: boolean;
}): FileFilter => {
  const {
    maxDepth = 10,
    excludeDirs = ['node_modules', '.git', '__pycache__', 'coverage'],
    requireTestInPath = false
  } = options || {};

  return (entry: ZipEntryInfo): boolean => {
    const { name, isFile, isDirectory } = entry;
    
    // Skip directories
    if (isDirectory) return false;
    
    // Check depth
    const depth = name.split('/').length - 1;
    if (depth > maxDepth) return false;
    
    // Check excluded directories
    if (excludeDirs.some(dir => name.includes(dir))) return false;
    
    // Check if it's an XML file
    if (!name.toLowerCase().endsWith('.xml')) return false;
    
    // Optionally require 'test' in the path
    if (requireTestInPath && !/test/i.test(name)) return false;
    
    return isFile;
  };
};

/**
 * Filter for potential JUnit XML files based on naming conventions
 */
export const createJUnitXMLFilter = (): FileFilter => {
  const junitPatterns = [
    /TEST-.*\.xml$/i,
    /.*test.*\.xml$/i,
    /junit.*\.xml$/i,
    /surefire.*\.xml$/i,
    /test-results.*\.xml$/i
  ];

  return (entry: ZipEntryInfo): boolean => {
    if (!entry.isFile || !entry.name.toLowerCase().endsWith('.xml')) {
      return false;
    }

    return junitPatterns.some(pattern => pattern.test(entry.name));
  };
};

// ============================================================================
// Stream Processing Helpers
// ============================================================================

/**
 * Create a transform stream that buffers chunks to a specific size
 */
export const createChunkBuffer = (targetChunkSize: number = 64 * 1024): Transform => {
  let buffer = Buffer.alloc(0);

  return new Transform({
    transform(chunk: Buffer, encoding, callback) {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= targetChunkSize) {
        this.push(buffer.subarray(0, targetChunkSize));
        buffer = buffer.subarray(targetChunkSize);
      }

      callback();
    },
    flush(callback) {
      if (buffer.length > 0) {
        this.push(buffer);
      }
      callback();
    }
  });
};

/**
 * Create a size-limiting transform stream
 */
export const createSizeLimiter = (maxSizeBytes: number): Transform => {
  let totalSize = 0;

  return new Transform({
    transform(chunk: Buffer, encoding, callback) {
      totalSize += chunk.length;
      
      if (totalSize > maxSizeBytes) {
        return callback(new Error(`File size exceeds limit of ${maxSizeBytes} bytes`));
      }

      callback(null, chunk);
    }
  });
};

/**
 * Create a timeout transform stream
 */
export const createTimeoutStream = (timeoutMs: number): Transform => {
  let timeout: NodeJS.Timeout;
  let hasData = false;

  const stream = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      if (!hasData) {
        hasData = true;
        clearTimeout(timeout);
      }

      // Reset timeout on each chunk
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        stream.destroy(new Error(`Stream timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      callback(null, chunk);
    },
    flush(callback) {
      clearTimeout(timeout);
      callback();
    }
  });

  // Initial timeout
  timeout = setTimeout(() => {
    if (!hasData) {
      stream.destroy(new Error(`Stream timeout after ${timeoutMs}ms - no data received`));
    }
  }, timeoutMs);

  return stream;
};

// ============================================================================
// Retry Utilities with Exponential Backoff
// ============================================================================

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterEnabled: true
} as const;

/**
 * Calculate delay for retry attempt with exponential backoff and jitter
 */
export const calculateRetryDelay = (
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number => {
  const { baseDelayMs, maxDelayMs, backoffMultiplier, jitterEnabled } = config;
  
  // Calculate exponential backoff delay
  let delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);
  
  // Add jitter if enabled (±25% randomization)
  if (jitterEnabled) {
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay = Math.max(0, delay + jitter);
  }
  
  return Math.round(delay);
};

/**
 * Sleep utility for delays
 */
export const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry function with exponential backoff
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  const { maxAttempts } = config;
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on last attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Calculate delay and wait
      const delay = calculateRetryDelay(attempt, config);
      await sleep(delay);
    }
  }

  throw new Error(`Operation failed after ${maxAttempts} attempts. Last error: ${lastError.message}`);
}

/**
 * Create a retryable HTTP fetch function
 */
export const createRetryableFetch = (config: RetryConfig = DEFAULT_RETRY_CONFIG) => {
  return async (url: string, options?: RequestInit): Promise<Response> => {
    return withRetry(async (attempt) => {
      const response = await fetch(url, {
        ...options,
        signal: options?.signal || AbortSignal.timeout(30000) // 30s default timeout
      });

      if (!response.ok) {
        // Determine if error is retryable
        const isRetryable = response.status >= 500 || 
                           response.status === 429 || 
                           response.status === 408;
        
        if (!isRetryable) {
          throw new Error(`HTTP ${response.status}: ${response.statusText} (non-retryable)`);
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText} (attempt ${attempt})`);
      }

      return response;
    }, config);
  };
};

// ============================================================================
// URL Validation and Security
// ============================================================================

/**
 * Allowed URL schemes for security
 */
const ALLOWED_SCHEMES = ['https'] as const;

/**
 * Blocked domains/IPs for security (prevent SSRF)
 */
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal', // GCP metadata
  '169.254.169.254', // AWS/Azure metadata
  '10.',  // Private IP ranges
  '172.',
  '192.168.'
] as const;

/**
 * Validate URL for security and correctness
 */
export const validateUrl = (urlString: string): { isValid: boolean; error?: string } => {
  try {
    const url = new URL(urlString);

    // Check scheme
    if (!ALLOWED_SCHEMES.includes(url.protocol.slice(0, -1) as any)) {
      return { isValid: false, error: `Unsupported protocol: ${url.protocol}` };
    }

    // Check for blocked hosts
    const hostname = url.hostname.toLowerCase();
    for (const blockedHost of BLOCKED_HOSTS) {
      if (hostname === blockedHost || hostname.includes(blockedHost)) {
        return { isValid: false, error: `Blocked hostname: ${hostname}` };
      }
    }

    // Check for private IP ranges more thoroughly
    if (isPrivateIP(hostname)) {
      return { isValid: false, error: `Private IP address not allowed: ${hostname}` };
    }

    return { isValid: true };
  } catch (error) {
    return { isValid: false, error: `Invalid URL: ${error instanceof Error ? error.message : String(error)}` };
  }
};

/**
 * Check if hostname is a private IP address
 */
const isPrivateIP = (hostname: string): boolean => {
  // IPv4 private ranges
  const ipv4Patterns = [
    /^10\./,                    // 10.0.0.0/8
    /^192\.168\./,              // 192.168.0.0/16
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^127\./,                   // Loopback
    /^0\./,                     // This network
    /^169\.254\./,              // Link-local
    /^224\./,                   // Multicast
    /^240\./                    // Reserved
  ];

  return ipv4Patterns.some(pattern => pattern.test(hostname));
};

// ============================================================================
// Format Detection Utilities
// ============================================================================

/**
 * JUnit format detection patterns
 */
const FORMAT_INDICATORS: Record<JUnitFormat, readonly string[]> = {
  surefire: ['surefire', 'maven', 'TEST-', '.Surefire'],
  gradle: ['gradle', 'build/test-results', 'Test Executor'],
  jest: ['jest', '__tests__', '.test.js', '.spec.js'],
  pytest: ['pytest', 'python', '.py', 'test_'],
  phpunit: ['phpunit', 'php', '.php', 'PHPUnit'],
  generic: []
} as const;

/**
 * Detect JUnit format from file name and path
 */
export const detectFormatFromPath = (filePath: string): JUnitFormat => {
  const normalized = filePath.toLowerCase();
  
  for (const [format, indicators] of Object.entries(FORMAT_INDICATORS)) {
    if (format === 'generic') continue; // Skip generic for path-based detection
    
    if (indicators.some(indicator => normalized.includes(indicator.toLowerCase()))) {
      return format as JUnitFormat;
    }
  }
  
  return 'generic';
};

/**
 * Create error with proper typing
 */
export const createIngestionError = (
  type: IngestionErrorType,
  message: string,
  details?: Record<string, unknown>,
  fileName?: string,
  cause?: Error
): IngestionError => ({
  type,
  message,
  details,
  fileName,
  cause,
  timestamp: new Date()
});

// ============================================================================
// File System Utilities
// ============================================================================

/**
 * Safely create file path with directory creation
 */
export const ensureDirectoryExists = async (filePath: string): Promise<void> => {
  const { dirname } = await import('path');
  const { mkdir } = await import('fs/promises');
  
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
};

/**
 * Get file stats safely
 */
export const getFileStats = async (filePath: string): Promise<{ size: number; mtime: Date } | null> => {
  try {
    const { stat } = await import('fs/promises');
    const stats = await stat(filePath);
    return {
      size: stats.size,
      mtime: stats.mtime
    };
  } catch {
    return null;
  }
};

/**
 * Clean up temporary files
 */
export const cleanupTempFiles = async (filePaths: string[]): Promise<void> => {
  const { unlink } = await import('fs/promises');
  
  await Promise.allSettled(
    filePaths.map(async (filePath) => {
      try {
        await unlink(filePath);
      } catch {
        // Ignore errors when cleaning up
      }
    })
  );
};

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate artifact source
 */
export const validateArtifactSource = (artifact: ArtifactSource): string[] => {
  const errors: string[] = [];
  
  if (!artifact.name || artifact.name.trim().length === 0) {
    errors.push('Artifact name is required');
  }
  
  if (!artifact.url || artifact.url.trim().length === 0) {
    errors.push('Artifact URL is required');
  } else {
    const urlValidation = validateUrl(artifact.url);
    if (!urlValidation.isValid) {
      errors.push(`Invalid artifact URL: ${urlValidation.error}`);
    }
  }
  
  if (artifact.size !== undefined && artifact.size < 0) {
    errors.push('Artifact size cannot be negative');
  }
  
  if (artifact.expiresAt && artifact.expiresAt < new Date()) {
    errors.push('Artifact URL has expired');
  }
  
  return errors;
};

/**
 * Sanitize file name for safe file system usage
 */
export const sanitizeFileName = (fileName: string): string => {
  return fileName
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
    .replace(/\s+/g, '_')          // Replace whitespace
    .replace(/_{2,}/g, '_')        // Collapse multiple underscores
    .replace(/^_+|_+$/g, '')       // Trim underscores
    .substring(0, 255);            // Limit length
};

/**
 * Generate correlation ID for request tracking
 */
export const generateCorrelationId = (): string => {
  return `ing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};