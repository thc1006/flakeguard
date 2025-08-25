# Policy-as-Code Engine

The Policy-as-Code engine allows FlakeGuard to load configuration from repository `.flakeguard.yml` files, enabling teams to customize flakiness thresholds, exclusion patterns, and notification settings on a per-repository basis.

## Features

- **Flexible Configuration**: Load policy from `.flakeguard.yml` in repository root
- **Smart Caching**: Cache policies to minimize GitHub API calls
- **Fallback Defaults**: Use environment variables and constants when file not found
- **Schema Validation**: Comprehensive Zod schema validation with helpful error messages
- **Team Overrides**: Different thresholds for different teams within same repository
- **Path Exclusions**: Glob pattern matching to exclude test files
- **Auto-Quarantine**: Optional automatic quarantine based on PR labels

## Configuration Schema

### Core Thresholds

```yaml
# Flakiness score thresholds (0.0 - 1.0)
flaky_threshold: 0.6        # Quarantine tests with score >= 0.6
warn_threshold: 0.3         # Warn about tests with score >= 0.3
```

### Minimum Criteria

```yaml
# Minimum requirements before taking action
min_occurrences: 5          # Need >= 5 test runs
min_recent_failures: 2      # Need >= 2 recent failures
lookback_days: 7            # Consider last 7 days of data
rolling_window_size: 50     # Use last 50 runs for scoring
```

### Path Exclusions

```yaml
# Glob patterns for paths to exclude from analysis
exclude_paths:
  - "node_modules/**"
  - "**/*.spec.ts"
  - "test/fixtures/**"
  - "docs/**"
```

### Team Configuration

```yaml
# Team-specific threshold overrides
team_overrides:
  "frontend":
    flaky_threshold: 0.7      # Higher tolerance for frontend tests
    warn_threshold: 0.4
  "backend":
    flaky_threshold: 0.8      # Even higher for backend
    auto_quarantine_enabled: true

# Team notifications
team_notifications:
  slack_channels:
    "frontend": "#frontend-flaky-tests"
    "backend": "#backend-quality"
```

### Auto-Quarantine

```yaml
# Automatic quarantine settings
auto_quarantine_enabled: false    # Require manual approval by default
quarantine_duration_days: 30      # Auto-expire after 30 days
labels_required:                  # PR must have ALL these labels
  - "ci"
  - "tests"
  - "ready-for-review"
```

### Advanced Configuration

```yaml
# Quality thresholds
confidence_threshold: 0.7         # Only act on high-confidence analysis

# Custom scoring weights (should sum to ~1.0)
scoring_weights:
  intermittency_weight: 0.30
  rerun_weight: 0.25
  clustering_weight: 0.15
  message_variance_weight: 0.10
  fail_ratio_weight: 0.10
  consecutive_failure_penalty: 0.10

# Exempted tests (never flagged as flaky)
exempted_tests:
  - "**/*smoke*"
  - "critical-path/**"
  - "security/**/*auth*"
```

## API Usage

### Loading Policy

```typescript
import { getPolicyEngine } from './policy/engine.js';

const engine = getPolicyEngine();
const policy = await engine.loadPolicy(octokit, 'owner', 'repo');
```

### Evaluating Policy

```typescript
const decisions = await engine.evaluatePolicy(
  testResults,
  policy,
  { owner: 'owner', repo: 'repo' },
  {
    teamContext: 'frontend',
    pullRequestLabels: ['ci', 'tests']
  }
);
```

### Service Layer

```typescript
import { createPolicyService } from './policy/service.js';

const service = createPolicyService(authManager);
const result = await service.evaluatePolicy({
  owner: 'owner',
  repo: 'repo',
  tests: testResults,
  options: {
    teamContext: 'backend',
    pullRequestLabels: ['ci']
  }
}, installationId);
```

## REST API Endpoints

### POST /api/v1/policy/evaluate

Evaluate policy for a set of test results.

**Request:**
```json
{
  "owner": "myorg",
  "repo": "myrepo",
  "tests": [
    {
      "name": "test.js:should work",
      "status": "failed",
      "flakeAnalysis": {
        "isFlaky": true,
        "confidence": 0.8,
        "historicalFailures": 5,
        "totalRuns": 10,
        "failureRate": 0.5
      }
    }
  ],
  "options": {
    "teamContext": "frontend",
    "pullRequestLabels": ["ci", "tests"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "repositoryId": "myorg/myrepo",
    "policySource": "file",
    "decisions": [
      {
        "testName": "test.js:should work",
        "action": "warn",
        "reason": "Moderate flakiness score (0.500) exceeds warning threshold (0.300)",
        "confidence": 0.8,
        "priority": "medium",
        "metadata": {
          "policyVersion": "1.0",
          "evaluatedAt": "2024-01-15T10:30:00Z",
          "teamOverride": "frontend"
        }
      }
    ],
    "summary": {
      "totalTests": 1,
      "actionsRecommended": 1,
      "quarantineCandidates": 0,
      "warnings": 1
    }
  }
}
```

### GET /api/v1/policy/load

Load policy configuration for a repository.

**Query Parameters:**
- `owner` (required): Repository owner
- `repo` (required): Repository name  
- `ref` (optional): Git reference (branch/tag/commit)

**Response:**
```json
{
  "success": true,
  "data": {
    "config": {
      "flaky_threshold": 0.6,
      "warn_threshold": 0.3,
      "exclude_paths": ["node_modules/**"]
    },
    "source": "file",
    "metadata": {
      "loadedAt": "2024-01-15T10:30:00Z",
      "repository": "myorg/myrepo",
      "ref": "main"
    }
  }
}
```

### POST /api/v1/policy/validate

Validate a policy configuration object.

**Request:**
```json
{
  "config": {
    "flaky_threshold": 0.7,
    "warn_threshold": 0.3,
    "exclude_paths": ["test/**"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "config": {
      "flaky_threshold": 0.7,
      "warn_threshold": 0.3,
      "min_occurrences": 5,
      "exclude_paths": ["test/**"]
    }
  }
}
```

### DELETE /api/v1/policy/cache

Invalidate cached policy for a repository.

**Request:**
```json
{
  "owner": "myorg",
  "repo": "myrepo"
}
```

### GET /api/v1/policy/stats

Get policy engine cache statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "cache": {
      "size": 15,
      "expired": 2,
      "hitsBySource": {
        "file": 10,
        "defaults": 3,
        "env": 2
      }
    },
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

## Environment Variables

```bash
# Policy defaults (used when .flakeguard.yml not found)
FLAKE_WARN_THRESHOLD=0.3
FLAKE_QUARANTINE_THRESHOLD=0.6
```

## Error Handling

The policy engine handles various error scenarios gracefully:

- **File Not Found**: Falls back to environment variables and defaults
- **Invalid YAML**: Logs warning and uses defaults
- **Schema Validation**: Returns detailed validation errors
- **GitHub API Errors**: Caches failures temporarily to avoid repeated calls
- **Access Denied**: Returns appropriate HTTP status codes

## Caching Strategy

- **Cache TTL**: 5 minutes by default
- **Cache Key**: `{owner}/{repo}:{ref}`
- **Invalidation**: Manual via API or automatic on expiry
- **Fallback**: On cache miss, loads from GitHub API
- **Error Caching**: Failed loads cached briefly to prevent API spam

## Testing

Run the test suite:

```bash
# Unit tests
pnpm test src/policy/__tests__/engine.test.ts

# Integration tests
pnpm test src/policy/__tests__/integration.test.ts

# All policy tests
pnpm test src/policy/
```

## Example .flakeguard.yml

See `.flakeguard.yml.example` in the repository root for a complete example configuration.

## Migration Guide

When upgrading to policy-as-code:

1. Review current environment variable settings
2. Create `.flakeguard.yml` in repository root
3. Test configuration with `/api/v1/policy/validate` endpoint
4. Monitor policy evaluation results
5. Adjust thresholds based on team feedback

## Best Practices

- Start with conservative thresholds and adjust based on results
- Use team overrides for different risk tolerances
- Exclude test infrastructure and fixtures from analysis
- Regular review and update of exclusion patterns
- Monitor policy stats to ensure effective caching
- Use auto-quarantine only for well-tested workflows
