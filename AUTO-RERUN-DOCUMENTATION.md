# 🔄 FlakeGuard Auto-Rerun Engine

## Overview

The FlakeGuard Auto-Rerun Engine automatically triggers reruns for **flaky-dominant test failures** while implementing robust loop prevention mechanisms. It analyzes test failure patterns and intelligently decides whether failures are likely to pass on retry.

## 🎯 Key Features

### 🔒 **Robust Loop Prevention**
- **SHA-based lock files**: `.flakeguard/.rerun.lock.<sha>` prevents multiple reruns per commit
- **Maximum rerun limit**: Exactly **1 rerun per commit SHA** (configurable)
- **Attempt tracking**: Prevents reruns on subsequent attempts (run_attempt > 1)
- **Lock persistence**: Survives workflow restarts and concurrent runs

### 🧠 **Intelligent Decision Logic**
- **Flaky dominance threshold**: 70% of failures must be flaky to trigger rerun
- **Quarantine awareness**: Considers quarantined tests in analysis  
- **Deterministic failure detection**: Avoids reruns when real bugs are present
- **Comprehensive analysis**: Frequency × volatility scoring for flake confidence

### 🔧 **Dual Execution Methods**
- **Option A (gh CLI)**: `gh run rerun $RUN_ID --failed` 
- **Option B (REST API)**: `POST /repos/owner/repo/actions/runs/run_id/rerun-failed-jobs`
- **Auto-detection**: Chooses best method based on token availability

### 📊 **Rich Logging & Reporting**
- **GitHub Step Summary**: Detailed analysis reports in Actions UI
- **Decision transparency**: Clear reasoning for rerun/no-rerun decisions
- **Failure pattern analysis**: Breakdown of flaky vs deterministic failures
- **Historical tracking**: Previous attempt tracking with timestamps

## 🛠️ Implementation

### Core Algorithm
```typescript
// Decision logic for auto-rerun
const shouldRerun = (
  flakyCoverage >= 0.7 &&           // 70%+ failures are flaky
  !lockFileExists &&               // No previous rerun for this SHA
  currentAttempt === 1 &&           // Not already a rerun attempt
  failedTests > 0                   // There are actual failures
);
```

### Lock File Structure
```json
{
  "sha": "a1b2c3d4e5f6789",
  "timestamp": "2025-01-10T18:30:00.000Z",
  "runId": "99887766",
  "attempt": 1,
  "reason": "Flaky-dominant failures detected (80.0% flaky, threshold: 70%)",
  "triggeredBy": "flakeguard-auto-rerun"
}
```

### Workflow Integration
```yaml
- name: FlakeGuard Auto-Rerun Analysis
  if: always()
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    pnpm --filter @flakeguard/cli exec tsx src/auto-rerun.ts analyze \
      --report .flakeguard/out/report.json \
      --quarantine .flakeguard/quarantine.yml \
      --sha "${{ github.sha }}" \
      --run-id "${{ github.run_id }}" \
      --repository "${{ github.repository }}" \
      --attempt "${{ github.run_attempt || '1' }}" \
      --token "${{ secrets.GITHUB_TOKEN }}" \
      --method auto
```

## 📋 Decision Matrix

| Scenario | Flaky % | Quarantined | Lock Exists | Attempt | Decision | Reason |
|----------|---------|-------------|-------------|---------|----------|---------|
| **Flaky Dominant** | 80% | 20% | ❌ No | 1 | ✅ **RERUN** | High flaky coverage |
| **Deterministic** | 30% | 10% | ❌ No | 1 | ❌ **NO RERUN** | Real failures dominate |
| **Previous Rerun** | 80% | 20% | ✅ Yes | 1 | ❌ **NO RERUN** | Lock prevents loop |
| **Second Attempt** | 80% | 20% | ❌ No | 2 | ❌ **NO RERUN** | Already a rerun |
| **All Quarantined** | 100% | 100% | ❌ No | 1 | ❌ **NO RERUN** | All failures known |
| **No Failures** | 0% | 0% | ❌ No | 1 | ❌ **NO RERUN** | Nothing to rerun |

## 🔍 Analysis Metrics

### Flaky Coverage Calculation
```typescript
const flakyCoverage = flakyFailures.length / totalFailures.length;
```

### Quarantine Coverage Calculation  
```typescript
const quarantineCoverage = quarantinedFailures.length / totalFailures.length;
```

### Unquarantined Flakes Detection
```typescript
const unquarantinedFlakes = failures.filter(f => 
  f.isFlaky && !f.isQuarantined && !quarantinedTests.includes(f.testKey)
);
```

## 🚀 Execution Methods

### Option A: GitHub CLI
```bash
gh run rerun $RUN_ID --failed
```

**Advantages:**
- ✅ Simple and reliable
- ✅ Handles authentication automatically
- ✅ Built-in error handling

**Requirements:**
- ✅ `gh` CLI must be available in runner
- ✅ `GITHUB_TOKEN` with appropriate permissions

### Option B: REST API
```typescript
POST https://api.github.com/repos/owner/repo/actions/runs/run_id/rerun-failed-jobs
Headers: {
  'Authorization': 'Bearer $GITHUB_TOKEN',
  'Accept': 'application/vnd.github.v3+json'
}
```

**Advantages:**
- ✅ Direct API control
- ✅ Better error handling and status codes
- ✅ No external CLI dependencies

**Requirements:**
- ✅ `GITHUB_TOKEN` with `actions: write` permission
- ✅ For some repos, may need PAT with `repo` scope

### Auto-Detection Logic
```typescript
// Choose method based on availability
if (method === 'auto') {
  if (token && token !== '') {
    method = 'rest';  // Use REST API if token available
  } else {
    method = 'gh';    // Fall back to gh CLI
  }
}
```

## 📊 Sample Report Output

```markdown
## ✅ FlakeGuard Auto-Rerun Report

**Timestamp:** 2025-01-10T18:30:00.000Z
**Commit SHA:** `a1b2c3d4e5f6789`
**Run ID:** 99887766
**Decision:** RERUN TRIGGERED

### 📊 Failure Analysis

| Metric | Value |
|--------|-------|
| **Flaky Coverage** | 80.0% |
| **Quarantine Coverage** | 20.0% |
| **Unquarantined Flakes** | 6 |
| **Deterministic Failures** | 2 |
| **Previous Rerun Attempts** | 0 |

### 🤔 Decision Reasoning

Flaky-dominant failures detected (80.0% flaky, threshold: 70%)

### 🔄 Rerun Execution

✅ **Rerun successfully triggered**

Successfully triggered rerun for run 99887766

### 🔒 Rerun Protection

🔓 No existing lock file for SHA `a1b2c3d4e5f6789`
```

## 🛡️ Safety Features

### 1. **Maximum Reruns Per SHA**
```typescript
private readonly maxRerunsPerSha = 1;
```
- Prevents infinite loops
- One chance per commit to retry flaky failures
- Lock file persists across workflow restarts

### 2. **Attempt Number Checking**
```typescript
if (currentAttempt > 1) {
  return { shouldRerun: false, reason: 'Already on attempt 2+' };
}
```
- GitHub Actions `run_attempt` detection
- Prevents reruns of reruns

### 3. **Threshold-Based Decisions**
```typescript
private readonly flakeDominanceThreshold = 0.7; // 70%
```
- Conservative threshold ensures real failures aren't ignored
- Balances CI stability with rerun benefits

### 4. **Graceful Error Handling**
```typescript
// Never crash the workflow on rerun failures
catch (error) {
  console.error('Rerun failed, but continuing...');
  // Log error but don't exit(1)
}
```

## 🎯 Benefits

### 1. **Reduced False Negatives**
- Flaky tests don't block legitimate code changes
- 70% threshold ensures only clearly flaky failures are rerun
- Preserves deterministic failure detection

### 2. **Improved CI Reliability**
- Reduces manual rerun burden on developers
- Consistent retry logic across all repositories
- Clear audit trail of rerun decisions

### 3. **Cost Optimization**
- Only reruns failed jobs (not entire workflow)
- Maximum 1 rerun per commit prevents waste
- Smart detection avoids unnecessary reruns

### 4. **Developer Experience**
- Transparent decision making in Action summaries
- No manual intervention required for known flakes
- Clear feedback on why reruns were/weren't triggered

## 🔧 Configuration

### CLI Options
```bash
flakeguard-auto-rerun analyze \
  --report .flakeguard/out/report.json \
  --quarantine .flakeguard/quarantine.yml \
  --sha $GITHUB_SHA \
  --run-id $GITHUB_RUN_ID \
  --repository $GITHUB_REPOSITORY \
  --attempt $GITHUB_RUN_ATTEMPT \
  --token $GITHUB_TOKEN \
  --method auto \
  --dry-run  # For testing
```

### Environment Variables
- `GITHUB_SHA` - Commit SHA for lock file naming
- `GITHUB_RUN_ID` - Run ID for rerun API calls
- `GITHUB_REPOSITORY` - Repository for REST API
- `GITHUB_RUN_ATTEMPT` - Current attempt number
- `GITHUB_TOKEN` - Authentication token
- `GITHUB_STEP_SUMMARY` - Summary output file

## 📈 Success Metrics

### Acceptance Criteria Met ✅
- ✅ **Flaky-dominant failures trigger exactly one rerun**
- ✅ **Lock mechanism prevents infinite loops**
- ✅ **Comprehensive logging to GitHub Step Summary**
- ✅ **Support for both gh CLI and REST API methods**
- ✅ **Graceful error handling with no workflow breaks**

### Test Results
| Test Case | Flaky % | Expected | Actual | Status |
|-----------|---------|----------|---------|--------|
| Flaky Dominant | 80% | RERUN | RERUN | ✅ Pass |
| Deterministic | 30% | NO RERUN | NO RERUN | ✅ Pass |
| Lock Exists | 80% | NO RERUN | NO RERUN | ✅ Pass |
| Second Attempt | 80% | NO RERUN | NO RERUN | ✅ Pass |

---

**Conclusion**: FlakeGuard Auto-Rerun Engine provides intelligent, safe, and transparent automatic reruns that improve CI reliability without introducing infinite loop risks. The dual-method approach ensures compatibility across different GitHub environments while comprehensive logging provides full audit trails. 🎉