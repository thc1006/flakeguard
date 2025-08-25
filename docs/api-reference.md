# FlakeGuard API Reference

Complete API documentation for FlakeGuard's REST API endpoints.

## Base Information

- **Base URL**: `https://api.flakeguard.dev` (or your deployment URL)
- **API Version**: v1
- **Content Type**: `application/json` (unless specified otherwise)
- **Authentication**: Bearer token or GitHub App installation token

## Authentication

### API Key Authentication

```http
Authorization: Bearer your-api-key
```

### GitHub App Authentication

For GitHub webhook events and check runs:

```http
Authorization: Bearer installation-token
```

## Health Endpoints

### GET /health

Basic health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0"
}
```

### GET /health/ready

Readiness check including database connectivity.

**Response:**
```json
{
  "status": "ready",
  "timestamp": "2024-01-15T10:30:00Z",
  "checks": {
    "database": "healthy",
    "redis": "healthy",
    "github": "healthy"
  }
}
```

## Test Result Ingestion

### POST /api/ingestion/junit

Ingest JUnit XML test results for analysis.

**Headers:**
```http
Content-Type: application/xml
X-Repository-Id: owner/repository
X-Run-Id: github-workflow-run-id
X-Job-Name: test-job-name (optional)
X-Suite-Name: test-suite-name (optional)
```

**Request Body:**
JUnit XML content

**Response:**
```json
{
  "success": true,
  "data": {
    "ingestionId": "ing_123456",
    "repositoryId": "owner/repository",
    "runId": "github-workflow-run-id",
    "testSuites": 3,
    "testCases": 42,
    "failures": 2,
    "errors": 0,
    "skipped": 1,
    "processingTimeMs": 150
  },
  "processedAt": "2024-01-15T10:30:00Z"
}
```

**Error Responses:**

400 Bad Request:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid JUnit XML format",
    "details": {
      "line": 42,
      "column": 15,
      "parseError": "Unexpected end of input"
    }
  }
}
```

### POST /api/ingestion/batch

Batch upload multiple test result files.

**Headers:**
```http
Content-Type: multipart/form-data
X-Repository-Id: owner/repository
X-Run-Id: github-workflow-run-id
```

**Request Body:**
Multipart form with test result files.

**Response:**
```json
{
  "success": true,
  "data": {
    "batchId": "batch_123456",
    "totalFiles": 5,
    "processed": 5,
    "failed": 0,
    "results": [
      {
        "filename": "test-results-1.xml",
        "status": "processed",
        "testCases": 20,
        "failures": 1
      }
    ]
  }
}
```

## Quarantine Management

### POST /api/quarantine/plan

Generate a quarantine plan for a repository.

**Request Body:**
```json
{
  "repositoryId": "owner/repository",
  "policy": {
    "warnThreshold": 0.3,
    "quarantineThreshold": 0.6,
    "minRunsForQuarantine": 5,
    "minRecentFailures": 2,
    "lookbackDays": 7,
    "rollingWindowSize": 50
  },
  "lookbackDays": 14,
  "includeAnnotations": true,
  "filters": {
    "testSuites": ["unit", "integration"],
    "excludePatterns": ["**/generated/**"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "repositoryId": "owner/repository",
    "candidates": [
      {
        "testName": "TestUserAuthentication",
        "testFullName": "com.example.auth.TestUserAuthentication.testLoginSuccess",
        "suite": "integration",
        "file": "src/test/java/com/example/auth/TestUserAuthentication.java",
        "flakeScore": {
          "score": 0.75,
          "confidence": 0.85,
          "breakdown": {
            "intermittencyScore": 0.6,
            "rerunPassRate": 0.8,
            "failureClustering": 0.4,
            "messageVariance": 0.3,
            "failSuccessRatio": 0.2,
            "consecutiveFailurePenalty": 0.1
          },
          "recommendation": {
            "action": "quarantine",
            "reason": "High intermittency with retry success pattern",
            "confidence": 0.85,
            "priority": "high"
          }
        },
        "statistics": {
          "totalRuns": 45,
          "failures": 12,
          "successes": 33,
          "failureRate": 0.27,
          "recentFailures": 5,
          "lastFailureAt": "2024-01-14T15:30:00Z"
        },
        "rationale": "Test shows classic flaky behavior with 27% failure rate but 80% success on retry. Recent pattern indicates timing-related issues.",
        "suggestedAnnotation": "<!-- FlakeGuard: Quarantine candidate due to intermittent failures (75% flakiness score) -->\n@Disabled(\"Quarantined by FlakeGuard - timing-related flakiness detected\")",
        "lastFailures": [
          {
            "timestamp": "2024-01-14T15:30:00Z",
            "message": "Connection timeout after 30 seconds",
            "runId": "run_123",
            "attempt": 1
          }
        ]
      }
    ],
    "summary": {
      "totalCandidates": 5,
      "highPriority": 2,
      "mediumPriority": 2,
      "lowPriority": 1,
      "totalTestsAnalyzed": 150,
      "analysisWindow": {
        "startDate": "2024-01-01T00:00:00Z",
        "endDate": "2024-01-15T00:00:00Z",
        "totalRuns": 1250
      }
    },
    "policy": {
      "warnThreshold": 0.3,
      "quarantineThreshold": 0.6,
      "minRunsForQuarantine": 5,
      "minRecentFailures": 2,
      "lookbackDays": 7,
      "rollingWindowSize": 50
    },
    "generatedAt": "2024-01-15T10:30:00Z"
  },
  "processedAt": "2024-01-15T10:30:00Z",
  "metricsCount": 1250
}
```

### GET /api/quarantine/policy

Get the default quarantine policy configuration.

**Response:**
```json
{
  "success": true,
  "data": {
    "warnThreshold": 0.3,
    "quarantineThreshold": 0.6,
    "minRunsForQuarantine": 5,
    "minRecentFailures": 2,
    "lookbackDays": 7,
    "rollingWindowSize": 50,
    "description": "Default policy balances sensitivity with false positives"
  }
}
```

## Test Analysis

### GET /api/repositories/{repositoryId}/tests

List test results with filtering and pagination.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50, max: 200)
- `status` (optional): Filter by status (`passed`, `failed`, `skipped`, `error`)
- `suite` (optional): Filter by test suite name
- `search` (optional): Search test names
- `startDate` (optional): Filter from date (ISO 8601)
- `endDate` (optional): Filter to date (ISO 8601)
- `sortBy` (optional): Sort field (`name`, `status`, `createdAt`, `flakeScore`)
- `sortOrder` (optional): Sort order (`asc`, `desc`)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "test_123456",
      "name": "testUserLogin",
      "suite": "integration",
      "class": "UserAuthenticationTest",
      "testFullName": "UserAuthenticationTest.testUserLogin",
      "file": "src/test/java/UserAuthenticationTest.java",
      "status": "failed",
      "time": 2.45,
      "message": "Expected 200 but got 503",
      "stack": "java.lang.AssertionError...",
      "runId": "run_789",
      "jobName": "integration-tests",
      "createdAt": "2024-01-15T10:30:00Z",
      "flakeAnalysis": {
        "isFlaky": true,
        "score": 0.65,
        "confidence": 0.8,
        "lastAnalyzed": "2024-01-15T10:35:00Z"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "pages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### GET /api/repositories/{repositoryId}/tests/{testId}/history

Get historical data for a specific test.

**Query Parameters:**
- `limit` (optional): Number of runs to return (default: 50)
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

**Response:**
```json
{
  "success": true,
  "data": {
    "testId": "test_123456",
    "testName": "testUserLogin",
    "testFullName": "UserAuthenticationTest.testUserLogin",
    "history": [
      {
        "runId": "run_789",
        "status": "failed",
        "time": 2.45,
        "message": "Expected 200 but got 503",
        "createdAt": "2024-01-15T10:30:00Z",
        "attempt": 1
      },
      {
        "runId": "run_788",
        "status": "passed",
        "time": 1.23,
        "message": null,
        "createdAt": "2024-01-14T16:20:00Z",
        "attempt": 1
      }
    ],
    "statistics": {
      "totalRuns": 45,
      "passed": 33,
      "failed": 12,
      "skipped": 0,
      "errors": 0,
      "failureRate": 0.267,
      "averageTime": 1.85,
      "firstSeen": "2024-01-01T10:00:00Z",
      "lastSeen": "2024-01-15T10:30:00Z"
    }
  }
}
```

### POST /api/repositories/{repositoryId}/tests/analyze

Trigger flakiness analysis for repository tests.

**Request Body:**
```json
{
  "testFilters": {
    "suites": ["unit", "integration"],
    "excludePatterns": ["**/generated/**"],
    "includeOnlyFailed": false
  },
  "analysisOptions": {
    "lookbackDays": 30,
    "minRuns": 3,
    "recalculateAll": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "analysisId": "analysis_123456",
    "repositoryId": "owner/repository",
    "status": "queued",
    "estimatedCompletion": "2024-01-15T10:35:00Z",
    "testsToAnalyze": 150
  }
}
```

## Flake Detection

### GET /api/repositories/{repositoryId}/flakes

List flaky test detections.

**Query Parameters:**
- `status` (optional): Filter by status (`pending`, `quarantined`, `dismissed`, `stable`)
- `confidence` (optional): Minimum confidence threshold (0.0-1.0)
- `priority` (optional): Filter by priority (`low`, `medium`, `high`, `critical`)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "flake_123456",
      "testName": "testUserLogin",
      "testFullName": "UserAuthenticationTest.testUserLogin",
      "isFlaky": true,
      "confidence": 0.85,
      "failurePattern": "timeout",
      "historicalFailures": 12,
      "totalRuns": 45,
      "failureRate": 0.267,
      "lastFailureAt": "2024-01-15T10:30:00Z",
      "suggestedAction": "quarantine",
      "status": "pending",
      "priority": "high",
      "createdAt": "2024-01-15T10:35:00Z",
      "updatedAt": "2024-01-15T10:35:00Z"
    }
  ]
}
```

### PATCH /api/repositories/{repositoryId}/flakes/{flakeId}

Update flake detection status.

**Request Body:**
```json
{
  "status": "quarantined",
  "reason": "Confirmed as flaky after manual review",
  "reviewedBy": "developer@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "flake_123456",
    "status": "quarantined",
    "updatedAt": "2024-01-15T10:40:00Z"
  }
}
```

## GitHub Integration

### POST /api/github/webhook

GitHub webhook endpoint (called by GitHub).

**Headers:**
```http
Content-Type: application/json
X-GitHub-Event: workflow_run
X-GitHub-Delivery: 12345678-1234-1234-1234-123456789012
X-Hub-Signature-256: sha256=...
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed successfully",
  "processedAt": "2024-01-15T10:30:00Z"
}
```

### POST /api/github/repositories/{repositoryId}/check-runs

Create a GitHub check run.

**Request Body:**
```json
{
  "name": "FlakeGuard Analysis",
  "headSha": "abc123def456",
  "status": "in_progress",
  "output": {
    "title": "Analyzing test results for flakiness",
    "summary": "Processing 42 test cases...",
    "text": "## Analysis in Progress\n\nWe're analyzing your test results for flakiness patterns."
  },
  "actions": [
    {
      "label": "View Full Report",
      "description": "Open detailed flakiness report",
      "identifier": "view_report"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123456789,
    "name": "FlakeGuard Analysis",
    "headSha": "abc123def456",
    "status": "in_progress",
    "conclusion": null,
    "startedAt": "2024-01-15T10:30:00Z",
    "completedAt": null,
    "checkRunUrl": "https://github.com/owner/repo/runs/123456789"
  }
}
```

## Analytics and Reporting

### GET /api/repositories/{repositoryId}/analytics/summary

Get repository test analytics summary.

**Query Parameters:**
- `period` (optional): Time period (`7d`, `30d`, `90d`, `1y`)

**Response:**
```json
{
  "success": true,
  "data": {
    "period": "30d",
    "summary": {
      "totalTests": 150,
      "totalRuns": 1250,
      "passRate": 0.89,
      "failureRate": 0.08,
      "skipRate": 0.03,
      "averageTestTime": 2.34,
      "flakyTests": 12,
      "flakeRate": 0.08,
      "quarantinedTests": 3
    },
    "trends": {
      "passRateTrend": 0.02,
      "flakeRateTrend": -0.01,
      "testCountTrend": 0.05
    },
    "topFlakySuites": [
      {
        "name": "integration",
        "flakeCount": 8,
        "flakeRate": 0.15
      }
    ]
  }
}
```

### GET /api/repositories/{repositoryId}/analytics/trends

Get test trends over time.

**Query Parameters:**
- `metric` (required): Metric to analyze (`pass_rate`, `flake_rate`, `test_count`, `avg_time`)
- `period` (optional): Time period (`7d`, `30d`, `90d`)
- `granularity` (optional): Data granularity (`daily`, `weekly`)

**Response:**
```json
{
  "success": true,
  "data": {
    "metric": "pass_rate",
    "period": "30d",
    "granularity": "daily",
    "dataPoints": [
      {
        "date": "2024-01-01",
        "value": 0.92,
        "testRuns": 45
      },
      {
        "date": "2024-01-02",
        "value": 0.89,
        "testRuns": 52
      }
    ]
  }
}
```

## Notifications

### POST /api/notifications/slack

Send Slack notification (webhook).

**Request Body:**
```json
{
  "repositoryId": "owner/repository",
  "type": "flake_detected",
  "data": {
    "testName": "testUserLogin",
    "flakeScore": 0.75,
    "failureRate": 0.267,
    "action": "quarantine_recommended"
  },
  "channels": ["#dev-alerts", "#quality-assurance"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "notificationId": "notif_123456",
    "channels": 2,
    "sentAt": "2024-01-15T10:30:00Z"
  }
}
```

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional context"
    },
    "timestamp": "2024-01-15T10:30:00Z",
    "traceId": "trace_123456"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `RESOURCE_NOT_FOUND` | 404 | Resource doesn't exist |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `GITHUB_API_ERROR` | 502 | GitHub API communication error |
| `PROCESSING_ERROR` | 500 | Internal processing error |
| `DATABASE_ERROR` | 500 | Database operation failed |

## Rate Limiting

### Rate Limit Headers

All responses include rate limiting headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705312200
X-RateLimit-Window: 60
```

### Rate Limits by Endpoint Category

| Category | Rate Limit | Window |
|----------|------------|---------|
| Health checks | 1000 requests | 1 minute |
| Test ingestion | 100 requests | 1 minute |
| Analysis requests | 50 requests | 1 minute |
| GitHub webhooks | 1000 requests | 1 minute |
| Analytics queries | 200 requests | 1 minute |

## OpenAPI Specification

The complete OpenAPI 3.0 specification is available at:
- Development: `http://localhost:3000/documentation`
- Production: `https://api.flakeguard.dev/documentation`

### Generate SDK

```bash
# Generate TypeScript SDK
npx openapi-generator-cli generate \
  -i https://api.flakeguard.dev/swagger.json \
  -g typescript-fetch \
  -o ./flakeguard-client

# Generate Python SDK  
npx openapi-generator-cli generate \
  -i https://api.flakeguard.dev/swagger.json \
  -g python \
  -o ./flakeguard-python-client
```

## Examples

### Complete Workflow Example

```typescript
import { FlakeGuardClient } from '@flakeguard/client';

const client = new FlakeGuardClient({
  baseURL: 'https://api.flakeguard.dev',
  apiKey: process.env.FLAKEGUARD_API_KEY
});

// 1. Ingest test results
const ingestion = await client.ingestion.junit({
  repositoryId: 'owner/repo',
  runId: 'workflow-123',
  content: junitXmlContent
});

// 2. Wait for analysis to complete
await new Promise(resolve => setTimeout(resolve, 5000));

// 3. Generate quarantine plan
const plan = await client.quarantine.generatePlan({
  repositoryId: 'owner/repo',
  lookbackDays: 14
});

// 4. Review flaky tests
for (const candidate of plan.data.candidates) {
  if (candidate.flakeScore.score > 0.7) {
    console.log(`High-priority flaky test: ${candidate.testName}`);
    console.log(`Recommendation: ${candidate.flakeScore.recommendation.action}`);
  }
}
```

This API reference provides comprehensive documentation for integrating with FlakeGuard's REST API, enabling custom workflows and advanced test analysis capabilities.