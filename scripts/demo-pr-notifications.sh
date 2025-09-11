#!/bin/bash

# FlakeGuard PR Notifications Demo
# 
# Demonstrates consolidated PR comment generation with CODEOWNERS integration,
# TTL information, and owner pings for quarantine changes.

echo "📢 FlakeGuard PR Notifications Demo"
echo "===================================="
echo ""

cd packages/cli

# Build CLI first
echo "🔧 Building CLI..."
pnpm build
echo ""

echo "📋 Testing PR notification features..."
echo ""

# Test 1: CODEOWNERS parsing
echo "🧪 Test 1: CODEOWNERS Parsing"
echo "------------------------------"
echo "Testing owner resolution for different file paths:"
echo ""

test_files=(
  "src/auth/auth.test.ts"
  "src/payment/payment.test.ts" 
  "src/ui/button.test.ts"
  "packages/cli/src/gate.ts"
  ".github/workflows/ci.yml"
  "README.md"
)

for file in "${test_files[@]}"; do
  echo "Testing: $file"
  node dist/pr-notifier.js test-codeowners --file-path "$file" --repo-path "../.." | grep "👥 Owners:"
  echo ""
done

# Test 2: Create test scenarios with different quarantine configs
echo "🎭 Test 2: Simulating Quarantine Changes"
echo "----------------------------------------"
echo "Creating test scenarios for PR notifications..."
echo ""

# Create base quarantine config (simulating base branch)
BASE_CONFIG="../../.flakeguard/base-quarantine.yml"
cat > "$BASE_CONFIG" << 'EOF'
version: "1.0"
quarantined_tests:
  - test_key: "auth::Authentication Service › should validate JWT token::src/auth/auth.test.ts"
    reason: "Timing-dependent test that fails in CI"
    quarantined_by: "developer@example.com"
    quarantined_at: "2025-09-10T16:00:00Z"
    expires_at: "2025-09-24T16:00:00Z"
    priority: "high"
    jira_ticket: "AUTH-123"
    owner_team: "auth-team"

settings:
  default_ttl_days: 14
  max_ttl_days: 30
  notifications:
    ttl_warning_days: 3
EOF

# Create updated quarantine config (simulating PR changes)
UPDATED_CONFIG="../../.flakeguard/updated-quarantine.yml"
cat > "$UPDATED_CONFIG" << 'EOF'
version: "1.0"
quarantined_tests:
  - test_key: "auth::Authentication Service › should validate JWT token::src/auth/auth.test.ts"
    reason: "Timing-dependent test that fails in CI (updated reason)"
    quarantined_by: "developer@example.com"
    quarantined_at: "2025-09-10T16:00:00Z"
    expires_at: "2025-09-28T16:00:00Z"  # Extended TTL
    priority: "medium"  # Changed priority
    jira_ticket: "AUTH-123"
    owner_team: "auth-team"

  - test_key: "payment::Payment Processing › should handle timeout::src/payment/payment.test.ts"
    reason: "Network timeout issues with payment gateway"
    quarantined_by: "payments-dev@example.com"
    quarantined_at: "2025-09-11T10:00:00Z"
    expires_at: "2025-09-25T10:00:00Z"
    priority: "high"
    jira_ticket: "PAY-456"
    owner_team: "payments-team"

  - test_key: "ui::Button Component › should render correctly::src/ui/button.test.ts"
    reason: "DOM timing issues in headless browser"
    quarantined_by: "frontend-dev@example.com"
    quarantined_at: "2025-09-11T12:00:00Z"
    expires_at: "2025-09-18T12:00:00Z"
    priority: "medium"
    jira_ticket: "UI-789"
    owner_team: "frontend-team"

settings:
  default_ttl_days: 14
  max_ttl_days: 30
  notifications:
    ttl_warning_days: 3
EOF

echo "✅ Created test configurations:"
echo "  Base config: 1 quarantined test"
echo "  Updated config: 3 quarantined tests (1 modified, 2 added)"
echo ""

# Test 3: Generate PR comment with changes
echo "📝 Test 3: Generate PR Comment"
echo "------------------------------"
echo "Generating consolidated PR comment for changes..."
echo ""

echo "Dry run (comment preview):"
node dist/pr-notifier.js notify \
  --repo "owner/repo" \
  --pr-number 123 \
  --config "$UPDATED_CONFIG" \
  --previous-config "$BASE_CONFIG" \
  --repo-path "../.." \
  --dry-run

echo ""

# Test 4: Test with no changes
echo "🚫 Test 4: No Changes Scenario"
echo "------------------------------" 
echo "Testing behavior when there are no quarantine changes..."
echo ""

node dist/pr-notifier.js notify \
  --repo "owner/repo" \
  --pr-number 124 \
  --config "$UPDATED_CONFIG" \
  --previous-config "$UPDATED_CONFIG" \
  --repo-path "../.." \
  --dry-run

echo ""

# Test 5: Test with removal only
echo "➖ Test 5: Removal Only Scenario"
echo "--------------------------------"
echo "Testing scenario where tests are removed from quarantine..."
echo ""

# Create config with removals
REMOVAL_CONFIG="../../.flakeguard/removal-quarantine.yml"
cat > "$REMOVAL_CONFIG" << 'EOF'
version: "1.0"
quarantined_tests:
  - test_key: "auth::Authentication Service › should validate JWT token::src/auth/auth.test.ts"
    reason: "Timing-dependent test that fails in CI"
    quarantined_by: "developer@example.com"
    quarantined_at: "2025-09-10T16:00:00Z"
    expires_at: "2025-09-24T16:00:00Z"
    priority: "high"
    jira_ticket: "AUTH-123"
    owner_team: "auth-team"

settings:
  default_ttl_days: 14
  max_ttl_days: 30
  notifications:
    ttl_warning_days: 3
EOF

echo "Simulating removals (updated → removal config):"
node dist/pr-notifier.js notify \
  --repo "owner/repo" \
  --pr-number 125 \
  --config "$REMOVAL_CONFIG" \
  --previous-config "$UPDATED_CONFIG" \
  --repo-path "../.." \
  --dry-run

echo ""

# Test 6: Test different file path patterns
echo "🔍 Test 6: CODEOWNERS Pattern Matching"
echo "--------------------------------------"
echo "Testing CODEOWNERS pattern matching for various test file patterns:"
echo ""

complex_patterns=(
  "apps/api/src/auth/auth.test.ts"
  "packages/core/tests/integration/database.test.ts"
  "src/e2e/payment-flow.spec.ts"
  "tests/unit/helpers.test.js"
  "src/db/migrations/001_create_users.sql"
)

for pattern in "${complex_patterns[@]}"; do
  echo "Pattern: $pattern"
  node dist/pr-notifier.js test-codeowners --file-path "$pattern" --repo-path "../.." | grep "👥 Owners:" | sed 's/^/  /'
done

echo ""

# Summary
echo "📊 PR Notifications Demo Summary"
echo "================================"
echo "✅ Demonstrated features:"
echo "  • CODEOWNERS file parsing with pattern matching"
echo "  • Last-matching-pattern-wins rule (GitHub behavior)"
echo "  • Quarantine change detection (added/removed/modified)"
echo "  • Owner mention extraction from file paths"
echo "  • Consolidated PR comment generation"
echo "  • TTL and priority information display"
echo "  • Dry-run mode for testing"
echo ""

echo "🎯 Key Integration Points:"
echo "  • POST /repos/{owner}/{repo}/issues/{number}/comments"
echo "  • CODEOWNERS-based owner mapping"  
echo "  • Consolidated single comment per PR"
echo "  • Owner pings with @mentions"
echo "  • TTL and metadata display"
echo ""

echo "🚀 Production Usage:"
echo "  • Triggered on .flakeguard/*.yml file changes"
echo "  • Compares base branch vs PR branch configs"
echo "  • Updates existing comments vs creating new ones"
echo "  • Integrates with GitHub Actions workflows"
echo "  • Uses GITHUB_TOKEN for API access"
echo ""

echo "🔧 Required Permissions:"
echo "  • contents: read (to access CODEOWNERS)"
echo "  • pull-requests: write (to post comments)"
echo ""

# Clean up test files
rm -f "$BASE_CONFIG" "$UPDATED_CONFIG" "$REMOVAL_CONFIG"

echo "🎉 PR notifications demo completed!"