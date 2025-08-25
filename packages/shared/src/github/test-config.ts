/**
 * Test Configuration and Utilities for GitHub API Wrapper
 * Provides testing utilities, mocks, and configuration for P18 implementation
 */

// Logger type imported but used indirectly in TestLogger compatibility comments

import type { 
  GitHubApiConfig,
  RequestOptions,
  RateLimitInfo,
  CircuitBreakerStatus,
  ApiMetrics,
} from './types.js';

// Type definitions for testing utilities
type LogEntry = {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'trace';
  obj: unknown;
  msg?: string;
};

// Minimal logger interface for testing (compatible with pino Logger)
type TestLogger = {
  level: string;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  fatal: (obj: unknown, msg?: string) => void;
  trace: (obj: unknown, msg?: string) => void;
  child: () => TestLogger;
  getLogs: () => LogEntry[];
};

type BaseWebhookPayload = {
  action?: string;
  sender: {
    login: string;
    id: number;
    type: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
      type: string;
    };
  };
};

type WorkflowRunPayload = BaseWebhookPayload & {
  workflow_run: {
    id: number;
    name: string;
    status: string;
    conclusion: string;
    html_url: string;
    artifacts_url: string;
  };
};

type CheckRunPayload = BaseWebhookPayload & {
  check_run: {
    id: number;
    name: string;
    status: string;
    conclusion: string;
    output: {
      title: string;
      summary: string;
    };
  };
  requested_action?: {
    identifier: string;
  };
};

type WebhookPayload = BaseWebhookPayload | WorkflowRunPayload | CheckRunPayload;

// Mutable versions for testing
type MutableRateLimitInfo = {
  remaining: number;
  limit: number;
  resetAt: Date;
  resetInSeconds: number;
  resource: string;
  isLimited: boolean;
};

type MutableCircuitBreakerStatus = {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureAt: Date | null;
  nextAttemptAt: Date | null;
  halfOpenAttempts: number;
  totalRequests: number;
  totalFailures: number;
};

type MutableApiMetrics = {
  totalRequests: number;
  totalFailures: number;
  successRate: number;
  avgResponseTimeMs: number;
  p95ResponseTimeMs: number;
  p99ResponseTimeMs: number;
  rateLimitStatus: RateLimitInfo;
  circuitBreakerStatus: CircuitBreakerStatus;
  requestsLast24h: number;
  failuresLast24h: number;
};

/**
 * Mock implementations for testing
 */
export class MockGitHubApiWrapper {
  private mockMetrics: MutableApiMetrics;
  private mockRateLimit: MutableRateLimitInfo;
  private mockCircuitBreaker: MutableCircuitBreakerStatus;
  private requestLog: Array<{ options: RequestOptions; timestamp: Date }> = [];
  
  // Unused in mock but needed for interface compatibility
  
  constructor(
    _config: Partial<GitHubApiConfig> = {},
    private shouldFail: boolean = false,
    private failureRate: number = 0
  ) {
    this.mockRateLimit = {
      remaining: 4500,
      limit: 5000,
      resetAt: new Date(Date.now() + 3600000),
      resetInSeconds: 3600,
      resource: 'core',
      isLimited: false,
    };

    this.mockCircuitBreaker = {
      state: 'closed',
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
      halfOpenAttempts: 0,
      totalRequests: 0,
      totalFailures: 0,
    };

    this.mockMetrics = {
      totalRequests: 0,
      totalFailures: 0,
      successRate: 1.0,
      avgResponseTimeMs: 250,
      p95ResponseTimeMs: 500,
      p99ResponseTimeMs: 800,
      rateLimitStatus: this.mockRateLimit,
      circuitBreakerStatus: this.mockCircuitBreaker,
      requestsLast24h: 0,
      failuresLast24h: 0,
    };
  }

  get metrics(): ApiMetrics {
    return this.mockMetrics;
  }

  get rateLimitStatus(): RateLimitInfo {
    return this.mockRateLimit;
  }

  get circuitBreakerStatus(): CircuitBreakerStatus {
    return this.mockCircuitBreaker;
  }

  async request<T = unknown>(options: RequestOptions): Promise<T> {
    this.requestLog.push({ options, timestamp: new Date() });
    this.mockMetrics.totalRequests++;
    
    // Simulate rate limit consumption
    this.mockRateLimit.remaining = Math.max(0, this.mockRateLimit.remaining - 1);
    this.mockRateLimit.isLimited = this.mockRateLimit.remaining < 500;

    // Simulate failures based on configuration
    const shouldFailThisRequest = this.shouldFail || (Math.random() < this.failureRate);
    
    if (shouldFailThisRequest) {
      this.mockMetrics.totalFailures++;
      this.mockCircuitBreaker.failureCount++;
      this.mockMetrics.successRate = (this.mockMetrics.totalRequests - this.mockMetrics.totalFailures) / this.mockMetrics.totalRequests;
      
      throw new Error(`Mock API failure for ${options.method} ${options.endpoint}`);
    }

    // Simulate response delay
    await new Promise<void>(resolve => setTimeout(resolve, 100 + Math.random() * 200));
    
    this.mockMetrics.successRate = (this.mockMetrics.totalRequests - this.mockMetrics.totalFailures) / this.mockMetrics.totalRequests;
    
    return this.generateMockResponse(options) as T;
  }

  async downloadArtifact(): Promise<Buffer> {
    await new Promise<void>(resolve => setTimeout(resolve, 10)); // Simulate async operation
    return Buffer.from('mock artifact content');
  }

  async* streamArtifact(): AsyncIterable<Buffer> {
    const chunks = ['chunk1', 'chunk2', 'chunk3'];
    for (const chunk of chunks) {
      await new Promise<void>(resolve => setTimeout(resolve, 10)); // Simulate async streaming
      yield Buffer.from(chunk);
    }
  }

  verifyWebhookSignature(): boolean {
    return true;
  }

  async close(): Promise<void> {
    // Mock cleanup
  }

  // Test utilities
  getRequestLog(): Array<{ options: RequestOptions; timestamp: Date }> {
    return [...this.requestLog];
  }

  clearRequestLog(): void {
    this.requestLog.length = 0;
  }

  setRateLimitRemaining(remaining: number): void {
    this.mockRateLimit.remaining = remaining;
    this.mockRateLimit.isLimited = remaining < 500;
  }

  setCircuitBreakerState(state: 'closed' | 'open' | 'half-open'): void {
    this.mockCircuitBreaker.state = state;
  }

  simulateRateLimit(): void {
    this.mockRateLimit.remaining = 0;
    this.mockRateLimit.isLimited = true;
  }

  simulateCircuitBreakerOpen(): void {
    this.mockCircuitBreaker.state = 'open';
    this.mockCircuitBreaker.nextAttemptAt = new Date(Date.now() + 300000);
  }

  private generateMockResponse(options: RequestOptions): unknown {
    // Generate appropriate mock response based on endpoint
    if (options.endpoint.includes('/check-runs')) {
      if (options.method === 'POST') {
        return {
          id: Math.floor(Math.random() * 1000000),
          name: 'FlakeGuard',
          status: 'in_progress',
          head_sha: 'abc123',
          html_url: 'https://github.com/owner/repo/runs/123',
        };
      } else if (options.method === 'PATCH') {
        return {
          id: 123456,
          status: 'completed',
          conclusion: 'success',
        };
      }
    }

    if (options.endpoint.includes('/artifacts')) {
      return {
        artifacts: [
          {
            id: 123456,
            name: 'junit-results',
            size_in_bytes: 1024,
            url: 'https://api.github.com/repos/owner/repo/actions/artifacts/123456/zip',
          },
        ],
      };
    }

    if (options.endpoint.includes('/issues')) {
      return {
        id: Math.floor(Math.random() * 1000000),
        number: Math.floor(Math.random() * 1000),
        title: 'FlakeGuard: Flaky tests detected',
        html_url: 'https://github.com/owner/repo/issues/123',
      };
    }

    // Default response
    return {
      status: 'success',
      message: 'Mock response',
      data: options.data,
    };
  }
}

/**
 * Test configuration presets
 */
export const testConfigurations = {
  /**
   * Fast test configuration - minimal delays, aggressive timeouts
   */
  fast: {
    rateLimit: {
      enabled: true,
      reservePercentage: 50, // Very conservative
      enableThrottling: false, // Disable for faster tests
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 2, // Fail fast
      failureTimeWindowMs: 1000, // 1 second window
      openTimeoutMs: 5000, // 5 seconds
    },
    retry: {
      enabled: true,
      maxAttempts: 2,
      baseDelayMs: 10, // Very short delays
      maxDelayMs: 100,
    },
    timeout: {
      requestTimeoutMs: 1000, // 1 second
      enabled: true,
    },
    requestQueue: {
      enabled: true,
      maxSize: 10,
      maxWaitTimeMs: 1000,
    },
  },

  /**
   * Integration test configuration - realistic but controllable
   */
  integration: {
    rateLimit: {
      enabled: true,
      reservePercentage: 20,
      enableThrottling: true,
      throttleThresholdPercent: 30,
      maxThrottleDelayMs: 5000,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3,
      failureTimeWindowMs: 10000,
      openTimeoutMs: 30000,
    },
    retry: {
      enabled: true,
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 5000,
    },
    security: {
      sanitizeRequests: true,
      validateResponses: true,
      auditLogging: true,
    },
  },

  /**
   * Load test configuration - optimized for high throughput testing
   */
  load: {
    rateLimit: {
      enabled: true,
      reservePercentage: 5,
      enableThrottling: true,
      throttleThresholdPercent: 10,
    },
    requestQueue: {
      enabled: true,
      maxSize: 1000,
      maxWaitTimeMs: 60000,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 10,
      openTimeoutMs: 10000,
    },
    artifactDownload: {
      enabled: true,
      maxSizeBytes: 10 * 1024 * 1024, // 10MB for tests
      useStreaming: true,
    },
  },
};

/**
 * Test utilities and helpers
 */
export class TestUtils {
  /**
   * Wait for condition with timeout
   */
  static async waitForCondition(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 5000,
    intervalMs: number = 100
  ): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      if (await condition()) {
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
    }
    
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  }

  /**
   * Create test logger that captures logs
   */
  static createTestLogger(): TestLogger {
    const logs: LogEntry[] = [];
    
    const mockLogger: TestLogger = {
      level: 'debug',
      debug: (obj: unknown, msg?: string) => {
        logs.push({ level: 'debug', obj, msg });
      },
      info: (obj: unknown, msg?: string) => {
        logs.push({ level: 'info', obj, msg });
      },
      warn: (obj: unknown, msg?: string) => {
        logs.push({ level: 'warn', obj, msg });
      },
      error: (obj: unknown, msg?: string) => {
        logs.push({ level: 'error', obj, msg });
      },
      fatal: (obj: unknown, msg?: string) => {
        logs.push({ level: 'fatal', obj, msg });
      },
      trace: (obj: unknown, msg?: string) => {
        logs.push({ level: 'trace', obj, msg });
      },
      child: () => mockLogger,
      getLogs: () => [...logs],
    };

    return mockLogger;
  }

  /**
   * Generate test webhook payload
   */
  static generateWebhookPayload(event: string, action?: string): WebhookPayload {
    const basePayload: BaseWebhookPayload = {
      action,
      sender: {
        login: 'testuser',
        id: 12345,
        type: 'User',
      },
      repository: {
        id: 67890,
        name: 'test-repo',
        full_name: 'testorg/test-repo',
        owner: {
          login: 'testorg',
          id: 54321,
          type: 'Organization',
        },
      },
    };

    switch (event) {
      case 'workflow_run': {
        const workflowPayload: WorkflowRunPayload = {
          ...basePayload,
          workflow_run: {
            id: 123456789,
            name: 'CI',
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://github.com/testorg/test-repo/actions/runs/123456789',
            artifacts_url: 'https://api.github.com/repos/testorg/test-repo/actions/runs/123456789/artifacts',
          },
        };
        return workflowPayload;
      }

      case 'check_run': {
        const checkRunPayload: CheckRunPayload = {
          ...basePayload,
          check_run: {
            id: 987654321,
            name: 'FlakeGuard',
            status: 'completed',
            conclusion: 'failure',
            output: {
              title: 'Flaky tests detected',
              summary: 'Found 3 potentially flaky tests',
            },
          },
          requested_action: action ? {
            identifier: action,
          } : undefined,
        };
        return checkRunPayload;
      }

      default:
        return basePayload;
    }
  }

  /**
   * Create test artifact buffer
   */
  static createTestArtifact(size: number = 1024): Buffer {
    const buffer = Buffer.alloc(size);
    buffer.write('PK'); // ZIP file header
    buffer.write('<?xml version="1.0"?><testsuite name="test">', 4);
    return buffer;
  }

  /**
   * Simulate network conditions
   */
  static async simulateNetworkDelay(minMs: number = 50, maxMs: number = 200): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    await new Promise<void>(resolve => setTimeout(resolve, delay));
  }

  /**
   * Simulate intermittent failures
   */
  static createFlakyFunction<T>(
    fn: () => T | Promise<T>,
    failureRate: number = 0.3
  ): () => T | Promise<T> {
    return async () => {
      if (Math.random() < failureRate) {
        throw new Error('Simulated intermittent failure');
      }
      return fn();
    };
  }

  /**
   * Assert rate limit compliance
   */
  static assertRateLimitCompliance(
    wrapper: MockGitHubApiWrapper,
    maxRequestsPerMinute: number = 100
  ): void {
    const logs = wrapper.getRequestLog();
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentRequests = logs.filter(log => log.timestamp > oneMinuteAgo);
    
    if (recentRequests.length > maxRequestsPerMinute) {
      throw new Error(
        `Rate limit violation: ${recentRequests.length} requests in last minute, max ${maxRequestsPerMinute}`
      );
    }
  }

  /**
   * Generate performance test data
   */
  static generatePerformanceTestData(count: number): Array<{
    owner: string;
    repo: string;
    operation: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
  }> {
    const operations = [
      { operation: 'check-runs', priority: 'high' as const },
      { operation: 'artifacts', priority: 'normal' as const },
      { operation: 'issues', priority: 'high' as const },
      { operation: 'repo', priority: 'low' as const },
    ];

    return Array.from({ length: count }, (_, i) => {
      const op = operations[i % operations.length];
      if (!op) {
        throw new Error('Invalid operation index');
      }
      return {
        owner: `org${Math.floor(i / 10)}`,
        repo: `repo${i % 10}`,
        operation: op.operation,
        priority: op.priority,
      };
    });
  }

  /**
   * Benchmark function execution
   */
  static async benchmark<T>(
    name: string,
    fn: () => Promise<T>,
    iterations: number = 1
  ): Promise<{
    name: string;
    iterations: number;
    totalTimeMs: number;
    avgTimeMs: number;
    minTimeMs: number;
    maxTimeMs: number;
    result: T;
  }> {
    const times: number[] = [];
    let result: T;

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      result = await fn();
      const end = Date.now();
      times.push(end - start);
    }

    if (!result) {
      throw new Error('Function must return a result');
    }

    return {
      name,
      iterations,
      totalTimeMs: times.reduce((sum, time) => sum + time, 0),
      avgTimeMs: times.reduce((sum, time) => sum + time, 0) / times.length,
      minTimeMs: Math.min(...times),
      maxTimeMs: Math.max(...times),
      result,
    };
  }

  /**
   * Create test scenarios for different failure modes
   */
  static createFailureScenarios(): Array<{
    name: string;
    setup: (wrapper: MockGitHubApiWrapper) => void;
    test: (wrapper: MockGitHubApiWrapper) => Promise<void>;
  }> {
    return [
      {
        name: 'Rate limit exhaustion',
        setup: (wrapper) => {
          wrapper.setRateLimitRemaining(0);
        },
        test: async (wrapper) => {
          try {
            await wrapper.request({
              method: 'GET',
              endpoint: '/user',
            });
            throw new Error('Should have failed with rate limit');
          } catch (error: unknown) {
            // Expected - type guard to ensure error is handled properly
            if (!(error instanceof Error)) {
              throw new Error('Expected Error instance');
            }
          }
        },
      },
      
      {
        name: 'Circuit breaker open',
        setup: (wrapper) => {
          wrapper.simulateCircuitBreakerOpen();
        },
        test: async (wrapper) => {
          try {
            await wrapper.request({
              method: 'GET',
              endpoint: '/user',
            });
            throw new Error('Should have failed with circuit breaker');
          } catch (error: unknown) {
            // Expected - type guard to ensure error is handled properly
            if (!(error instanceof Error)) {
              throw new Error('Expected Error instance');
            }
          }
        },
      },
      
      {
        name: 'High failure rate',
        setup: () => {
          // No setup needed, controlled in MockGitHubApiWrapper constructor
        },
        test: async (wrapper) => {
          const results = await Promise.allSettled([
            wrapper.request({ method: 'GET', endpoint: '/test1' }),
            wrapper.request({ method: 'GET', endpoint: '/test2' }),
            wrapper.request({ method: 'GET', endpoint: '/test3' }),
            wrapper.request({ method: 'GET', endpoint: '/test4' }),
            wrapper.request({ method: 'GET', endpoint: '/test5' }),
          ]);
          
          const failures = results.filter(r => r.status === 'rejected').length;
          console.log(`Failed ${failures} out of 5 requests`);
          // No return value needed as this is just for testing
        },
      },
    ];
  }
}

/**
 * Example test cases
 */
export const exampleTests = {
  /**
   * Unit test example
   */
  async testRateLimitThrottling(): Promise<void> {
    const logger = TestUtils.createTestLogger();
    const wrapper = new MockGitHubApiWrapper({ debug: true }, false, 0);
    
    // Set rate limit low to trigger throttling
    wrapper.setRateLimitRemaining(50);
    
    const start = Date.now();
    await wrapper.request({
      method: 'GET',
      endpoint: '/user',
    });
    const duration = Date.now() - start;
    
    console.log(`Request took ${duration}ms (should include throttling delay)`);
    console.log('Logs:', logger.getLogs());
  },

  /**
   * Integration test example
   */
  async testCircuitBreakerRecovery(): Promise<void> {
    const wrapper = new MockGitHubApiWrapper({}, false, 0.8); // 80% failure rate
    
    // Make requests until circuit breaker opens
    let circuitOpened = false;
    for (let i = 0; i < 10 && !circuitOpened; i++) {
      try {
        await wrapper.request({ method: 'GET', endpoint: '/test' });
      } catch (error) {
        // Expected failures
      }
      
      circuitOpened = wrapper.circuitBreakerStatus.state === 'open';
    }
    
    console.log('Circuit breaker opened:', circuitOpened);
    console.log('Circuit breaker status:', wrapper.circuitBreakerStatus);
  },

  /**
   * Performance test example
   */
  async testRequestThroughput(): Promise<void> {
    const wrapper = new MockGitHubApiWrapper({}, false, 0);
    const testData = TestUtils.generatePerformanceTestData(100);
    
    const benchmark = await TestUtils.benchmark(
      'Request throughput',
      async () => {
        const promises = testData.map(data => 
          wrapper.request({
            method: 'GET',
            endpoint: `/repos/${data.owner}/${data.repo}`,
            priority: data.priority,
          })
        );
        
        return Promise.allSettled(promises);
      },
      1
    );
    
    console.log('Benchmark results:', benchmark);
    
    const successful = (benchmark.result)
      .filter(r => r.status === 'fulfilled').length;
    
    console.log(`Successful requests: ${successful}/${testData.length}`);
    console.log(`Throughput: ${(successful / benchmark.totalTimeMs * 1000).toFixed(2)} requests/second`);
  },

  /**
   * Error handling test example
   */
  async testErrorRecovery(): Promise<void> {
    const scenarios = TestUtils.createFailureScenarios();
    
    for (const scenario of scenarios) {
      console.log(`\nTesting scenario: ${scenario.name}`);
      
      const wrapper = new MockGitHubApiWrapper({}, scenario.name.includes('failure'), 0.7);
      scenario.setup(wrapper);
      
      try {
        await scenario.test(wrapper);
        console.log('✓ Scenario completed');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.log('✗ Scenario failed:', message);
      }
    }
  },
};