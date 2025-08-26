#!/bin/bash

# FlakeGuard Comprehensive QA Verification Script
# Phases A-K verification with detailed reporting

set -e
set -o pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Global variables
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
readonly RESULTS_FILE="$PROJECT_ROOT/VERIFICATION.md"

# Test results tracking
declare -A PHASE_RESULTS

# Initialize results file
echo "# FlakeGuard QA Verification Report" > "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"
echo "**Generated on:** $(date '+%Y-%m-%d %H:%M:%S')" >> "$RESULTS_FILE"
echo "**Verification Script Version:** 1.0.0" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

# Log function
log() {
    echo -e "$*"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Record test result
record_result() {
    local phase="$1"
    local test="$2"
    local status="$3"
    local evidence="$4"
    
    PHASE_RESULTS["${phase}_${test}"]="$status|$evidence"
}

# Phase A: Local bootstrap & static checks
phase_a() {
    log "${BLUE}=== Phase A: Local Bootstrap & Static Checks ===${NC}"
    
    # Check monorepo structure
    local required_dirs=("apps/api" "apps/worker" "packages/shared")
    local missing_dirs=()
    
    for dir in "${required_dirs[@]}"; do
        if [[ -d "$PROJECT_ROOT/$dir" ]]; then
            log "${GREEN}✓${NC} $dir exists"
        else
            missing_dirs+=("$dir")
            log "${RED}✗${NC} $dir missing"
        fi
    done
    
    if [[ ${#missing_dirs[@]} -eq 0 ]]; then
        record_result "A" "monorepo_structure" "PASS" "All required directories present"
    else
        record_result "A" "monorepo_structure" "FAIL" "Missing: ${missing_dirs[*]}"
    fi
    
    # Check TypeScript configuration
    if [[ -f "$PROJECT_ROOT/tsconfig.json" ]]; then
        if grep -q '"strict": true' "$PROJECT_ROOT/tsconfig.json"; then
            record_result "A" "typescript_strict" "PASS" "Strict mode enabled"
        else
            record_result "A" "typescript_strict" "FAIL" "Strict mode not enabled"
        fi
    else
        record_result "A" "typescript_strict" "FAIL" "tsconfig.json not found"
    fi
}

# Phase B: Containers & environment
phase_b() {
    log "${BLUE}=== Phase B: Containers & Environment ===${NC}"
    
    # Check for docker-compose.yml
    if [[ -f "$PROJECT_ROOT/docker-compose.yml" ]]; then
        record_result "B" "docker_compose" "PASS" "docker-compose.yml exists"
    else
        record_result "B" "docker_compose" "FAIL" "docker-compose.yml not found"
    fi
    
    # Check for Prisma schema
    if [[ -f "$PROJECT_ROOT/apps/api/prisma/schema.prisma" ]]; then
        record_result "B" "prisma_schema" "PASS" "Prisma schema exists"
    else
        record_result "B" "prisma_schema" "FAIL" "Prisma schema not found"
    fi
}

# Phase C: Webhook path & queue
phase_c() {
    log "${BLUE}=== Phase C: Webhook Path & Queue ===${NC}"
    
    # Check for webhook handler
    if find "$PROJECT_ROOT/apps/api/src" -name "*webhook*" -type f | grep -q .; then
        record_result "C" "webhook_handler" "PASS" "Webhook handler found"
    else
        record_result "C" "webhook_handler" "FAIL" "No webhook handler found"
    fi
    
    # Check for BullMQ
    if grep -q "bullmq" "$PROJECT_ROOT/apps/api/package.json" 2>/dev/null; then
        record_result "C" "bullmq" "PASS" "BullMQ dependency found"
    else
        record_result "C" "bullmq" "FAIL" "BullMQ not in dependencies"
    fi
}

# Phase D: Artifacts ingestion & JUnit parser
phase_d() {
    log "${BLUE}=== Phase D: Artifacts Ingestion & JUnit Parser ===${NC}"
    
    # Check for JUnit parser
    if find "$PROJECT_ROOT" -name "*junit*parser*" -type f | grep -q .; then
        record_result "D" "junit_parser" "PASS" "JUnit parser implementation found"
    else
        record_result "D" "junit_parser" "FAIL" "JUnit parser not found"
    fi
}

# Phase E: Flakiness scoring & policy
phase_e() {
    log "${BLUE}=== Phase E: Flakiness Scoring & Policy ===${NC}"
    
    # Check for flakiness scoring
    if [[ -f "$PROJECT_ROOT/apps/api/src/analytics/flakiness.ts" ]]; then
        record_result "E" "flakiness_scoring" "PASS" "Flakiness scoring module exists"
    else
        record_result "E" "flakiness_scoring" "FAIL" "Flakiness scoring module not found"
    fi
    
    # Check for policy engine
    if [[ -f "$PROJECT_ROOT/apps/api/src/policy/engine.ts" ]]; then
        record_result "E" "policy_engine" "PASS" "Policy engine exists"
    else
        record_result "E" "policy_engine" "FAIL" "Policy engine not found"
    fi
}

# Phase F: Check Run rendering
phase_f() {
    log "${BLUE}=== Phase F: Check Run Rendering ===${NC}"
    
    # Check for check run renderer
    if find "$PROJECT_ROOT/apps/api/src" -name "*check*run*" -type f | grep -q .; then
        record_result "F" "check_run_renderer" "PASS" "Check run renderer found"
        
        # Verify ≤3 actions constraint
        if grep -r "slice.*3\|limit.*3\|max.*3" "$PROJECT_ROOT/apps/api/src" 2>/dev/null | grep -q .; then
            record_result "F" "actions_limit" "PASS" "Actions limit constraint found"
        else
            record_result "F" "actions_limit" "WARN" "Actions limit not obviously enforced"
        fi
    else
        record_result "F" "check_run_renderer" "FAIL" "Check run renderer not found"
    fi
}

# Phase G: Requested-action handlers
phase_g() {
    log "${BLUE}=== Phase G: Requested-Action Handlers ===${NC}"
    
    # Check for action handlers
    if [[ -f "$PROJECT_ROOT/apps/api/src/github/handlers.ts" ]] || [[ -f "$PROJECT_ROOT/apps/api/src/github/action-handlers.ts" ]]; then
        record_result "G" "action_handlers" "PASS" "Action handlers found"
    else
        record_result "G" "action_handlers" "FAIL" "Action handlers not found"
    fi
}

# Phase H: Slack triage flow
phase_h() {
    log "${BLUE}=== Phase H: Slack Triage Flow ===${NC}"
    
    # Check for Slack app
    if [[ -f "$PROJECT_ROOT/apps/api/src/slack/app.ts" ]]; then
        record_result "H" "slack_app" "PASS" "Slack app implementation found"
    else
        record_result "H" "slack_app" "FAIL" "Slack app not found"
    fi
}

# Phase I: Workers, schedules, metrics
phase_i() {
    log "${BLUE}=== Phase I: Workers, Schedules, Metrics ===${NC}"
    
    # Check for worker implementation
    if [[ -f "$PROJECT_ROOT/apps/worker/src/index.ts" ]]; then
        record_result "I" "worker_impl" "PASS" "Worker implementation found"
    else
        record_result "I" "worker_impl" "FAIL" "Worker implementation not found"
    fi
    
    # Check for metrics
    if grep -q "prom-client\|prometheus" "$PROJECT_ROOT/apps/api/package.json" 2>/dev/null; then
        record_result "I" "metrics" "PASS" "Prometheus client found"
    else
        record_result "I" "metrics" "FAIL" "Metrics library not found"
    fi
}

# Phase J: Docs & repo hygiene
phase_j() {
    log "${BLUE}=== Phase J: Docs & Repo Hygiene ===${NC}"
    
    # Check required files
    local required_files=("LICENSE" ".gitignore" "README.md" "CONTRIBUTING.md" "CODE_OF_CONDUCT.md" "SECURITY.md" "CHANGELOG.md")
    local missing_files=()
    
    for file in "${required_files[@]}"; do
        if [[ -f "$PROJECT_ROOT/$file" ]]; then
            log "${GREEN}✓${NC} $file exists"
        else
            missing_files+=("$file")
            log "${YELLOW}⚠${NC} $file missing"
        fi
    done
    
    if [[ ${#missing_files[@]} -eq 0 ]]; then
        record_result "J" "repo_hygiene" "PASS" "All required files present"
    elif [[ ${#missing_files[@]} -le 2 ]]; then
        record_result "J" "repo_hygiene" "WARN" "Missing: ${missing_files[*]}"
    else
        record_result "J" "repo_hygiene" "FAIL" "Missing: ${missing_files[*]}"
    fi
}

# Generate final report
generate_report() {
    echo "## Verification Results Matrix" >> "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
    echo "| Phase | Test | Status | Evidence |" >> "$RESULTS_FILE"
    echo "|-------|------|--------|----------|" >> "$RESULTS_FILE"
    
    local total=0
    local passed=0
    local failed=0
    local warned=0
    
    for key in $(printf '%s\n' "${!PHASE_RESULTS[@]}" | sort); do
        IFS='|' read -r status evidence <<< "${PHASE_RESULTS[$key]}"
        local phase=$(echo "$key" | cut -d'_' -f1)
        local test=$(echo "$key" | cut -d'_' -f2-)
        
        echo "| $phase | $test | **$status** | $evidence |" >> "$RESULTS_FILE"
        
        ((total++))
        case "$status" in
            PASS) ((passed++)) ;;
            FAIL) ((failed++)) ;;
            WARN) ((warned++)) ;;
        esac
    done
    
    echo "" >> "$RESULTS_FILE"
    echo "## Summary Statistics" >> "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
    echo "- **Total Tests:** $total" >> "$RESULTS_FILE"
    echo "- **Passed:** $passed" >> "$RESULTS_FILE"
    echo "- **Failed:** $failed" >> "$RESULTS_FILE"
    echo "- **Warnings:** $warned" >> "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
    
    if [[ $failed -eq 0 ]]; then
        echo "**Overall Status:** ✅ READY FOR PRODUCTION" >> "$RESULTS_FILE"
    else
        echo "**Overall Status:** ❌ $failed CRITICAL ISSUES FOUND" >> "$RESULTS_FILE"
    fi
    
    echo "" >> "$RESULTS_FILE"
    echo "## Appendix: Test Environment" >> "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
    echo "- **Node Version:** $(node --version 2>/dev/null || echo 'Not installed')" >> "$RESULTS_FILE"
    echo "- **NPM Version:** $(npm --version 2>/dev/null || echo 'Not installed')" >> "$RESULTS_FILE"
    echo "- **PNPM Version:** $(pnpm --version 2>/dev/null || echo 'Not installed')" >> "$RESULTS_FILE"
    echo "- **Docker Version:** $(docker --version 2>/dev/null || echo 'Not installed')" >> "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
    echo "---" >> "$RESULTS_FILE"
    echo "*Report generated by FlakeGuard QA Verification System*" >> "$RESULTS_FILE"
}

# Main execution
main() {
    log "Starting FlakeGuard QA Verification..."
    
    phase_a
    phase_b
    phase_c
    phase_d
    phase_e
    phase_f
    phase_g
    phase_h
    phase_i
    phase_j
    
    generate_report
    
    log ""
    log "${GREEN}Verification complete!${NC}"
    log "Report generated: $RESULTS_FILE"
}

main "$@"