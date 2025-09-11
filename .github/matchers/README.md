# FlakeGuard Problem Matchers

This directory contains GitHub Actions problem matchers for FlakeGuard test failure annotations.

## Overview

Problem matchers scan action output for specific patterns and create annotations on PRs. FlakeGuard uses multiple matchers to capture different test failure formats and surface them as inline annotations on changed files.

## Supported Formats

### FlakeGuard Custom Formats

**Flaky Test Warnings:**
```
FLAKY src/auth/auth.test.ts:42:1 JWT token validation Test failed intermittently due to timing issues
```
- Creates **warning** annotations
- Indicates tests identified as potentially flaky

**Test Failure Errors:**
```  
FAILURE src/payment/payment.test.ts:78:5 Payment timeout Network timeout connecting to payment gateway
```
- Creates **error** annotations
- Indicates deterministic test failures

### Jest/Vitest Style

**Jest failures:**
```
  ● Authentication Service › JWT token validation
    Expected: true
    Received: false
    at validateToken (src/auth/auth.test.ts:42:15)
```

**Vitest failures:**
```
❯ Retry mechanism should retry failed operations packages/core/retry.test.ts:15:8
```

### Playwright Style

```
  [webkit] › Authentication tests
  src/auth/auth.test.ts:42:1 JWT token validation failed
```

### Mocha Style

```
  1) Authentication Service should validate tokens
    at validateToken (src/auth/auth.test.ts:42:15)
```

## Usage in Workflows

### 1. Register the Matcher

Add this step early in your workflow:

```yaml
- name: Register FlakeGuard problem matcher
  run: echo "::add-matcher::.github/matchers/flakeguard.json"
```

### 2. Run Tests/FlakeGuard Analysis

Any subsequent step output matching the patterns will create annotations:

```yaml
- name: Run FlakeGuard test ingestion
  run: |
    pnpm --filter @flakeguard/cli exec tsx src/ingest.ts \
      --artifacts-dir .flakeguard/artifacts \
      --output .flakeguard/out/report.json
```

### 3. Remove Matcher (Optional)

To stop matching patterns:

```yaml
- name: Remove FlakeGuard problem matcher
  run: echo "::remove-matcher owner=flakeguard-junit::"
```

## Matcher Configuration

The matcher is defined in `flakeguard.json` with these owners:

- `flakeguard-junit`: Custom FLAKY/FAILURE format
- `flakeguard-test-failure`: Generic test failures
- `flakeguard-jest`: Jest-style output
- `flakeguard-vitest`: Vitest-style output  
- `flakeguard-playwright`: Playwright-style output
- `flakeguard-mocha`: Mocha-style output

## Annotation Behavior

**On PRs:**
- Annotations appear inline on the **Files Changed** tab
- Line numbers correspond to the test failure locations
- **Warnings** (FLAKY) show as yellow icons
- **Errors** (FAILURE) show as red icons

**On Push/Main:**
- Annotations appear in the workflow summary
- No inline file annotations (no diff context)

## Testing

Use the demo script to test matcher patterns:

```bash
./scripts/demo-problem-matcher.sh
```

This outputs various failure formats that should create annotations when run in GitHub Actions.

## Troubleshooting

### Annotations Not Appearing

1. **Matcher not registered:** Ensure `::add-matcher::` runs before output
2. **Wrong file paths:** Annotations only show for files in the PR diff
3. **Pattern mismatch:** Check regex patterns match your output format
4. **Branch context:** Annotations require PR context to show inline

### Testing Locally

Problem matchers only work in GitHub Actions. To test:

1. Create a test PR
2. Push changes that trigger the workflow
3. Check the **Files Changed** tab for annotations

### Pattern Debugging

Add debug output to see what's being matched:

```yaml
- name: Debug output
  run: |
    echo "Testing pattern matching..."
    echo "FAILURE src/test.ts:10:1 Test Name Error message"
```

## Integration with FlakeGuard

The FlakeGuard CLI automatically outputs failures in the correct format:

- **Deterministic failures** → `FAILURE` format (red error annotations)
- **Flaky candidates** → `FLAKY` format (yellow warning annotations)
- **Real-time detection** → Annotations appear as FlakeGuard runs

This provides immediate feedback on test quality directly in the PR review process.