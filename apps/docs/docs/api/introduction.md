# API Introduction

FlakeGuard provides a comprehensive REST API for integrating flaky test detection capabilities into your development workflow. The API is built with modern standards, providing consistent, reliable access to all FlakeGuard functionality.

## API Overview

The FlakeGuard API is designed around REST principles with predictable URLs, standard HTTP methods, and JSON payloads. All API endpoints are secured with authentication and follow consistent patterns for error handling and pagination.

### Base URL

```
https://api.flakeguard.dev/v1
```

For self-hosted installations:
```
https://your-flakeguard-domain.com/api/v1
```

### API Versioning

The API uses URL-based versioning with the version number included in the path:

- **Current Version**: `v1`
- **Status**: Stable
- **Deprecation Policy**: 12 months advance notice for breaking changes

## Quick Start

### 1. Authentication

Obtain an API token from your FlakeGuard dashboard:

```bash
# Set your API token (example)
export FLAKEGUARD_TOKEN="fg_EXAMPLE_TOKEN_1234567890abcdef"

# Test authentication
curl -H "Authorization: $(printf '%s' "Bearer $FLAKEGUARD_TOKEN")" \
     https://api.flakeguard.dev/v1/user
```

### 2. Submit Test Results

Submit JUnit XML test results for analysis:

```bash
curl -X POST \
  -H "Authorization: $(printf '%s' "Bearer $FLAKEGUARD_TOKEN")" \
  -H "Content-Type: application/xml" \
  -H "X-Repository-Id: owner/repo" \
  -H "X-Run-Id: workflow-run-123" \
  --data @test-results.xml \
  https://api.flakeguard.dev/v1/ingestion/junit
```

### 3. Get Analysis Results

Retrieve flakiness analysis for your tests:

```bash
curl -H "Authorization: $(printf '%s' "Bearer $FLAKEGUARD_TOKEN")" \
     "https://api.flakeguard.dev/v1/repositories/owner%2Frepo/analysis?limit=10"
```

## Core Concepts

### Repositories

Repositories represent GitHub repositories that are monitored by FlakeGuard. Each repository has:

- **Configuration**: Quarantine policies, notification settings
- **Test Results**: Historical test execution data
- **Flakiness Analysis**: Calculated flakiness scores and recommendations
- **Users**: Team members with various permission levels

### Test Results

Test results represent individual test executions, typically parsed from JUnit XML files:

```json
{
  "id": "test-result-123",
  "testName": "should calculate user permissions correctly",
  "className": "UserServiceTest",
  "status": "failed",
  "duration": 1.234,
  "errorMessage": "Expected true but got false",
  "stackTrace": "...",
  "runId": "workflow-run-456",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Flakiness Analysis

FlakeGuard calculates flakiness scores based on historical test execution patterns:

```json
{
  "testIdentifier": "UserServiceTest.should_calculate_user_permissions_correctly",
  "flakiness": {
    "score": 0.75,
    "confidence": 0.92,
    "recommendation": "quarantine",
    "reasoning": "High failure rate with inconsistent error messages"
  },
  "statistics": {
    "totalRuns": 100,
    "failures": 75,
    "successRate": 0.25,
    "avgDuration": 1.2
  }
}
```

### Quarantine Management

Tests can be quarantined to prevent them from affecting CI/CD pipelines:

```json
{
  "status": "quarantined",
  "reason": "high_flakiness_score",
  "quarantinedAt": "2024-01-01T12:00:00Z",
  "quarantinedBy": "user-123",
  "autoQuarantine": true,
  "reviewRequired": false
}
```

## HTTP Methods and Status Codes

### HTTP Methods

| Method | Usage |
|--------|--------|
| `GET` | Retrieve resources or collections |
| `POST` | Create new resources or trigger actions |
| `PUT` | Update entire resources |
| `PATCH` | Partial resource updates |
| `DELETE` | Remove resources |

### Status Codes

FlakeGuard API uses standard HTTP status codes:

#### Success Codes
- `200 OK` - Request succeeded
- `201 Created` - Resource created successfully
- `202 Accepted` - Request accepted for async processing
- `204 No Content` - Request succeeded, no response body

#### Client Error Codes
- `400 Bad Request` - Invalid request syntax or parameters
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - Insufficient permissions for resource
- `404 Not Found` - Resource does not exist
- `409 Conflict` - Resource conflict (e.g., duplicate creation)
- `422 Unprocessable Entity` - Valid request, but semantic errors
- `429 Too Many Requests` - Rate limit exceeded

#### Server Error Codes
- `500 Internal Server Error` - Unexpected server error
- `502 Bad Gateway` - Upstream service error
- `503 Service Unavailable` - Service temporarily unavailable
- `504 Gateway Timeout` - Upstream service timeout

## Request and Response Format

### Request Headers

#### Required Headers
```http
Authorization: Bearer fg_EXAMPLE_TOKEN_1234567890abcdef
Content-Type: application/json
Accept: application/json
```

#### Optional Headers
```http
X-Repository-Id: owner/repo              # Repository context
X-Run-Id: workflow-run-123               # Workflow run context  
X-Request-ID: req-uuid-123               # Request tracing
User-Agent: MyApp/1.0                    # Client identification
```

### Request Body

All POST and PUT requests should include a JSON body:

```json
{
  "data": {
    "type": "test-result",
    "attributes": {
      "testName": "example test",
      "status": "failed",
      "duration": 1.234
    }
  }
}
```

### Response Format

All API responses follow a consistent structure:

#### Success Response
```json
{
  "data": {
    "id": "123",
    "type": "test-result",
    "attributes": {
      "testName": "example test",
      "status": "failed"
    }
  },
  "meta": {
    "timestamp": "2024-01-01T12:00:00Z",
    "requestId": "req-uuid-123"
  }
}
```

#### Collection Response
```json
{
  "data": [...],
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "totalPages": 8
    },
    "timestamp": "2024-01-01T12:00:00Z"
  },
  "links": {
    "self": "/v1/test-results?page=1",
    "next": "/v1/test-results?page=2",
    "prev": null,
    "first": "/v1/test-results?page=1",
    "last": "/v1/test-results?page=8"
  }
}
```

#### Error Response
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "testName",
        "message": "Test name is required"
      }
    ]
  },
  "meta": {
    "timestamp": "2024-01-01T12:00:00Z",
    "requestId": "req-uuid-123"
  }
}
```

## Pagination

Large collections use cursor-based pagination:

### Request Parameters
```http
GET /v1/test-results?limit=50&cursor=eyJpZCI6MTIzfQ
```

### Response
```json
{
  "data": [...],
  "meta": {
    "pagination": {
      "limit": 50,
      "hasNext": true,
      "hasPrev": false,
      "nextCursor": "eyJpZCI6MTczfQ",
      "prevCursor": null
    }
  }
}
```

## Filtering and Sorting

### Filtering
Use query parameters to filter collections:

```http
GET /v1/test-results?status=failed&repository=owner/repo&since=2024-01-01
```

### Sorting
Sort results using the `sort` parameter:

```http
GET /v1/test-results?sort=-timestamp,testName
```

- Prefix with `-` for descending order
- Multiple fields separated by commas
- Default sort varies by endpoint

## Error Handling

### Error Codes

FlakeGuard uses structured error codes for programmatic handling:

| Code | Description |
|------|-------------|
| `AUTHENTICATION_FAILED` | Invalid or missing authentication token |
| `PERMISSION_DENIED` | Insufficient permissions for operation |
| `VALIDATION_ERROR` | Request validation failed |
| `RESOURCE_NOT_FOUND` | Requested resource does not exist |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `INTERNAL_ERROR` | Unexpected server error |
| `SERVICE_UNAVAILABLE` | Service temporarily unavailable |

### Error Recovery

Implement proper error handling in your client code:

```javascript
async function callFlakeGuardAPI(endpoint, options) {
  try {
    const response = await fetch(endpoint, options);
    
    if (!response.ok) {
      const error = await response.json();
      
      switch (error.error.code) {
        case 'RATE_LIMIT_EXCEEDED':
          // Implement exponential backoff
          await sleep(1000 * Math.pow(2, retryCount));
          return callFlakeGuardAPI(endpoint, options);
          
        case 'AUTHENTICATION_FAILED':
          // Refresh token and retry
          await refreshToken();
          return callFlakeGuardAPI(endpoint, options);
          
        case 'SERVICE_UNAVAILABLE':
          // Wait and retry with circuit breaker
          throw new ServiceUnavailableError(error.error.message);
          
        default:
          throw new APIError(error.error.message, error.error.code);
      }
    }
    
    return response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}
```

## SDK Libraries

Official SDKs are available for popular programming languages:

### JavaScript/TypeScript
```bash
npm install @flakeguard/sdk
```

```javascript
import { FlakeGuardClient } from '@flakeguard/sdk';

const client = new FlakeGuardClient({
  token: process.env.FLAKEGUARD_TOKEN,
  baseURL: 'https://api.flakeguard.dev/v1'
});

const results = await client.testResults.list({
  repository: 'owner/repo',
  status: 'failed'
});
```

### Python
```bash
pip install flakeguard-python
```

```python
from flakeguard import FlakeGuardClient

client = FlakeGuardClient(
    token=os.environ['FLAKEGUARD_TOKEN'],
    base_url='https://api.flakeguard.dev/v1'
)

results = client.test_results.list(
    repository='owner/repo',
    status='failed'
)
```

### Go
```bash
go get github.com/flakeguard/flakeguard-go
```

```go
import "github.com/flakeguard/flakeguard-go"

client := flakeguard.NewClient(
    flakeguard.WithToken(os.Getenv("FLAKEGUARD_TOKEN")),
    flakeguard.WithBaseURL("https://api.flakeguard.dev/v1"),
)

results, err := client.TestResults.List(ctx, &flakeguard.TestResultsListOptions{
    Repository: "owner/repo",
    Status: "failed",
})
```

## Rate Limiting

FlakeGuard API implements rate limiting to ensure fair usage:

### Rate Limits

| Tier | Requests/Hour | Burst Limit |
|------|---------------|-------------|
| Free | 1,000 | 100 |
| Pro | 10,000 | 500 |
| Enterprise | 100,000 | 2,000 |

### Rate Limit Headers

Response headers indicate your current rate limit status:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
X-RateLimit-Retry-After: 3600
```

### Handling Rate Limits

When rate limited (429 status), implement exponential backoff:

```javascript
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequestWithBackoff(request, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await request();
      return response;
    } catch (error) {
      if (error.status === 429 && attempt < maxRetries - 1) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 60000);
        await sleep(backoff);
        continue;
      }
      throw error;
    }
  }
}
```

## Webhooks

FlakeGuard can send webhooks to notify your systems about important events:

### Available Events
- `test.quarantined` - Test was quarantined
- `analysis.completed` - Flakiness analysis finished
- `repository.configured` - Repository settings changed

### Webhook Security

All webhooks include HMAC-SHA256 signatures for verification:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = 'sha256=' + 
    crypto.createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

## Next Steps

- [Authentication Guide](./authentication.md)
- [REST API Reference](./rest/ingestion.md)
- [Rate Limiting Details](./rate-limiting.md)
- [Error Handling Guide](./error-handling.md)
- [SDK Documentation](./sdks/javascript.md)