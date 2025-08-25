/**
 * Vitest Benchmark Test Configuration for FlakeGuard API
 * 
 * Performance benchmarks and load testing
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',
    globals: true,
    
    // File patterns - only benchmark tests
    include: [
      'src/**/*.benchmark.test.{js,mjs,cjs,ts,mts,cts}',
      'src/**/__benchmarks__/**/*.{js,mjs,cjs,ts,mts,cts}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      'src/**/*.unit.test.{js,mjs,cjs,ts,mts,cts}',
      'src/**/*.integration.test.{js,mjs,cjs,ts,mts,cts}',
      'src/**/*.e2e.test.{js,mjs,cjs,ts,mts,cts}',
    ],
    
    // Test execution - very long timeouts for benchmarks
    testTimeout: 300000, // 5 minutes
    hookTimeout: 60000,
    teardownTimeout: 30000,
    
    // Reporters
    reporter: ['default', 'json'],
    outputFile: {
      json: './test-results/benchmark-results.json',
    },
    
    // Setup files
    setupFiles: ['./src/__tests__/setup/benchmark.setup.ts'],
    
    // Pool options - single threaded for consistent benchmarks
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
        minThreads: 1,
      },
    },
    
    // No retries for benchmarks
    retry: 0,
    
    // Mock configuration
    clearMocks: true,
    restoreMocks: true,
    
    // Sequential execution for consistent results
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