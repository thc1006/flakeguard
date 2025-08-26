# FlakeGuard Check Runs Rendering System (Phase P5)

## Overview

This document describes the implementation of the Check Runs rendering system for FlakeGuard, which provides comprehensive markdown rendering and GitHub Check Run management for flaky test detection.

## Implementation Files

### Core Implementation
- **`check-runs.ts`** - Main implementation with rendering and GitHub API functions
- **`__tests__/check-runs.test.ts`** - Comprehensive test suite with snapshot testing
- **`__tests__/check-runs.integration.test.ts`** - Simple integration tests without external dependencies
- **`__tests__/__snapshots__/check-runs.test.ts.snap`** - Snapshot tests for output consistency

## Core Functions

### `renderCheckRunOutput(tests: readonly TestCandidate[]): CheckRunOutput`

Generates comprehensive markdown summaries for flaky test candidates.

**Features:**
- Shows top-N flaky candidates in a table format
- Includes columns: Test Name, Fail Count, Rerun Pass Rate, Last Failed Run, Confidence
- Sorts by confidence (descending) then fail count (descending)
- Limits display to top 10 candidates with overflow indicator
- Escapes markdown special characters in test names
- Provides comprehensive explanations and recommendations

**Output Format:**
```markdown
🔍 FlakeGuard Analysis: N Flaky Test Candidates Detected

## Flaky Test Candidates

The following tests show patterns consistent with flaky behavior:

| Test Name | Fail Count | Rerun Pass Rate | Last Failed Run | Confidence |
|-----------|------------|-----------------|-----------------|------------|
| `test.Example` | 5 | 75.0% | 1/15/2024 | 85.0% |

### What are flaky tests?
[Comprehensive explanation...]

### Recommended Actions
[Action recommendations...]
```

### `generateCheckRunActions(tests, hasFailures): readonly CheckRunActionDef[]`

Generates exactly ≤3 requested actions based on analysis results.

**Action Priority:**
1. **rerun_failed** - If there are failures
2. **quarantine** - For high-confidence flaky tests (≥0.7)
3. **open_issue** - For any flaky test candidates

**Constraints:**
- Never exceeds 3 actions (GitHub limit)
- Always returns 0-3 actions
- Customizes descriptions based on test count (singular/plural)

### `createOrUpdateCheckRun(authManager, params): Promise<ApiResponse<FlakeGuardCheckRun>>`

Creates GitHub Check Runs with proper status transitions.

**Features:**
- Ensures proper status progression: queued → in_progress → completed
- Handles authentication via GitHubAuthManager
- Maps GitHub API errors to internal error codes
- Comprehensive logging for debugging
- Type-safe parameter validation

### `createFlakeGuardCheckRun(authManager, owner, repo, headSha, installationId, tests, hasFailures)`

Creates comprehensive FlakeGuard analysis check runs.

**Conclusion Logic:**
- `action_required` - High confidence flaky tests (≥0.8) need attention
- `neutral` - Some candidates but not critical
- `success` - No flaky tests detected

## Data Types

### `TestCandidate`
```typescript
export interface TestCandidate {
  readonly testName: string;
  readonly failCount: number;
  readonly rerunPassRate: number;
  readonly lastFailedRun: string | null;
  readonly confidence: number;
  readonly failurePattern: string | null;
  readonly totalRuns: number;
}
```

### `CheckRunActionDef`
```typescript
export interface CheckRunActionDef {
  readonly label: string;
  readonly description: string;
  readonly identifier: CheckRunAction;
}
```

## Integration Points

### Database Integration
- `convertToTestCandidates()` converts Prisma query results to TestCandidate format
- Calculates rerun pass rate based on failure rate (conservative estimate)
- Handles null dates and patterns gracefully

### GitHub API Integration
- Uses existing `GitHubAuthManager` for authentication
- Integrates with Octokit REST API for check run operations
- Maps GitHub errors to internal error codes
- Supports both create and update operations

### Flake Detection Integration
- Consumes output from `FlakeDetector.getRepositoryFlakeSummary()`
- Uses confidence scores for action prioritization
- Supports failure pattern analysis in rendering

## Error Handling

### GitHub API Errors
- 401 Unauthorized → `UNAUTHORIZED`
- 403 Forbidden → `FORBIDDEN`
- 404 Not Found → `RESOURCE_NOT_FOUND`
- 422 Validation Error → `VALIDATION_ERROR`
- 429 Rate Limited → `GITHUB_RATE_LIMITED`
- 5xx Server Errors → `GITHUB_SERVICE_UNAVAILABLE`

### Graceful Degradation
- Handles malformed test data without throwing
- Provides sensible defaults for missing data
- Continues operation even with partial failures

## Testing Strategy

### Unit Tests (`check-runs.test.ts`)
- **Markdown Rendering**: Output format consistency, special character handling
- **Action Generation**: Count validation, priority logic, edge cases
- **GitHub Integration**: API calls, error handling, status transitions
- **Data Conversion**: Database to TestCandidate mapping
- **Snapshot Testing**: Ensures output format consistency over time

### Integration Tests (`check-runs.integration.test.ts`)
- Simple tests that work without external dependencies
- Core functionality validation
- Edge case handling
- Performance with large datasets

### Test Coverage Areas
1. **Empty States** - No flaky tests, no failures
2. **Single Candidates** - Basic rendering and actions
3. **Multiple Candidates** - Sorting, limiting, action prioritization
4. **Edge Cases** - Malformed data, large datasets, special characters
5. **Error Scenarios** - API failures, network issues, rate limiting
6. **Constraint Validation** - Action count limits, markdown escaping

## Performance Considerations

### Efficient Rendering
- Limits display to top 10 candidates to prevent overly long outputs
- Uses efficient array operations for sorting and filtering
- Minimal string operations for markdown generation

### GitHub API Optimization
- Batches check run operations where possible
- Implements proper error handling to avoid unnecessary retries
- Uses installation tokens for optimal rate limiting

## Configuration

### Action Thresholds
```typescript
const HIGH_CONFIDENCE_THRESHOLD = 0.7; // For quarantine suggestions
const DISPLAY_LIMIT = 10; // Maximum candidates to show in table
const MAX_ACTIONS = 3; // GitHub Check Run action limit
```

### Markdown Templates
- Comprehensive explanations of flaky tests
- Actionable recommendations for developers
- Professional formatting with proper escaping
- Consistent branding with FlakeGuard identity

## Security Considerations

### Input Sanitization
- Escapes markdown special characters in test names
- Validates action counts to prevent API errors
- Sanitizes error messages in responses

### Authentication
- Uses GitHubAuthManager for secure token management
- Validates installation permissions before API calls
- Handles token expiration gracefully

## Future Enhancements

### Potential Improvements
1. **Rich Formatting** - Support for more advanced markdown features
2. **Interactive Elements** - Links to detailed reports, test histories
3. **Customization** - Repository-specific action preferences
4. **Analytics** - Track action usage and effectiveness
5. **Templates** - Customizable output templates
6. **Internationalization** - Multi-language support

### Scalability Considerations
- Support for repositories with thousands of tests
- Efficient pagination for large result sets
- Caching strategies for repeated analyses
- Background processing for heavy computations

## Usage Examples

### Basic Usage
```typescript
import { createFlakeGuardCheckRun } from './check-runs.js';

const tests: TestCandidate[] = [
  {
    testName: 'integration.DatabaseTest',
    failCount: 5,
    rerunPassRate: 0.75,
    lastFailedRun: '2024-01-15T10:30:00Z',
    confidence: 0.85,
    failurePattern: 'connection timeout',
    totalRuns: 20,
  },
];

const result = await createFlakeGuardCheckRun(
  authManager,
  'owner',
  'repo',
  'sha123',
  installationId,
  tests,
  true // hasFailures
);
```

### Custom Rendering
```typescript
import { renderCheckRunOutput, generateCheckRunActions } from './check-runs.js';

const output = renderCheckRunOutput(tests);
const actions = generateCheckRunActions(tests, hasFailures);

console.log('Title:', output.title);
console.log('Summary:', output.summary);
console.log('Actions:', actions.length);
```

## Dependencies

### Runtime Dependencies
- `@octokit/rest` - GitHub API client
- `@prisma/client` - Database operations
- Existing FlakeGuard authentication and logging systems

### Development Dependencies
- `vitest` - Testing framework
- `@types/node` - TypeScript types
- Existing FlakeGuard development tools

## Conclusion

The FlakeGuard Check Runs rendering system provides a robust, type-safe, and well-tested solution for communicating flaky test analysis results through GitHub Check Runs. It maintains strict constraints (never exceeding 3 actions), provides consistent output formatting, and integrates seamlessly with existing FlakeGuard infrastructure.

Key achievements:
- ✅ Comprehensive markdown rendering with professional formatting
- ✅ Strict action count validation (never > 3)
- ✅ Extensive test coverage including snapshot tests
- ✅ Proper GitHub API integration with error handling
- ✅ Type-safe implementation following TypeScript best practices
- ✅ Graceful handling of edge cases and malformed data
- ✅ Performance optimizations for large datasets

The system is ready for production use and provides a solid foundation for future enhancements.