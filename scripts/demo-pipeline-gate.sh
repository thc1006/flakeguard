#!/bin/bash

# FlakeGuard Pipeline Gate Demo
# 
# Demonstrates the soft gating feature that prevents known flaky tests
# from failing the pipeline while still catching new regressions.

echo "🚪 FlakeGuard Pipeline Gate Demo"
echo "================================"
echo ""

cd packages/cli

echo "📋 Testing various gating scenarios..."
echo ""

# Scenario 1: Non-quarantined failures (should fail)
echo "🔴 Scenario 1: Non-quarantined failures"
echo "----------------------------------------"
echo "Expected: FAIL - pipeline blocked by non-quarantined tests"
echo ""

# Create minimal quarantine with only one test
cat > ../../.flakeguard/demo-quarantine-1.yml << 'EOF'
version: "1.0"
quarantined_tests:
  - test_key: "auth::Authentication Service › should validate JWT token::src/auth/auth.test.ts"
    reason: "Known flaky test"
    quarantined_at: "2025-09-10T16:00:00Z"
    expires_at: "2025-09-24T16:00:00Z"
    priority: "high"
EOF

node dist/gate.js \
  --quarantine-config ../../.flakeguard/demo-quarantine-1.yml \
  --test-report ../../.flakeguard/out/report-rich.json

gate_result_1=$?
echo "Exit code: $gate_result_1"
echo ""

# Scenario 2: All failures quarantined (should pass)
echo "🟢 Scenario 2: All failures quarantined"
echo "----------------------------------------"
echo "Expected: PASS - all failures are known and quarantined"
echo ""

node dist/gate.js \
  --quarantine-config ../../.flakeguard/quarantine.yml \
  --test-report ../../.flakeguard/out/report-rich.json

gate_result_2=$?
echo "Exit code: $gate_result_2"
echo ""

# Scenario 3: Expired quarantine (should fail)
echo "🟠 Scenario 3: Expired quarantine"
echo "----------------------------------"
echo "Expected: FAIL - quarantine TTL expired"
echo ""

node dist/gate.js \
  --quarantine-config ../../.flakeguard/quarantine-expired.yml \
  --test-report ../../.flakeguard/out/report-rich.json

gate_result_3=$?
echo "Exit code: $gate_result_3"
echo ""

# Scenario 4: All tests passing (should pass)
echo "🟢 Scenario 4: All tests passing"
echo "---------------------------------"
echo "Expected: PASS - no failures at all"
echo ""

node dist/gate.js \
  --quarantine-config ../../.flakeguard/quarantine.yml \
  --test-report ../../.flakeguard/out/report-no-failures.json

gate_result_4=$?
echo "Exit code: $gate_result_4"
echo ""

# Scenario 5: Quarantine expiring soon (should pass with warning)
echo "🟡 Scenario 5: Quarantine expiring soon"
echo "----------------------------------------"
echo "Expected: PASS - but with TTL warning"
echo ""

node dist/gate.js \
  --quarantine-config ../../.flakeguard/quarantine-expiring.yml \
  --test-report ../../.flakeguard/out/report-rich.json

gate_result_5=$?
echo "Exit code: $gate_result_5"
echo ""

# Summary
echo "📊 Demo Summary"
echo "==============="
echo "Scenario 1 (Non-quarantined): $([ $gate_result_1 -eq 0 ] && echo '🟢 PASS' || echo '🔴 FAIL') (expected: FAIL)"
echo "Scenario 2 (All quarantined): $([ $gate_result_2 -eq 0 ] && echo '🟢 PASS' || echo '🔴 FAIL') (expected: PASS)"
echo "Scenario 3 (Expired TTL):     $([ $gate_result_3 -eq 0 ] && echo '🟢 PASS' || echo '🔴 FAIL') (expected: FAIL)"
echo "Scenario 4 (All passing):     $([ $gate_result_4 -eq 0 ] && echo '🟢 PASS' || echo '🔴 FAIL') (expected: PASS)"
echo "Scenario 5 (Expiring soon):   $([ $gate_result_5 -eq 0 ] && echo '🟢 PASS' || echo '🔴 FAIL') (expected: PASS)"
echo ""

# Check if all scenarios behaved as expected
expected_results="1 0 1 0 0"  # FAIL PASS FAIL PASS PASS
actual_results="$gate_result_1 $gate_result_2 $gate_result_3 $gate_result_4 $gate_result_5"

if [ "$expected_results" = "$actual_results" ]; then
    echo "✅ All scenarios behaved as expected!"
    echo ""
    echo "🎯 How to use in your workflow:"
    echo "1. Add 'continue-on-error: true' to your test steps"
    echo "2. Add the FlakeGuard gate step after tests"
    echo "3. Quarantine known flaky tests in .flakeguard/quarantine.yml"
    echo "4. Pipeline passes only if all failures are quarantined and under TTL"
else
    echo "❌ Some scenarios didn't behave as expected"
    echo "Expected: $expected_results"
    echo "Actual:   $actual_results"
fi

# Clean up demo files
rm -f ../../.flakeguard/demo-quarantine-1.yml