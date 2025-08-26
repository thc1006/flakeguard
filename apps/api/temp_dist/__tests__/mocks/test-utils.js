/**
 * Common Test Utilities for JUnit Ingestion Tests
 *
 * Provides shared utilities, helpers, and test data generators
 * used across multiple test files in the ingestion test suite.
 */
import { Readable, Transform } from 'stream';
import { vi } from 'vitest';
// ============================================================================
// Stream Utilities
// ============================================================================
/**
 * Create a readable stream from string content
 */
export function createStreamFromString(content) {
    return new Readable({
        read() {
            this.push(content);
            this.push(null);
        }
    });
}
/**
 * Create a readable stream that emits chunks with delays
 */
export function createSlowStream(content, chunkSize = 100, delay = 10) {
    let position = 0;
    return new Readable({
        read() {
            if (position >= content.length) {
                this.push(null);
                return;
            }
            setTimeout(() => {
                const chunk = content.slice(position, position + chunkSize);
                position += chunkSize;
                this.push(chunk);
            }, delay);
        }
    });
}
/**
 * Create a stream that fails after a delay
 */
export function createFailingStream(content, failAfterMs = 1000) {
    const stream = createStreamFromString(content);
    setTimeout(() => {
        stream.emit('error', new Error('Stream failed'));
    }, failAfterMs);
    return stream;
}
/**
 * Create a transform stream that simulates size limiting
 */
export function createSizeLimitTransform(maxSize) {
    let bytesProcessed = 0;
    return new Transform({
        transform(chunk, _encoding, callback) {
            bytesProcessed += chunk.length;
            if (bytesProcessed > maxSize) {
                callback(new Error(`Size limit exceeded: ${bytesProcessed} > ${maxSize}`));
                return;
            }
            callback(null, chunk);
        }
    });
}
/**
 * Create a transform stream that simulates timeout
 */
export function createTimeoutTransform(timeoutMs) {
    const timer = setTimeout(() => {
        stream.emit('error', new Error('Transform timeout'));
    }, timeoutMs);
    const stream = new Transform({
        transform(chunk, _encoding, callback) {
            callback(null, chunk);
        },
        flush(callback) {
            clearTimeout(timer);
            callback();
        }
    });
    return stream;
}
// ============================================================================
// Mock Data Generators
// ============================================================================
/**
 * Generate a test case with configurable properties
 */
export function createTestCase(options = {}) {
    const { name = 'testMethod', className = 'TestClass', status = 'passed', time = Math.random() * 2, withFailure = status === 'failed', withError = status === 'error', withSystemOutput = false } = options;
    // Create a mutable object first using type assertion
    const testCase = {
        name,
        className,
        status,
        time
    };
    if (withFailure && status === 'failed') {
        testCase.failure = {
            type: 'AssertionError',
            message: 'Test assertion failed',
            stackTrace: `AssertionError: Test assertion failed\n\tat ${className}.${name}(${className}.java:42)`
        };
    }
    if (withError && status === 'error') {
        testCase.error = {
            type: 'RuntimeException',
            message: 'Unexpected error occurred',
            stackTrace: `RuntimeException: Unexpected error occurred\n\tat ${className}.${name}(${className}.java:42)`
        };
    }
    if (status === 'skipped') {
        testCase.skipped = {
            message: 'Test was skipped'
        };
    }
    if (withSystemOutput) {
        testCase.systemOut = `System output for ${name}`;
        testCase.systemErr = `System error for ${name}`;
    }
    return testCase;
}
/**
 * Generate a test suite with configurable properties
 */
export function createTestSuite(options = {}) {
    const { name = 'TestSuite', testCount = 5, failureCount = 1, errorCount = 1, skippedCount = 1, withProperties = false, withSystemOutput = false } = options;
    const testCases = [];
    const passedCount = testCount - failureCount - errorCount - skippedCount;
    // Create passed tests
    for (let i = 0; i < passedCount; i++) {
        testCases.push(createTestCase({
            name: `testPassed${i + 1}`,
            status: 'passed'
        }));
    }
    // Create failed tests
    for (let i = 0; i < failureCount; i++) {
        testCases.push(createTestCase({
            name: `testFailed${i + 1}`,
            status: 'failed',
            withFailure: true
        }));
    }
    // Create error tests
    for (let i = 0; i < errorCount; i++) {
        testCases.push(createTestCase({
            name: `testError${i + 1}`,
            status: 'error',
            withError: true
        }));
    }
    // Create skipped tests
    for (let i = 0; i < skippedCount; i++) {
        testCases.push(createTestCase({
            name: `testSkipped${i + 1}`,
            status: 'skipped'
        }));
    }
    // Create a mutable object first using type assertion
    const suite = {
        name,
        tests: testCount,
        failures: failureCount,
        errors: errorCount,
        skipped: skippedCount,
        time: testCases.reduce((sum, tc) => sum + (tc.time || 0), 0),
        testCases
    };
    if (withProperties) {
        suite.properties = {
            'java.version': '17.0.5',
            'maven.version': '3.9.4',
            'surefire.version': '3.2.2'
        };
    }
    if (withSystemOutput) {
        suite.systemOut = `System output for ${name}`;
        suite.systemErr = `System error for ${name}`;
    }
    return suite;
}
/**
 * Generate test suites with configurable properties
 */
export function createTestSuites(options = {}) {
    const { suiteCount = 2, testCount = 5, failureCount = 1, errorCount = 1, skippedCount = 1 } = options;
    const suites = [];
    let totalTests = 0;
    let totalFailures = 0;
    let totalErrors = 0;
    let totalSkipped = 0;
    let totalTime = 0;
    for (let i = 0; i < suiteCount; i++) {
        const suite = createTestSuite({
            name: `TestSuite${i + 1}`,
            testCount,
            failureCount,
            errorCount,
            skippedCount
        });
        suites.push(suite);
        totalTests += suite.tests;
        totalFailures += suite.failures;
        totalErrors += suite.errors;
        totalSkipped += suite.skipped;
        totalTime += suite.time || 0;
    }
    return {
        name: 'Test Suites',
        tests: totalTests,
        failures: totalFailures,
        errors: totalErrors,
        skipped: totalSkipped,
        time: totalTime,
        suites
    };
}
// ============================================================================
// Time and Date Utilities
// ============================================================================
/**
 * Create a date string in ISO format
 */
export function createISODate(offsetMs = 0) {
    return new Date(Date.now() + offsetMs).toISOString();
}
/**
 * Create a JUnit-style timestamp
 */
export function createJUnitTimestamp(offsetMs = 0) {
    return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z/, '');
}
/**
 * Wait for a specified amount of time
 */
export function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Create a timeout promise that rejects after specified time
 */
export function createTimeout(ms, message = 'Operation timed out') {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
    });
}
// ============================================================================
// Event Testing Utilities
// ============================================================================
/**
 * Collect events from an EventEmitter for testing
 */
export class EventCollector {
    constructor(emitter, eventNames) {
        this.emitter = emitter;
        this.eventNames = eventNames;
        this.events = [];
        this.eventNames.forEach(eventName => {
            emitter.on(eventName, (...args) => {
                this.events.push({
                    event: eventName,
                    args,
                    timestamp: Date.now()
                });
            });
        });
    }
    getEvents() {
        return [...this.events];
    }
    getEventsByName(eventName) {
        return this.events.filter(e => e.event === eventName);
    }
    getEventCount(eventName) {
        if (eventName) {
            return this.events.filter(e => e.event === eventName).length;
        }
        return this.events.length;
    }
    waitForEvent(eventName, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for event: ${eventName}`));
            }, timeout);
            const handler = (...args) => {
                clearTimeout(timer);
                this.emitter.off(eventName, handler);
                resolve(args);
            };
            this.emitter.on(eventName, handler);
        });
    }
    waitForEvents(eventName, count, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const events = [];
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for ${count} ${eventName} events, got ${events.length}`));
            }, timeout);
            const handler = (...args) => {
                events.push(args);
                if (events.length >= count) {
                    clearTimeout(timer);
                    this.emitter.off(eventName, handler);
                    resolve(events);
                }
            };
            this.emitter.on(eventName, handler);
        });
    }
    clear() {
        this.events = [];
    }
}
// ============================================================================
// Performance Testing Utilities
// ============================================================================
/**
 * Measure execution time of an async function
 */
export async function measureTime(fn) {
    const startTime = Date.now();
    const result = await fn();
    const timeMs = Date.now() - startTime;
    return { result, timeMs };
}
/**
 * Measure memory usage of an async function
 */
export async function measureMemory(fn) {
    const initialMemory = process.memoryUsage().heapUsed;
    const result = await fn();
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryUsedMB = (finalMemory - initialMemory) / 1024 / 1024;
    return { result, memoryUsedMB };
}
/**
 * Create a performance benchmark for comparing functions
 */
export class PerformanceBenchmark {
    constructor() {
        this.results = [];
    }
    async run(name, fn, iterations = 1) {
        const times = [];
        let totalMemory = 0;
        for (let i = 0; i < iterations; i++) {
            const { result, timeMs } = await measureTime(async () => {
                return measureMemory(fn);
            });
            times.push(timeMs);
            totalMemory += result.memoryUsedMB;
        }
        const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
        const avgMemory = totalMemory / iterations;
        this.results.push({
            name,
            timeMs: avgTime,
            memoryMB: avgMemory,
            iterations
        });
    }
    getResults() {
        return [...this.results];
    }
    clear() {
        this.results = [];
    }
    printResults() {
        console.log('\nPerformance Benchmark Results:');
        console.log('='.repeat(80));
        this.results.forEach(result => {
            console.log(`${result.name}:`);
            console.log(`  Average Time: ${result.timeMs.toFixed(2)}ms`);
            console.log(`  Average Memory: ${result.memoryMB.toFixed(2)}MB`);
            console.log(`  Iterations: ${result.iterations}`);
            console.log('');
        });
    }
}
// ============================================================================
// Error Testing Utilities
// ============================================================================
/**
 * Create an error with specific properties for testing
 */
export function createTestError(message, options = {}) {
    const error = new Error(message);
    if (options.code) {
        error.code = options.code;
    }
    if (options.status) {
        error.status = options.status;
    }
    if (options.cause) {
        error.cause = options.cause;
    }
    if (options.stack) {
        error.stack = options.stack;
    }
    return error;
}
/**
 * Simulate network errors with different scenarios
 */
export function simulateNetworkError(scenario) {
    switch (scenario) {
        case 'timeout':
            const timeoutError = new Error('Request timeout');
            timeoutError.code = 'ETIMEDOUT';
            return timeoutError;
        case 'connection_refused':
            const connError = new Error('Connection refused');
            connError.code = 'ECONNREFUSED';
            return connError;
        case 'dns_error':
            const dnsError = new Error('DNS lookup failed');
            dnsError.code = 'ENOTFOUND';
            return dnsError;
        case 'ssl_error':
            const sslError = new Error('SSL certificate error');
            sslError.code = 'CERT_UNTRUSTED';
            return sslError;
        default:
            return new Error('Unknown network error');
    }
}
// ============================================================================
// Validation Utilities
// ============================================================================
/**
 * Deep compare two objects for testing
 */
export function deepEqual(obj1, obj2) {
    if (obj1 === obj2) {
        return true;
    }
    if (obj1 == null || obj2 == null) {
        return false;
    }
    if (typeof obj1 !== typeof obj2) {
        return false;
    }
    if (typeof obj1 !== 'object') {
        return obj1 === obj2;
    }
    if (Array.isArray(obj1) !== Array.isArray(obj2)) {
        return false;
    }
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length) {
        return false;
    }
    for (const key of keys1) {
        if (!keys2.includes(key)) {
            return false;
        }
        if (!deepEqual(obj1[key], obj2[key])) {
            return false;
        }
    }
    return true;
}
/**
 * Validate that an object matches a schema
 */
export function validateSchema(obj, schema) {
    const errors = [];
    function validateProperty(value, schemaProperty, path) {
        if (schemaProperty.required && (value === undefined || value === null)) {
            errors.push(`${path}: required property is missing`);
            return;
        }
        if (value !== undefined && schemaProperty.type) {
            const actualType = Array.isArray(value) ? 'array' : typeof value;
            if (actualType !== schemaProperty.type) {
                errors.push(`${path}: expected ${schemaProperty.type}, got ${actualType}`);
            }
        }
        if (schemaProperty.properties && typeof value === 'object' && !Array.isArray(value)) {
            for (const [key, subSchema] of Object.entries(schemaProperty.properties)) {
                validateProperty(value[key], subSchema, `${path}.${key}`);
            }
        }
        if (schemaProperty.items && Array.isArray(value)) {
            value.forEach((item, index) => {
                validateProperty(item, schemaProperty.items, `${path}[${index}]`);
            });
        }
    }
    validateProperty(obj, schema, 'root');
    return {
        valid: errors.length === 0,
        errors
    };
}
// ============================================================================
// Mock Logger
// ============================================================================
export function createMockLogger() {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        log: vi.fn()
    };
}
// ============================================================================
// Cleanup Utilities
// ============================================================================
/**
 * Cleanup helper for tests
 */
export class TestCleanup {
    constructor() {
        this.cleanupFns = [];
    }
    add(cleanupFn) {
        this.cleanupFns.push(cleanupFn);
    }
    async cleanup() {
        const results = await Promise.allSettled(this.cleanupFns.map(fn => Promise.resolve(fn())));
        const errors = results
            .filter((result) => result.status === 'rejected')
            .map(result => result.reason);
        if (errors.length > 0) {
            console.warn('Cleanup errors:', errors);
        }
        this.cleanupFns = [];
    }
}
