/**
 * Job Queue Mock Data and Utilities for Testing
 * 
 * Provides realistic mock queue responses for testing job processing
 * without requiring an actual Redis instance or queue system.
 */

import { vi } from 'vitest';
import type { Job, Queue, Worker, JobsOptions } from 'bullmq';

// ============================================================================
// Mock Job Data
// ============================================================================

export interface MockJob {
  id: string;
  name: string;
  data: any;
  opts: JobsOptions;
  progress: any;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  returnvalue?: any;
  attemptsMade: number;
  timestamp: number;
}

export const MOCK_JOBS: MockJob[] = [
  {
    id: 'job-completed-123',
    name: 'process-junit-artifacts',
    data: {
      workflowRunId: 987654321,
      repository: { owner: 'test-org', repo: 'test-repo' },
      installationId: 12345678,
      correlationId: 'correlation-123'
    },
    opts: {
      priority: 0,
      delay: 0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    },
    progress: { processed: 2, total: 2 },
    processedOn: Date.now() - 15000,
    finishedOn: Date.now() - 1000,
    returnvalue: {
      success: true,
      results: [
        {
          fileName: 'TEST-UserServiceTest.xml',
          format: 'surefire',
          testSuites: {
            name: 'com.example.service.UserServiceTest',
            tests: 5,
            failures: 0,
            errors: 0,
            skipped: 0,
            suites: []
          }
        }
      ],
      stats: {
        totalFiles: 2,
        processedFiles: 2,
        totalTests: 13,
        totalFailures: 2,
        totalErrors: 1,
        totalSkipped: 1,
        processingTimeMs: 12000,
        downloadTimeMs: 3000
      }
    },
    attemptsMade: 1,
    timestamp: Date.now() - 20000
  },
  {
    id: 'job-failed-456',
    name: 'process-junit-artifacts',
    data: {
      workflowRunId: 987654322,
      repository: { owner: 'test-org', repo: 'test-repo' },
      installationId: 12345678,
      correlationId: 'correlation-456'
    },
    opts: {
      priority: 0,
      delay: 0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    },
    progress: { processed: 0, total: 1 },
    processedOn: Date.now() - 10000,
    finishedOn: Date.now() - 2000,
    failedReason: 'Network timeout during artifact download',
    attemptsMade: 3,
    timestamp: Date.now() - 15000
  },
  {
    id: 'job-active-789',
    name: 'process-junit-artifacts',
    data: {
      workflowRunId: 987654323,
      repository: { owner: 'test-org', repo: 'test-repo' },
      installationId: 12345678,
      correlationId: 'correlation-789'
    },
    opts: {
      priority: 10, // High priority
      delay: 0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    },
    progress: { processed: 1, total: 3, currentTask: 'parsing XML files' },
    processedOn: Date.now() - 5000,
    attemptsMade: 1,
    timestamp: Date.now() - 8000
  },
  {
    id: 'job-queued-012',
    name: 'process-junit-artifacts',
    data: {
      workflowRunId: 987654324,
      repository: { owner: 'test-org', repo: 'test-repo' },
      installationId: 12345678,
      correlationId: 'correlation-012'
    },
    opts: {
      priority: 0,
      delay: 1000, // Delayed job
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    },
    progress: {},
    attemptsMade: 0,
    timestamp: Date.now() - 1000
  },
  {
    id: 'job-retry-345',
    name: 'process-junit-artifacts',
    data: {
      workflowRunId: 987654325,
      repository: { owner: 'test-org', repo: 'test-repo' },
      installationId: 12345678,
      correlationId: 'correlation-345'
    },
    opts: {
      priority: 0,
      delay: 0,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    },
    progress: { processed: 0, total: 2, error: 'Temporary network issue' },
    processedOn: Date.now() - 30000,
    attemptsMade: 2,
    timestamp: Date.now() - 35000
  }
];

// ============================================================================
// Mock Queue Implementation
// ============================================================================

export class MockQueue {
  private jobs: Map<string, MockJob> = new Map();
  private jobCounter = 1000;
  
  constructor(name: string, opts?: any) {
    // Initialize with sample jobs
    MOCK_JOBS.forEach(job => {
      this.jobs.set(job.id, { ...job });
    });
  }

  async add(
    name: string,
    data: any,
    opts: JobsOptions = {}
  ): Promise<MockJob> {
    const jobId = `job-${this.jobCounter++}`;
    const job: MockJob = {
      id: jobId,
      name,
      data,
      opts,
      progress: {},
      attemptsMade: 0,
      timestamp: Date.now()
    };
    
    this.jobs.set(jobId, job);
    return job;
  }

  async getJob(jobId: string): Promise<MockJob | null> {
    return this.jobs.get(jobId) || null;
  }

  async getJobs(
    types: string[] = ['completed', 'failed', 'active', 'waiting'],
    start = 0,
    end = -1
  ): Promise<MockJob[]> {
    const allJobs = Array.from(this.jobs.values());
    
    // Filter by job status
    const filteredJobs = allJobs.filter(job => {
      const status = this.getJobStatus(job);
      return types.includes(status);
    });
    
    // Apply pagination
    const endIndex = end === -1 ? filteredJobs.length : end + 1;
    return filteredJobs.slice(start, endIndex);
  }

  async getJobCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const allJobs = Array.from(this.jobs.values());
    
    return {
      waiting: allJobs.filter(job => this.getJobStatus(job) === 'waiting').length,
      active: allJobs.filter(job => this.getJobStatus(job) === 'active').length,
      completed: allJobs.filter(job => this.getJobStatus(job) === 'completed').length,
      failed: allJobs.filter(job => this.getJobStatus(job) === 'failed').length,
      delayed: allJobs.filter(job => this.getJobStatus(job) === 'delayed').length
    };
  }

  async clean(grace: number, limit?: number, type?: string): Promise<string[]> {
    const cleanedJobs: string[] = [];
    const cutoff = Date.now() - grace;
    
    for (const [jobId, job] of this.jobs.entries()) {
      const shouldClean = 
        (type === 'completed' && job.finishedOn && job.finishedOn < cutoff) ||
        (type === 'failed' && job.failedReason && (job.finishedOn || job.timestamp) < cutoff) ||
        (!type && (job.finishedOn || job.timestamp) < cutoff);
        
      if (shouldClean) {
        this.jobs.delete(jobId);
        cleanedJobs.push(jobId);
        
        if (limit && cleanedJobs.length >= limit) {
          break;
        }
      }
    }
    
    return cleanedJobs;
  }

  async close(): Promise<void> {
    this.jobs.clear();
  }

  // Utility methods for testing

  updateJobProgress(jobId: string, progress: any): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = { ...job.progress, ...progress };
    }
  }

  completeJob(jobId: string, result: any): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.finishedOn = Date.now();
      job.returnvalue = result;
    }
  }

  failJob(jobId: string, reason: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.finishedOn = Date.now();
      job.failedReason = reason;
      job.attemptsMade = job.opts.attempts || 3;
    }
  }

  private getJobStatus(job: MockJob): string {
    if (job.finishedOn && job.returnvalue) return 'completed';
    if (job.finishedOn && job.failedReason) return 'failed';
    if (job.processedOn && !job.finishedOn) return 'active';
    if (job.opts.delay && job.opts.delay > 0) return 'delayed';
    return 'waiting';
  }
}

// ============================================================================
// Mock Worker Implementation  
// ============================================================================

export class MockWorker {
  private eventHandlers: Map<string, Function[]> = new Map();
  private isRunning = false;
  
  constructor(
    queueName: string,
    processor: Function,
    opts?: any
  ) {
    this.isRunning = true;
  }

  on(event: string, handler: Function): this {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
    return this;
  }

  off(event: string, handler: Function): this {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
    return this;
  }

  emit(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  async close(): Promise<void> {
    this.isRunning = false;
    this.eventHandlers.clear();
  }

  // Test utilities
  simulateJobCompletion(job: MockJob, result: any): void {
    this.emit('completed', job, result);
  }

  simulateJobFailure(job: MockJob, error: Error): void {
    this.emit('failed', job, error);
  }

  simulateJobProgress(job: MockJob, progress: any): void {
    this.emit('progress', job, progress);
  }
}

// ============================================================================
// Mock Setup Functions
// ============================================================================

export function createMockQueue(name = 'test-queue'): MockQueue {
  return new MockQueue(name);
}

export function createMockWorker(
  queueName = 'test-queue',
  processor?: Function
): MockWorker {
  const defaultProcessor = async (job: any) => {
    // Default processor that simulates successful job processing
    return { success: true, processedAt: Date.now() };
  };
  
  return new MockWorker(queueName, processor || defaultProcessor);
}

export function setupQueueMocks() {
  const mockQueue = createMockQueue();
  const mockWorker = createMockWorker();
  
  return {
    queue: mockQueue,
    worker: mockWorker,
    mocks: {
      add: vi.fn().mockImplementation(mockQueue.add.bind(mockQueue)),
      getJob: vi.fn().mockImplementation(mockQueue.getJob.bind(mockQueue)),
      getJobs: vi.fn().mockImplementation(mockQueue.getJobs.bind(mockQueue)),
      getJobCounts: vi.fn().mockImplementation(mockQueue.getJobCounts.bind(mockQueue)),
      clean: vi.fn().mockImplementation(mockQueue.clean.bind(mockQueue)),
      close: vi.fn().mockImplementation(mockQueue.close.bind(mockQueue)),
      on: vi.fn().mockImplementation(mockWorker.on.bind(mockWorker)),
      off: vi.fn().mockImplementation(mockWorker.off.bind(mockWorker)),
      emit: vi.fn().mockImplementation(mockWorker.emit.bind(mockWorker))
    }
  };
}

// ============================================================================
// Job Processing Scenarios
// ============================================================================

export const JOB_SCENARIOS = {
  SUCCESSFUL_PROCESSING: {
    job: MOCK_JOBS[0],
    expectedResult: MOCK_JOBS[0].returnvalue,
    expectedDuration: 15000
  },
  
  NETWORK_FAILURE: {
    job: MOCK_JOBS[1],
    expectedError: 'Network timeout during artifact download',
    expectedAttempts: 3
  },
  
  IN_PROGRESS: {
    job: MOCK_JOBS[2],
    expectedProgress: { processed: 1, total: 3 },
    expectedStatus: 'active'
  },
  
  QUEUED_WITH_DELAY: {
    job: MOCK_JOBS[3],
    expectedDelay: 1000,
    expectedStatus: 'waiting'
  },
  
  RETRY_SCENARIO: {
    job: MOCK_JOBS[4],
    expectedAttempts: 2,
    expectedMaxAttempts: 3
  }
} as const;

// ============================================================================
// Performance Testing Utilities
// ============================================================================

export function createLargeJobSet(count: number): MockJob[] {
  const jobs: MockJob[] = [];
  
  for (let i = 0; i < count; i++) {
    jobs.push({
      id: `bulk-job-${i}`,
      name: 'process-junit-artifacts',
      data: {
        workflowRunId: 1000000 + i,
        repository: { owner: 'perf-org', repo: `repo-${i}` },
        installationId: 12345678,
        correlationId: `bulk-correlation-${i}`
      },
      opts: {
        priority: Math.floor(Math.random() * 10),
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      },
      progress: i % 3 === 0 ? { processed: 1, total: 2 } : {},
      processedOn: i % 4 === 0 ? Date.now() - Math.random() * 60000 : undefined,
      finishedOn: i % 5 === 0 ? Date.now() - Math.random() * 30000 : undefined,
      returnvalue: i % 5 === 0 ? { success: true, tests: Math.floor(Math.random() * 100) } : undefined,
      failedReason: i % 10 === 0 ? 'Random failure for testing' : undefined,
      attemptsMade: Math.floor(Math.random() * 3) + 1,
      timestamp: Date.now() - Math.random() * 120000
    });
  }
  
  return jobs;
}

export function simulateQueueLoad(queue: MockQueue, jobsPerSecond: number, duration: number): Promise<string[]> {
  return new Promise((resolve) => {
    const jobIds: string[] = [];
    const interval = 1000 / jobsPerSecond;
    let elapsed = 0;
    
    const timer = setInterval(async () => {
      const job = await queue.add('load-test-job', {
        timestamp: Date.now(),
        index: jobIds.length
      });
      jobIds.push(job.id);
      
      elapsed += interval;
      if (elapsed >= duration) {
        clearInterval(timer);
        resolve(jobIds);
      }
    }, interval);
  });
}

// ============================================================================
// Error Simulation Utilities
// ============================================================================

export function simulateQueueErrors(queue: MockQueue) {
  const originalAdd = queue.add.bind(queue);
  let errorCount = 0;
  
  queue.add = async (name: string, data: any, opts?: JobsOptions) => {
    errorCount++;
    
    // Simulate various queue errors
    if (errorCount % 10 === 0) {
      throw new Error('Queue is full');
    }
    
    if (errorCount % 7 === 0) {
      throw new Error('Redis connection lost');
    }
    
    if (errorCount % 15 === 0) {
      throw new Error('Job serialization failed');
    }
    
    return originalAdd(name, data, opts);
  };
  
  return () => {
    queue.add = originalAdd;
    errorCount = 0;
  };
}

export function simulateWorkerErrors(worker: MockWorker) {
  setTimeout(() => {
    worker.emit('error', new Error('Worker process crashed'));
  }, Math.random() * 5000);
  
  setTimeout(() => {
    worker.emit('stalled', { id: 'stalled-job-123' });
  }, Math.random() * 10000);
}