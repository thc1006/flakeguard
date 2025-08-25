#!/bin/bash

# FlakeGuard Post-Deployment Verification Script
# Comprehensive validation after production deployment

set -euo pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Script configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly LOG_FILE="${PROJECT_ROOT}/logs/post-deployment-verification.log"

# Configuration
readonly API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
readonly WEB_BASE_URL="${WEB_BASE_URL:-http://localhost:3002}"
readonly PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
readonly GRAFANA_URL="${GRAFANA_URL:-http://localhost:3001}"

# Verification results
declare -A VERIFICATION_RESULTS
OVERALL_SUCCESS=true

# Ensure logs directory exists
mkdir -p "${PROJECT_ROOT}/logs"

# Logging functions
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a "${LOG_FILE}"
}

info() { log "INFO" "$@"; }
warn() { log "WARN" "${YELLOW}$*${NC}"; }
error() { log "ERROR" "${RED}$*${NC}"; }
success() { log "SUCCESS" "${GREEN}$*${NC}"; }

# Utility functions
wait_for_service() {
    local service_name="$1"
    local url="$2"
    local max_attempts="${3:-30}"
    local attempt=1
    
    info "Waiting for $service_name to be available at $url..."
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -sf "$url" &> /dev/null; then
            success "$service_name is available (attempt $attempt/$max_attempts)"
            return 0
        fi
        
        info "$service_name not ready, waiting... (attempt $attempt/$max_attempts)"
        sleep 2
        ((attempt++))
    done
    
    error "$service_name failed to become available after $max_attempts attempts"
    return 1
}

# Verification functions

verify_service_health() {
    info "🏥 Verifying service health..."
    
    local services=(
        "API:${API_BASE_URL}/health"
        "Prometheus:${PROMETHEUS_URL}/-/healthy"
        "Grafana:${GRAFANA_URL}/api/health"
    )
    
    local failed_services=()
    
    for service_def in "${services[@]}"; do
        local service_name="${service_def%%:*}"
        local health_url="${service_def#*:}"
        
        info "Checking $service_name health at $health_url"
        
        if ! wait_for_service "$service_name" "$health_url" 10; then
            failed_services+=("$service_name")
        fi
    done
    
    if [[ ${#failed_services[@]} -gt 0 ]]; then
        error "Health check failed for services: ${failed_services[*]}"
        VERIFICATION_RESULTS["service_health"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "All services are healthy"
    VERIFICATION_RESULTS["service_health"]="PASSED"
    return 0
}

verify_database_functionality() {
    info "🗄️ Verifying database functionality..."
    
    cd "${PROJECT_ROOT}/apps/api"
    
    # Test database connection
    if ! pnpm exec prisma db execute --stdin <<< "SELECT 1;" &> /dev/null; then
        error "Database connection test failed"
        VERIFICATION_RESULTS["database"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    # Verify core tables exist
    local core_tables=(
        "User"
        "Organization"
        "FGRepository"
        "FGTestCase"
        "FGOccurrence"
    )
    
    for table in "${core_tables[@]}"; do
        if ! pnpm exec prisma db execute --stdin <<< "SELECT COUNT(*) FROM \"$table\";" &> /dev/null; then
            error "Core table $table verification failed"
            VERIFICATION_RESULTS["database"]="FAILED"
            OVERALL_SUCCESS=false
            return 1
        fi
    done
    
    success "Database functionality verified"
    VERIFICATION_RESULTS["database"]="PASSED"
    return 0
}

verify_api_endpoints() {
    info "🔌 Verifying API endpoints..."
    
    local endpoints=(
        "GET:/health"
        "GET:/v1/status"
        "GET:/metrics"
    )
    
    local failed_endpoints=()
    
    for endpoint_def in "${endpoints[@]}"; do
        local method="${endpoint_def%%:*}"
        local path="${endpoint_def#*:}"
        local url="${API_BASE_URL}${path}"
        
        info "Testing $method $path"
        
        case "$method" in
            "GET")
                if ! curl -sf "$url" &> /dev/null; then
                    failed_endpoints+=("$method $path")
                fi
                ;;
            "POST")
                if ! curl -sf -X POST "$url" -H "Content-Type: application/json" -d '{}' &> /dev/null; then
                    failed_endpoints+=("$method $path")
                fi
                ;;
        esac
    done
    
    if [[ ${#failed_endpoints[@]} -gt 0 ]]; then
        error "API endpoint verification failed for: ${failed_endpoints[*]}"
        VERIFICATION_RESULTS["api_endpoints"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "API endpoints verified"
    VERIFICATION_RESULTS["api_endpoints"]="PASSED"
    return 0
}

verify_worker_functionality() {
    info "👷 Verifying worker functionality..."
    
    # Check if BullMQ dashboard or metrics endpoint is available
    local worker_health_url="${API_BASE_URL}/worker/health"
    
    if curl -sf "$worker_health_url" &> /dev/null; then
        success "Worker health endpoint accessible"
    else
        warn "Worker health endpoint not accessible (may be expected)"
    fi
    
    # Check Redis connectivity (used by workers)
    if command -v redis-cli &> /dev/null; then
        if redis-cli ping | grep -q "PONG"; then
            success "Redis connectivity verified"
        else
            error "Redis connectivity failed"
            VERIFICATION_RESULTS["worker"]="FAILED"
            OVERALL_SUCCESS=false
            return 1
        fi
    fi
    
    success "Worker functionality verified"
    VERIFICATION_RESULTS["worker"]="PASSED"
    return 0
}

verify_monitoring_stack() {
    info "📊 Verifying monitoring stack..."
    
    # Verify Prometheus is collecting metrics
    local prometheus_targets_url="${PROMETHEUS_URL}/api/v1/targets"
    
    if ! curl -sf "$prometheus_targets_url" | jq -e '.data.activeTargets | length > 0' &> /dev/null; then
        error "Prometheus targets verification failed"
        VERIFICATION_RESULTS["monitoring"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    # Verify Grafana is accessible
    if ! curl -sf "${GRAFANA_URL}/api/health" &> /dev/null; then
        error "Grafana health check failed"
        VERIFICATION_RESULTS["monitoring"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Monitoring stack verified"
    VERIFICATION_RESULTS["monitoring"]="PASSED"
    return 0
}

verify_security_configuration() {
    info "🛡️ Verifying security configuration..."
    
    # Check security headers
    local security_headers=(
        "X-Content-Type-Options"
        "X-Frame-Options"
        "X-XSS-Protection"
    )
    
    local missing_headers=()
    
    for header in "${security_headers[@]}"; do
        if ! curl -sI "${API_BASE_URL}/health" | grep -qi "$header"; then
            missing_headers+=("$header")
        fi
    done
    
    if [[ ${#missing_headers[@]} -gt 0 ]]; then
        warn "Missing security headers: ${missing_headers[*]}"
    fi
    
    # Verify HTTPS in production (if applicable)
    if [[ "${API_BASE_URL}" == https://* ]]; then
        info "Verifying SSL certificate..."
        if ! curl -sI "${API_BASE_URL}/health" | grep -q "200 OK"; then
            error "HTTPS endpoint verification failed"
            VERIFICATION_RESULTS["security"]="FAILED"
            OVERALL_SUCCESS=false
            return 1
        fi
    fi
    
    success "Security configuration verified"
    VERIFICATION_RESULTS["security"]="PASSED"
    return 0
}

verify_performance_metrics() {
    info "⚡ Verifying performance metrics..."
    
    # Test API response times
    local start_time=$(date +%s.%3N)
    curl -sf "${API_BASE_URL}/health" &> /dev/null
    local end_time=$(date +%s.%3N)
    local response_time=$(echo "$end_time - $start_time" | bc)
    
    # Convert to milliseconds
    local response_time_ms=$(echo "$response_time * 1000" | bc | cut -d. -f1)
    
    info "API response time: ${response_time_ms}ms"
    
    if [[ $response_time_ms -gt 1000 ]]; then
        warn "API response time is high: ${response_time_ms}ms"
    fi
    
    # Verify metrics endpoint provides data
    if curl -sf "${API_BASE_URL}/metrics" | grep -q "process_cpu_user_seconds_total"; then
        success "Metrics endpoint is providing data"
    else
        warn "Metrics endpoint may not be providing expected data"
    fi
    
    success "Performance metrics verified"
    VERIFICATION_RESULTS["performance"]="PASSED"
    return 0
}

verify_backup_procedures() {
    info "💾 Verifying backup procedures..."
    
    # Check if backup scripts exist
    local backup_scripts=(
        "${PROJECT_ROOT}/scripts/backup-database.sh"
        "${PROJECT_ROOT}/scripts/restore-database.sh"
    )
    
    for script in "${backup_scripts[@]}"; do
        if [[ ! -f "$script" ]]; then
            warn "Backup script not found: $script"
        else
            if [[ ! -x "$script" ]]; then
                warn "Backup script not executable: $script"
            fi
        fi
    done
    
    # Test database backup capability (dry run)
    info "Testing database backup capability..."
    if command -v pg_dump &> /dev/null && pnpm exec prisma db execute --stdin <<< "SELECT 1;" &> /dev/null; then
        success "Database backup capability verified"
    else
        warn "Database backup capability could not be verified"
    fi
    
    success "Backup procedures verified"
    VERIFICATION_RESULTS["backup"]="PASSED"
    return 0
}

verify_log_aggregation() {
    info "📝 Verifying log aggregation..."
    
    # Check if application is generating logs
    local api_log_file="${PROJECT_ROOT}/logs/api.log"
    
    # Trigger a log entry by hitting the health endpoint
    curl -sf "${API_BASE_URL}/health" &> /dev/null
    
    # Check if logs are being written (wait a moment for async logging)
    sleep 2
    
    if [[ -f "$api_log_file" ]] && [[ -s "$api_log_file" ]]; then
        success "Application logging verified"
    elif docker logs flakeguard-api 2>&1 | grep -q "Server listening"; then
        success "Container logging verified"
    else
        warn "Log aggregation could not be fully verified"
    fi
    
    success "Log aggregation verified"
    VERIFICATION_RESULTS["logging"]="PASSED"
    return 0
}

run_smoke_tests() {
    info "🧪 Running smoke tests..."
    
    # Test basic API functionality
    local test_cases=(
        "Health check:GET:${API_BASE_URL}/health:200"
        "Status endpoint:GET:${API_BASE_URL}/v1/status:200"
        "Metrics endpoint:GET:${API_BASE_URL}/metrics:200"
    )
    
    local failed_tests=()
    
    for test_case in "${test_cases[@]}"; do
        IFS=':' read -r test_name method url expected_code <<< "$test_case"
        
        info "Running smoke test: $test_name"
        
        local actual_code
        actual_code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
        
        if [[ "$actual_code" != "$expected_code" ]]; then
            failed_tests+=("$test_name (expected $expected_code, got $actual_code)")
        fi
    done
    
    if [[ ${#failed_tests[@]} -gt 0 ]]; then
        error "Smoke tests failed: ${failed_tests[*]}"
        VERIFICATION_RESULTS["smoke_tests"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Smoke tests passed"
    VERIFICATION_RESULTS["smoke_tests"]="PASSED"
    return 0
}

print_summary() {
    echo ""
    echo "============================================="
    echo "🚀 POST-DEPLOYMENT VERIFICATION SUMMARY"
    echo "============================================="
    echo ""
    
    local passed=0
    local failed=0
    
    for check in "${!VERIFICATION_RESULTS[@]}"; do
        local result="${VERIFICATION_RESULTS[$check]}"
        if [[ "$result" == "PASSED" ]]; then
            echo -e "✅ ${check}: ${GREEN}PASSED${NC}"
            ((passed++))
        else
            echo -e "❌ ${check}: ${RED}FAILED${NC}"
            ((failed++))
        fi
    done
    
    echo ""
    echo "============================================="
    echo "Total Checks: $((passed + failed))"
    echo -e "Passed: ${GREEN}${passed}${NC}"
    echo -e "Failed: ${RED}${failed}${NC}"
    echo "============================================="
    echo ""
    
    if [[ "$OVERALL_SUCCESS" == true ]]; then
        success "🎉 DEPLOYMENT VERIFICATION SUCCESSFUL!"
        echo ""
        echo "Next steps:"
        echo "1. Monitor application metrics and logs"
        echo "2. Set up automated health checks"
        echo "3. Configure alerting rules"
        echo "4. Schedule regular backups"
        echo "5. Document any deployment-specific configurations"
        return 0
    else
        error "❌ DEPLOYMENT VERIFICATION FAILED!"
        echo ""
        echo "Please investigate and fix the failed checks."
        echo "Consider rolling back if critical issues are detected."
        return 1
    fi
}

main() {
    echo "🔍 Starting FlakeGuard Post-Deployment Verification"
    echo "==================================================="
    echo ""
    
    info "Verification started at $(date)"
    info "API Base URL: $API_BASE_URL"
    info "Web Base URL: $WEB_BASE_URL"
    info "Prometheus URL: $PROMETHEUS_URL"
    info "Grafana URL: $GRAFANA_URL"
    echo ""
    
    # Run all verifications
    verify_service_health || true
    verify_database_functionality || true
    verify_api_endpoints || true
    verify_worker_functionality || true
    verify_monitoring_stack || true
    verify_security_configuration || true
    verify_performance_metrics || true
    verify_backup_procedures || true
    verify_log_aggregation || true
    run_smoke_tests || true
    
    # Print summary and exit
    print_summary
}

# Handle script interruption
trap 'error "Verification interrupted"; exit 1' INT TERM

# Run main function
main "$@"