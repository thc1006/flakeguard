/**
 * Test Setup Configuration
 * 
 * Global test setup for Vitest including:
 * - Environment variable setup
 * - Console mocking
 * - Global test utilities
 * - Database test container setup
 * - Mock configurations
 */

import { vi, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';

import { mockEnvironmentVariables, setupTestEnvironment } from './mocks.js';

// =============================================================================
// ENVIRONMENT SETUP
// =============================================================================

// Mock environment variables for testing
mockEnvironmentVariables({
  NODE_ENV: 'test',
  LOG_LEVEL: 'error', // Reduce log noise in tests
  GITHUB_APP_ID: '12345',
  GITHUB_PRIVATE_KEY: 'FAKE_PRIVATE_KEY_FOR_TESTS',
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
});

// Set up test environment utilities
setupTestEnvironment();

// =============================================================================
// GLOBAL MOCKS
// =============================================================================

// Mock fetch for HTTP requests
global.fetch = vi.fn();

// Mock WebSocket for real-time features
const WebSocketMock = vi.fn().mockImplementation(() => ({
  close: vi.fn(),
  send: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: 1,
}));

// Add static constants required by WebSocket interface
WebSocketMock.CONNECTING = 0;
WebSocketMock.OPEN = 1;
WebSocketMock.CLOSING = 2;
WebSocketMock.CLOSED = 3;

global.WebSocket = WebSocketMock as any;

// Mock crypto for Node.js compatibility
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => '00000000-0000-0000-0000-000000000000',
    getRandomValues: (arr: any) => arr.fill(0),
    subtle: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    },
  },
});

// =============================================================================
// TEST DATABASE SETUP
// =============================================================================

let testDatabaseContainer: any;

beforeAll(async () => {
  // Start test database container if needed
  if (process.env.USE_TEST_CONTAINER === 'true') {
    try {
      const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
      
      testDatabaseContainer = await new PostgreSqlContainer()
        .withDatabase('flakeguard_test')
        .withUsername('test')
        .withPassword('test')
        .withExposedPorts(5432)
        .start();
      
      // Update database URL for tests
      process.env.DATABASE_URL = testDatabaseContainer.getConnectionUri();
      
      console.log('Test database container started:', testDatabaseContainer.getConnectionUri());
    } catch (error) {
      console.warn('Could not start test database container, using mock database:', error);
    }
  }
}, 60000); // 60 second timeout for container startup

afterAll(async () => {
  // Clean up test database container
  if (testDatabaseContainer) {
    try {
      await testDatabaseContainer.stop();
      console.log('Test database container stopped');
    } catch (error) {
      console.warn('Error stopping test database container:', error);
    }
  }
}, 30000);

// =============================================================================
// TEST ISOLATION
// =============================================================================

beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
  
  // Reset console mocks
  vi.restoreAllMocks();
  
  // Clear any cached modules
  vi.resetModules();
  
  // Reset environment variables to test defaults
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
});

afterEach(() => {
  // Clean up after each test
  vi.clearAllMocks();
  vi.resetAllMocks();
  
  // Clear any timers
  vi.clearAllTimers();
  vi.useRealTimers();
});

// =============================================================================
// GLOBAL TEST UTILITIES
// =============================================================================

// Extend global expect with custom matchers
expect.extend({
  toBeValidDate(received: any) {
    const pass = received instanceof Date && !isNaN(received.getTime());
    return {
      message: () => 
        pass
          ? `Expected ${received} not to be a valid date`
          : `Expected ${received} to be a valid date`,
      pass,
    };
  },
  
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    return {
      message: () =>
        pass
          ? `Expected ${received} not to be within range ${floor} - ${ceiling}`
          : `Expected ${received} to be within range ${floor} - ${ceiling}`,
      pass,
    };
  },
  
  toHaveBeenCalledWithObjectContaining(received: any, expected: object) {
    const pass = received.mock.calls.some((call: any[]) =>
      call.some(arg => 
        typeof arg === 'object' && 
        Object.keys(expected).every(key => 
          arg?.[key] !== undefined && 
          JSON.stringify(arg[key]) === JSON.stringify((expected as any)[key])
        )
      )
    );
    
    return {
      message: () =>
        pass
          ? `Expected mock not to have been called with object containing ${JSON.stringify(expected)}`
          : `Expected mock to have been called with object containing ${JSON.stringify(expected)}`,
      pass,
    };
  },
});

// =============================================================================
// TEST PERFORMANCE MONITORING
// =============================================================================

// Track slow tests
const slowTestThreshold = 5000; // 5 seconds
const originalIt = global.it;

global.it = function(name: string, fn?: any, timeout?: number) {
  if (!fn) return originalIt(name);
  
  return originalIt(name, async () => {
    const start = Date.now();
    try {
      await fn();
    } finally {
      const duration = Date.now() - start;
      if (duration > slowTestThreshold) {
        console.warn(`🐌 Slow test detected: "${name}" took ${duration}ms`);
      }
    }
  }, timeout);
};

// =============================================================================
// ERROR HANDLING
// =============================================================================

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions in tests
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// =============================================================================
// TEST DEBUGGING UTILITIES
// =============================================================================

// Debug helper for inspecting objects
(global as any).debug = (obj: any, label = 'Debug') => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(obj, null, 2));
  console.log(`=== End ${label} ===\n`);
};

// Mock inspection helper
(global as any).inspectMock = (mock: any, label = 'Mock') => {
  console.log(`\n=== ${label} Calls ===`);
  console.log('Call count:', mock.mock?.calls?.length || 0);
  console.log('Calls:', mock.mock?.calls || []);
  console.log('Results:', mock.mock?.results || []);
  console.log(`=== End ${label} ===\n`);
};

// =============================================================================
// TYPE AUGMENTATION
// =============================================================================

declare global {
  namespace Vi {
    interface JestAssertion<T = any> {
      toBeValidDate(): T;
      toBeWithinRange(floor: number, ceiling: number): T;
      toHaveBeenCalledWithObjectContaining(expected: object): T;
    }
  }
  
  function debug(obj: any, label?: string): void;
  function inspectMock(mock: any, label?: string): void;
}

console.log('🧪 Test setup complete');