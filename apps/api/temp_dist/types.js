/**
 * Comprehensive TypeScript interfaces for JUnit XML ingestion service
 * Supports multiple JUnit formats with advanced type safety
 */
import { z } from 'zod';
/**
 * Typed exception classes
 */
export class IngestionException extends Error {
    constructor(errorType, message, details, fileName, cause) {
        super(message);
        this.errorType = errorType;
        this.details = details;
        this.fileName = fileName;
        this.cause = cause;
        this.name = 'IngestionException';
    }
    toIngestionError() {
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
    constructor(message, fileName, cause) {
        super('DOWNLOAD_FAILED', message, undefined, fileName, cause);
        this.name = 'DownloadFailedException';
    }
}
export class ParsingFailedException extends IngestionException {
    constructor(message, fileName, cause) {
        super('PARSING_FAILED', message, undefined, fileName, cause);
        this.name = 'ParsingFailedException';
    }
}
export class TimeoutException extends IngestionException {
    constructor(message, timeoutMs) {
        super('TIMEOUT', message, { timeoutMs });
        this.name = 'TimeoutException';
    }
}
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
/**
 * Type guard for JUnit format detection
 */
export const isJUnitFormat = (value) => {
    return ['surefire', 'gradle', 'jest', 'pytest', 'phpunit', 'generic'].includes(value);
};
/**
 * Type predicate for error checking
 */
export const isIngestionError = (error) => {
    return typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        'message' in error &&
        'timestamp' in error;
};
