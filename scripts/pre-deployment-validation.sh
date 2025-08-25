#!/bin/bash

# FlakeGuard Pre-Deployment Validation Script
# Performs comprehensive validation before production deployment

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
readonly LOG_FILE="${PROJECT_ROOT}/logs/pre-deployment-validation.log"

# Validation results
declare -A VALIDATION_RESULTS
OVERALL_SUCCESS=true

# Ensure logs directory exists
mkdir -p "${PROJECT_ROOT}/logs"

# Logging function
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

# Validation functions

validate_environment() {
    info "🔍 Validating environment configuration..."
    
    local required_vars=(
        "DATABASE_URL"
        "REDIS_URL"
        "JWT_SECRET"
        "API_KEY"
    )
    
    local missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        error "Missing required environment variables: ${missing_vars[*]}"
        VALIDATION_RESULTS["environment"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Environment configuration validated"
    VALIDATION_RESULTS["environment"]="PASSED"
    return 0
}

validate_dependencies() {
    info "📦 Validating dependencies..."
    
    # Check Node.js version
    if ! command -v node &> /dev/null; then
        error "Node.js not found"
        VALIDATION_RESULTS["dependencies"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    local node_version=$(node --version | sed 's/v//')
    local required_major=20
    local current_major=$(echo "$node_version" | cut -d. -f1)
    
    if [[ $current_major -lt $required_major ]]; then
        error "Node.js version $node_version < required v$required_major"
        VALIDATION_RESULTS["dependencies"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    # Check pnpm
    if ! command -v pnpm &> /dev/null; then
        error "pnpm not found"
        VALIDATION_RESULTS["dependencies"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Dependencies validated"
    VALIDATION_RESULTS["dependencies"]="PASSED"
    return 0
}

validate_database_connectivity() {
    info "🗄️ Validating database connectivity..."
    
    local max_attempts=5
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        info "Database connection attempt $attempt/$max_attempts"
        
        if pnpm --filter=@flakeguard/api exec prisma db execute --stdin <<< "SELECT 1;" &> /dev/null; then
            success "Database connectivity validated"
            VALIDATION_RESULTS["database_connectivity"]="PASSED"
            return 0
        fi
        
        warn "Database connection attempt $attempt failed"
        ((attempt++))
        sleep 2
    done
    
    error "Database connectivity validation failed after $max_attempts attempts"
    VALIDATION_RESULTS["database_connectivity"]="FAILED"
    OVERALL_SUCCESS=false
    return 1
}

validate_migrations() {
    info "🔄 Validating database migrations..."
    
    cd "${PROJECT_ROOT}/apps/api"
    
    # Check migration status
    if ! pnpm exec prisma migrate status &> /dev/null; then
        error "Migration status check failed"
        VALIDATION_RESULTS["migrations"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    # Verify schema integrity
    if ! pnpm exec prisma db pull --print &> /dev/null; then
        error "Schema integrity validation failed"
        VALIDATION_RESULTS["migrations"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Database migrations validated"
    VALIDATION_RESULTS["migrations"]="PASSED"
    return 0
}

validate_redis_connectivity() {
    info "📦 Validating Redis connectivity..."
    
    # Extract Redis URL components
    local redis_host="localhost"
    local redis_port="6379"
    
    if [[ "${REDIS_URL}" =~ redis://([^:]+):([0-9]+) ]]; then
        redis_host="${BASH_REMATCH[1]}"
        redis_port="${BASH_REMATCH[2]}"
    fi
    
    if command -v redis-cli &> /dev/null; then
        if redis-cli -h "$redis_host" -p "$redis_port" ping | grep -q "PONG"; then
            success "Redis connectivity validated"
            VALIDATION_RESULTS["redis_connectivity"]="PASSED"
            return 0
        fi
    fi
    
    error "Redis connectivity validation failed"
    VALIDATION_RESULTS["redis_connectivity"]="FAILED"
    OVERALL_SUCCESS=false
    return 1
}

validate_build_process() {
    info "🔨 Validating build process..."
    
    cd "${PROJECT_ROOT}"
    
    # Clean previous builds
    info "Cleaning previous builds..."
    pnpm clean &> /dev/null || true
    
    # Install dependencies
    info "Installing dependencies..."
    if ! pnpm install --frozen-lockfile; then
        error "Dependency installation failed"
        VALIDATION_RESULTS["build"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    # Build shared packages first
    info "Building shared packages..."
    if ! pnpm --filter='./packages/*' build; then
        error "Shared package build failed"
        VALIDATION_RESULTS["build"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    # Build applications
    info "Building applications..."
    if ! pnpm --filter='./apps/*' build; then
        error "Application build failed"
        VALIDATION_RESULTS["build"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Build process validated"
    VALIDATION_RESULTS["build"]="PASSED"
    return 0
}

validate_tests() {
    info "🧪 Validating test suite..."
    
    cd "${PROJECT_ROOT}"
    
    # Type checking
    info "Running type checking..."
    if ! pnpm typecheck; then
        error "Type checking failed"
        VALIDATION_RESULTS["tests"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    # Linting
    info "Running linting..."
    if ! pnpm lint; then
        error "Linting failed"
        VALIDATION_RESULTS["tests"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    # Unit tests
    info "Running unit tests..."
    if ! pnpm --filter=@flakeguard/api test:unit; then
        error "Unit tests failed"
        VALIDATION_RESULTS["tests"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Test suite validated"
    VALIDATION_RESULTS["tests"]="PASSED"
    return 0
}

validate_docker_configuration() {
    info "🐳 Validating Docker configuration..."
    
    cd "${PROJECT_ROOT}"
    
    # Validate Docker Compose configurations
    local compose_files=(
        "docker-compose.yml"
        "docker-compose.prod.yml"
    )
    
    for compose_file in "${compose_files[@]}"; do
        if [[ -f "$compose_file" ]]; then
            info "Validating $compose_file..."
            if ! docker compose -f "$compose_file" config --quiet; then
                error "$compose_file validation failed"
                VALIDATION_RESULTS["docker"]="FAILED"
                OVERALL_SUCCESS=false
                return 1
            fi
        fi
    done
    
    # Validate Dockerfiles exist
    local dockerfiles=(
        "apps/api/Dockerfile"
        "apps/worker/Dockerfile"
        "apps/web/Dockerfile"
    )
    
    for dockerfile in "${dockerfiles[@]}"; do
        if [[ ! -f "$dockerfile" ]]; then
            error "Missing Dockerfile: $dockerfile"
            VALIDATION_RESULTS["docker"]="FAILED"
            OVERALL_SUCCESS=false
            return 1
        fi
    done
    
    success "Docker configuration validated"
    VALIDATION_RESULTS["docker"]="PASSED"
    return 0
}

validate_security_configuration() {
    info "🛡️ Validating security configuration..."
    
    cd "${PROJECT_ROOT}"
    
    # Check for security vulnerabilities
    info "Running security audit..."
    if ! pnpm audit --audit-level high; then
        warn "Security audit found high-level vulnerabilities"
    fi
    
    # Validate secret configurations
    if [[ "${JWT_SECRET}" == *"change-this"* || ${#JWT_SECRET} -lt 32 ]]; then
        error "JWT_SECRET is not properly configured (must be 32+ chars, not default)"
        VALIDATION_RESULTS["security"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    if [[ "${API_KEY}" == *"change-this"* || ${#API_KEY} -lt 16 ]]; then
        error "API_KEY is not properly configured (must be 16+ chars, not default)"
        VALIDATION_RESULTS["security"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Security configuration validated"
    VALIDATION_RESULTS["security"]="PASSED"
    return 0
}

validate_monitoring_configuration() {
    info "📊 Validating monitoring configuration..."
    
    cd "${PROJECT_ROOT}"
    
    # Check monitoring configuration files
    local monitoring_files=(
        "config/prometheus.yml"
        "docker-compose.monitoring.yml"
    )
    
    for file in "${monitoring_files[@]}"; do
        if [[ ! -f "$file" ]]; then
            error "Missing monitoring file: $file"
            VALIDATION_RESULTS["monitoring"]="FAILED"
            OVERALL_SUCCESS=false
            return 1
        fi
    done
    
    # Validate monitoring Docker Compose
    if ! docker compose -f docker-compose.monitoring.yml config --quiet; then
        error "Monitoring Docker Compose validation failed"
        VALIDATION_RESULTS["monitoring"]="FAILED"
        OVERALL_SUCCESS=false
        return 1
    fi
    
    success "Monitoring configuration validated"
    VALIDATION_RESULTS["monitoring"]="PASSED"
    return 0
}

print_summary() {
    echo ""
    echo "=========================================="
    echo "🚀 PRE-DEPLOYMENT VALIDATION SUMMARY"
    echo "=========================================="
    echo ""
    
    local passed=0
    local failed=0
    
    for check in "${!VALIDATION_RESULTS[@]}"; do
        local result="${VALIDATION_RESULTS[$check]}"
        if [[ "$result" == "PASSED" ]]; then
            echo -e "✅ ${check}: ${GREEN}PASSED${NC}"
            ((passed++))
        else
            echo -e "❌ ${check}: ${RED}FAILED${NC}"
            ((failed++))
        fi
    done
    
    echo ""
    echo "=========================================="
    echo "Total Checks: $((passed + failed))"
    echo -e "Passed: ${GREEN}${passed}${NC}"
    echo -e "Failed: ${RED}${failed}${NC}"
    echo "=========================================="
    echo ""
    
    if [[ "$OVERALL_SUCCESS" == true ]]; then
        success "🎉 ALL VALIDATIONS PASSED - READY FOR DEPLOYMENT!"
        echo ""
        echo "Next steps:"
        echo "1. Deploy infrastructure: docker compose -f docker-compose.prod.yml up -d postgres redis"
        echo "2. Apply migrations: pnpm migrate:deploy"
        echo "3. Deploy applications: docker compose -f docker-compose.prod.yml up -d api worker web"
        echo "4. Verify deployment: ./scripts/health-check.sh --production"
        return 0
    else
        error "❌ VALIDATION FAILED - DO NOT DEPLOY!"
        echo ""
        echo "Please fix the failed checks before attempting deployment."
        return 1
    fi
}

main() {
    echo "🚀 Starting FlakeGuard Pre-Deployment Validation"
    echo "=================================================="
    echo ""
    
    # Load environment variables
    if [[ -f "${PROJECT_ROOT}/.env" ]]; then
        source "${PROJECT_ROOT}/.env"
    else
        warn ".env file not found, using system environment variables"
    fi
    
    # Run all validations
    validate_environment || true
    validate_dependencies || true
    validate_database_connectivity || true
    validate_migrations || true
    validate_redis_connectivity || true
    validate_build_process || true
    validate_tests || true
    validate_docker_configuration || true
    validate_security_configuration || true
    validate_monitoring_configuration || true
    
    # Print summary and exit
    print_summary
}

# Handle script interruption
trap 'error "Validation interrupted"; exit 1' INT TERM

# Run main function
main "$@"