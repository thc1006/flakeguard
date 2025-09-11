# 🎯 GitHub Actions Problem Matchers

## Overview

FlakeGuard uses GitHub Actions Problem Matchers to automatically convert test failures and analysis results into **inline PR annotations**. This makes it much easier for developers to see exactly where issues occur in their code.

## 📁 Problem Matcher Files

### `.github/matchers/junit.json`
General-purpose matcher for common test runners and tools:
- **JUnit/Vitest/Jest** test failures
- **TypeScript** compilation errors  
- **ESLint** linting issues
- **Generic** test failure patterns

### `.github/matchers/flakeguard.json`
FlakeGuard-specific matcher for test analysis results:
- **[FLAKY]** - Flaky test warnings (⚠️ warning)
- **[FAILED]** - Test failure analysis (❌ error)
- **[QUARANTINED]** - Quarantined test notices (ℹ️ notice)

## 🔧 How It Works

### 1. Registration
Problem matchers are registered at the beginning of workflow jobs:
```yaml
- name: Register problem matchers
  run: echo "::add-matcher::.github/matchers/junit.json"
```

### 2. Pattern Matching
When logs contain matching patterns, GitHub automatically creates annotations:

**Input Log:**
```
[FLAKY] Auth token validation in src/auth/auth.test.ts:14 - Random timeout behavior detected
```

**Generated Annotation:**
- **File**: `src/auth/auth.test.ts`
- **Line**: `14`
- **Severity**: `warning`
- **Message**: `Auth token validation - Random timeout behavior detected`

### 3. PR Display
Annotations appear in multiple locations:
- ✅ **Files tab** - Inline annotations on changed lines
- ✅ **Checks tab** - Grouped by severity and tool
- ✅ **Summary** - Aggregated counts in job summaries

## 🎨 Annotation Types

| Pattern | Severity | Purpose | Example |
|---------|----------|---------|---------|
| `[FLAKY]` | ⚠️ Warning | Flaky test detection | Random timeout behavior |
| `[FAILED]` | ❌ Error | Test failure analysis | Network connection error |
| `[QUARANTINED]` | ℹ️ Notice | Quarantined test info | Test disabled for 7 days |
| TypeScript | ❌ Error | Compilation errors | Type mismatch |
| ESLint | ⚠️ Warning | Code quality | Unused variable |

## 📋 Pattern Examples

### FlakeGuard Analysis
```bash
[FLAKY] Auth token validation in src/auth/auth.test.ts:14 - Random timeout behavior detected
[FAILED] Payment timeout handling in src/payment/payment.test.ts:25 - Network timeout error  
[QUARANTINED] Modal flicker test in src/ui/modal.test.ts:18 - Known flaky test quarantined for 7 days
```

### Test Failures
```bash
# Vitest
FAIL src/auth/auth.test.ts > Authentication Service › should validate JWT token
  src/auth/auth.test.ts:14:23

# Jest  
  ✖ Authentication flow › should handle JWT token validation
    at src/auth/auth.test.ts:14:23
```

### TypeScript Errors
```bash
src/payment/payment.test.ts(25,15): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
```

### ESLint Issues
```bash
src/ui/modal.test.ts:18:10: error 'unused-variable' is never used  @typescript-eslint/no-unused-vars
```

## 🚀 Testing Problem Matchers

### Local Testing
Run the test script to see expected output patterns:
```bash
node test-problem-matcher.js
```

### CI Testing  
The CI workflow includes a demonstration step that outputs test patterns:
```yaml
- name: Demonstrate problem matcher annotations
  continue-on-error: true
  run: |
    echo "[FLAKY] Auth token validation in src/auth/auth.test.ts:14 - Random timeout behavior detected"
    echo "[FAILED] Payment timeout handling in src/payment/payment.test.ts:25 - Network timeout error"
    # ... more test patterns
```

## 📈 Benefits for FlakeGuard

### 1. **Instant Visual Feedback**
- Developers see issues **inline** with their code changes
- No need to dig through CI logs to find problems
- Clear distinction between flaky vs. deterministic failures

### 2. **Enhanced Code Review**
- Reviewers can see test issues **contextually** 
- FlakeGuard analysis appears **right next to** the problematic code
- Quarantine status is **immediately visible** in PR files

### 3. **Actionable Insights**
- **[FLAKY]** warnings help identify unstable tests
- **[QUARANTINED]** notices explain why tests are disabled
- **[FAILED]** errors provide failure analysis with context

### 4. **Reduced Context Switching**
- All test information appears **in the PR interface**
- No need to switch between PR and CI logs
- Faster issue resolution and code iteration

## 🔍 Debugging Problem Matchers

### Common Issues

**Annotations not appearing:**
- ✅ Check matcher is registered before log output
- ✅ Verify pattern regex matches actual log format
- ✅ Ensure file paths are relative to repository root

**Wrong severity/location:**
- ✅ Check named capture groups in regex pattern
- ✅ Verify file paths exist and are accessible
- ✅ Test patterns with GitHub's matcher validator

### Validation Commands
```bash
# Test regex patterns locally
echo "[FLAKY] Test in src/test.ts:10 - message" | grep -E "^\[FLAKY\]\s+(.*)\s+in\s+(.*):(\d+)\s+-\s+(.*)$"

# Validate JSON syntax
jq . .github/matchers/flakeguard.json

# Test with actual CI output
grep -E "\[FLAKY\]|\[FAILED\]|\[QUARANTINED\]" ci-logs.txt
```

## 📚 Resources

- [GitHub Actions Problem Matchers Documentation](https://github.com/actions/toolkit/blob/main/docs/problem-matchers.md)
- [Problem Matcher Examples](https://github.com/actions/setup-node/blob/main/.github/matchers/tsc.json)
- [FlakeGuard Architecture](./docs/architecture.md)
- [CI Workflow Documentation](./docs/ci-workflow.md)

---

**Result**: Test failures and FlakeGuard analysis now appear as **inline PR annotations**, making code review faster and issue resolution more efficient! 🎉