#!/bin/bash

# FlakeGuard Implementation Verification Script
# This script verifies all components of the FlakeGuard implementation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNINGS=0

# Function to print colored output
print_status() {
    if [ "$1" = "PASS" ]; then
        echo -e "${GREEN}✓${NC} $2"
        ((PASSED_CHECKS++))
    elif [ "$1" = "FAIL" ]; then
        echo -e "${RED}✗${NC} $2"
        ((FAILED_CHECKS++))
    elif [ "$1" = "WARN" ]; then
        echo -e "${YELLOW}⚠${NC} $2"
        ((WARNINGS++))
    else
        echo "$2"
    fi
    ((TOTAL_CHECKS++))
}

# Function to check if file exists
check_file() {
    if [ -f "$1" ]; then
        print_status "PASS" "File exists: $1"
        return 0
    else
        print_status "FAIL" "File missing: $1"
        return 1
    fi
}

# Function to check if directory exists
check_dir() {
    if [ -d "$1" ]; then
        print_status "PASS" "Directory exists: $1"
        return 0
    else
        print_status "FAIL" "Directory missing: $1"
        return 1
    fi
}

echo "================================================"
echo "FlakeGuard Implementation Verification Script"
echo "================================================"
echo ""

# Check Node.js version
echo "=== Environment Checks ==="
NODE_VERSION=$(node --version 2>/dev/null || echo "not installed")
if [[ $NODE_VERSION == v20* ]] || [[ $NODE_VERSION == v21* ]] || [[ $NODE_VERSION == v22* ]]; then
    print_status "PASS" "Node.js version: $NODE_VERSION"
else
    print_status "WARN" "Node.js version: $NODE_VERSION (recommended: v20+)"
fi

# Check pnpm
if command -v pnpm &> /dev/null; then
    PNPM_VERSION=$(pnpm --version)
    print_status "PASS" "pnpm installed: v$PNPM_VERSION"
else
    print_status "FAIL" "pnpm not installed"
fi

echo ""
echo "=== Core Configuration Files ==="
check_file "package.json"
check_file "pnpm-workspace.yaml"
check_file "tsconfig.json"
check_file ".gitignore"
check_file ".env.example"
check_file "LICENSE"
check_file "README.md"
check_file "CHANGELOG.md"

echo ""
echo "=== Project Structure ==="
check_dir "apps"
check_dir "apps/api"
check_dir "apps/worker"
check_dir "apps/web"
check_dir "apps/docs"
check_dir "packages"
check_dir "packages/shared"
check_dir "packages/cli"

echo ""
echo "=== API Application Files ==="
check_file "apps/api/package.json"
check_file "apps/api/tsconfig.json"
check_file "apps/api/Dockerfile"
check_dir "apps/api/src"
check_dir "apps/api/prisma"
check_file "apps/api/prisma/schema.prisma"

echo ""
echo "=== Worker Application Files ==="
check_file "apps/worker/package.json"
check_file "apps/worker/tsconfig.json"
check_file "apps/worker/Dockerfile"
check_dir "apps/worker/src"
check_dir "apps/worker/src/processors"

echo ""
echo "=== Web Application Files ==="
check_file "apps/web/package.json"
check_file "apps/web/tsconfig.json"
check_file "apps/web/next.config.js"
check_dir "apps/web/src"
check_dir "apps/web/messages"

echo ""
echo "=== Documentation Site ==="
check_file "apps/docs/package.json"
check_file "apps/docs/docusaurus.config.ts"
check_dir "apps/docs/docs"
check_dir "apps/docs/i18n"

echo ""
echo "=== Docker Configuration ==="
check_file "docker-compose.yml"
check_file "docker-compose.dev.yml"
check_file "docker-compose.prod.yml"
check_file "docker-compose.test.yml"
check_file "docker-compose.monitoring.yml"

echo ""
echo "=== CI/CD Workflows ==="
check_dir ".github"
check_dir ".github/workflows"
check_file ".github/workflows/ci.yml"
check_file ".github/workflows/release.yml"
check_file ".github/workflows/docker.yml"
check_file ".github/workflows/security.yml"

echo ""
echo "=== Monitoring Configuration ==="
check_dir "monitoring"
check_file "monitoring/prometheus.yml"
check_file "monitoring/alertmanager.yml"
check_file "monitoring/slo-definitions.yaml"
check_dir "monitoring/grafana"

echo ""
echo "=== Security Files ==="
check_file "SECURITY.md"
check_file "THREAT_MODEL.md"
check_file "CODE_OF_CONDUCT.md"
check_file "CONTRIBUTING.md"
check_file "SUPPORT.md"

echo ""
echo "=== P0-P7: Core Implementation ==="
# P0: Project Scaffolding
check_file "apps/api/src/app.ts"
check_file "apps/api/src/server.ts"

# P1: GitHub App
check_file "apps/api/src/routes/github-webhook.ts"
check_file "apps/api/src/github/auth.ts"

# P2: Artifact Service
check_file "packages/shared/src/github/artifact-handler.ts"

# P3: JUnit Parser
check_file "apps/api/src/ingestion/junit-parser.ts"
check_dir "apps/api/src/__tests__/fixtures/junit"

# P4: Check Runs
check_file "apps/api/src/github/check-runs.ts"
check_file "apps/api/src/github/check-run-renderer.ts"

# P5: Action Handlers
check_file "apps/api/src/github/action-handlers.ts"

# P6: Slack Integration
check_file "apps/api/src/slack/app.ts"
check_file "apps/api/slack-app-manifest.yaml"

# P7: Worker Architecture
check_file "apps/worker/src/index.ts"

echo ""
echo "=== P8-P14: Data & Policy ==="
# P8: Data Model
check_dir "apps/api/prisma/migrations"

# P9: Policy Engine
check_file "apps/api/src/policy/engine.ts"
check_file "apps/api/src/policy/service.ts"

# P10: Web Dashboard
check_dir "apps/web/src/components"
check_dir "apps/web/src/app"

# P11: Observability
check_file "apps/api/src/utils/metrics.ts"

# P12: Security
check_file "apps/api/src/plugins/security.ts"

# P13: Tests
check_dir "apps/api/src/__tests__"
check_file "apps/api/vitest.config.ts"

echo ""
echo "=== P15-P20: Advanced Features ==="
# P16: Setup Wizard
check_file "packages/cli/src/wizard/SetupWizard.ts"

# P18: Rate Limiting
check_file "packages/shared/src/github/rate-limiter.ts"
check_file "packages/shared/src/github/circuit-breaker.ts"

# P19: Multi-tenant
check_file "apps/api/src/services/tenant-management.ts"

# P20: Documentation
check_dir "apps/docs/docs/api"
check_dir "apps/docs/docs/architecture"

echo ""
echo "=== Bilingual Support ==="
check_file "apps/web/messages/en.json"
check_file "apps/web/messages/zh-TW.json"
check_dir "apps/docs/i18n/zh-TW"
check_file "SECURITY_CONFIGURATION.zh-TW.md"

echo ""
echo "================================================"
echo "Verification Summary"
echo "================================================"
echo "Total Checks: $TOTAL_CHECKS"
echo -e "${GREEN}Passed: $PASSED_CHECKS${NC}"
echo -e "${RED}Failed: $FAILED_CHECKS${NC}"
echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
echo ""

if [ $FAILED_CHECKS -eq 0 ]; then
    echo -e "${GREEN}✓ All critical components verified successfully!${NC}"
    echo ""
    echo "Next Steps:"
    echo "1. Run: pnpm install"
    echo "2. Copy .env.example to .env and configure"
    echo "3. Run: docker-compose up -d postgres redis"
    echo "4. Run: cd apps/api && pnpm prisma migrate deploy"
    echo "5. Start services: pnpm dev"
    exit 0
else
    echo -e "${RED}✗ Some components are missing or incomplete.${NC}"
    echo "Please review the failed checks above."
    exit 1
fi
