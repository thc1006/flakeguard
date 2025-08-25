/**
 * Request Queue implementation for GitHub API
 * Manages request prioritization and queueing during high load
 */

import type { Logger } from 'pino';

import { GitHubApiError } from './types.js';
import type {
  RequestQueueConfig,
  RequestOptions,
} from './types.js';

interface QueuedRequest {
  readonly id: string;
  readonly priority: 'low' | 'normal' | 'high' | 'critical';
  readonly options: RequestOptions;
  readonly timestamp: Date;
  readonly timeoutMs: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly operation: () => Promise<unknown>;
}

interface QueuedRequestWithTimeout extends QueuedRequest {
  timeoutId?: NodeJS.Timeout;
}

/**
 * Priority-based request queue for GitHub API calls
 */
export class RequestQueue {
  private readonly queues = new Map<string, QueuedRequest[]>();
  private readonly processing = new Set<string>();
  private readonly metrics = {
    totalEnqueued: 0,
    totalProcessed: 0,
    totalFailed: 0,
    totalTimeout: 0,
    currentSize: 0,
    avgWaitTime: 0,
  };
  
  private requestIdCounter = 0;
  private readonly waitTimes: number[] = [];
  private isShuttingDown = false;

  constructor(
    private readonly config: RequestQueueConfig,
    private readonly logger: Logger
  ) {
    // Initialize priority queues
    for (const priority of this.config.priorities) {
      this.queues.set(priority, []);
    }
  }

  /**
   * Enqueue a request with priority handling
   */
  async enqueue<T>(
    operation: () => Promise<T>,
    options: RequestOptions
  ): Promise<T> {
    if (!this.config.enabled) {
      return operation();
    }

    if (this.isShuttingDown) {
      throw new GitHubApiError(
        'SERVICE_UNAVAILABLE',
        'Request queue is shutting down',
        { retryable: false }
      );
    }

    const priority = options.priority || 'normal';
    const requestId = this.generateRequestId();
    
    // Check queue size limits
    if (this.getTotalQueueSize() >= this.config.maxSize) {
      this.logger.warn(
        { 
          requestId,
          priority,
          endpoint: options.endpoint,
          currentSize: this.getTotalQueueSize(),
          maxSize: this.config.maxSize,
        },
        'Request queue is full, rejecting request'
      );
      
      throw new GitHubApiError(
        'QUEUE_FULL',
        'Request queue is at capacity',
        {
          retryable: true,
          context: {
            queueSize: this.getTotalQueueSize(),
            maxSize: this.config.maxSize,
          },
        }
      );
    }

    return new Promise<T>((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        id: requestId,
        priority,
        options,
        timestamp: new Date(),
        timeoutMs: options.timeout || this.config.maxWaitTimeMs,
        resolve: resolve as (value: unknown) => void,
        reject: reject as (error: unknown) => void,
        operation,
      };

      // Set timeout for queued request
      const timeoutId = setTimeout(() => {
        this.handleRequestTimeout(queuedRequest);
      }, queuedRequest.timeoutMs);

      // Store timeout ID for cleanup
      (queuedRequest as QueuedRequestWithTimeout).timeoutId = timeoutId;

      // Add to appropriate priority queue
      const queue = this.queues.get(priority);
      if (!queue) {
        reject(new GitHubApiError(
          'CONFIGURATION_INVALID',
          `Invalid priority: ${priority}`,
          { retryable: false }
        ));
        return;
      }

      queue.push(queuedRequest);
      this.metrics.totalEnqueued++;
      this.metrics.currentSize++;

      this.logger.debug(
        {
          requestId,
          priority,
          endpoint: options.endpoint,
          queueSize: queue.length,
          totalSize: this.getTotalQueueSize(),
        },
        'Request enqueued'
      );

      // Start processing if not already running for this priority
      if (!this.processing.has(priority)) {
        void this.processQueue(priority).catch((error) => {
          this.logger.error(
            { error, priority, requestId },
            'Queue processing failed'
          );
        });
      }
    });
  }

  /**
   * Get queue status and metrics
   */
  getStatus(): {
    totalSize: number;
    priorityQueues: Record<string, number>;
    processing: string[];
    metrics: {
      totalEnqueued: number;
      totalProcessed: number;
      totalFailed: number;
      totalTimeout: number;
      currentSize: number;
      avgWaitTime: number;
    };
  } {
    const priorityQueues: Record<string, number> = {};
    
    for (const [priority, queue] of Array.from(this.queues.entries())) {
      priorityQueues[priority] = queue.length;
    }

    return {
      totalSize: this.getTotalQueueSize(),
      priorityQueues,
      processing: Array.from(this.processing),
      metrics: { ...this.metrics },
    };
  }

  /**
   * Gracefully shutdown the queue
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Starting request queue shutdown');

    // Reject all pending requests
    for (const [, queue] of Array.from(this.queues.entries())) {
      while (queue.length > 0) {
        const request = queue.shift();
        if (request) {
          this.clearRequestTimeout(request);
          request.reject(new GitHubApiError(
            'SERVICE_UNAVAILABLE',
            'Request queue shutting down',
            { retryable: true }
          ));
        }
      }
    }

    // Wait for active processing to complete
    const shutdownPromise = this.waitForProcessingComplete();
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs);
    });

    try {
      await Promise.race([shutdownPromise, timeoutPromise]);
      this.logger.info('Request queue shutdown completed');
    } catch (error) {
      this.logger.error({ error }, 'Request queue shutdown timed out');
      throw error;
    }
  }

  /**
   * Process requests from priority queue
   */
  private async processQueue(priority: string): Promise<void> {
    if (this.processing.has(priority)) {
      return; // Already processing this priority
    }

    this.processing.add(priority);
    const queue = this.queues.get(priority);

    if (!queue) {
      this.processing.delete(priority);
      return;
    }

    this.logger.debug(
      { priority, queueSize: queue.length },
      'Starting queue processing'
    );

    while (queue.length > 0 && !this.isShuttingDown) {
      const request = queue.shift();
      
      if (!request) {
        continue;
      }

      await this.processRequest(request);
    }

    this.processing.delete(priority);
    
    this.logger.debug(
      { priority },
      'Queue processing completed'
    );
  }

  /**
   * Process individual request
   */
  private async processRequest(request: QueuedRequest): Promise<void> {
    const startTime = Date.now();
    this.clearRequestTimeout(request);

    try {
      this.logger.debug(
        {
          requestId: request.id,
          priority: request.priority,
          endpoint: request.options.endpoint,
          waitTime: startTime - request.timestamp.getTime(),
        },
        'Processing queued request'
      );

      const result = await request.operation();
      
      const waitTime = startTime - request.timestamp.getTime();
      this.recordWaitTime(waitTime);
      
      this.metrics.totalProcessed++;
      this.metrics.currentSize--;
      
      request.resolve(result);

      this.logger.debug(
        {
          requestId: request.id,
          priority: request.priority,
          endpoint: request.options.endpoint,
          duration: Date.now() - startTime,
          waitTime,
        },
        'Request processed successfully'
      );
    } catch (error) {
      this.metrics.totalFailed++;
      this.metrics.currentSize--;
      
      this.logger.error(
        {
          requestId: request.id,
          priority: request.priority,
          endpoint: request.options.endpoint,
          error: error instanceof Error ? error.message : String(error),
          waitTime: startTime - request.timestamp.getTime(),
        },
        'Request processing failed'
      );

      request.reject(error);
    }
  }

  /**
   * Handle request timeout
   */
  private handleRequestTimeout(request: QueuedRequest): void {
    // Remove from queue if still there
    const queue = this.queues.get(request.priority);
    if (queue) {
      const index = queue.findIndex(r => r.id === request.id);
      if (index !== -1) {
        queue.splice(index, 1);
        this.metrics.currentSize--;
      }
    }

    this.metrics.totalTimeout++;

    this.logger.warn(
      {
        requestId: request.id,
        priority: request.priority,
        endpoint: request.options.endpoint,
        timeout: request.timeoutMs,
      },
      'Request timed out in queue'
    );

    request.reject(new GitHubApiError(
      'REQUEST_TIMEOUT',
      `Request timed out after ${request.timeoutMs}ms in queue`,
      {
        retryable: true,
        context: {
          queueTimeout: true,
          timeoutMs: request.timeoutMs,
        },
      }
    ));
  }

  /**
   * Clear request timeout
   */
  private clearRequestTimeout(request: QueuedRequest): void {
    const timeoutId = (request as QueuedRequestWithTimeout).timeoutId;
    if (timeoutId) {
      clearTimeout(timeoutId);
      delete (request as QueuedRequestWithTimeout).timeoutId;
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestIdCounter}`;
  }

  /**
   * Get total queue size across all priorities
   */
  private getTotalQueueSize(): number {
    let total = 0;
    for (const queue of Array.from(this.queues.values())) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Record wait time for metrics
   */
  private recordWaitTime(waitTime: number): void {
    this.waitTimes.push(waitTime);
    
    // Keep only last 1000 wait times
    if (this.waitTimes.length > 1000) {
      this.waitTimes.shift();
    }
    
    // Update average wait time
    this.metrics.avgWaitTime = this.waitTimes.reduce((sum, time) => sum + time, 0) / this.waitTimes.length;
  }

  /**
   * Wait for all processing to complete
   */
  private async waitForProcessingComplete(): Promise<void> {
    while (this.processing.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

/**
 * Request prioritization utility
 */
export class RequestPrioritizer {
  private static readonly ENDPOINT_PRIORITIES: Record<string, string> = {
    // Critical endpoints
    '/app/installations/{installation_id}/access_tokens': 'critical',
    '/repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip': 'critical',
    
    // High priority endpoints
    '/repos/{owner}/{repo}/check-runs': 'high',
    '/repos/{owner}/{repo}/check-runs/{check_run_id}': 'high',
    '/repos/{owner}/{repo}/actions/runs/{run_id}/rerun': 'high',
    '/repos/{owner}/{repo}/issues': 'high',
    
    // Normal priority endpoints
    '/repos/{owner}/{repo}/actions/runs': 'normal',
    '/repos/{owner}/{repo}/actions/runs/{run_id}': 'normal',
    '/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts': 'normal',
    '/repos/{owner}/{repo}/contents/{path}': 'normal',
    
    // Low priority endpoints
    '/repos/{owner}/{repo}': 'low',
    '/user': 'low',
    '/user/installations': 'low',
  };

  /**
   * Determine priority for request
   */
  static determinePriority(options: RequestOptions): 'low' | 'normal' | 'high' | 'critical' {
    // Use explicit priority if provided
    if (options.priority) {
      return options.priority;
    }

    // Normalize endpoint for lookup
    const normalizedEndpoint = this.normalizeEndpoint(options.endpoint);
    
    // Look up priority
    const priority = this.ENDPOINT_PRIORITIES[normalizedEndpoint];
    if (priority) {
      return priority as 'low' | 'normal' | 'high' | 'critical';
    }

    // Default priority based on method
    switch (options.method?.toUpperCase()) {
      case 'POST':
      case 'PUT':
      case 'PATCH':
      case 'DELETE':
        return 'high'; // Write operations
      case 'GET':
      default:
        return 'normal'; // Read operations
    }
  }

  /**
   * Normalize endpoint path for priority lookup
   */
  private static normalizeEndpoint(endpoint: string): string {
    return endpoint
      .replace(/\/\d+/g, '/{id}')
      .replace(/\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/, '/{owner}/{repo}')
      .replace(/\/[a-zA-Z0-9_-]+$/, '/{param}');
  }

  /**
   * Get queue statistics by priority
   */
  static analyzeQueueDistribution(
    queueStatus: ReturnType<RequestQueue['getStatus']>
  ): {
    priorityDistribution: Record<string, { count: number; percentage: number }>;
    recommendations: string[];
  } {
    const total = queueStatus.totalSize;
    const priorityDistribution: Record<string, { count: number; percentage: number }> = {};
    const recommendations: string[] = [];

    for (const [priority, count] of Object.entries(queueStatus.priorityQueues)) {
      priorityDistribution[priority] = {
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      };
    }

    // Generate recommendations
    if ((priorityDistribution.critical?.percentage ?? 0) > 50) {
      recommendations.push('High critical request volume - consider scaling or optimization');
    }
    
    if ((priorityDistribution.low?.percentage ?? 0) > 30) {
      recommendations.push('Consider deferring low-priority requests during high load');
    }
    
    if (total > 100) {
      recommendations.push('Queue size is high - investigate request patterns and rate limits');
    }

    return {
      priorityDistribution,
      recommendations,
    };
  }
}