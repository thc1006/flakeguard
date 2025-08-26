/**
 * GitHub API Wrapper Usage Examples
 * Demonstrates various patterns and use cases for the enhanced wrapper
 */

import type { Logger } from 'pino';

import {
  createGitHubApiWrapper,
  createGitHubApiWrapperFromEnv,
  GitHubApiError,
  isRateLimitError,
  isRetryableError,
  withRetry,
  createHealthCheck,
  debug,
} from './index.js';

/**
 * Basic usage examples
 */
export class GitHubApiExamples {
  private wrapper;
  private logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.wrapper = createGitHubApiWrapperFromEnv(logger);
  }

  /**
   * Example 1: Creating a check run with resilience
   */
  async createFlakeGuardCheckRun(owner: string, repo: string, headSha: string) {
    try {
      const checkRun = await this.wrapper.request({
        method: 'POST',
        endpoint: `/repos/${owner}/${repo}/check-runs`,
        priority: 'high', // High priority for user-facing operations
        data: {
          name: 'FlakeGuard Analysis',
          head_sha: headSha,
          status: 'in_progress',
          started_at: new Date().toISOString(),
          output: {
            title: 'FlakeGuard Test Analysis',
            summary: 'Analyzing test results for flaky tests...',
          },
          actions: [
            {
              label: 'Quarantine Flaky Tests',
              description: 'Quarantine identified flaky tests',
              identifier: 'quarantine',
            },
            {
              label: 'Re-run Failed Jobs',
              description: 'Re-run jobs with failed tests',
              identifier: 'rerun_failed',
            },
            {
              label: 'Open Issue',
              description: 'Open GitHub issue for investigation',
              identifier: 'open_issue',
            },
          ],
        },
      });

      this.logger.info(
        { checkRunId: checkRun.id, owner, repo, headSha },
        'FlakeGuard check run created successfully'
      );

      return checkRun;
    } catch (error) {
      await this.handleApiError(error, 'create check run');
      throw error;
    }
  }

  /**
   * Example 2: Downloading and processing JUnit artifacts
   */
  async processJunitArtifacts(
    owner: string,
    repo: string,
    workflowRunId: number,
    onTestResult?: (testResult: any) => void
  ) {
    try {
      // First, get the artifacts for the workflow run
      const artifacts = await this.wrapper.request({
        method: 'GET',
        endpoint: `/repos/${owner}/${repo}/actions/runs/${workflowRunId}/artifacts`,
        priority: 'normal',
      });

      this.logger.info(
        { artifactCount: artifacts.artifacts.length, workflowRunId },
        'Found artifacts for workflow run'
      );

      // Process each JUnit artifact
      for (const artifact of artifacts.artifacts) {
        if (artifact.name.includes('junit') || artifact.name.includes('test-results')) {
          await this.processJunitArtifact(artifact.id, owner, repo, onTestResult);
        }
      }
    } catch (error) {
      await this.handleApiError(error, 'process junit artifacts');
      throw error;
    }
  }

  /**
   * Example 3: Streaming large artifact download
   */
  async processJunitArtifact(
    artifactId: number,
    owner: string,
    repo: string,
    onTestResult?: (testResult: any) => void
  ) {
    try {
      this.logger.info({ artifactId }, 'Starting JUnit artifact download');

      const chunks: Buffer[] = [];
      let totalSize = 0;

      // Stream the artifact download
      for await (const chunk of this.wrapper.streamArtifact({
        artifactId,
        owner,
        repo,
        chunkSize: 64 * 1024, // 64KB chunks
        maxRetries: 3,
      })) {
        chunks.push(chunk);
        totalSize += chunk.length;

        // Progress logging
        if (totalSize % (1024 * 1024) === 0) { // Every MB
          this.logger.debug({ totalSize, chunks: chunks.length }, 'Download progress');
        }
      }

      const artifactBuffer = Buffer.concat(chunks);
      
      this.logger.info(
        { artifactId, totalSize, chunks: chunks.length },
        'Artifact download completed'
      );

      // Process the JUnit XML (this would be your JUnit parser)
      const testResults = await this.parseJunitXml(artifactBuffer);
      
      if (onTestResult) {
        testResults.forEach(onTestResult);
      }

      return testResults;
    } catch (error) {
      if (error instanceof GitHubApiError && error.code === 'ARTIFACT_EXPIRED') {
        this.logger.warn({ artifactId }, 'Artifact URL expired, this is expected for old artifacts');
        return [];
      }
      
      await this.handleApiError(error, 'process junit artifact');
      throw error;
    }
  }

  /**
   * Example 4: Handling check run requested actions
   */
  async handleCheckRunAction(
    action: 'quarantine' | 'rerun_failed' | 'open_issue',
    checkRunId: number,
    owner: string,
    repo: string,
    testData: any
  ) {
    try {
      switch (action) {
        case 'quarantine':
          await this.quarantineFlakyTests(owner, repo, testData.flakyTests);
          break;
        
        case 'rerun_failed':
          await this.rerunFailedJobs(owner, repo, testData.failedJobs);
          break;
        
        case 'open_issue':
          await this.openFlakeIssue(owner, repo, testData.flakyTests);
          break;
      }

      // Update check run with action result
      await this.wrapper.request({
        method: 'PATCH',
        endpoint: `/repos/${owner}/${repo}/check-runs/${checkRunId}`,
        priority: 'high',
        data: {
          status: 'completed',
          conclusion: 'success',
          completed_at: new Date().toISOString(),
          output: {
            title: 'FlakeGuard Action Completed',
            summary: `Successfully executed action: ${action}`,
          },
        },
      });

    } catch (error) {
      await this.handleApiError(error, `handle action ${action}`);
      throw error;
    }
  }

  /**
   * Example 5: Bulk operations with rate limit awareness
   */
  async updateMultipleCheckRuns(updates: Array<{
    owner: string;
    repo: string;
    checkRunId: number;
    data: any;
  }>) {
    const results = [];
    const batchSize = 10; // Process in batches to manage rate limits

    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      this.logger.info(
        { batchIndex: Math.floor(i / batchSize), batchSize: batch.length },
        'Processing check run update batch'
      );

      // Process batch in parallel, but respect rate limits
      const batchPromises = batch.map(async (update) => {
        try {
          return await withRetry(
            () => this.wrapper.request({
              method: 'PATCH',
              endpoint: `/repos/${update.owner}/${update.repo}/check-runs/${update.checkRunId}`,
              priority: 'normal',
              data: update.data,
            }),
            3, // max retries
            {
              shouldRetry: (error) => {
                // Retry on rate limits and server errors, but not auth errors
                return isRetryableError(error) && 
                       !(error instanceof GitHubApiError && 
                         error.code === 'PERMISSION_DENIED');
              }
            }
          );
        } catch (error) {
          this.logger.error(
            { 
              owner: update.owner, 
              repo: update.repo, 
              checkRunId: update.checkRunId,
              error: error instanceof Error ? error.message : String(error)
            },
            'Failed to update check run'
          );
          return { error };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Check rate limit status between batches
      const rateLimitStatus = this.wrapper.rateLimitStatus;
      if (rateLimitStatus.isLimited) {
        const delayMs = Math.min(rateLimitStatus.resetInSeconds * 1000, 60000);
        this.logger.warn(
          { 
            remaining: rateLimitStatus.remaining, 
            delayMs,
            resetAt: rateLimitStatus.resetAt 
          },
          'Rate limit low, adding delay between batches'
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Example 6: Webhook signature verification
   */
  async handleWebhook(payload: string, signature: string, secret: string) {
    // Verify the webhook signature
    const isValid = this.wrapper.verifyWebhookSignature(payload, signature, secret);
    
    if (!isValid) {
      this.logger.error('Invalid webhook signature');
      throw new GitHubApiError(
        'WEBHOOK_VERIFICATION_FAILED',
        'Webhook signature verification failed',
        { retryable: false }
      );
    }

    const webhookPayload = JSON.parse(payload);
    
    this.logger.info(
      { 
        event: webhookPayload.action || 'unknown',
        repository: webhookPayload.repository?.full_name,
        sender: webhookPayload.sender?.login,
      },
      'Webhook verified and parsed successfully'
    );

    return webhookPayload;
  }

  /**
   * Example 7: Health monitoring and alerts
   */
  async monitorApiHealth() {
    const healthCheck = createHealthCheck(this.wrapper);
    
    const health = await healthCheck();
    
    this.logger.info(health, 'GitHub API health check completed');

    // Example: Send alerts based on health
    if (!health.healthy) {
      await this.sendHealthAlert(health);
    }

    return health;
  }

  /**
   * Example 8: Development debugging
   */
  async debugApiStatus() {
    // Test basic connectivity
    await debug.test(this.wrapper);

    // Log current status
    debug.logRateLimit(this.wrapper, this.logger);
    debug.logCircuitBreaker(this.wrapper, this.logger);
    debug.logMetrics(this.wrapper, this.logger);

    // Get detailed metrics
    const metrics = this.wrapper.metrics;
    
    this.logger.info({
      requests24h: metrics.requestsLast24h,
      failures24h: metrics.failuresLast24h,
      successRate: `${(metrics.successRate * 100).toFixed(2)}%`,
      avgResponseTime: `${metrics.avgResponseTimeMs.toFixed(2)}ms`,
      p95ResponseTime: `${metrics.p95ResponseTimeMs.toFixed(2)}ms`,
      rateLimitRemaining: metrics.rateLimitStatus.remaining,
      circuitBreakerState: metrics.circuitBreakerStatus.state,
    }, 'GitHub API detailed metrics');
  }

  /**
   * Example 9: Graceful shutdown
   */
  async shutdown() {
    this.logger.info('Starting graceful shutdown of GitHub API wrapper');
    
    try {
      await this.wrapper.close();
      this.logger.info('GitHub API wrapper shut down successfully');
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error during GitHub API wrapper shutdown'
      );
      throw error;
    }
  }

  /**
   * Helper: Handle API errors with appropriate logging and recovery
   */
  private async handleApiError(error: any, operation: string) {
    if (error instanceof GitHubApiError) {
      switch (error.code) {
        case 'RATE_LIMITED':
          const rateLimitStatus = this.wrapper.rateLimitStatus;
          this.logger.warn(
            { 
              operation,
              remaining: rateLimitStatus.remaining,
              resetAt: rateLimitStatus.resetAt,
            },
            'Rate limit exceeded during operation'
          );
          break;

        case 'CIRCUIT_BREAKER_OPEN':
          const circuitStatus = this.wrapper.circuitBreakerStatus;
          this.logger.error(
            {
              operation,
              nextAttemptAt: circuitStatus.nextAttemptAt,
              failureCount: circuitStatus.failureCount,
            },
            'Circuit breaker open during operation'
          );
          break;

        case 'QUEUE_FULL':
          this.logger.warn(
            { operation },
            'Request queue full during operation'
          );
          break;

        case 'ARTIFACT_EXPIRED':
          this.logger.warn(
            { operation },
            'Artifact URL expired during operation'
          );
          break;

        case 'PERMISSION_DENIED':
          this.logger.error(
            { operation },
            'Permission denied during operation - check GitHub App permissions'
          );
          break;

        default:
          this.logger.error(
            { 
              operation,
              errorCode: error.code,
              message: error.message,
              retryable: error.retryable,
            },
            'GitHub API error during operation'
          );
      }
    } else {
      this.logger.error(
        {
          operation,
          error: error instanceof Error ? error.message : String(error),
        },
        'Unexpected error during operation'
      );
    }
  }

  /**
   * Helper: Quarantine flaky tests (placeholder implementation)
   */
  private async quarantineFlakyTests(owner: string, repo: string, flakyTests: any[]) {
    this.logger.info({ owner, repo, testCount: flakyTests.length }, 'Quarantining flaky tests');
    
    // Implementation would update test files or CI configuration
    // to skip or isolate flaky tests
  }

  /**
   * Helper: Re-run failed jobs (placeholder implementation)
   */
  private async rerunFailedJobs(owner: string, repo: string, failedJobs: any[]) {
    this.logger.info({ owner, repo, jobCount: failedJobs.length }, 'Re-running failed jobs');
    
    for (const job of failedJobs) {
      await this.wrapper.request({
        method: 'POST',
        endpoint: `/repos/${owner}/${repo}/actions/runs/${job.runId}/rerun-failed-jobs`,
        priority: 'high',
      });
    }
  }

  /**
   * Helper: Open GitHub issue for flaky tests (placeholder implementation) 
   */
  private async openFlakeIssue(owner: string, repo: string, flakyTests: any[]) {
    this.logger.info({ owner, repo, testCount: flakyTests.length }, 'Opening flake issue');
    
    const issueBody = this.generateFlakeIssueBody(flakyTests);
    
    await this.wrapper.request({
      method: 'POST',
      endpoint: `/repos/${owner}/${repo}/issues`,
      priority: 'high',
      data: {
        title: `FlakeGuard: Flaky tests detected (${flakyTests.length} tests)`,
        body: issueBody,
        labels: ['flaky-tests', 'bug', 'ci'],
      },
    });
  }

  /**
   * Helper: Generate issue body for flaky tests
   */
  private generateFlakeIssueBody(flakyTests: any[]): string {
    return `
# FlakeGuard: Flaky Tests Detected

FlakeGuard has identified ${flakyTests.length} potentially flaky test(s) that may need attention.

## Detected Flaky Tests

${flakyTests.map(test => `
### \`${test.name}\`
- **Failure Rate**: ${test.failureRate}%
- **Confidence**: ${test.confidence}%
- **Recent Failures**: ${test.recentFailures}
- **Pattern**: ${test.failurePattern || 'Various failures'}

\`\`\`
${test.lastError || 'No error details available'}
\`\`\`
`).join('\n')}

## Recommended Actions

1. **Review Test Logic**: Check for race conditions, timing issues, or external dependencies
2. **Stabilize Environment**: Ensure test environment is consistent and isolated  
3. **Add Retry Logic**: Consider adding intelligent retry mechanisms for transient failures
4. **Quarantine**: Temporarily skip these tests while investigating

## FlakeGuard Analysis

This issue was automatically created by FlakeGuard based on test failure patterns and confidence analysis.

For more information, see the [FlakeGuard documentation](https://github.com/your-org/flakeguard).
    `.trim();
  }

  /**
   * Helper: Parse JUnit XML (placeholder implementation)
   */
  private async parseJunitXml(buffer: Buffer): Promise<any[]> {
    // This would be implemented with actual JUnit XML parsing
    // For now, return mock data
    return [
      {
        name: 'TestExample.testMethod',
        status: 'failed',
        duration: 1500,
        errorMessage: 'Expected true but was false',
        stackTrace: 'at TestExample.testMethod(TestExample.java:42)',
      },
    ];
  }

  /**
   * Helper: Send health alert (placeholder implementation)
   */
  private async sendHealthAlert(health: any) {
    this.logger.error(health, 'GitHub API health check failed - would send alert');
    
    // Implementation would send alerts via:
    // - Slack webhook
    // - PagerDuty
    // - Email
    // - Discord webhook
    // etc.
  }
}

/**
 * Example configuration for different environments
 */
export const exampleConfigurations = {
  /**
   * Development configuration - more logging, faster timeouts
   */
  development: {
    debug: true,
    rateLimit: {
      enabled: true,
      reservePercentage: 20, // More conservative in dev
      enableThrottling: true,
      throttleThresholdPercent: 30,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3, // Fail faster in dev
      openTimeoutMs: 60000, // 1 minute
    },
    retry: {
      enabled: true,
      maxAttempts: 2, // Fewer retries in dev
      baseDelayMs: 500,
    },
    timeout: {
      requestTimeoutMs: 15000, // Shorter timeout in dev
      enabled: true,
    },
  },

  /**
   * Production configuration - optimized for reliability and performance
   */
  production: {
    debug: false,
    rateLimit: {
      enabled: true,
      reservePercentage: 10,
      enableThrottling: true,
      throttleThresholdPercent: 20,
      maxThrottleDelayMs: 60000,
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      failureTimeWindowMs: 60000,
      openTimeoutMs: 300000, // 5 minutes
      halfOpenMaxCalls: 3,
      successThreshold: 0.5,
    },
    retry: {
      enabled: true,
      maxAttempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      multiplier: 2,
      jitterFactor: 0.1,
    },
    security: {
      sanitizeRequests: true,
      validateResponses: true,
      auditLogging: true,
      verifyWebhookSignatures: true,
    },
  },

  /**
   * High-throughput configuration - optimized for maximum API usage
   */
  highThroughput: {
    debug: false,
    rateLimit: {
      enabled: true,
      reservePercentage: 5, // Use more of the rate limit
      enableThrottling: true,
      throttleThresholdPercent: 10,
    },
    requestQueue: {
      enabled: true,
      maxSize: 5000, // Larger queue
      maxWaitTimeMs: 300000, // 5 minutes
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 10, // More tolerant of failures
      openTimeoutMs: 180000, // 3 minutes
    },
    artifactDownload: {
      enabled: true,
      maxSizeBytes: 500 * 1024 * 1024, // 500MB
      useStreaming: true,
      streamChunkSize: 128 * 1024, // 128KB chunks
    },
  },
};

/**
 * Example usage patterns for different scenarios
 */
export const usagePatterns = {
  /**
   * Pattern: Webhook processing
   */
  async webhookProcessing(
    wrapper: any,
    payload: string,
    signature: string,
    secret: string
  ) {
    // Verify webhook
    const isValid = wrapper.verifyWebhookSignature(payload, signature, secret);
    if (!isValid) {
      throw new Error('Invalid webhook signature');
    }

    const event = JSON.parse(payload);
    
    // Process based on event type
    switch (event.action) {
      case 'completed':
        if (event.workflow_run) {
          await this.processWorkflowCompletion(wrapper, event);
        }
        break;
      
      case 'requested_action':
        if (event.check_run) {
          await this.processCheckRunAction(wrapper, event);
        }
        break;
    }
  },

  /**
   * Pattern: Batch processing with rate limit management
   */
  async batchProcessing(wrapper: any, items: any[], batchSize: number = 10) {
    const results = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(item => this.processItem(wrapper, item))
      );
      
      results.push(...batchResults);
      
      // Check rate limit between batches
      const rateLimit = wrapper.rateLimitStatus;
      if (rateLimit.isLimited) {
        const delayMs = Math.min(rateLimit.resetInSeconds * 1000, 60000);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return results;
  },

  /**
   * Pattern: Long-running background job
   */
  async backgroundJob(wrapper: any) {
    const healthCheck = createHealthCheck(wrapper);
    
    while (true) {
      try {
        // Check health before processing
        const health = await healthCheck();
        if (!health.healthy) {
          console.warn('API unhealthy, waiting...', health);
          await new Promise(resolve => setTimeout(resolve, 60000));
          continue;
        }
        
        // Process work items
        await this.processWorkQueue(wrapper);
        
        // Wait between cycles
        await new Promise(resolve => setTimeout(resolve, 30000));
        
      } catch (error) {
        console.error('Background job error:', error);
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
  },

  /**
   * Helper methods for patterns
   */
  async processWorkflowCompletion(wrapper: any, event: any) {
    // Implementation for workflow completion
  },

  async processCheckRunAction(wrapper: any, event: any) {
    // Implementation for check run action
  },

  async processItem(wrapper: any, item: any) {
    // Implementation for item processing
  },

  async processWorkQueue(wrapper: any) {
    // Implementation for work queue processing
  },
};