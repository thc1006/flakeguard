#!/bin/bash

# FlakeGuard Quarantine Management Demo
# 
# Demonstrates comprehensive quarantine rules management including:
# - Schema validation with TTL checking
# - Adding/removing tests from quarantine  
# - PR integration for immediate updates
# - Expiration monitoring and notifications

echo "🔒 FlakeGuard Quarantine Management Demo"
echo "======================================="
echo ""

cd packages/cli

# Build CLI first
echo "🔧 Building CLI..."
pnpm build
echo ""

echo "📋 Testing quarantine management features..."
echo ""

# Test 1: Initialize a new quarantine config
echo "🆕 Test 1: Initialize new quarantine configuration"
echo "--------------------------------------------------"
echo "Creating a fresh quarantine config with defaults..."
echo ""

TEST_CONFIG="../../.flakeguard/test-quarantine.yml"
node dist/quarantine.js init "$TEST_CONFIG" --force

echo ""
echo "✅ Created new configuration. Let's validate it:"
node dist/quarantine.js validate "$TEST_CONFIG" --verbose

echo ""

# Test 2: Add a test to quarantine
echo "➕ Test 2: Add test to quarantine"
echo "---------------------------------"
echo "Adding a flaky test with detailed metadata..."
echo ""

node dist/quarantine.js add \
  "api::API Integration › should handle timeout gracefully::src/api/timeout.test.ts" \
  "Test fails intermittently due to network latency in CI environment" \
  "api-team" \
  --config "$TEST_CONFIG" \
  --ttl-days 7 \
  --priority high \
  --jira-ticket "API-234" \
  --notes "Occurs more frequently on weekends when CI load is higher"

echo ""

# Test 3: Add another test with different settings
echo "➕ Test 3: Add another test with different priority"
echo "---------------------------------------------------"
echo ""

node dist/quarantine.js add \
  "ui::Button Component › should render correctly::src/ui/button.test.ts" \
  "Flaky test due to DOM timing issues in headless browser" \
  "frontend-team" \
  --config "$TEST_CONFIG" \
  --ttl-days 14 \
  --priority medium \
  --jira-ticket "UI-567"

echo ""

# Test 4: List quarantined tests
echo "📋 Test 4: List quarantined tests"
echo "---------------------------------"
echo "Showing all quarantined tests in table format:"
echo ""

node dist/quarantine.js list --config "$TEST_CONFIG" --format table

echo ""
echo "Showing detailed summary:"
node dist/quarantine.js list --config "$TEST_CONFIG" --format summary

echo ""

# Test 5: Validate the updated configuration
echo "🔍 Test 5: Validate updated configuration"
echo "-----------------------------------------"
echo ""

node dist/quarantine.js validate "$TEST_CONFIG" --verbose

echo ""

# Test 6: Test filtering by team and priority
echo "🔍 Test 6: Test filtering capabilities"
echo "-------------------------------------"
echo "Filter by team 'api-team':"
node dist/quarantine.js list --config "$TEST_CONFIG" --team "api-team" --format table

echo ""
echo "Filter by priority 'high':"
node dist/quarantine.js list --config "$TEST_CONFIG" --priority "high" --format table

echo ""

# Test 7: Remove a test from quarantine
echo "➖ Test 7: Remove test from quarantine"
echo "--------------------------------------"
echo "Removing the UI test that was fixed..."
echo ""

node dist/quarantine.js remove \
  "ui::Button Component › should render correctly::src/ui/button.test.ts" \
  --config "$TEST_CONFIG"

echo ""
echo "Updated list after removal:"
node dist/quarantine.js list --config "$TEST_CONFIG" --format table

echo ""

# Test 8: Test expiration checking
echo "⏰ Test 8: Test expiration checking"
echo "-----------------------------------"
echo "Checking for expiring quarantines..."
echo ""

node dist/quarantine.js check-expiration --config "$TEST_CONFIG" --warning-days 30

echo ""

# Test 9: Test with expired quarantine (create a fake expired entry)
echo "🚨 Test 9: Test with expired quarantine"
echo "---------------------------------------"
echo "Creating a test with expired TTL to demonstrate expiration detection..."
echo ""

# Add a test with a past expiration date by directly editing the config
cat >> "$TEST_CONFIG" << 'EOF'
  - test_key: "legacy::Old Test › should work::src/legacy/old.test.ts"
    reason: "Legacy test with expired quarantine"
    quarantined_by: "old-dev@example.com"
    quarantined_at: "2025-08-01T10:00:00Z"
    expires_at: "2025-08-15T10:00:00Z"
    priority: "low"
    owner_team: "legacy-team"
    jira_ticket: "LEG-123"
EOF

echo "Added expired quarantine entry. Checking status:"
node dist/quarantine.js validate "$TEST_CONFIG" || echo ""

echo ""
echo "Checking expiration with expired entry:"
node dist/quarantine.js check-expiration --config "$TEST_CONFIG" || echo ""

echo ""

# Test 10: Test JSON output format
echo "📊 Test 10: Test JSON output format"
echo "-----------------------------------"
echo "Getting quarantine data in JSON format for integration:"
echo ""

node dist/quarantine.js list --config "$TEST_CONFIG" --format json | head -20
echo "..."
echo ""

# Test 11: Test invalid configurations
echo "❌ Test 11: Test schema validation with invalid data"
echo "----------------------------------------------------"
echo "Testing validation with invalid quarantine entry..."
echo ""

# Create invalid config
INVALID_CONFIG="../../.flakeguard/invalid-quarantine.yml"
cat > "$INVALID_CONFIG" << 'EOF'
version: "1.0"
quarantined_tests:
  - test_key: ""  # Invalid: empty test key
    reason: "short"  # Invalid: reason too short
    quarantined_by: "not-an-email"  # Invalid: not an email
    quarantined_at: "invalid-date"  # Invalid: not ISO date
    expires_at: "2025-01-01"  # Invalid: missing time
    priority: "super-high"  # Invalid: not in enum
    owner_team: ""  # Invalid: empty
EOF

echo "Validating invalid configuration:"
node dist/quarantine.js validate "$INVALID_CONFIG" || echo ""

echo ""

# Summary
echo "📊 Demo Summary"
echo "==============="
echo "✅ All quarantine management features tested:"
echo "  • Schema validation with comprehensive error reporting"
echo "  • TTL checking with expiration warnings"
echo "  • Adding tests with rich metadata (priority, TTL, Jira, notes)"
echo "  • Removing tests from quarantine"  
echo "  • Multiple output formats (table, summary, JSON)"
echo "  • Filtering by team, priority, and status"
echo "  • Expiration monitoring and alerts"
echo "  • Derived fields (will-expire-in-days, average TTL, etc.)"
echo ""

echo "🎯 Key Features Demonstrated:"
echo "  ✓ Immediate validation on PR additions"
echo "  ✓ Rich schema with business rule validation"
echo "  ✓ TTL enforcement with automatic expiration detection"
echo "  ✓ Team ownership and accountability tracking"
echo "  ✓ Priority-based quarantine management"
echo "  ✓ Integration-ready JSON output"
echo "  ✓ Comprehensive error handling and reporting"
echo ""

echo "🚀 Integration Points:"
echo "  • GitHub workflows can add/remove quarantines via CLI"
echo "  • PR integration creates automatic quarantine PRs"
echo "  • Expiration monitoring with issue creation"
echo "  • Slack notifications for expired quarantines"
echo "  • README status updates with quarantine metrics"
echo ""

# Clean up test files
rm -f "$TEST_CONFIG" "$INVALID_CONFIG"

echo "🎉 Quarantine management demo completed!"