/**
 * Test Fixture Data for JUnit XML Files and Test Results
 * 
 * Provides structured test data that corresponds to the XML fixtures
 * for use in tests that need to verify parsing results.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { TestSuite, TestSuites, TestCase } from '../../types.js';

// Get the directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesPath = join(__dirname, '..', 'fixtures');

// ============================================================================
// Fixture File Paths
// ============================================================================

export const FIXTURE_PATHS = {
  SUREFIRE_SUCCESS: join(fixturesPath, 'surefire-success.xml'),
  SUREFIRE_FAILURES: join(fixturesPath, 'surefire-failures.xml'),
  GRADLE_RESULTS: join(fixturesPath, 'gradle-results.xml'),
  JEST_RESULTS: join(fixturesPath, 'jest-results.xml'),
  PYTEST_RESULTS: join(fixturesPath, 'pytest-results.xml'),
  PHPUNIT_RESULTS: join(fixturesPath, 'phpunit-results.xml'),
  LARGE_RESULTS: join(fixturesPath, 'large-results.xml'),
  MALFORMED: join(fixturesPath, 'malformed.xml'),
  EMPTY: join(fixturesPath, 'empty.xml')
} as const;

// ============================================================================
// Fixture Content Loaders
// ============================================================================

export function loadFixture(fixtureName: keyof typeof FIXTURE_PATHS): string {
  try {
    return readFileSync(FIXTURE_PATHS[fixtureName], 'utf-8');
  } catch (error) {
    throw new Error(`Failed to load fixture ${fixtureName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadAllFixtures(): Record<keyof typeof FIXTURE_PATHS, string> {
  const fixtures = {} as Record<keyof typeof FIXTURE_PATHS, string>;
  
  for (const [key, path] of Object.entries(FIXTURE_PATHS)) {
    try {
      fixtures[key as keyof typeof FIXTURE_PATHS] = readFileSync(path, 'utf-8');
    } catch (error) {
      console.warn(`Warning: Could not load fixture ${key}:`, error);
      fixtures[key as keyof typeof FIXTURE_PATHS] = '';
    }
  }
  
  return fixtures;
}

// ============================================================================
// Expected Parsing Results
// ============================================================================

export const EXPECTED_SUREFIRE_SUCCESS: TestSuites = {
  name: 'com.example.service.UserServiceTest',
  tests: 5,
  failures: 0,
  errors: 0,
  skipped: 0,
  time: 2.543,
  timestamp: '2023-12-01T10:30:15',
  suites: [{
    name: 'com.example.service.UserServiceTest',
    id: '1',
    package: 'com.example.service',
    hostname: 'localhost',
    tests: 5,
    failures: 0,
    errors: 0,
    skipped: 0,
    time: 2.543,
    timestamp: '2023-12-01T10:30:15',
    properties: {
      'java.version': '17.0.5',
      'java.vendor': 'Eclipse Adoptium',
      'java.home': '/opt/java/openjdk',
      'os.name': 'Linux',
      'os.arch': 'amd64',
      'os.version': '5.15.0-89-generic',
      'user.timezone': 'UTC',
      'maven.version': '3.9.4',
      'surefire.version': '3.2.2'
    },
    testCases: [
      {
        name: 'testCreateUser',
        className: 'com.example.service.UserServiceTest',
        time: 0.521,
        status: 'passed'
      },
      {
        name: 'testFindUserById',
        className: 'com.example.service.UserServiceTest',
        time: 0.425,
        status: 'passed'
      },
      {
        name: 'testUpdateUser',
        className: 'com.example.service.UserServiceTest',
        time: 0.687,
        status: 'passed'
      },
      {
        name: 'testDeleteUser',
        className: 'com.example.service.UserServiceTest',
        time: 0.398,
        status: 'passed'
      },
      {
        name: 'testFindAllUsers',
        className: 'com.example.service.UserServiceTest',
        time: 0.512,
        status: 'passed'
      }
    ],
    systemOut: `INFO  [main] com.example.service.UserService - UserService initialized
INFO  [main] com.example.service.UserService - Creating user: John Doe
INFO  [main] com.example.service.UserService - User created with ID: 1
INFO  [main] com.example.service.UserService - Finding user with ID: 1
INFO  [main] com.example.service.UserService - User found: John Doe
INFO  [main] com.example.service.UserService - Updating user with ID: 1
INFO  [main] com.example.service.UserService - User updated successfully
INFO  [main] com.example.service.UserService - Deleting user with ID: 1
INFO  [main] com.example.service.UserService - User deleted successfully
INFO  [main] com.example.service.UserService - Finding all users
INFO  [main] com.example.service.UserService - Found 0 users`,
    systemErr: ''
  }]
};

export const EXPECTED_SUREFIRE_FAILURES: TestSuites = {
  name: undefined,
  tests: 8,
  failures: 2,
  errors: 1,
  skipped: 1,
  time: 15.832,
  timestamp: '2023-12-01T10:32:48',
  suites: [{
    name: 'com.example.integration.DatabaseIntegrationTest',
    id: '2',
    package: 'com.example.integration',
    hostname: 'ci-runner-01',
    tests: 8,
    failures: 2,
    errors: 1,
    skipped: 1,
    time: 15.832,
    timestamp: '2023-12-01T10:32:48',
    properties: {
      'java.version': '17.0.5',
      'java.vendor': 'Eclipse Adoptium',
      'spring.profiles.active': 'test',
      'database.url': 'jdbc:h2:mem:testdb',
      'test.execution.timeout': '30000'
    },
    testCases: [
      {
        name: 'testDatabaseConnection',
        className: 'com.example.integration.DatabaseIntegrationTest',
        time: 1.245,
        status: 'passed'
      },
      {
        name: 'testCreateTable',
        className: 'com.example.integration.DatabaseIntegrationTest',
        time: 0.876,
        status: 'passed'
      },
      {
        name: 'testInsertRecord',
        className: 'com.example.integration.DatabaseIntegrationTest',
        time: 2.134,
        status: 'failed',
        failure: {
          type: 'org.opentest4j.AssertionFailedError',
          message: 'Assertion failed: Expected 1 record, but found 0',
          stackTrace: expect.stringContaining('AssertionFailedError')
        },
        systemOut: expect.stringContaining('Starting testInsertRecord'),
        systemErr: expect.stringContaining('Failed to verify record insertion')
      },
      {
        name: 'testUpdateRecord',
        className: 'com.example.integration.DatabaseIntegrationTest',
        time: 1.987,
        status: 'failed',
        failure: {
          type: 'org.h2.jdbc.JdbcSQLIntegrityConstraintViolationException',
          message: 'SQL constraint violation: unique key violated',
          stackTrace: expect.stringContaining('JdbcSQLIntegrityConstraintViolationException')
        }
      },
      {
        name: 'testDeleteRecord',
        className: 'com.example.integration.DatabaseIntegrationTest',
        time: 0.654,
        status: 'passed'
      },
      {
        name: 'testTransactionRollback',
        className: 'com.example.integration.DatabaseIntegrationTest',
        time: 3.421,
        status: 'error',
        error: {
          type: 'java.sql.SQLTimeoutException',
          message: 'Connection timeout after 5000ms',
          stackTrace: expect.stringContaining('SQLTimeoutException')
        }
      },
      {
        name: 'testBulkInsert',
        className: 'com.example.integration.DatabaseIntegrationTest',
        time: 4.892,
        status: 'passed'
      },
      {
        name: 'testConnectionPooling',
        className: 'com.example.integration.DatabaseIntegrationTest',
        time: 0.623,
        status: 'skipped',
        skipped: {
          message: 'Database connection pooling test disabled in CI environment'
        }
      }
    ],
    systemOut: expect.stringContaining('Starting DatabaseIntegrationTest'),
    systemErr: expect.stringContaining('Database connection issues detected')
  }]
};

export const EXPECTED_GRADLE_RESULTS: TestSuites = {
  name: 'com.example.gradle.ApiControllerTest',
  tests: 6,
  failures: 1,
  errors: 0,
  skipped: 1,
  time: 8.246,
  timestamp: '2023-12-01T10:45:22',
  suites: [{
    name: 'com.example.gradle.ApiControllerTest',
    tests: 6,
    failures: 1,
    errors: 0,
    skipped: 1,
    time: 8.246,
    timestamp: '2023-12-01T10:45:22',
    hostname: 'gradle-worker-01',
    testCases: [
      {
        name: 'testGetUser',
        className: 'com.example.gradle.ApiControllerTest',
        time: 1.234,
        status: 'passed'
      },
      {
        name: 'testCreateUser',
        className: 'com.example.gradle.ApiControllerTest',
        time: 2.156,
        status: 'passed'
      },
      {
        name: 'testUpdateUser',
        className: 'com.example.gradle.ApiControllerTest',
        time: 1.876,
        status: 'passed'
      },
      {
        name: 'testDeleteUser',
        className: 'com.example.gradle.ApiControllerTest',
        time: 0.987,
        status: 'failed',
        failure: {
          type: 'AssertionError',
          message: 'Expected status 204 but was 500',
          stackTrace: expect.stringContaining('Expected status 204 but was 500')
        }
      },
      {
        name: 'testGetAllUsers',
        className: 'com.example.gradle.ApiControllerTest',
        time: 1.456,
        status: 'passed'
      },
      {
        name: 'testGetUserNotFound',
        className: 'com.example.gradle.ApiControllerTest',
        time: 0.537,
        status: 'skipped',
        skipped: {
          message: 'Test requires external service that is not available in CI'
        }
      }
    ],
    systemOut: expect.stringContaining('API Controller initialized'),
    systemErr: ''
  }]
};

export const EXPECTED_JEST_RESULTS: TestSuites = {
  name: 'jest tests',
  tests: 12,
  failures: 2,
  errors: 0,
  skipped: 0,
  time: 4.567,
  timestamp: '2023-12-01T10:50:15',
  suites: [
    {
      name: 'UserService',
      tests: 6,
      failures: 1,
      errors: 0,
      skipped: 0,
      time: 2.345,
      timestamp: '2023-12-01T10:50:15',
      testCases: [
        {
          name: 'should create a new user',
          className: 'UserService',
          time: 0.456,
          status: 'passed'
        },
        {
          name: 'should find user by id',
          className: 'UserService',
          time: 0.234,
          status: 'passed'
        },
        {
          name: 'should update user',
          className: 'UserService',
          time: 0.567,
          status: 'passed'
        },
        {
          name: 'should delete user',
          className: 'UserService',
          time: 0.123,
          status: 'passed'
        },
        {
          name: 'should throw error for invalid user id',
          className: 'UserService',
          time: 0.089,
          status: 'passed'
        },
        {
          name: 'should validate user email format',
          className: 'UserService',
          time: 0.876,
          status: 'failed',
          failure: {
            type: 'AssertionError',
            message: 'Expected validation to fail for invalid email',
            stackTrace: expect.stringContaining('Expected validation to fail')
          }
        }
      ]
    },
    {
      name: 'ApiController',
      tests: 6,
      failures: 1,
      errors: 0,
      skipped: 0,
      time: 2.222,
      timestamp: '2023-12-01T10:50:17',
      testCases: [
        {
          name: 'GET /api/users should return all users',
          className: 'ApiController',
          time: 0.345,
          status: 'passed'
        },
        {
          name: 'GET /api/users/:id should return user by id',
          className: 'ApiController',
          time: 0.287,
          status: 'passed'
        },
        {
          name: 'POST /api/users should create new user',
          className: 'ApiController',
          time: 0.567,
          status: 'passed'
        },
        {
          name: 'PUT /api/users/:id should update user',
          className: 'ApiController',
          time: 0.423,
          status: 'passed'
        },
        {
          name: 'DELETE /api/users/:id should delete user',
          className: 'ApiController',
          time: 0.189,
          status: 'passed'
        },
        {
          name: 'should handle authentication middleware',
          className: 'ApiController',
          time: 0.411,
          status: 'failed',
          failure: {
            type: 'AssertionError',
            message: 'Authentication middleware did not reject invalid token',
            stackTrace: expect.stringContaining('Authentication middleware')
          }
        }
      ]
    }
  ]
};

export const EXPECTED_PYTEST_RESULTS: TestSuites = {
  name: undefined,
  tests: 15,
  failures: 3,
  errors: 1,
  skipped: 2,
  time: 12.456,
  timestamp: '2023-12-01T10:55:30',
  suites: [{
    name: 'pytest',
    tests: 15,
    failures: 3,
    errors: 1,
    skipped: 2,
    time: 12.456,
    timestamp: '2023-12-01T10:55:30',
    hostname: 'python-test-runner',
    testCases: expect.arrayContaining([
      expect.objectContaining({
        name: 'test_user_creation',
        className: 'tests.test_user_model',
        status: 'passed',
        time: 0.123
      }),
      expect.objectContaining({
        name: 'test_user_email_uniqueness',
        className: 'tests.test_user_model',
        status: 'failed',
        failure: expect.objectContaining({
          message: 'AssertionError: User with duplicate email should not be created'
        })
      }),
      expect.objectContaining({
        name: 'test_transaction_rollback',
        className: 'tests.test_database',
        status: 'error',
        error: expect.objectContaining({
          message: 'ConnectionError: Database connection lost'
        })
      }),
      expect.objectContaining({
        name: 'test_external_service_integration',
        className: 'tests.test_external_api',
        status: 'skipped',
        skipped: expect.objectContaining({
          message: 'External API service is not available in test environment'
        })
      })
    ])
  }]
};

export const EXPECTED_PHPUNIT_RESULTS: TestSuites = {
  name: undefined,
  tests: 14,
  failures: 2,
  errors: 0,
  skipped: 1,
  time: 4.691356,
  suites: [
    {
      name: 'UserControllerTest',
      tests: 8,
      failures: 2,
      errors: 0,
      skipped: 1,
      time: 3.456789,
      timestamp: '2023-12-01T11:00:45+00:00',
      testCases: expect.arrayContaining([
        expect.objectContaining({
          name: 'testIndex',
          className: 'Tests\\Unit\\UserControllerTest',
          status: 'passed',
          time: 0.123456
        }),
        expect.objectContaining({
          name: 'testDestroy',
          className: 'Tests\\Unit\\UserControllerTest',
          status: 'failed',
          failure: expect.objectContaining({
            type: 'PHPUnit\\Framework\\ExpectationFailedException',
            message: 'Failed asserting that 500 matches expected 204.'
          })
        }),
        expect.objectContaining({
          name: 'testDatabaseConnectionFailure',
          className: 'Tests\\Unit\\UserControllerTest',
          status: 'skipped',
          skipped: expect.objectContaining({
            message: 'Database connection test skipped in CI environment'
          })
        })
      ])
    },
    {
      name: 'UserModelTest',
      tests: 6,
      failures: 0,
      errors: 0,
      skipped: 0,
      time: 1.234567,
      timestamp: '2023-12-01T11:00:48+00:00',
      testCases: expect.arrayContaining([
        expect.objectContaining({
          name: 'testUserCreation',
          className: 'Tests\\Unit\\UserModelTest',
          status: 'passed',
          time: 0.156789
        })
      ])
    }
  ]
};

export const EXPECTED_LARGE_RESULTS: TestSuites = {
  name: 'Large Test Suite',
  tests: 500,
  failures: 25,
  errors: 5,
  skipped: 15,
  time: 245.678,
  timestamp: '2023-12-01T11:15:00',
  suites: expect.arrayContaining([
    expect.objectContaining({
      name: 'com.example.performance.LoadTest',
      tests: 100,
      failures: 5,
      errors: 1,
      skipped: 2,
      time: 45.234,
      testCases: expect.arrayContaining([
        expect.objectContaining({
          name: 'testHighLoadStability',
          status: 'failed',
          failure: expect.objectContaining({
            message: 'Performance threshold exceeded: 5678ms > 5000ms'
          })
        }),
        expect.objectContaining({
          name: 'testSystemCrash',
          status: 'error',
          error: expect.objectContaining({
            type: 'java.lang.OutOfMemoryError',
            message: 'JVM crashed during test execution'
          })
        })
      ])
    })
  ])
};

// ============================================================================
// Test Data Builders
// ============================================================================

export interface TestFixtureOptions {
  format?: 'surefire' | 'gradle' | 'jest' | 'pytest' | 'phpunit';
  testCount?: number;
  failureCount?: number;
  errorCount?: number;
  skippedCount?: number;
  withSystemOutput?: boolean;
  withProperties?: boolean;
}

export function createTestSuite(options: TestFixtureOptions = {}): TestSuite {
  const {
    testCount = 5,
    failureCount = 1,
    errorCount = 0,
    skippedCount = 1,
    withSystemOutput = false,
    withProperties = false
  } = options;

  const testCases: TestCase[] = [];
  
  // Create passed tests
  const passedCount = testCount - failureCount - errorCount - skippedCount;
  for (let i = 0; i < passedCount; i++) {
    testCases.push({
      name: `testPassed${i + 1}`,
      className: 'TestClass',
      time: Math.random() * 2,
      status: 'passed'
    });
  }
  
  // Create failed tests
  for (let i = 0; i < failureCount; i++) {
    testCases.push({
      name: `testFailed${i + 1}`,
      className: 'TestClass',
      time: Math.random() * 2,
      status: 'failed',
      failure: {
        type: 'AssertionError',
        message: `Test failed: assertion ${i + 1}`,
        stackTrace: `Stack trace for failure ${i + 1}`
      }
    });
  }
  
  // Create error tests
  for (let i = 0; i < errorCount; i++) {
    testCases.push({
      name: `testError${i + 1}`,
      className: 'TestClass',
      time: Math.random() * 2,
      status: 'error',
      error: {
        type: 'RuntimeException',
        message: `Runtime error ${i + 1}`,
        stackTrace: `Stack trace for error ${i + 1}`
      }
    });
  }
  
  // Create skipped tests
  for (let i = 0; i < skippedCount; i++) {
    testCases.push({
      name: `testSkipped${i + 1}`,
      className: 'TestClass',
      time: 0,
      status: 'skipped',
      skipped: {
        message: `Test skipped: reason ${i + 1}`
      }
    });
  }

  const suite: TestSuite = {
    name: 'TestSuite',
    tests: testCount,
    failures: failureCount,
    errors: errorCount,
    skipped: skippedCount,
    time: testCases.reduce((sum, test) => sum + (test.time || 0), 0),
    testCases
  };

  if (withSystemOutput) {
    suite.systemOut = 'System output content';
    suite.systemErr = 'System error content';
  }

  if (withProperties) {
    suite.properties = {
      'test.property': 'test.value',
      'environment': 'test'
    };
  }

  return suite;
}

export function createTestSuites(suiteCount: number, options: TestFixtureOptions = {}): TestSuites {
  const suites: TestSuite[] = [];
  let totalTests = 0;
  let totalFailures = 0;
  let totalErrors = 0;
  let totalSkipped = 0;
  let totalTime = 0;

  for (let i = 0; i < suiteCount; i++) {
    const suite = createTestSuite({
      ...options,
      testCount: options.testCount || 5 + i
    });
    suite.name = `TestSuite${i + 1}`;
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
// Fixture Validation Utilities
// ============================================================================

export function validateTestSuites(testSuites: TestSuites): string[] {
  const errors: string[] = [];

  if (testSuites.tests < 0) {
    errors.push('Total tests count cannot be negative');
  }

  if (testSuites.failures < 0) {
    errors.push('Total failures count cannot be negative');
  }

  if (testSuites.errors < 0) {
    errors.push('Total errors count cannot be negative');
  }

  if (testSuites.skipped < 0) {
    errors.push('Total skipped count cannot be negative');
  }

  const calculatedTests = testSuites.suites.reduce((sum, suite) => sum + suite.tests, 0);
  if (calculatedTests !== testSuites.tests) {
    errors.push(`Test count mismatch: expected ${testSuites.tests}, calculated ${calculatedTests}`);
  }

  const calculatedFailures = testSuites.suites.reduce((sum, suite) => sum + suite.failures, 0);
  if (calculatedFailures !== testSuites.failures) {
    errors.push(`Failure count mismatch: expected ${testSuites.failures}, calculated ${calculatedFailures}`);
  }

  for (const suite of testSuites.suites) {
    const suiteErrors = validateTestSuite(suite);
    errors.push(...suiteErrors.map(err => `Suite '${suite.name}': ${err}`));
  }

  return errors;
}

export function validateTestSuite(suite: TestSuite): string[] {
  const errors: string[] = [];

  if (!suite.name) {
    errors.push('Suite name is required');
  }

  if (suite.tests < 0) {
    errors.push('Test count cannot be negative');
  }

  if (suite.testCases.length !== suite.tests) {
    errors.push(`Test case count mismatch: expected ${suite.tests}, found ${suite.testCases.length}`);
  }

  const statusCounts = suite.testCases.reduce(
    (counts, testCase) => {
      counts[testCase.status]++;
      return counts;
    },
    { passed: 0, failed: 0, error: 0, skipped: 0, flaky: 0 }
  );

  if (statusCounts.failed !== suite.failures) {
    errors.push(`Failed test count mismatch: expected ${suite.failures}, found ${statusCounts.failed}`);
  }

  if (statusCounts.error !== suite.errors) {
    errors.push(`Error test count mismatch: expected ${suite.errors}, found ${statusCounts.error}`);
  }

  if (statusCounts.skipped !== suite.skipped) {
    errors.push(`Skipped test count mismatch: expected ${suite.skipped}, found ${statusCounts.skipped}`);
  }

  return errors;
}

// Export for Jest matchers
export const expect = {
  stringContaining: (str: string) => str,
  arrayContaining: (arr: any[]) => arr,
  objectContaining: (obj: any) => obj
};