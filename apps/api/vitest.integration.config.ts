/**
 * Vitest Integration Test Configuration for FlakeGuard API
 * 
 * Integration tests with external dependencies (databases, APIs, etc.)
 */

import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',
    globals: true,
    
    // File patterns - only integration tests
    include: [
      'src/**/*.integration.test.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      'src/**/*.unit.test.{js,mjs,cjs,ts,mts,cts}',
      'src/**/*.e2e.test.{js,mjs,cjs,ts,mts,cts}',
      'src/**/*.benchmark.test.{js,mjs,cjs,ts,mts,cts}',
    ],
    
    // Test execution - longer timeouts for external dependencies
    testTimeout: 60000, // 60 seconds for Docker containers
    hookTimeout: 30000,
    teardownTimeout: 15000,
    
    // Reporters
    reporter: ['default', 'json', 'html'],
    outputFile: {
      json: './test-results/integration-results.json',
      html: './test-results/integration-results.html',
    },
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage/integration',
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
          branches: 75,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    
    // Setup files
    setupFiles: ['./src/__tests__/setup/integration.setup.ts'],
    
    // Pool options - less parallelization due to shared resources
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 2, // Limited to avoid resource conflicts
        minThreads: 1,
      },
    },
    
    // Retry configuration for external dependencies
    retry: 3,
    
    // Mock configuration
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: false, // Keep env vars for integration tests
    unstubGlobals: false,
    
    // Sequential execution for integration tests to avoid conflicts
    sequence: {
      concurrent: false,
    },
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