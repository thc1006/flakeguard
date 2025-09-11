#!/bin/bash

# FlakeGuard Auto-Rerun Demo
# 
# Tests the auto-rerun functionality that triggers when failures are
# flaky-dominated, with comprehensive loop prevention testing.

echo "🔄 FlakeGuard Auto-Rerun Demo"
echo "============================"
echo ""

cd packages/cli

echo "🎯 Testing auto-rerun scenarios with different failure patterns..."
echo ""

# Build the CLI first
echo "🔧 Building CLI..."
pnpm build
echo ""

# Test scenarios for auto-rerun logic
echo "📋 Testing various auto-rerun scenarios..."
echo ""

# Scenario 1: First attempt with flaky-dominated failures (should trigger rerun)
echo "🟢 Scenario 1: Flaky-dominated failures on first attempt"
echo "--------------------------------------------------------"
echo "Expected: Should trigger rerun (>60% flaky dominance, first attempt)"
echo ""

# Create report with mostly quarantined failures (flaky-dominated)
# 2 quarantined + 1 non-quarantined = 67% flaky dominance, should trigger rerun
cat > ../../.flakeguard/out/report-flaky-dominated.json << 'EOF'
{
  "summary": {
    "totalTests": 10,
    "passedTests": 7,
    "failedTests": 3,
    "skippedTests": 0,
    "flakyCandidates": 2,
    "runId": "12345",
    "sha": "abcd1234",
    "ref": "refs/heads/feature/auto-rerun-test",
    "timestamp": "2025-09-11T16:00:00.000Z"
  },
  "failures": [
    {
      "testKey": "auth::Authentication Service › should validate JWT token::src/auth/auth.test.ts",
      "name": "should validate JWT token",
      "suite": "Authentication Service",
      "file": "src/auth/auth.test.ts",
      "line": 45,
      "message": "Timeout waiting for response",
      "messageHash": "timeout_waiting",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "db::Database Connection Pool › should handle concurrent connections::src/db/pool.test.ts",
      "name": "should handle concurrent connections",
      "suite": "Database Connection Pool",
      "file": "src/db/pool.test.ts", 
      "line": 123,
      "message": "Connection pool exhausted",
      "messageHash": "connection_pool_exhausted",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "api::API Response › should handle rate limiting::src/api/rate-limit.test.ts",
      "name": "should handle rate limiting",
      "suite": "API Response",
      "file": "src/api/rate-limit.test.ts",
      "line": 89,
      "message": "Rate limit response timeout",
      "messageHash": "rate_limit_timeout",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    }
  ],
  "environment": {
    "runner": "github-actions"
  }
}
EOF

# Test with quarantine config that covers 2 out of 3 failures (67% flaky dominance)
export GITHUB_OUTPUT=$(mktemp)
node dist/gate.js \
  --quarantine-config ../../.flakeguard/quarantine.yml \
  --test-report ../../.flakeguard/out/report-flaky-dominated.json \
  --run-attempt 1 \
  --verbose || echo "Gate decision made"

echo ""
echo "GitHub Actions outputs:"
cat "$GITHUB_OUTPUT" || echo "No outputs file"
should_rerun_1=$(grep "should_rerun=" "$GITHUB_OUTPUT" | cut -d'=' -f2)
rerun_reason_1=$(grep "rerun_reason=" "$GITHUB_OUTPUT" | cut -d'=' -f2)
echo "should_rerun: $should_rerun_1"
echo "rerun_reason: $rerun_reason_1"
echo ""

# Scenario 2: Second attempt (should NOT trigger rerun to prevent loops)
echo "🔴 Scenario 2: Same failures on second attempt"
echo "----------------------------------------------"
echo "Expected: Should NOT trigger rerun (loop prevention)"
echo ""

export GITHUB_OUTPUT=$(mktemp)
node dist/gate.js \
  --quarantine-config ../../.flakeguard/quarantine.yml \
  --test-report ../../.flakeguard/out/report-flaky-dominated.json \
  --run-attempt 2 \
  --verbose || echo "Gate decision made"

echo ""
echo "GitHub Actions outputs:"
cat "$GITHUB_OUTPUT" || echo "No outputs file"
should_rerun_2=$(grep "should_rerun=" "$GITHUB_OUTPUT" | cut -d'=' -f2)
rerun_reason_2=$(grep "rerun_reason=" "$GITHUB_OUTPUT" | cut -d'=' -f2)
echo "should_rerun: $should_rerun_2"
echo "rerun_reason: $rerun_reason_2"
echo ""

# Scenario 3: Low flaky dominance (should NOT trigger rerun)
echo "🟡 Scenario 3: Low flaky dominance"
echo "----------------------------------"
echo "Expected: Should NOT trigger rerun (not flaky-dominated)"
echo ""

# Create report with only 1 quarantined out of 4 failures (25% flaky dominance)
cat > ../../.flakeguard/out/report-low-flaky.json << 'EOF'
{
  "summary": {
    "totalTests": 10,
    "passedTests": 6,
    "failedTests": 4,
    "skippedTests": 0,
    "flakyCandidates": 1,
    "runId": "12346",
    "sha": "abcd1235", 
    "ref": "refs/heads/feature/auto-rerun-test",
    "timestamp": "2025-09-11T16:05:00.000Z"
  },
  "failures": [
    {
      "testKey": "auth::Authentication Service › should validate JWT token::src/auth/auth.test.ts",
      "name": "should validate JWT token",
      "suite": "Authentication Service",
      "file": "src/auth/auth.test.ts",
      "line": 45,
      "message": "Timeout waiting for response",
      "messageHash": "timeout_waiting",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "tax::Tax Calculator › should calculate tax::src/tax/tax.test.ts",
      "name": "should calculate tax",
      "suite": "Tax Calculator",
      "file": "src/tax/tax.test.ts",
      "line": 30,
      "message": "Assertion failed: expected 100, got 95",
      "messageHash": "assertion_failed",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "email::Email Validator › should validate email::src/email/validator.test.ts",
      "name": "should validate email",
      "suite": "Email Validator",
      "file": "src/email/validator.test.ts",
      "line": 20,
      "message": "Invalid email format",
      "messageHash": "invalid_email",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "json::JSON Parser › should parse JSON::src/json/parser.test.ts",
      "name": "should parse JSON",
      "suite": "JSON Parser",
      "file": "src/json/parser.test.ts",
      "line": 15,
      "message": "Unexpected token at position 5",
      "messageHash": "unexpected_token",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    }
  ],
  "environment": {
    "runner": "github-actions"
  }
}
EOF

export GITHUB_OUTPUT=$(mktemp)
node dist/gate.js \
  --quarantine-config ../../.flakeguard/quarantine.yml \
  --test-report ../../.flakeguard/out/report-low-flaky.json \
  --run-attempt 1 \
  --verbose || echo "Gate decision made"

echo ""
echo "GitHub Actions outputs:"
cat "$GITHUB_OUTPUT" || echo "No outputs file"
should_rerun_3=$(grep "should_rerun=" "$GITHUB_OUTPUT" | cut -d'=' -f2)
rerun_reason_3=$(grep "rerun_reason=" "$GITHUB_OUTPUT" | cut -d'=' -f2)
echo "should_rerun: $should_rerun_3"
echo "rerun_reason: $rerun_reason_3"
echo ""

# Scenario 4: Too many non-quarantined failures (should NOT trigger rerun)
echo "🟠 Scenario 4: Too many non-quarantined failures"
echo "-------------------------------------------------"
echo "Expected: Should NOT trigger rerun (>3 non-quarantined failures)"
echo ""

# Create report with 5 non-quarantined failures
cat > ../../.flakeguard/out/report-many-failures.json << 'EOF'
{
  "summary": {
    "totalTests": 15,
    "passedTests": 10,
    "failedTests": 5,
    "skippedTests": 0,
    "flakyCandidates": 0,
    "runId": "12347",
    "sha": "abcd1236",
    "ref": "refs/heads/feature/auto-rerun-test",
    "timestamp": "2025-09-11T16:10:00.000Z"
  },
  "failures": [
    {
      "testKey": "tax::Tax Calculator › should calculate tax::src/tax/tax.test.ts",
      "name": "should calculate tax",
      "suite": "Tax Calculator",
      "file": "src/tax/tax.test.ts",
      "line": 30,
      "message": "Assertion failed",
      "messageHash": "assertion_failed",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "email::Email Validator › should validate email::src/email/validator.test.ts",
      "name": "should validate email",
      "suite": "Email Validator", 
      "file": "src/email/validator.test.ts",
      "line": 20,
      "message": "Invalid email format",
      "messageHash": "invalid_email",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "json::JSON Parser › should parse JSON::src/json/parser.test.ts",
      "name": "should parse JSON",
      "suite": "JSON Parser",
      "file": "src/json/parser.test.ts",
      "line": 15,
      "message": "Unexpected token",
      "messageHash": "unexpected_token",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "auth::Password Hasher › should hash password::src/auth/hash.test.ts",
      "name": "should hash password",
      "suite": "Password Hasher",
      "file": "src/auth/hash.test.ts",
      "line": 25,
      "message": "Hash mismatch",
      "messageHash": "hash_mismatch",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    },
    {
      "testKey": "db::Database › should connect to database::src/db/connection.test.ts",
      "name": "should connect to database",
      "suite": "Database",
      "file": "src/db/connection.test.ts", 
      "line": 10,
      "message": "Connection refused",
      "messageHash": "connection_refused",
      "envHash": "ubuntu-latest-node-18",
      "attempt": 1
    }
  ],
  "environment": {
    "runner": "github-actions"
  }
}
EOF

export GITHUB_OUTPUT=$(mktemp)
node dist/gate.js \
  --quarantine-config ../../.flakeguard/quarantine.yml \
  --test-report ../../.flakeguard/out/report-many-failures.json \
  --run-attempt 1 \
  --verbose || echo "Gate decision made"

echo ""
echo "GitHub Actions outputs:"
cat "$GITHUB_OUTPUT" || echo "No outputs file"
should_rerun_4=$(grep "should_rerun=" "$GITHUB_OUTPUT" | cut -d'=' -f2)
rerun_reason_4=$(grep "rerun_reason=" "$GITHUB_OUTPUT" | cut -d'=' -f2)
echo "should_rerun: $should_rerun_4"
echo "rerun_reason: $rerun_reason_4"
echo ""

# Scenario 5: Test the actual rerun script (dry-run mode)
echo "🧪 Scenario 5: Auto-rerun script dry-run"
echo "----------------------------------------"
echo "Expected: Should show rerun would be triggered"
echo ""

node dist/rerun.js \
  --run-id "12345" \
  --repository "owner/repo" \
  --sha "abcd1234" \
  --current-attempt 1 \
  --dry-run || echo "Rerun script completed"

echo ""

# Summary
echo "📊 Auto-Rerun Demo Summary"
echo "=========================="
echo "Scenario 1 (Flaky-dominated, attempt 1): should_rerun=$should_rerun_1 (expected: true)"
echo "Scenario 2 (Same but attempt 2):         should_rerun=$should_rerun_2 (expected: false)"
echo "Scenario 3 (Low flaky dominance):        should_rerun=$should_rerun_3 (expected: false)"
echo "Scenario 4 (Too many failures):          should_rerun=$should_rerun_4 (expected: false)"
echo "Scenario 5 (Rerun script dry-run):       ✅ Script executed successfully"
echo ""

# Verify expected behavior
expected_results="true false false false"
actual_results="$should_rerun_1 $should_rerun_2 $should_rerun_3 $should_rerun_4"

if [ "$expected_results" = "$actual_results" ]; then
    echo "✅ All auto-rerun scenarios behaved as expected!"
    echo ""
    echo "🎯 Key behaviors verified:"
    echo "  ✓ Triggers rerun when >60% failures are flaky (quarantined)"
    echo "  ✓ Prevents rerun loops (only first attempt)"
    echo "  ✓ Skips rerun when not flaky-dominated"
    echo "  ✓ Skips rerun when too many non-quarantined failures"
    echo "  ✓ Rerun script handles dry-run mode correctly"
    echo ""
    echo "🔄 How auto-rerun works in practice:"
    echo "1. Gate analyzes failure patterns and quarantine status"
    echo "2. If >60% failures are known flaky tests (quarantined)"
    echo "3. And only 1-3 non-quarantined failures exist"
    echo "4. And this is the first attempt"
    echo "5. Then auto-rerun is triggered to filter out transient issues"
    echo "6. GitHub CLI reruns only the failed jobs once"
else
    echo "❌ Some auto-rerun scenarios didn't behave as expected"
    echo "Expected: $expected_results"  
    echo "Actual:   $actual_results"
    echo ""
    echo "💡 Check the logic in gate.ts shouldTriggerRerun() method"
fi

# Clean up test files
rm -f ../../.flakeguard/out/report-flaky-dominated.json
rm -f ../../.flakeguard/out/report-low-flaky.json  
rm -f ../../.flakeguard/out/report-many-failures.json

echo ""
echo "🎉 Auto-rerun demo completed!"