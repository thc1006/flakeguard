/**
 * Benchmark Test Setup for FlakeGuard API
 * 
 * Configures environment for performance testing and benchmarks
 */

import { beforeAll, afterAll, beforeEach } from 'vitest';

// Performance monitoring utilities
let performanceMarks: Map<string, number> = new Map();

beforeAll(() => {
  // Set up performance monitoring
  global.performance = global.performance || require('perf_hooks').performance;
  
  // Disable console output for cleaner benchmark results
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  
  // Set NODE_ENV to production for realistic performance
  process.env.NODE_ENV = 'production';
  
  console.info('Benchmark environment initialized');
});

beforeEach(() => {
  // Clear performance marks
  performanceMarks.clear();
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
});

afterAll(() => {
  // Restore console methods
  delete console.log;
  delete console.warn;
  delete console.error;
});

// Benchmark utilities
declare global {
  var benchmarkUtils: {
    startTimer: (name: string) => void;
    endTimer: (name: string) => number;
    measureMemory: () => NodeJS.MemoryUsage;
    createLargeDataset: (size: number) => any[];
    measureAsyncOperation: <T>(fn: () => Promise<T>) => Promise<{ result: T; duration: number; memory: NodeJS.MemoryUsage }>;
    runBenchmark: (name: string, fn: () => void | Promise<void>, iterations?: number) => Promise<BenchmarkResult>;
  };
}

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  memoryUsage: NodeJS.MemoryUsage;
  operationsPerSecond: number;
}

global.benchmarkUtils = {
  startTimer: (name: string) => {
    performanceMarks.set(name, performance.now());
  },

  endTimer: (name: string) => {
    const start = performanceMarks.get(name);
    if (!start) {
      throw new Error(`Timer '${name}' was not started`);
    }
    const duration = performance.now() - start;
    performanceMarks.delete(name);
    return duration;
  },

  measureMemory: () => {
    return process.memoryUsage();
  },

  createLargeDataset: (size: number) => {
    return Array.from({ length: size }, (_, i) => ({
      id: `test-${i}`,
      name: `Test Case ${i}`,
      status: i % 3 === 0 ? 'failed' : 'passed',
      duration: Math.random() * 5000,
      className: `TestClass${Math.floor(i / 10)}`,
      fileName: `test-${Math.floor(i / 100)}.spec.ts`,
      createdAt: new Date(Date.now() - i * 1000),
    }));
  },

  measureAsyncOperation: async <T>(fn: () => Promise<T>) => {
    const startMemory = process.memoryUsage();
    const start = performance.now();
    
    const result = await fn();
    
    const end = performance.now();
    const endMemory = process.memoryUsage();
    
    return {
      result,
      duration: end - start,
      memory: {
        rss: endMemory.rss - startMemory.rss,
        heapTotal: endMemory.heapTotal - startMemory.heapTotal,
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        external: endMemory.external - startMemory.external,
        arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers,
      },
    };
  },

  runBenchmark: async (name: string, fn: () => void | Promise<void>, iterations = 1000): Promise<BenchmarkResult> => {
    const times: number[] = [];
    const startMemory = process.memoryUsage();
    
    // Warmup
    for (let i = 0; i < Math.min(10, iterations); i++) {
      await fn();
    }
    
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }
    
    // Actual benchmark
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }
    
    const endMemory = process.memoryUsage();
    const totalTime = times.reduce((sum, time) => sum + time, 0);
    const averageTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const operationsPerSecond = 1000 / averageTime;
    
    return {
      name,
      iterations,
      totalTime,
      averageTime,
      minTime,
      maxTime,
      memoryUsage: {
        rss: endMemory.rss - startMemory.rss,
        heapTotal: endMemory.heapTotal - startMemory.heapTotal,
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        external: endMemory.external - startMemory.external,
        arrayBuffers: endMemory.arrayBuffers - startMemory.arrayBuffers,
      },
      operationsPerSecond,
    };
  },
};