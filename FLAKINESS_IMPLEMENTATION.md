# Flakiness Scoring and Quarantine Policy Engine

This document describes the comprehensive flakiness scoring and quarantine policy engine implemented for the FlakeGuard project.

## Overview

The flakiness scoring engine uses a sophisticated rolling window algorithm to detect flaky tests by analyzing test execution patterns. It weights intermittent failures higher than permanent failures and provides actionable quarantine recommendations.

## Files Created

### Core Implementation

1. **`packages/shared/src/types/analytics.ts`** - TypeScript types for analytics
2. **`apps/api/src/analytics/flakiness.ts`** - Main flakiness scoring engine
3. **`apps/api/src/routes/quarantine.ts`** - REST API endpoints for quarantine planning
4. **`packages/shared/src/constants/index.ts`** - Updated with DEFAULT_QUARANTINE_POLICY

### Testing

5. **`apps/api/src/analytics/__tests__/flakiness.test.ts`** - Comprehensive test suite
6. **`apps/api/src/routes/__tests__/quarantine.test.ts`** - API endpoint tests
7. **`apps/api/src/analytics/__tests__/verification.js`** - Algorithm verification script

## Key Features

### 1. Rolling Window Algorithm

- Uses the last 50 runs by default (configurable via `rollingWindowSize`)
- Focuses on recent test behavior rather than historical patterns
- Automatically adapts to tests with sparse data

### 2. Weighted Feature Scoring

The algorithm extracts and weights multiple features:

- **Intermittency Score (30% weight)**: Detects pass/fail alternating patterns
- **Re-run Pass Rate (25% weight)**: Heavily weights tests that pass on retry
- **Failure Clustering (15% weight)**: Analyzes temporal failure distribution
- **Message Variance (10% weight)**: Detects varying error messages
- **Fail/Success Ratio (10% weight)**: Basic failure rate
- **Consecutive Failure Penalty (10% weight)**: Reduces score for always-failing tests

### 3. Message Signature Normalization

Sophisticated message normalization removes variable parts:

- Timestamps and time values
- File paths and line numbers
- Memory addresses and hex values
- Process/thread IDs
- Port numbers and UUIDs
- Assertion values and stack traces

### 4. Configurable Quarantine Policy

Default thresholds:
- **Warning**: ≥ 0.3 flakiness score
- **Quarantine**: ≥ 0.6 flakiness score
- **Minimum Runs**: 5 runs required
- **Recent Failures**: 2 failures in last 7 days required

### 5. Intelligent Recommendations

- **Priority Levels**: Low, Medium, High, Critical
- **Confidence Scoring**: Based on data availability and time span
- **Rationale Generation**: Human-readable explanations
- **PR Annotations**: Ready-to-use markdown for pull requests

## API Endpoints

### POST /v1/quarantine/plan

Generate quarantine plan for a repository.

**Request Body:**
```json
{
  "repositoryId": "string",
  "policy": {
    "warnThreshold": 0.3,
    "quarantineThreshold": 0.6,
    "minRunsForQuarantine": 5,
    "minRecentFailures": 2,
    "lookbackDays": 7,
    "rollingWindowSize": 50
  },
  "lookbackDays": 14,
  "includeAnnotations": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "repositoryId": "string",
    "candidates": [
      {
        "testName": "string",
        "testFullName": "string",
        "flakeScore": {
          "score": 0.75,
          "confidence": 0.85,
          "recommendation": {
            "action": "quarantine",
            "reason": "string",
            "confidence": 0.85,
            "priority": "high"
          }
        },
        "rationale": "string",
        "suggestedAnnotation": "string",
        "lastFailures": [...]
      }
    ],
    "summary": {
      "totalCandidates": 5,
      "highPriority": 2,
      "mediumPriority": 2,
      "lowPriority": 1
    },
    "generatedAt": "2024-01-15T10:30:00Z"
  },
  "processedAt": "2024-01-15T10:30:00Z",
  "metricsCount": 1250
}
```

### GET /v1/quarantine/policy

Get default quarantine policy configuration.

## Algorithm Verification

The verification script confirms:

✅ **Stable tests score ~0**: Consistently passing tests get minimal scores  
✅ **Flaky tests score >0.3**: Intermittent failures are detected  
✅ **Retry-passing tests score >0.5**: Tests that pass on retry get high scores  
✅ **Always-failing < intermittent**: Broken tests score lower than flaky ones  
✅ **Scoring determinism**: Same input always produces same output  
✅ **Bounded scores**: All scores stay within 0.0-1.0 range  

## Test Patterns Detected

### 1. Intermittent Flaky Tests
- **Pattern**: Alternating pass/fail results
- **Score**: High (0.4-0.8)
- **Key Features**: High intermittency score, moderate failure rate

### 2. Retry-Passing Flaky Tests
- **Pattern**: Initial failure, retry success
- **Score**: Very High (0.6-1.0)
- **Key Features**: High re-run pass rate, classic flaky behavior

### 3. Always-Failing Tests
- **Pattern**: Consistent failures
- **Score**: Low-Medium (0.1-0.4)
- **Key Features**: High failure rate, zero intermittency, penalty applied

### 4. Stable Tests
- **Pattern**: Consistent passes or consistent behavior
- **Score**: Very Low (0.0-0.1)
- **Key Features**: Low failure rate, zero intermittency

## Edge Cases Handled

- **New tests** with minimal data
- **Sparse data** over long time periods
- **Tests with only skipped runs**
- **Varying error message formats**
- **Different retry patterns**
- **Window size larger than available runs**
- **Concurrent request handling**

## Integration

The implementation integrates with:

- **Prisma ORM**: Database queries for test results
- **Fastify**: REST API framework
- **Zod**: Request/response validation
- **Swagger/OpenAPI**: API documentation
- **Vitest**: Test framework

## Usage Example

```typescript
import { FlakinessScorer } from './analytics/flakiness.js';

const scorer = new FlakinessScorer({
  quarantineThreshold: 0.7,
  minRunsForQuarantine: 10
});

const flakeScore = scorer.computeFlakeScore(testRuns);
console.log(`Test flakiness: ${flakeScore.score}`);
console.log(`Recommendation: ${flakeScore.recommendation.action}`);
```

## Performance Considerations

- **Rolling Window**: Limits analysis to recent runs for efficiency
- **Indexed Queries**: Uses database indexes for fast test result retrieval
- **Streaming Processing**: Handles large datasets efficiently
- **Caching**: Suitable for caching computed scores
- **Concurrent Safe**: Algorithm is stateless and thread-safe

## Monitoring

The engine provides comprehensive logging:
- Quarantine plan generation metrics
- Processing duration tracking
- Error handling with context
- Request/response validation

This implementation provides production-grade flaky test detection with strong theoretical foundations and practical applicability.