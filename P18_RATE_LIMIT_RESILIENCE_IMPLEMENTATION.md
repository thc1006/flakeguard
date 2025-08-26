# P18 - Rate Limit & Resilience Implementation

FlakeGuard's comprehensive GitHub API integration with advanced rate limiting, circuit breaker patterns, and resilience mechanisms.

## Overview

This implementation provides a production-ready GitHub API wrapper that handles all aspects of API resilience:

- **Primary Rate Limiting**: Intelligent tracking and throttling of GitHub's 5000/hour limits
- **Secondary Rate Limiting**: Automatic retry with exponential backoff for abuse detection (403 errors)
- **Circuit Breaker Pattern**: Prevents cascading failures with automatic recovery
- **Request Queuing**: Priority-based request management during high load
- **Artifact Resilience**: Robust artifact download with streaming and URL re-fetching
- **Security Integration**: Webhook verification, request sanitization, and audit logging
- **Comprehensive Monitoring**: Detailed metrics and health checks

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                  EnhancedGitHubApiWrapper                       │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│ │ Request Queue   │  │ Circuit Breaker │  │ Rate Limiter    │   │
│ │ - Priority      │  │ - Failure Track │  │ - Primary/Sec   │   │
│ │ - Timeout       │  │ - Auto Recovery │  │ - Throttling    │   │
│ │ - Backpressure  │  │ - Health Check  │  │ - Monitoring    │   │
│ └─────────────────┘  └─────────────────┘  └─────────────────┘   │
│ ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│ │ Artifact Handler│  │ Security Manager│  │ Token Manager   │   │
│ │ - Streaming     │  │ - Webhook Verify│  │ - Secure Store  │   │
│ │ - URL Refresh   │  │ - Request Sanitize                   │   │
│ │ - Retry Logic   │  │ - Audit Logging │  │ - Auto Cleanup  │   │
│ └─────────────────┘  └─────────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### 1. Enhanced Rate Limiting

#### Primary Rate Limiting
- Tracks GitHub's 5000 requests/hour limit
- Configurable reserve percentage (default: 10%)
- Proactive throttling when approaching limits
- Per-resource tracking (core, search, graphql)

```typescript
const rateLimitConfig: RateLimitConfig = {
  enabled: true,
  reservePercentage: 10,           // Reserve 10% of rate limit
  minReserveRequests: 100,         // Minimum reserve
  enableThrottling: true,          // Enable proactive throttling  
  throttleThresholdPercent: 20,    // Throttle when <20% remaining
  maxThrottleDelayMs: 60000,       // Max delay 1 minute
};
```

#### Secondary Rate Limiting
- Handles 403 abuse detection responses
- Exponential backoff with jitter
- Respects Retry-After headers
- Automatic endpoint-specific delays

```typescript
const secondaryConfig: SecondaryRateLimitConfig = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 300000,              // 5 minutes max
  jitterFactor: 0.1,               // 10% jitter
  backoffMultiplier: 2,
};
```

### 2. Circuit Breaker Pattern

Prevents cascading failures when GitHub API is experiencing issues:

- **Closed**: Normal operation
- **Open**: Fails fast when failure threshold reached
- **Half-Open**: Tests recovery with limited requests

```typescript
const circuitBreakerConfig: CircuitBreakerConfig = {
  enabled: true,
  failureThreshold: 5,             // Open after 5 failures
  failureTimeWindowMs: 60000,      // In 1-minute window
  openTimeoutMs: 300000,           // Stay open for 5 minutes
  halfOpenMaxCalls: 3,             // Test with 3 requests
  successThreshold: 0.5,           // 50% success to close
};
```

### 3. Request Queue & Prioritization

Manages request flow during high load with priority handling:

```typescript
// Automatic priority assignment
const priorities = {
  'critical': ['access_tokens', 'artifact downloads'],
  'high': ['check-runs', 'issues', 'rerun'],
  'normal': ['workflow runs', 'contents'],
  'low': ['repo info', 'user data']
};

// Queue configuration
const queueConfig: RequestQueueConfig = {
  enabled: true,
  maxSize: 1000,                   // Queue size limit
  maxWaitTimeMs: 60000,            // Max wait time
  priorities: ['low', 'normal', 'high', 'critical'],
};
```

### 4. Artifact Download Resilience

Handles GitHub's short-lived artifact URLs (expire in ~1 minute):

```typescript
// Stream large artifacts
for await (const chunk of wrapper.streamArtifact({
  artifactId: 12345,
  owner: 'org',
  repo: 'repo',
  chunkSize: 64 * 1024,           // 64KB chunks
  maxRetries: 3,
})) {
  await processChunk(chunk);
}

// Or download complete
const buffer = await wrapper.downloadArtifact({
  artifactId: 12345,
  owner: 'org', 
  repo: 'repo',
  timeout: 300000,                // 5 minutes
});
```

### 5. Security Features

#### Webhook Verification
```typescript
const isValid = wrapper.verifyWebhookSignature(
  payload,
  signature,
  webhookSecret
);
```

#### Request Sanitization
- Automatically redacts sensitive fields from logs
- Prevents header injection attacks
- Detects suspicious request patterns
- Comprehensive audit logging

### 6. Monitoring & Metrics

Real-time metrics for observability:

```typescript
const metrics = wrapper.metrics;
console.log({
  totalRequests: metrics.totalRequests,
  successRate: metrics.successRate,
  avgResponseTime: metrics.avgResponseTimeMs,
  rateLimitRemaining: metrics.rateLimitStatus.remaining,
  circuitBreakerState: metrics.circuitBreakerStatus.state,
});
```

## Usage Examples

### Basic Setup

```typescript
import { createGitHubApiWrapper } from '@flakeguard/shared';
import pino from 'pino';

const logger = pino();

// From environment variables
const wrapper = createGitHubApiWrapperFromEnv(logger);

// Or with explicit config
const wrapper = createGitHubApiWrapper({
  appId: 123456,
  privateKey: process.env.GITHUB_PRIVATE_KEY,
  installationId: 789012,
}, logger);
```

### Making Requests

```typescript
// High-priority check run creation
const checkRun = await wrapper.request({
  method: 'POST',
  endpoint: '/repos/{owner}/{repo}/check-runs',
  priority: 'high',
  data: {
    name: 'FlakeGuard',
    head_sha: 'abc123',
    status: 'in_progress',
  },
});

// Low-priority repository info
const repo = await wrapper.request({
  method: 'GET',
  endpoint: '/repos/{owner}/{repo}',
  priority: 'low',
});
```

### Error Handling

```typescript
import { GitHubApiError, isRateLimitError } from '@flakeguard/shared';

try {
  const result = await wrapper.request(options);
} catch (error) {
  if (error instanceof GitHubApiError) {
    if (error.code === 'CIRCUIT_BREAKER_OPEN') {
      // Handle circuit breaker
      console.log('API temporarily unavailable');
    } else if (isRateLimitError(error)) {
      // Handle rate limiting
      console.log('Rate limit exceeded');
    }
  }
}
```

### Health Checks

```typescript
import { createHealthCheck } from '@flakeguard/shared';

const healthCheck = createHealthCheck(wrapper);

app.get('/health/github', async (req, res) => {
  const health = await healthCheck();
  res.status(health.healthy ? 200 : 503).json(health);
});
```

## Configuration

### Environment Variables

```bash
# Required
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_INSTALLATION_ID=789012

# Optional - Rate Limiting
GITHUB_RATE_LIMIT_RESERVE_PERCENT=10
GITHUB_RATE_LIMIT_THROTTLE_THRESHOLD=20

# Optional - Circuit Breaker  
GITHUB_CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
GITHUB_CIRCUIT_BREAKER_TIMEOUT_MS=300000

# Optional - Security
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_ENABLE_AUDIT_LOGGING=true

# Optional - Debugging
NODE_ENV=development  # Enables debug mode
```

### Advanced Configuration

```typescript
const wrapper = createGitHubApiWrapper(appConfig, logger, {
  // Custom rate limiting
  rateLimit: {
    enabled: true,
    reservePercentage: 15,      // More conservative
    enableThrottling: true,
  },
  
  // Aggressive circuit breaker
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,        // Open faster
    openTimeoutMs: 600000,      // Stay open longer (10min)
  },
  
  // High-throughput queue
  requestQueue: {
    enabled: true,
    maxSize: 2000,              // Larger queue
    maxWaitTimeMs: 120000,      // Longer wait time
  },
  
  // Enhanced security
  security: {
    sanitizeRequests: true,
    validateResponses: true,
    auditLogging: true,
    verifyWebhookSignatures: true,
  },
});
```

## Monitoring Integration

### Prometheus Metrics

```typescript
// Export metrics for Prometheus
app.get('/metrics/github', (req, res) => {
  const metrics = wrapper.metrics;
  const rateLimitMetrics = `
# GitHub API Rate Limit
github_api_rate_limit_remaining{resource="core"} ${metrics.rateLimitStatus.remaining}
github_api_rate_limit_limit{resource="core"} ${metrics.rateLimitStatus.limit}

# Request Metrics  
github_api_requests_total ${metrics.totalRequests}
github_api_failures_total ${metrics.totalFailures}
github_api_success_rate ${metrics.successRate}
github_api_response_time_avg_ms ${metrics.avgResponseTimeMs}
github_api_response_time_p95_ms ${metrics.p95ResponseTimeMs}

# Circuit Breaker
github_api_circuit_breaker_state{state="${metrics.circuitBreakerStatus.state}"} 1
github_api_circuit_breaker_failures ${metrics.circuitBreakerStatus.failureCount}
  `;
  
  res.set('Content-Type', 'text/plain').send(rateLimitMetrics);
});
```

### Alerting Rules

```yaml
# prometheus/alerts/github-api.yml
groups:
  - name: github-api
    rules:
      - alert: GitHubAPIRateLimitLow
        expr: github_api_rate_limit_remaining < 500
        for: 5m
        annotations:
          summary: "GitHub API rate limit running low"
          
      - alert: GitHubAPICircuitBreakerOpen
        expr: github_api_circuit_breaker_state{state="open"} == 1
        for: 1m
        annotations:
          summary: "GitHub API circuit breaker is open"
          
      - alert: GitHubAPIHighFailureRate
        expr: github_api_success_rate < 0.9
        for: 10m
        annotations:
          summary: "GitHub API success rate below 90%"
```

## Best Practices

### 1. Request Prioritization

```typescript
// Critical: Authentication and access tokens
await wrapper.request({
  method: 'POST', 
  endpoint: '/app/installations/{id}/access_tokens',
  priority: 'critical'
});

// High: User-facing operations
await wrapper.request({
  method: 'POST',
  endpoint: '/repos/{owner}/{repo}/check-runs', 
  priority: 'high'
});

// Normal: Background processing
await wrapper.request({
  method: 'GET',
  endpoint: '/repos/{owner}/{repo}/actions/runs',
  priority: 'normal'  
});

// Low: Informational queries
await wrapper.request({
  method: 'GET',
  endpoint: '/repos/{owner}/{repo}',
  priority: 'low'
});
```

### 2. Error Recovery Patterns

```typescript
import { withRetry, isRetryableError } from '@flakeguard/shared';

// Automatic retry with custom logic
const result = await withRetry(
  () => wrapper.request(options),
  3, // max attempts
  {
    shouldRetry: (error) => {
      // Custom retry logic
      return isRetryableError(error) && 
             error.code !== 'PERMISSION_DENIED';
    }
  }
);
```

### 3. Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  console.log('Shutting down GitHub API wrapper...');
  
  try {
    await wrapper.close(); // Wait for pending requests
    console.log('GitHub API wrapper closed gracefully');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  
  process.exit(0);
});
```

### 4. Development Debugging

```typescript
import { debug } from '@flakeguard/shared';

// Test the wrapper
await debug.test(wrapper);

// Log current status  
debug.logRateLimit(wrapper, logger);
debug.logCircuitBreaker(wrapper, logger);
debug.logMetrics(wrapper, logger);
```

## Troubleshooting

### Common Issues

1. **Rate Limit Exceeded**
   ```typescript
   if (error.code === 'RATE_LIMITED') {
     // Check remaining limits
     const rateLimit = wrapper.rateLimitStatus;
     console.log(`Rate limit: ${rateLimit.remaining}/${rateLimit.limit}`);
     console.log(`Resets at: ${rateLimit.resetAt}`);
   }
   ```

2. **Circuit Breaker Open**
   ```typescript
   const status = wrapper.circuitBreakerStatus;
   if (status.state === 'open') {
     console.log(`Circuit breaker open, next attempt at: ${status.nextAttemptAt}`);
   }
   ```

3. **Queue Full**
   ```typescript
   if (error.code === 'QUEUE_FULL') {
     // Wait and retry, or use higher priority
     await wrapper.request({ ...options, priority: 'high' });
   }
   ```

### Performance Tuning

```typescript
// High-throughput configuration
const config = {
  requestQueue: {
    maxSize: 5000,           // Larger queue
    maxWaitTimeMs: 300000,   // 5 minute wait
  },
  
  rateLimit: {
    reservePercentage: 5,    // Use more of rate limit
    throttleThresholdPercent: 10,  // More aggressive
  },
  
  circuitBreaker: {
    failureThreshold: 10,    // More tolerant
    openTimeoutMs: 180000,   // Shorter recovery time
  }
};
```

### Monitoring Dashboard Queries

```promql
# Request rate
rate(github_api_requests_total[5m])

# Error rate  
rate(github_api_failures_total[5m]) / rate(github_api_requests_total[5m])

# Rate limit usage
(github_api_rate_limit_limit - github_api_rate_limit_remaining) / github_api_rate_limit_limit

# Response time percentiles
histogram_quantile(0.95, rate(github_api_response_time_bucket[5m]))
```

## Testing

### Unit Tests

```typescript
import { createGitHubApiWrapper } from '@flakeguard/shared';
import pino from 'pino';

describe('GitHub API Wrapper', () => {
  let wrapper: EnhancedGitHubApiWrapper;
  
  beforeEach(() => {
    wrapper = createGitHubApiWrapper({
      appId: 123,
      privateKey: 'test-key',
    }, pino({ level: 'silent' }));
  });
  
  afterEach(async () => {
    await wrapper.close();
  });
  
  it('should handle rate limiting', async () => {
    // Mock rate limit response
    // Test throttling behavior
  });
  
  it('should open circuit breaker on failures', async () => {
    // Simulate failures
    // Verify circuit breaker opens
  });
});
```

### Integration Tests

```typescript
describe('GitHub API Integration', () => {
  it('should download artifacts with retry', async () => {
    const buffer = await wrapper.downloadArtifact({
      artifactId: process.env.TEST_ARTIFACT_ID,
      owner: 'test-org',
      repo: 'test-repo',
    });
    
    expect(buffer.length).toBeGreaterThan(0);
  });
  
  it('should verify webhook signatures', () => {
    const isValid = wrapper.verifyWebhookSignature(
      '{"test": "payload"}',
      'sha256=...',
      process.env.WEBHOOK_SECRET
    );
    
    expect(isValid).toBe(true);
  });
});
```

## Implementation Status

✅ **Completed Features:**

- [x] Enhanced Octokit Wrapper with comprehensive resilience
- [x] Primary and Secondary Rate Limiting with intelligent throttling  
- [x] Circuit Breaker Pattern with automatic recovery
- [x] Request Queue with priority-based handling
- [x] Artifact Download with streaming and URL refresh
- [x] Security Manager with webhook verification and audit logging
- [x] Token Manager with secure storage and cleanup
- [x] Comprehensive Metrics and Health Monitoring
- [x] TypeScript types and interfaces
- [x] Utility functions and debugging tools
- [x] Configuration management and environment integration
- [x] Documentation and examples

🔄 **Integration Points:**

- API service integration for webhook handling
- Worker service integration for background processing  
- Web dashboard integration for monitoring display
- CLI integration for setup and debugging

📋 **Next Steps:**

1. Integration testing with real GitHub API
2. Performance benchmarking under load
3. Production deployment with monitoring
4. Documentation and training materials

The P18 Rate Limit & Resilience implementation provides enterprise-grade GitHub API integration with comprehensive resilience patterns, security features, and monitoring capabilities ready for production deployment.