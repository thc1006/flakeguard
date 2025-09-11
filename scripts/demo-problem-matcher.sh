#!/bin/bash

# FlakeGuard Problem Matcher Demo Script
# 
# This script demonstrates how the problem matcher captures different
# failure formats and creates PR annotations.

echo "🧪 FlakeGuard Problem Matcher Demo"
echo "================================="
echo ""

echo "📋 Registering problem matcher..."
echo "::add-matcher::.github/matchers/flakeguard.json"
echo ""

echo "🔍 Simulating test failures from real test files..."
echo ""

# FlakeGuard custom format - will create warning annotations
echo "FLAKY src/auth/auth.test.ts:42:1 JWT token validation Test failed intermittently due to timing issues"
echo "FLAKY packages/core/retry.test.ts:15:1 Retry mechanism Flaky behavior detected in retry logic"

echo ""

# FlakeGuard failure format - will create error annotations  
echo "FAILURE src/payment/payment.test.ts:78:5 Payment timeout Network timeout connecting to payment gateway"
echo "FAILURE apps/api/health.test.ts:25:10 Health check endpoint Database connection failed"

echo ""

# Jest-style failures - multi-line pattern matching
echo "  ● Authentication Service › JWT token validation"
echo "    Expected: true"
echo "    Received: false"
echo "    at validateToken (src/auth/auth.test.ts:42:15)"

echo ""

echo "  ● Payment Processing › timeout handling"
echo "    Network timeout: Unable to connect to payment gateway"
echo "    at PaymentService.processPayment (src/payment/payment.test.ts:78:5)"

echo ""

# Vitest-style failures
echo "❯ Retry mechanism should retry failed operations packages/core/retry.test.ts:15:8"
echo "❯ Health check endpoint should detect database issues apps/api/health.test.ts:25:10"

echo ""

# Playwright-style failures
echo "  [webkit] › Authentication tests"
echo "  src/auth/auth.test.ts:42:1 JWT token validation failed"

echo ""

echo "✅ Problem matcher demo complete!"
echo "   Check the PR Files Changed tab for inline annotations."