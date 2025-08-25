#!/bin/bash

# Comprehensive Security Testing Script for FlakeGuard
# Performs automated security testing and validation

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="http://localhost:3000"
TEST_TIMEOUT=30
SECURITY_REPORT_DIR="./security-reports"
DATE=$(date +%Y%m%d_%H%M%S)

# Create security reports directory
mkdir -p "$SECURITY_REPORT_DIR"

echo -e "${BLUE}🔐 FlakeGuard Security Test Suite${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

log() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

# Test results tracking
TEST_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    ((TEST_COUNT++))
    echo ""
    log "Running: $test_name"
    
    if eval "$test_command"; then
        success "$test_name"
        ((PASS_COUNT++))
        return 0
    else
        error "$test_name"
        ((FAIL_COUNT++))
        return 1
    fi
}

# =============================================================================
# DEPENDENCY SECURITY TESTS
# =============================================================================

test_npm_audit() {
    npm audit --audit-level=high --json > "$SECURITY_REPORT_DIR/npm_audit_$DATE.json" 2>&1
    local vulnerabilities=$(jq '.metadata.vulnerabilities.high + .metadata.vulnerabilities.critical' "$SECURITY_REPORT_DIR/npm_audit_$DATE.json" 2>/dev/null || echo "0")
    
    if [ "$vulnerabilities" -eq 0 ]; then
        return 0
    else
        error "Found $vulnerabilities high/critical vulnerabilities"
        return 1
    fi
}

test_outdated_packages() {
    local outdated_count=$(npm outdated --json 2>/dev/null | jq 'length' 2>/dev/null || echo "0")
    
    if [ "$outdated_count" -le 5 ]; then
        return 0
    else
        warning "$outdated_count packages are outdated"
        return 1
    fi
}

test_license_compliance() {
    # Check for licenses that might be problematic
    local problematic_licenses=$(npx license-checker --json 2>/dev/null | jq -r 'to_entries[] | select(.value.licenses | test("GPL|AGPL|LGPL"; "i")) | .key' | wc -l)
    
    if [ "$problematic_licenses" -eq 0 ]; then
        return 0
    else
        warning "Found $problematic_licenses packages with potentially problematic licenses"
        return 1
    fi
}

# =============================================================================
# SECRETS AND CONFIGURATION TESTS
# =============================================================================

test_secret_in_code() {
    # Check for hardcoded secrets in source code
    local secret_patterns="(password|secret|key|token)\s*[:=]\s*['\"][^'\"]*['\"]" 
    local matches=$(find . -name "*.ts" -o -name "*.js" -o -name "*.json" | 
                    grep -v node_modules | 
                    xargs grep -i -E "$secret_patterns" | 
                    grep -v -E "(test|spec|mock)" | 
                    wc -l)
    
    if [ "$matches" -eq 0 ]; then
        return 0
    else
        error "Found $matches potential hardcoded secrets"
        return 1
    fi
}

test_env_file_security() {
    # Check if .env files have proper permissions
    if [ -f ".env" ]; then
        local permissions=$(stat -f "%A" .env 2>/dev/null || stat -c "%a" .env 2>/dev/null)
        if [ "$permissions" = "600" ] || [ "$permissions" = "640" ]; then
            return 0
        else
            error ".env file has insecure permissions: $permissions"
            return 1
        fi
    fi
    return 0
}

test_docker_secrets() {
    # Check if Docker secrets directory exists and has proper permissions
    if [ -d "./secrets" ]; then
        local permissions=$(stat -f "%A" ./secrets 2>/dev/null || stat -c "%a" ./secrets 2>/dev/null)
        if [ "$permissions" = "700" ] || [ "$permissions" = "750" ]; then
            return 0
        else
            warning "Secrets directory has insecure permissions: $permissions"
            return 1
        fi
    fi
    return 0
}

# =============================================================================
# API SECURITY TESTS
# =============================================================================

test_health_endpoint() {
    local response=$(curl -s -w "\n%{http_code}" "$BASE_URL/health" | tail -1)
    [ "$response" = "200" ]
}

test_security_headers() {
    local headers=$(curl -s -I "$BASE_URL/health" 2>/dev/null)
    
    # Check for required security headers
    echo "$headers" | grep -i "x-content-type-options: nosniff" > /dev/null &&
    echo "$headers" | grep -i "x-frame-options: deny" > /dev/null &&
    echo "$headers" | grep -i "x-xss-protection: 1; mode=block" > /dev/null &&
    echo "$headers" | grep -i "content-security-policy:" > /dev/null
}

test_cors_configuration() {
    # Test CORS preflight request
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Origin: https://evil.example.com" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        -X OPTIONS "$BASE_URL/api/users" 2>/dev/null)
    
    # Should not allow arbitrary origins
    [ "$response" != "200" ]
}

test_rate_limiting() {
    local success_count=0
    local rate_limited_count=0
    
    # Make rapid requests to test rate limiting
    for i in {1..20}; do
        local response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" 2>/dev/null)
        if [ "$response" = "200" ]; then
            ((success_count++))
        elif [ "$response" = "429" ]; then
            ((rate_limited_count++))
        fi
    done
    
    # Should have some rate limiting after many requests
    [ "$rate_limited_count" -gt 0 ] || [ "$success_count" -lt 20 ]
}

test_api_without_auth() {
    # Test API endpoints without authentication
    local response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/users" 2>/dev/null)
    
    # Should require authentication
    [ "$response" = "401" ] || [ "$response" = "403" ]
}

test_csrf_protection() {
    # Test POST request without CSRF token
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{"test": "data"}' \
        "$BASE_URL/api/dashboard/test" 2>/dev/null)
    
    # Should reject requests without CSRF token
    [ "$response" = "403" ] || [ "$response" = "404" ]
}

# =============================================================================
# WEBHOOK SECURITY TESTS
# =============================================================================

test_github_webhook_without_signature() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: push" \
        -H "X-GitHub-Delivery: test-delivery" \
        -d '{"test": "payload"}' \
        "$BASE_URL/api/github/webhook" 2>/dev/null)
    
    # Should reject webhooks without proper signature
    [ "$response" = "401" ] || [ "$response" = "400" ]
}

test_github_webhook_invalid_signature() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "X-GitHub-Event: push" \
        -H "X-GitHub-Delivery: test-delivery" \
        -H "X-Hub-Signature-256: sha256=invalid-signature" \
        -d '{"test": "payload"}' \
        "$BASE_URL/api/github/webhook" 2>/dev/null)
    
    # Should reject webhooks with invalid signature
    [ "$response" = "401" ] || [ "$response" = "400" ]
}

test_large_payload_rejection() {
    # Test very large payload (potential DoS)
    local large_payload=$(python3 -c "print('x' * 10000000)")  # 10MB payload
    local response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$large_payload" \
        "$BASE_URL/api/ingestion/junit" 2>/dev/null)
    
    # Should reject very large payloads
    [ "$response" = "413" ] || [ "$response" = "400" ]
}

# =============================================================================
# INPUT VALIDATION TESTS
# =============================================================================

test_sql_injection_protection() {
    # Test SQL injection patterns
    local sql_payloads=(
        "'; DROP TABLE users; --"
        "1' OR '1'='1"
        "'; INSERT INTO users VALUES ('hacker'); --"
    )
    
    for payload in "${sql_payloads[@]}"; do
        local response=$(curl -s -o /dev/null -w "%{http_code}" \
            -X GET \
            "$BASE_URL/api/users?search=$payload" 2>/dev/null)
        
        # Should not return 200 for SQL injection attempts
        if [ "$response" = "200" ]; then
            error "SQL injection payload not blocked: $payload"
            return 1
        fi
    done
    
    return 0
}

test_xss_protection() {
    # Test XSS payloads
    local xss_payloads=(
        "<script>alert('xss')</script>"
        "javascript:alert('xss')"
        "<img src=x onerror=alert('xss')>"
    )
    
    for payload in "${xss_payloads[@]}"; do
        local response=$(curl -s "$BASE_URL/health" -H "User-Agent: $payload" 2>/dev/null)
        
        # Response should not contain unescaped payload
        if echo "$response" | grep -F "$payload" > /dev/null; then
            error "XSS payload not properly escaped: $payload"
            return 1
        fi
    done
    
    return 0
}

test_path_traversal_protection() {
    # Test path traversal attempts
    local traversal_payloads=(
        "../../../etc/passwd"
        "..\\..\\..\\windows\\system32\\config\\sam"
        "%2e%2e%2f%2e%2e%2f%2e%2e%2f%65%74%63%2f%70%61%73%73%77%64"
    )
    
    for payload in "${traversal_payloads[@]}"; do
        local response=$(curl -s -o /dev/null -w "%{http_code}" \
            "$BASE_URL/static/$payload" 2>/dev/null)
        
        # Should not allow path traversal
        if [ "$response" = "200" ]; then
            error "Path traversal not blocked: $payload"
            return 1
        fi
    done
    
    return 0
}

# =============================================================================
# DOCKER SECURITY TESTS
# =============================================================================

test_docker_image_vulnerabilities() {
    if command -v docker &> /dev/null; then
        # Check if Docker images have known vulnerabilities
        local exit_code=0
        
        # Test API image if it exists
        if docker images | grep -q "flakeguard/api"; then
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
                aquasec/trivy image --exit-code 1 --severity HIGH,CRITICAL \
                flakeguard/api:latest > "$SECURITY_REPORT_DIR/docker_scan_api_$DATE.txt" 2>&1 || exit_code=1
        fi
        
        return $exit_code
    else
        warning "Docker not available, skipping container security scan"
        return 0
    fi
}

test_docker_secrets_mount() {
    if [ -f "docker-compose.security.yml" ]; then
        # Check if Docker Compose uses proper secrets
        if grep -q "secrets:" docker-compose.security.yml && 
           grep -q "file:" docker-compose.security.yml; then
            return 0
        else
            error "Docker Compose does not use proper secrets configuration"
            return 1
        fi
    fi
    return 0
}

# =============================================================================
# RUN ALL TESTS
# =============================================================================

log "Starting FlakeGuard Security Test Suite"
log "Base URL: $BASE_URL"
log "Reports Directory: $SECURITY_REPORT_DIR"
echo ""

# Dependency Security Tests
log "Running Dependency Security Tests..."
run_test "NPM Audit (High/Critical vulnerabilities)" "test_npm_audit"
run_test "Outdated Packages Check" "test_outdated_packages"
run_test "License Compliance Check" "test_license_compliance"

# Secrets and Configuration Tests
log "Running Secrets and Configuration Tests..."
run_test "Hardcoded Secrets Check" "test_secret_in_code"
run_test "Environment File Security" "test_env_file_security"
run_test "Docker Secrets Configuration" "test_docker_secrets"

# API Security Tests
log "Running API Security Tests..."
run_test "Health Endpoint Availability" "test_health_endpoint"
run_test "Security Headers" "test_security_headers"
run_test "CORS Configuration" "test_cors_configuration"
run_test "Rate Limiting" "test_rate_limiting"
run_test "API Authentication" "test_api_without_auth"
run_test "CSRF Protection" "test_csrf_protection"

# Webhook Security Tests
log "Running Webhook Security Tests..."
run_test "GitHub Webhook Signature Requirement" "test_github_webhook_without_signature"
run_test "GitHub Webhook Invalid Signature" "test_github_webhook_invalid_signature"
run_test "Large Payload Rejection" "test_large_payload_rejection"

# Input Validation Tests
log "Running Input Validation Tests..."
run_test "SQL Injection Protection" "test_sql_injection_protection"
run_test "XSS Protection" "test_xss_protection"
run_test "Path Traversal Protection" "test_path_traversal_protection"

# Docker Security Tests
log "Running Docker Security Tests..."
run_test "Docker Image Vulnerabilities" "test_docker_image_vulnerabilities"
run_test "Docker Secrets Mount" "test_docker_secrets_mount"

# =============================================================================
# TEST RESULTS SUMMARY
# =============================================================================

echo ""
echo -e "${BLUE}Security Test Results Summary${NC}"
echo -e "${BLUE}=============================${NC}"
echo -e "Total Tests: ${TEST_COUNT}"
echo -e "${GREEN}Passed: ${PASS_COUNT}${NC}"
echo -e "${RED}Failed: ${FAIL_COUNT}${NC}"

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo ""
    success "🎉 All security tests passed!"
    echo -e "${GREEN}FlakeGuard security posture looks good.${NC}"
else
    echo ""
    error "⚠️  Some security tests failed!"
    echo -e "${RED}Please review the failed tests and fix the issues.${NC}"
fi

echo ""
log "Security reports saved to: $SECURITY_REPORT_DIR"
log "Review detailed reports for more information."

# Generate security report
cat > "$SECURITY_REPORT_DIR/security_summary_$DATE.json" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "total_tests": $TEST_COUNT,
  "passed_tests": $PASS_COUNT,
  "failed_tests": $FAIL_COUNT,
  "success_rate": $(echo "scale=2; $PASS_COUNT * 100 / $TEST_COUNT" | bc -l),
  "security_status": "$([ $FAIL_COUNT -eq 0 ] && echo 'PASS' || echo 'FAIL')"
}
EOF

# Exit with appropriate code
if [ "$FAIL_COUNT" -eq 0 ]; then
    exit 0
else
    exit 1
fi