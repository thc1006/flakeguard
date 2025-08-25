/**
 * Shared Ingestion Types
 * 
 * Type definitions for JUnit ingestion functionality shared across
 * API and worker services, including job configurations, status tracking,
 * and result reporting.
 */

// ============================================================================
// Core Ingestion Types
// ============================================================================

/**
 * Ingestion job status
 */
export type IngestionJobStatus = 
  | 'queued' 
  | 'processing' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

/**
 * Job priority levels
 */
export type IngestionJobPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Processing phases
 */
export type IngestionPhase = 'download' | 'extract' | 'parse' | 'complete';

/**
 * Artifact source information
 */
export interface ArtifactSourceInfo {
  readonly id: number;
  readonly name: string;
  readonly url: string;
  readonly sizeInBytes: number;
  readonly expiresAt: string; // ISO date string
  readonly createdAt: string; // ISO date string
}

/**
 * Repository context for ingestion
 */
export interface IngestionRepositoryInfo {
  readonly owner: string;
  readonly repo: string;
  readonly installationId: number;
}

/**
 * Artifact filtering criteria
 */
export interface ArtifactFilterCriteria {
  readonly namePatterns?: readonly string[];
  readonly extensions?: readonly string[];
  readonly maxSizeBytes?: number;
  readonly minSizeBytes?: number;
  readonly notExpired?: boolean;
}

// ============================================================================
// Job Configuration and Results
// ============================================================================

/**
 * Ingestion job configuration
 */
export interface IngestionJobConfig {
  readonly workflowRunId: number;
  readonly repository: IngestionRepositoryInfo;
  readonly filter?: ArtifactFilterCriteria;
  readonly priority?: IngestionJobPriority;
  readonly correlationId?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Job progress information
 */
export interface JobProgressInfo {
  readonly phase: IngestionPhase;
  readonly processed: number;
  readonly total: number;
  readonly percentage: number;
  readonly currentFileName?: string;
  readonly estimatedTimeRemaining?: number; // in milliseconds
}

/**
 * Job execution result
 */
export interface JobExecutionResult {
  readonly jobId: string;
  readonly success: boolean;
  readonly processedArtifacts: number;
  readonly totalTests: number;
  readonly totalFailures: number;
  readonly totalErrors: number;
  readonly processingTimeMs: number;
  readonly errors: readonly string[];
  readonly warnings?: readonly string[];
}

/**
 * Complete job information
 */
export interface IngestionJobInfo {
  readonly jobId: string;
  readonly correlationId?: string;
  readonly status: IngestionJobStatus;
  readonly priority: IngestionJobPriority;
  readonly workflowRunId: number;
  readonly repository: IngestionRepositoryInfo;
  readonly progress?: JobProgressInfo;
  readonly result?: JobExecutionResult;
  readonly createdAt: string; // ISO date string
  readonly startedAt?: string; // ISO date string
  readonly completedAt?: string; // ISO date string
  readonly errorMessage?: string;
  readonly metadata?: Record<string, unknown>;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Process artifacts request
 */
export interface ProcessArtifactsRequest {
  readonly workflowRunId: number;
  readonly repository: {
    readonly owner: string;
    readonly repo: string;
  };
  readonly installationId: number;
  readonly filter?: ArtifactFilterCriteria;
  readonly priority?: IngestionJobPriority;
  readonly correlationId?: string;
}

/**
 * Process artifacts response
 */
export interface ProcessArtifactsResponse {
  readonly jobId: string;
  readonly status: 'queued';
  readonly message: string;
  readonly correlationId: string;
  readonly estimatedCompletionTime: string; // ISO date string
  readonly statusUrl: string;
  readonly artifactCount: number;
}

/**
 * Job status response
 */
export interface JobStatusResponse {
  readonly jobId: string;
  readonly status: IngestionJobStatus;
  readonly progress?: JobProgressInfo;
  readonly result?: JobExecutionResult;
  readonly createdAt: string; // ISO date string
  readonly startedAt?: string; // ISO date string
  readonly completedAt?: string; // ISO date string
  readonly errorMessage?: string;
}

/**
 * Ingestion history query parameters
 */
export interface IngestionHistoryQuery {
  readonly repository?: string; // Format: "owner/repo"
  readonly status?: IngestionJobStatus;
  readonly fromDate?: string; // ISO date string
  readonly toDate?: string; // ISO date string
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: 'createdAt' | 'completedAt' | 'testCount' | 'processingTime';
  readonly orderDirection?: 'asc' | 'desc';
}

/**
 * Ingestion history response
 */
export interface IngestionHistoryResponse {
  readonly jobs: readonly JobStatusResponse[];
  readonly pagination: {
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
    readonly hasMore: boolean;
  };
}

// ============================================================================
// Queue and Worker Types
// ============================================================================

/**
 * Queue job data
 */
export interface IngestionQueueJobData extends IngestionJobConfig {
  readonly type: 'process-artifacts';
  readonly retryCount?: number;
  readonly automatic?: boolean;
  readonly triggeredBy?: string;
}

/**
 * Queue statistics
 */
export interface QueueStatistics {
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly delayed: number;
  readonly totalProcessed: number;
  readonly averageProcessingTime: number;
  readonly successRate: number;
}

/**
 * Worker health information
 */
export interface WorkerHealthInfo {
  readonly isRunning: boolean;
  readonly concurrency: number;
  readonly activeJobs: number;
  readonly completedJobs: number;
  readonly failedJobs: number;
  readonly lastProcessedAt?: string; // ISO date string
  readonly averageJobTime: number; // in milliseconds
  readonly errorRate: number; // percentage
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Job lifecycle events
 */
export type IngestionJobEvent = 
  | 'job-queued'
  | 'job-started'
  | 'job-progress'
  | 'job-completed'
  | 'job-failed'
  | 'job-cancelled';

/**
 * Job event payload
 */
export interface IngestionJobEventPayload {
  readonly event: IngestionJobEvent;
  readonly jobId: string;
  readonly correlationId?: string;
  readonly timestamp: string; // ISO date string
  readonly data: {
    readonly status?: IngestionJobStatus;
    readonly progress?: JobProgressInfo;
    readonly result?: JobExecutionResult;
    readonly error?: string;
  };
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Ingestion error categories
 */
export type IngestionErrorType =
  | 'VALIDATION_FAILED'
  | 'ARTIFACT_NOT_FOUND'
  | 'DOWNLOAD_FAILED'
  | 'EXTRACTION_FAILED'
  | 'PARSING_FAILED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'FILE_TOO_LARGE'
  | 'PROCESSING_FAILED';

/**
 * Detailed error information
 */
export interface IngestionErrorDetail {
  readonly type: IngestionErrorType;
  readonly message: string;
  readonly fileName?: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: Error;
  readonly timestamp: string; // ISO date string
  readonly retryable: boolean;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Pagination parameters
 */
export interface PaginationParams {
  readonly limit: number;
  readonly offset: number;
}

/**
 * Sort parameters
 */
export interface SortParams {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

/**
 * Filter parameters
 */
export interface FilterParams {
  readonly [key: string]: string | number | boolean | readonly (string | number | boolean)[];
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  readonly data: T;
  readonly success: boolean;
  readonly message?: string;
  readonly errors?: readonly string[];
  readonly timestamp: string; // ISO date string
}

// ============================================================================
// Type Guards and Validators
// ============================================================================

/**
 * Check if a value is a valid ingestion job status
 */
export function isIngestionJobStatus(value: unknown): value is IngestionJobStatus {
  return typeof value === 'string' && 
    ['queued', 'processing', 'completed', 'failed', 'cancelled'].includes(value);
}

/**
 * Check if a value is a valid job priority
 */
export function isIngestionJobPriority(value: unknown): value is IngestionJobPriority {
  return typeof value === 'string' && 
    ['low', 'normal', 'high', 'critical'].includes(value);
}

/**
 * Check if a value is a valid ingestion phase
 */
export function isIngestionPhase(value: unknown): value is IngestionPhase {
  return typeof value === 'string' && 
    ['download', 'extract', 'parse', 'complete'].includes(value);
}

/**
 * Validate repository info
 */
export function isValidRepositoryInfo(value: unknown): value is IngestionRepositoryInfo {
  if (typeof value !== 'object' || value === null) return false;
  
  const repo = value as Record<string, unknown>;
  return typeof repo.owner === 'string' &&
         typeof repo.repo === 'string' &&
         typeof repo.installationId === 'number' &&
         repo.owner.length > 0 &&
         repo.repo.length > 0 &&
         repo.installationId > 0;
}

/**
 * Validate artifact filter criteria
 */
export function isValidArtifactFilter(value: unknown): value is ArtifactFilterCriteria {
  if (typeof value !== 'object' || value === null) return true; // Optional
  
  const filter = value as Record<string, unknown>;
  
  // All fields are optional, but if present must be valid
  if (filter.namePatterns !== undefined && 
      (!Array.isArray(filter.namePatterns) || 
       !filter.namePatterns.every(p => typeof p === 'string'))) {
    return false;
  }
  
  if (filter.extensions !== undefined && 
      (!Array.isArray(filter.extensions) || 
       !filter.extensions.every(e => typeof e === 'string'))) {
    return false;
  }
  
  if (filter.maxSizeBytes !== undefined && 
      (typeof filter.maxSizeBytes !== 'number' || filter.maxSizeBytes <= 0)) {
    return false;
  }
  
  if (filter.minSizeBytes !== undefined && 
      (typeof filter.minSizeBytes !== 'number' || filter.minSizeBytes < 0)) {
    return false;
  }
  
  if (filter.notExpired !== undefined && typeof filter.notExpired !== 'boolean') {
    return false;
  }
  
  return true;
}