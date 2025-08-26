#!/bin/bash

# Health check script for FlakeGuard services
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env"

# Load environment variables
if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
fi

# Set defaults if not provided
API_URL="${API_URL:-http://localhost:3000}"
WEB_URL="${WEB_URL:-http://localhost:3002}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/flakeguard}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3001}"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Health check for PostgreSQL
check_postgres() {
    log_info "Checking PostgreSQL health..."
    
    if timeout 10 pg_isready -d "$DATABASE_URL" &>/dev/null; then
        log_success "PostgreSQL is healthy"
        return 0
    else
        log_error "PostgreSQL health check failed"
        return 1
    fi
}

# Health check for Redis
check_redis() {
    log_info "Checking Redis health..."
    
    local redis_host redis_port
    redis_host=$(echo "$REDIS_URL" | sed -n 's|redis://\([^:]*\):.*|\1|p')
    redis_port=$(echo "$REDIS_URL" | sed -n 's|redis://[^:]*:\([^/]*\).*|\1|p')
    
    redis_host=${redis_host:-localhost}
    redis_port=${redis_port:-6379}
    
    if timeout 10 redis-cli -h "$redis_host" -p "$redis_port" ping &>/dev/null | grep -q "PONG"; then
        log_success "Redis is healthy"
        return 0
    else
        log_error "Redis health check failed"
        return 1
    fi
}

# Health check for API service
check_api() {
    log_info "Checking API service health..."
    
    local health_endpoint="$API_URL/health"
    
    if timeout 10 curl -sf "$health_endpoint" &>/dev/null; then
        log_success "API service is healthy"
        return 0
    else
        log_error "API service health check failed"
        return 1
    fi
}

# Health check for Web service
check_web() {
    log_info "Checking Web service health..."
    
    if timeout 10 curl -sf "$WEB_URL" &>/dev/null; then
        log_success "Web service is healthy"
        return 0
    else
        log_error "Web service health check failed"
        return 1
    fi
}

# Health check for Prometheus
check_prometheus() {
    log_info "Checking Prometheus health..."
    
    local health_endpoint="$PROMETHEUS_URL/-/healthy"
    
    if timeout 10 curl -sf "$health_endpoint" &>/dev/null; then
        log_success "Prometheus is healthy"
        return 0
    else
        log_warning "Prometheus health check failed (may not be running)"
        return 1
    fi
}

# Health check for Grafana
check_grafana() {
    log_info "Checking Grafana health..."
    
    local health_endpoint="$GRAFANA_URL/api/health"
    
    if timeout 10 curl -sf "$health_endpoint" &>/dev/null; then
        log_success "Grafana is healthy"
        return 0
    else
        log_warning "Grafana health check failed (may not be running)"
        return 1
    fi
}

# Check Docker services
check_docker_services() {
    log_info "Checking Docker services..."
    
    if ! command -v docker &> /dev/null; then
        log_warning "Docker not found, skipping container health checks"
        return 1
    fi
    
    local services=("flakeguard-postgres" "flakeguard-redis")
    local healthy_count=0
    
    for service in "${services[@]}"; do
        if docker ps --filter "name=$service" --filter "status=running" --format "{{.Names}}" | grep -q "$service"; then
            local health_status
            health_status=$(docker inspect --format='{{.State.Health.Status}}' "$service" 2>/dev/null || echo "unknown")
            
            case "$health_status" in
                "healthy")
                    log_success "Docker service $service is healthy"
                    ((healthy_count++))
                    ;;
                "unhealthy")
                    log_error "Docker service $service is unhealthy"
                    ;;
                "starting")
                    log_warning "Docker service $service is starting"
                    ;;
                *)
                    log_warning "Docker service $service health status unknown"
                    ;;
            esac
        else
            log_warning "Docker service $service is not running"
        fi
    done
    
    if [[ $healthy_count -eq ${#services[@]} ]]; then
        log_success "All Docker services are healthy"
        return 0
    else
        log_warning "Some Docker services are not healthy"
        return 1
    fi
}

# Comprehensive health check
comprehensive_check() {
    log_info "Running comprehensive health check..."
    
    local checks=(
        "check_postgres"
        "check_redis"
        "check_api"
        "check_web"
        "check_prometheus"
        "check_grafana"
        "check_docker_services"
    )
    
    local passed=0
    local total=${#checks[@]}
    
    for check in "${checks[@]}"; do
        if $check; then
            ((passed++))
        fi
        echo # Add spacing between checks
    done
    
    log_info "Health check summary: $passed/$total checks passed"
    
    if [[ $passed -eq $total ]]; then
        log_success "All health checks passed!"
        return 0
    elif [[ $passed -ge $((total * 2 / 3)) ]]; then
        log_warning "Most health checks passed, but some services may be unavailable"
        return 0
    else
        log_error "Multiple health checks failed. Please check service status."
        return 1
    fi
}

# Quick health check (essential services only)
quick_check() {
    log_info "Running quick health check..."
    
    local checks=("check_postgres" "check_redis")
    local passed=0
    local total=${#checks[@]}
    
    for check in "${checks[@]}"; do
        if $check; then
            ((passed++))
        fi
    done
    
    if [[ $passed -eq $total ]]; then
        log_success "Essential services are healthy"
        return 0
    else
        log_error "Essential services health check failed"
        return 1
    fi
}

# Wait for services to become healthy
wait_for_services() {
    local timeout="${1:-120}"
    local interval="${2:-5}"
    local elapsed=0
    
    log_info "Waiting for services to become healthy (timeout: ${timeout}s)..."
    
    while [[ $elapsed -lt $timeout ]]; do
        if quick_check &>/dev/null; then
            log_success "Services are healthy (took ${elapsed}s)"
            return 0
        fi
        
        log_info "Services not ready yet, waiting ${interval}s..."
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done
    
    log_error "Services did not become healthy within timeout"
    return 1
}

# Main execution
main() {
    local check_type="${1:-comprehensive}"
    
    log_info "Starting FlakeGuard health check..."
    log_info "Check type: $check_type"
    
    case "$check_type" in
        "quick")
            quick_check
            ;;
        "comprehensive"|"full")
            comprehensive_check
            ;;
        "wait")
            wait_for_services "${2:-120}" "${3:-5}"
            ;;
        "postgres")
            check_postgres
            ;;
        "redis")
            check_redis
            ;;
        "api")
            check_api
            ;;
        "web")
            check_web
            ;;
        "prometheus")
            check_prometheus
            ;;
        "grafana")
            check_grafana
            ;;
        "docker")
            check_docker_services
            ;;
        *)
            log_error "Unknown check type: $check_type"
            echo "Available types: quick, comprehensive, wait, postgres, redis, api, web, prometheus, grafana, docker"
            exit 1
            ;;
    esac
}

# Handle script arguments
case "${1:-comprehensive}" in
    --help|-h)
        echo "FlakeGuard Health Check Script"
        echo ""
        echo "Usage: $0 [check_type] [options]"
        echo ""
        echo "Check Types:"
        echo "  comprehensive  Run all health checks (default)"
        echo "  quick         Check essential services only"
        echo "  wait          Wait for services to become healthy"
        echo "  postgres      Check PostgreSQL only"
        echo "  redis         Check Redis only"
        echo "  api           Check API service only"
        echo "  web           Check Web service only"
        echo "  prometheus    Check Prometheus only"
        echo "  grafana       Check Grafana only"
        echo "  docker        Check Docker services only"
        echo ""
        echo "Options:"
        echo "  --help, -h    Show this help message"
        echo ""
        echo "Environment Variables:"
        echo "  API_URL       API service URL"
        echo "  WEB_URL       Web service URL"
        echo "  DATABASE_URL  PostgreSQL connection string"
        echo "  REDIS_URL     Redis connection string"
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac