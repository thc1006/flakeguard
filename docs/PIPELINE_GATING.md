# FlakeGuard Pipeline Gating

FlakeGuard implements **soft gating** to prevent known flaky tests from failing your pipeline while still catching new regressions. This allows teams to maintain green pipelines without permanently ignoring problematic tests.

## How It Works

### 1. Test Execution with `continue-on-error`
```yaml
- name: Run Tests
  continue-on-error: true  # Tests can fail without stopping workflow
  run: npm test
```

### 2. FlakeGuard Analysis
FlakeGuard ingests test results and generates a report identifying failures and flaky candidates.

### 3. Pipeline Gate Evaluation
The gate script (`packages/cli/src/gate.ts`) evaluates failures against quarantine configuration:

- **✅ PASS**: All failures are quarantined and within TTL
- **❌ FAIL**: Any non-quarantined or expired failures exist

### 4. Final Pipeline Status
The gate's exit code (0 = pass, 1 = fail) determines the overall workflow status.

## Quarantine Configuration

Tests are quarantined using `.flakeguard/quarantine.yml`:

```yaml
version: "1.0"

quarantined_tests:
  - test_key: "auth::JWT validation::src/auth/auth.test.ts"
    reason: "Timing-dependent behavior in CI environment"
    quarantined_by: "developer@example.com"
    quarantined_at: "2025-09-10T16:00:00Z"
    expires_at: "2025-09-24T16:00:00Z"  # TTL: 2 weeks
    priority: "high"
    jira_ticket: "FLAKE-123"
    owner_team: "auth-team"

settings:
  default_ttl_days: 14
  max_ttl_days: 30
  notifications:
    ttl_warning_days: 3
```

## Gate Decision Logic

The gate evaluates each test failure:

| Scenario | Gate Decision | Exit Code |
|----------|---------------|-----------|
| ✅ No failures | Pass | 0 |
| ✅ All failures quarantined & valid | Pass | 0 |
| ❌ Any non-quarantined failures | Fail | 1 |
| ❌ Any expired quarantines | Fail | 1 |
| ⚠️ Expiring soon (but valid) | Pass with warning | 0 |

## Workflow Integration

### Complete Example

```yaml
name: CI with FlakeGuard Gating

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Run tests with continue-on-error
      - name: Run Tests
        continue-on-error: true
        id: tests
        run: npm test -- --reporter=junit --outputFile=test-results.xml
      
      # FlakeGuard ingestion
      - name: FlakeGuard Analysis
        if: always()
        run: |
          pnpm --filter @flakeguard/cli exec tsx src/ingest.ts \
            --artifacts-dir ./test-results \
            --output .flakeguard/out/report.json \
            --state-file .flakeguard/state.json \
            --run-id ${{ github.run_id }} \
            --sha ${{ github.sha }} \
            --ref ${{ github.ref }}
      
      # Pipeline gate (determines final status)
      - name: Pipeline Gate
        if: always()
        run: |
          pnpm --filter @flakeguard/cli exec tsx src/gate.ts \
            --quarantine-config .flakeguard/quarantine.yml \
            --test-report .flakeguard/out/report.json
```

## Gate Output Examples

### ✅ Passing Gate (All Quarantined)
```
🚪 Gate Decision
================

✅ 2 quarantined test(s) failed but pipeline approved

📊 Test Failure Breakdown
Total failures: 2
├─ Quarantined: 2 (allowed)
├─ Non-quarantined: 0 (none)
└─ Expired quarantines: 0 (none)

🎉 Pipeline gate: PASS
```

### ❌ Failing Gate (Non-Quarantined)
```
🚪 Gate Decision
================

❌ Pipeline blocked by 1 non-quarantined failure(s)

📊 Test Failure Breakdown  
Total failures: 2
├─ Quarantined: 1 (allowed)
├─ Non-quarantined: 1 (blocking)
└─ Expired quarantines: 0 (none)

❌ Non-quarantined failures (blocking):
  • Payment timeout test

🎯 Next Steps
To unblock the pipeline:
1. Fix the 1 non-quarantined test failure(s)
   OR quarantine them temporarily if they are flaky

🚫 Pipeline gate: FAIL
```

## Benefits

### 🟢 **Advantages**
- **Faster feedback**: No waiting for flaky test retries
- **Stable pipelines**: Known flakes don't block deployments  
- **Forced ownership**: TTL expiration ensures tests get fixed
- **New regression detection**: Non-quarantined failures still block
- **Visibility**: Clear reporting of what's quarantined vs real issues

### 🔄 **Compared to Alternatives**

| Approach | Pros | Cons |
|----------|------|------|
| **Retry on failure** | Simple | Slow, hides real regressions |
| **Skip flaky tests** | Fast | Permanent ignoring, no ownership |
| **FlakeGuard gating** | Fast + accountability | Requires quarantine management |

## Best Practices

### 1. **Quarantine Lifecycle**
- Start with short TTL (7-14 days)
- Include JIRA ticket for tracking
- Assign to specific team/owner
- Review expiring quarantines weekly

### 2. **TTL Management**
```yaml
# Good: Short TTL with accountability
expires_at: "2025-09-24T16:00:00Z"  # 2 weeks
jira_ticket: "FLAKE-123"
owner_team: "auth-team"

# Bad: Long TTL without ownership  
expires_at: "2026-01-01T00:00:00Z"  # 4 months
reason: "sometimes fails"
```

### 3. **Monitoring**
- Set up alerts for expiring quarantines
- Track quarantine success rate
- Monitor for abuse (too many quarantines)

## Command Reference

### Gate Script
```bash
# Basic usage
pnpm --filter @flakeguard/cli exec tsx src/gate.ts \
  --quarantine-config .flakeguard/quarantine.yml \
  --test-report .flakeguard/out/report.json

# With verbose output  
pnpm --filter @flakeguard/cli exec tsx src/gate.ts \
  --quarantine-config .flakeguard/quarantine.yml \
  --test-report .flakeguard/out/report.json \
  --verbose
```

### Exit Codes
- **0**: Pipeline should pass (all failures quarantined or none)
- **1**: Pipeline should fail (non-quarantined or expired failures)

## Troubleshooting

### Pipeline Unexpectedly Failing
1. Check gate output for non-quarantined failures
2. Verify test keys match quarantine config exactly
3. Check for expired TTLs

### Pipeline Unexpectedly Passing
1. Verify gate step is running after test failures
2. Check that `continue-on-error: true` is set on test steps
3. Ensure test report contains expected failures

### Quarantine Not Working
1. Verify test key format: `suite::name::file`
2. Check TTL is in future: `expires_at > now`
3. Validate YAML syntax

The pipeline gate provides a balanced approach to handling flaky tests - preventing them from blocking progress while ensuring they don't get permanently ignored.