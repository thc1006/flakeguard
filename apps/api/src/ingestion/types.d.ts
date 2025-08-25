/**
 * Comprehensive TypeScript interfaces for JUnit XML ingestion service
 * Supports multiple JUnit formats with advanced type safety
 */
import { z } from 'zod';
/**
 * Base test case status discriminated union
 */
export type TestCaseStatus = 'passed' | 'failed' | 'error' | 'skipped' | 'flaky';
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
    readonly time?: number;
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
/**
 * Supported JUnit XML formats with conditional parsing
 */
export type JUnitFormat = 'surefire' | 'gradle' | 'jest' | 'pytest' | 'phpunit' | 'generic';
/**
 * Format-specific parser configuration
 */
export type FormatSpecificConfig<T extends JUnitFormat> = T extends 'surefire' ? {
    readonly surefireVersion?: string;
    readonly includeSystemProperties?: boolean;
} : T extends 'gradle' ? {
    readonly gradleVersion?: string;
    readonly includeStandardStreams?: boolean;
} : T extends 'jest' ? {
    readonly jestVersion?: string;
    readonly collectCoverage?: boolean;
} : T extends 'pytest' ? {
    readonly pytestVersion?: string;
    readonly includeProperties?: boolean;
} : T extends 'phpunit' ? {
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
    readonly confidence: number;
    readonly indicators: readonly string[];
}
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
/**
 * Base ingestion error types
 */
export type IngestionErrorType = 'DOWNLOAD_FAILED' | 'EXTRACTION_FAILED' | 'PARSING_FAILED' | 'VALIDATION_FAILED' | 'TIMEOUT' | 'RETRY_EXHAUSTED' | 'UNSUPPORTED_FORMAT' | 'FILE_TOO_LARGE' | 'NETWORK_ERROR' | 'AUTHENTICATION_ERROR' | 'RATE_LIMITED';
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
export declare class IngestionException extends Error {
    readonly errorType: IngestionErrorType;
    readonly details?: Record<string, unknown> | undefined;
    readonly fileName?: string | undefined;
    readonly cause?: Error | undefined;
    constructor(errorType: IngestionErrorType, message: string, details?: Record<string, unknown> | undefined, fileName?: string | undefined, cause?: Error | undefined);
    toIngestionError(): IngestionError;
}
/**
 * Specific exception types with type safety
 */
export declare class DownloadFailedException extends IngestionException {
    constructor(message: string, fileName?: string, cause?: Error);
}
export declare class ParsingFailedException extends IngestionException {
    constructor(message: string, fileName?: string, cause?: Error);
}
export declare class TimeoutException extends IngestionException {
    constructor(message: string, timeoutMs: number);
}
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
/**
 * Zod schemas for runtime validation
 */
export declare const TestCaseSchema: z.ZodObject<{
    name: z.ZodString;
    className: z.ZodString;
    time: z.ZodOptional<z.ZodNumber>;
    status: z.ZodEnum<["passed", "failed", "error", "skipped", "flaky"]>;
    failure: z.ZodOptional<z.ZodObject<{
        type: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        stackTrace: z.ZodOptional<z.ZodString>;
        systemOut: z.ZodOptional<z.ZodString>;
        systemErr: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        message?: string | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
        stackTrace?: string | undefined;
    }, {
        type: string;
        message?: string | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
        stackTrace?: string | undefined;
    }>>;
    error: z.ZodOptional<z.ZodObject<{
        type: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        stackTrace: z.ZodOptional<z.ZodString>;
        systemOut: z.ZodOptional<z.ZodString>;
        systemErr: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: string;
        message?: string | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
        stackTrace?: string | undefined;
    }, {
        type: string;
        message?: string | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
        stackTrace?: string | undefined;
    }>>;
    skipped: z.ZodOptional<z.ZodObject<{
        message: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        message?: string | undefined;
    }, {
        message?: string | undefined;
    }>>;
    systemOut: z.ZodOptional<z.ZodString>;
    systemErr: z.ZodOptional<z.ZodString>;
    properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status: "error" | "failed" | "skipped" | "passed" | "flaky";
    name: string;
    className: string;
    error?: {
        type: string;
        message?: string | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
        stackTrace?: string | undefined;
    } | undefined;
    failure?: {
        type: string;
        message?: string | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
        stackTrace?: string | undefined;
    } | undefined;
    skipped?: {
        message?: string | undefined;
    } | undefined;
    time?: number | undefined;
    properties?: Record<string, string> | undefined;
    systemOut?: string | undefined;
    systemErr?: string | undefined;
}, {
    status: "error" | "failed" | "skipped" | "passed" | "flaky";
    name: string;
    className: string;
    error?: {
        type: string;
        message?: string | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
        stackTrace?: string | undefined;
    } | undefined;
    failure?: {
        type: string;
        message?: string | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
        stackTrace?: string | undefined;
    } | undefined;
    skipped?: {
        message?: string | undefined;
    } | undefined;
    time?: number | undefined;
    properties?: Record<string, string> | undefined;
    systemOut?: string | undefined;
    systemErr?: string | undefined;
}>;
export declare const TestSuiteSchema: z.ZodObject<{
    name: z.ZodString;
    id: z.ZodOptional<z.ZodString>;
    package: z.ZodOptional<z.ZodString>;
    hostname: z.ZodOptional<z.ZodString>;
    tests: z.ZodNumber;
    failures: z.ZodNumber;
    errors: z.ZodNumber;
    skipped: z.ZodNumber;
    time: z.ZodOptional<z.ZodNumber>;
    timestamp: z.ZodOptional<z.ZodString>;
    properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    testCases: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        className: z.ZodString;
        time: z.ZodOptional<z.ZodNumber>;
        status: z.ZodEnum<["passed", "failed", "error", "skipped", "flaky"]>;
        failure: z.ZodOptional<z.ZodObject<{
            type: z.ZodString;
            message: z.ZodOptional<z.ZodString>;
            stackTrace: z.ZodOptional<z.ZodString>;
            systemOut: z.ZodOptional<z.ZodString>;
            systemErr: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        }, {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        }>>;
        error: z.ZodOptional<z.ZodObject<{
            type: z.ZodString;
            message: z.ZodOptional<z.ZodString>;
            stackTrace: z.ZodOptional<z.ZodString>;
            systemOut: z.ZodOptional<z.ZodString>;
            systemErr: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        }, {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        }>>;
        skipped: z.ZodOptional<z.ZodObject<{
            message: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            message?: string | undefined;
        }, {
            message?: string | undefined;
        }>>;
        systemOut: z.ZodOptional<z.ZodString>;
        systemErr: z.ZodOptional<z.ZodString>;
        properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        status: "error" | "failed" | "skipped" | "passed" | "flaky";
        name: string;
        className: string;
        error?: {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        } | undefined;
        failure?: {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        } | undefined;
        skipped?: {
            message?: string | undefined;
        } | undefined;
        time?: number | undefined;
        properties?: Record<string, string> | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
    }, {
        status: "error" | "failed" | "skipped" | "passed" | "flaky";
        name: string;
        className: string;
        error?: {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        } | undefined;
        failure?: {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        } | undefined;
        skipped?: {
            message?: string | undefined;
        } | undefined;
        time?: number | undefined;
        properties?: Record<string, string> | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
    }>, "many">;
    systemOut: z.ZodOptional<z.ZodString>;
    systemErr: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    errors: number;
    skipped: number;
    tests: number;
    failures: number;
    testCases: {
        status: "error" | "failed" | "skipped" | "passed" | "flaky";
        name: string;
        className: string;
        error?: {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        } | undefined;
        failure?: {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        } | undefined;
        skipped?: {
            message?: string | undefined;
        } | undefined;
        time?: number | undefined;
        properties?: Record<string, string> | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
    }[];
    id?: string | undefined;
    timestamp?: string | undefined;
    time?: number | undefined;
    package?: string | undefined;
    hostname?: string | undefined;
    properties?: Record<string, string> | undefined;
    systemOut?: string | undefined;
    systemErr?: string | undefined;
}, {
    name: string;
    errors: number;
    skipped: number;
    tests: number;
    failures: number;
    testCases: {
        status: "error" | "failed" | "skipped" | "passed" | "flaky";
        name: string;
        className: string;
        error?: {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        } | undefined;
        failure?: {
            type: string;
            message?: string | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
            stackTrace?: string | undefined;
        } | undefined;
        skipped?: {
            message?: string | undefined;
        } | undefined;
        time?: number | undefined;
        properties?: Record<string, string> | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
    }[];
    id?: string | undefined;
    timestamp?: string | undefined;
    time?: number | undefined;
    package?: string | undefined;
    hostname?: string | undefined;
    properties?: Record<string, string> | undefined;
    systemOut?: string | undefined;
    systemErr?: string | undefined;
}>;
export declare const TestSuitesSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    tests: z.ZodNumber;
    failures: z.ZodNumber;
    errors: z.ZodNumber;
    skipped: z.ZodNumber;
    time: z.ZodOptional<z.ZodNumber>;
    timestamp: z.ZodOptional<z.ZodString>;
    suites: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        id: z.ZodOptional<z.ZodString>;
        package: z.ZodOptional<z.ZodString>;
        hostname: z.ZodOptional<z.ZodString>;
        tests: z.ZodNumber;
        failures: z.ZodNumber;
        errors: z.ZodNumber;
        skipped: z.ZodNumber;
        time: z.ZodOptional<z.ZodNumber>;
        timestamp: z.ZodOptional<z.ZodString>;
        properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        testCases: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            className: z.ZodString;
            time: z.ZodOptional<z.ZodNumber>;
            status: z.ZodEnum<["passed", "failed", "error", "skipped", "flaky"]>;
            failure: z.ZodOptional<z.ZodObject<{
                type: z.ZodString;
                message: z.ZodOptional<z.ZodString>;
                stackTrace: z.ZodOptional<z.ZodString>;
                systemOut: z.ZodOptional<z.ZodString>;
                systemErr: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            }, {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            }>>;
            error: z.ZodOptional<z.ZodObject<{
                type: z.ZodString;
                message: z.ZodOptional<z.ZodString>;
                stackTrace: z.ZodOptional<z.ZodString>;
                systemOut: z.ZodOptional<z.ZodString>;
                systemErr: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            }, {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            }>>;
            skipped: z.ZodOptional<z.ZodObject<{
                message: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                message?: string | undefined;
            }, {
                message?: string | undefined;
            }>>;
            systemOut: z.ZodOptional<z.ZodString>;
            systemErr: z.ZodOptional<z.ZodString>;
            properties: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            status: "error" | "failed" | "skipped" | "passed" | "flaky";
            name: string;
            className: string;
            error?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            failure?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            skipped?: {
                message?: string | undefined;
            } | undefined;
            time?: number | undefined;
            properties?: Record<string, string> | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
        }, {
            status: "error" | "failed" | "skipped" | "passed" | "flaky";
            name: string;
            className: string;
            error?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            failure?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            skipped?: {
                message?: string | undefined;
            } | undefined;
            time?: number | undefined;
            properties?: Record<string, string> | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
        }>, "many">;
        systemOut: z.ZodOptional<z.ZodString>;
        systemErr: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        errors: number;
        skipped: number;
        tests: number;
        failures: number;
        testCases: {
            status: "error" | "failed" | "skipped" | "passed" | "flaky";
            name: string;
            className: string;
            error?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            failure?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            skipped?: {
                message?: string | undefined;
            } | undefined;
            time?: number | undefined;
            properties?: Record<string, string> | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
        }[];
        id?: string | undefined;
        timestamp?: string | undefined;
        time?: number | undefined;
        package?: string | undefined;
        hostname?: string | undefined;
        properties?: Record<string, string> | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
    }, {
        name: string;
        errors: number;
        skipped: number;
        tests: number;
        failures: number;
        testCases: {
            status: "error" | "failed" | "skipped" | "passed" | "flaky";
            name: string;
            className: string;
            error?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            failure?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            skipped?: {
                message?: string | undefined;
            } | undefined;
            time?: number | undefined;
            properties?: Record<string, string> | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
        }[];
        id?: string | undefined;
        timestamp?: string | undefined;
        time?: number | undefined;
        package?: string | undefined;
        hostname?: string | undefined;
        properties?: Record<string, string> | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    errors: number;
    skipped: number;
    tests: number;
    suites: {
        name: string;
        errors: number;
        skipped: number;
        tests: number;
        failures: number;
        testCases: {
            status: "error" | "failed" | "skipped" | "passed" | "flaky";
            name: string;
            className: string;
            error?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            failure?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            skipped?: {
                message?: string | undefined;
            } | undefined;
            time?: number | undefined;
            properties?: Record<string, string> | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
        }[];
        id?: string | undefined;
        timestamp?: string | undefined;
        time?: number | undefined;
        package?: string | undefined;
        hostname?: string | undefined;
        properties?: Record<string, string> | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
    }[];
    failures: number;
    name?: string | undefined;
    timestamp?: string | undefined;
    time?: number | undefined;
}, {
    errors: number;
    skipped: number;
    tests: number;
    suites: {
        name: string;
        errors: number;
        skipped: number;
        tests: number;
        failures: number;
        testCases: {
            status: "error" | "failed" | "skipped" | "passed" | "flaky";
            name: string;
            className: string;
            error?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            failure?: {
                type: string;
                message?: string | undefined;
                systemOut?: string | undefined;
                systemErr?: string | undefined;
                stackTrace?: string | undefined;
            } | undefined;
            skipped?: {
                message?: string | undefined;
            } | undefined;
            time?: number | undefined;
            properties?: Record<string, string> | undefined;
            systemOut?: string | undefined;
            systemErr?: string | undefined;
        }[];
        id?: string | undefined;
        timestamp?: string | undefined;
        time?: number | undefined;
        package?: string | undefined;
        hostname?: string | undefined;
        properties?: Record<string, string> | undefined;
        systemOut?: string | undefined;
        systemErr?: string | undefined;
    }[];
    failures: number;
    name?: string | undefined;
    timestamp?: string | undefined;
    time?: number | undefined;
}>;
export declare const IngestionConfigSchema: z.ZodObject<{
    repository: z.ZodObject<{
        owner: z.ZodString;
        repo: z.ZodString;
        ref: z.ZodOptional<z.ZodString>;
        sha: z.ZodOptional<z.ZodString>;
        runId: z.ZodOptional<z.ZodNumber>;
        jobId: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        owner: string;
        repo: string;
        jobId?: number | undefined;
        runId?: number | undefined;
        ref?: string | undefined;
        sha?: string | undefined;
    }, {
        owner: string;
        repo: string;
        jobId?: number | undefined;
        runId?: number | undefined;
        ref?: string | undefined;
        sha?: string | undefined;
    }>;
    artifacts: z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        name: z.ZodString;
        size: z.ZodOptional<z.ZodNumber>;
        downloadUrl: z.ZodOptional<z.ZodString>;
        expiresAt: z.ZodOptional<z.ZodDate>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        name: string;
        downloadUrl?: string | undefined;
        expiresAt?: Date | undefined;
        size?: number | undefined;
    }, {
        url: string;
        name: string;
        downloadUrl?: string | undefined;
        expiresAt?: Date | undefined;
        size?: number | undefined;
    }>, "many">;
    expectedFormat: z.ZodOptional<z.ZodEnum<["surefire", "gradle", "jest", "pytest", "phpunit", "generic"]>>;
    streamingEnabled: z.ZodOptional<z.ZodBoolean>;
    maxFileSizeBytes: z.ZodOptional<z.ZodNumber>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
    concurrency: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    repository: {
        owner: string;
        repo: string;
        jobId?: number | undefined;
        runId?: number | undefined;
        ref?: string | undefined;
        sha?: string | undefined;
    };
    artifacts: {
        url: string;
        name: string;
        downloadUrl?: string | undefined;
        expiresAt?: Date | undefined;
        size?: number | undefined;
    }[];
    maxFileSizeBytes?: number | undefined;
    expectedFormat?: "surefire" | "gradle" | "jest" | "pytest" | "phpunit" | "generic" | undefined;
    streamingEnabled?: boolean | undefined;
    timeoutMs?: number | undefined;
    concurrency?: number | undefined;
}, {
    repository: {
        owner: string;
        repo: string;
        jobId?: number | undefined;
        runId?: number | undefined;
        ref?: string | undefined;
        sha?: string | undefined;
    };
    artifacts: {
        url: string;
        name: string;
        downloadUrl?: string | undefined;
        expiresAt?: Date | undefined;
        size?: number | undefined;
    }[];
    maxFileSizeBytes?: number | undefined;
    expectedFormat?: "surefire" | "gradle" | "jest" | "pytest" | "phpunit" | "generic" | undefined;
    streamingEnabled?: boolean | undefined;
    timeoutMs?: number | undefined;
    concurrency?: number | undefined;
}>;
/**
 * Extract format-specific config type
 */
export type ExtractFormatConfig<T> = T extends IngestionConfig<infer F> ? FormatSpecificConfig<F> : never;
/**
 * Conditional result type based on format
 */
export type FormatSpecificResult<T extends JUnitFormat> = FileProcessingResult & {
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
export type AsyncIngestionResult<T extends JUnitFormat = JUnitFormat> = Promise<IngestionResult & {
    format?: T;
}>;
/**
 * Type guard for JUnit format detection
 */
export declare const isJUnitFormat: (value: string) => value is JUnitFormat;
/**
 * Type predicate for error checking
 */
export declare const isIngestionError: (error: unknown) => error is IngestionError;
//# sourceMappingURL=types.d.ts.map