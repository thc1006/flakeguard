/**
 * Vitest Unit Test Configuration for FlakeGuard API
 * 
 * Fast, isolated unit tests without external dependencies
 */

import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',
    globals: true,
    
    // Load test environment variables
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/flakeguard_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-jwt-secret-32-chars-minimum-length-for-security',
      API_KEY: 'FAKE_API_KEY_FOR_TESTS_ONLY_123',
      GITHUB_APP_ID: '12345',
      GITHUB_PRIVATE_KEY: '-----BEGIN FAKE PRIVATE KEY FOR TESTS ONLY-----\nTHIS_IS_A_FAKE_KEY_FOR_TESTING_PURPOSES_ONLY\nDO_NOT_USE_IN_PRODUCTION_ENVIRONMENTS\n-----END FAKE PRIVATE KEY FOR TESTS ONLY-----',
      GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
      GITHUB_CLIENT_ID: 'test-github-client-id',
      GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      SLACK_BOT_TOKEN: 'xoxb-test-token',
      SLACK_SIGNING_SECRET: 'test-signing-secret',
      ENABLE_SLACK_APP: 'false',
      LOG_LEVEL: 'error',
      FLAKE_WARN_THRESHOLD: '0.3',
      FLAKE_QUARANTINE_THRESHOLD: '0.6',
    },
    
    // File patterns - only unit tests
    include: [
      'src/**/*.unit.test.{js,mjs,cjs,ts,mts,cts}',
      'src/**/__tests__/**/*.test.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      'src/**/*.integration.test.{js,mjs,cjs,ts,mts,cts}',
      'src/**/*.e2e.test.{js,mjs,cjs,ts,mts,cts}',
      'src/**/*.benchmark.test.{js,mjs,cjs,ts,mts,cts}',
    ],
    
    // Test execution - fast for unit tests
    testTimeout: 10000, // 10 seconds
    hookTimeout: 5000,
    teardownTimeout: 5000,
    
    // Reporters
    reporter: ['default', 'json', 'html'],
    outputFile: {
      json: './test-results/unit-results.json',
      html: './test-results/unit-results.html',
    },
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage/unit',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        'src/**/mocks.ts',
        'src/**/types.ts',
        'src/**/constants.ts',
        'src/server.ts',
      ],
      thresholds: {
        global: {
          branches: 85,
          functions: 90,
          lines: 90,
          statements: 90,
        },
      },
    },
    
    // Setup files
    setupFiles: ['./src/__tests__/setup/unit.setup.ts'],
    
    // Pool options - maximize parallelization for unit tests
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 8,
        minThreads: 2,
      },
    },
    
    // Mock configuration
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    
    // No external dependencies for unit tests
    isolate: true,
  },
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './src/__tests__'),
      '@fixtures': path.resolve(__dirname, './src/__tests__/fixtures'),
      '@mocks': path.resolve(__dirname, './src/__tests__/mocks'),
    },
  },
  
  // ESM support
  esbuild: {
    target: 'node18',
  },
});