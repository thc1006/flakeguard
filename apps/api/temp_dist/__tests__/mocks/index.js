/**
 * Centralized Mock Exports for JUnit Ingestion Tests
 *
 * This file provides a single entry point for all mock data and utilities
 * used throughout the test suite, including GitHub API responses, test fixtures,
 * and database mocks.
 */
// GitHub API Mocks
export { MOCK_ARTIFACTS, MOCK_WORKFLOW_RUN, MOCK_NOT_FOUND_ERROR, MOCK_UNAUTHORIZED_ERROR, MOCK_FORBIDDEN_ERROR, MOCK_RATE_LIMIT_ERROR, MOCK_SERVER_ERROR, MockGitHubApiClient, createMockGitHubApiClient, createMockArtifact, createMockWorkflowRun, setupGitHubApiMocks, simulateNetworkError as githubSimulateNetworkError, simulateTimeout } from './github-api.js';
// Test Fixtures (use fixture prefix to avoid conflicts)
export { FIXTURE_PATHS, loadFixture, loadAllFixtures, EXPECTED_SUREFIRE_SUCCESS, EXPECTED_SUREFIRE_FAILURES, EXPECTED_GRADLE_RESULTS, EXPECTED_JEST_RESULTS, EXPECTED_PYTEST_RESULTS, EXPECTED_PHPUNIT_RESULTS, EXPECTED_LARGE_RESULTS, createTestSuite as createTestFixture, createTestSuites as createTestFixtures, validateTestSuites, validateTestSuite } from './test-fixtures.js';
// Database Mocks  
export * from './database-mocks.js';
// Job Queue Mocks
export * from './queue-mocks.js';
// Test utilities (use util prefix to avoid conflicts)
export { createStreamFromString, createSlowStream, createFailingStream, createSizeLimitTransform, createTimeoutTransform, createTestCase, createTestSuite as createUtilTestSuite, createTestSuites as createUtilTestSuites, createISODate, createJUnitTimestamp, wait, createTimeout, EventCollector, measureTime, measureMemory, PerformanceBenchmark, createTestError, simulateNetworkError as utilSimulateNetworkError, deepEqual, validateSchema, createMockLogger, TestCleanup } from './test-utils.js';
