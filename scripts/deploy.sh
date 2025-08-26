#!/bin/bash

# FlakeGuard deployment script
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_ROOT}/.env"
DOCKER_COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"
DOCKER_COMPOSE_DEV_FILE="${PROJECT_ROOT}/docker-compose.dev.yml"

# Load environment variables
if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
fi

# Set defaults
ENVIRONMENT="${ENVIRONMENT:-development}"
DOCKER_REGISTRY="${DOCKER_REGISTRY:-ghcr.io}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
HEALTH_CHECK_TIMEOUT="${HEALTH_CHECK_TIMEOUT:-300}"

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

log_step() {
    echo -e "${MAGENTA}[STEP]${NC} $1"
}

log_debug() {
    if [[ "${DEBUG:-}" == "true" ]]; then
        echo -e "${CYAN}[DEBUG]${NC} $1"
    fi
}

# Validation functions
validate_environment() {
    log_step "Validating deployment environment..."
    
    case "$ENVIRONMENT" in
        "development"|"dev")
            log_info "Deploying to development environment"
            ;;
        "staging"|"stage")
            log_info "Deploying to staging environment"
            ;;
        "production"|"prod")
            log_warning "Deploying to PRODUCTION environment"
            read -p "Are you sure you want to deploy to production? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Deployment cancelled"
                exit 0
            fi
            ;;
        *)
            log_error "Unknown environment: $ENVIRONMENT"
            echo "Supported environments: development, staging, production"
            exit 1
            ;;
    esac
}

validate_prerequisites() {
    log_step "Validating prerequisites..."
    
    local missing_tools=()
    
    # Check required tools
    for tool in docker docker-compose pnpm node; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_error "Please install the missing tools and try again"
        exit 1
    fi
    
    # Check Docker daemon
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
    
    # Check disk space (minimum 5GB)
    local available_space
    available_space=$(df "$PROJECT_ROOT" | awk 'NR==2{print $4}')
    if [[ $available_space -lt 5242880 ]]; then
        log_warning "Low disk space detected (less than 5GB available)"
    fi
    
    log_success "All prerequisites validated"
}

# Backup functions
create_backup() {
    if [[ "$ENVIRONMENT" == "production" ]]; then
        log_step "Creating database backup..."
        
        local backup_dir="$PROJECT_ROOT/backups"
        local backup_file="$backup_dir/flakeguard_$(date +%Y%m%d_%H%M%S).sql"
        
        mkdir -p "$backup_dir"
        
        if docker-compose exec -T postgres pg_dump -U postgres flakeguard > "$backup_file"; then
            log_success "Database backup created: $backup_file"
            
            # Keep only last 10 backups
            find "$backup_dir" -name "*.sql" -type f -print0 | sort -zr | tail -n +11 | xargs -0 rm -f
        else
            log_error "Failed to create database backup"
            exit 1
        fi
    fi
}

# Build functions
build_images() {
    log_step "Building Docker images..."
    
    local build_args=(
        --build-arg NODE_VERSION=20
        --build-arg PNPM_VERSION=10.0.0
        --build-arg ENVIRONMENT="$ENVIRONMENT"
    )
    
    if [[ "$ENVIRONMENT" == "development" ]]; then
        log_info "Building development images..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" -f "$DOCKER_COMPOSE_DEV_FILE" build "${build_args[@]}"
    else
        log_info "Building production images..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" build "${build_args[@]}"
    fi
    
    log_success "Docker images built successfully"
}

# Deployment functions
deploy_infrastructure() {
    log_step "Deploying infrastructure services..."
    
    # Start infrastructure services first
    if [[ "$ENVIRONMENT" == "development" ]]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" -f "$DOCKER_COMPOSE_DEV_FILE" up -d postgres redis
    else
        docker-compose -f "$DOCKER_COMPOSE_FILE" up -d postgres redis
    fi
    
    # Wait for infrastructure to be healthy
    log_info "Waiting for infrastructure services to be healthy..."
    local timeout=60
    local elapsed=0
    
    while [[ $elapsed -lt $timeout ]]; do
        if docker-compose ps postgres redis | grep -q "healthy"; then
            break
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    
    if [[ $elapsed -ge $timeout ]]; then
        log_error "Infrastructure services failed to become healthy within timeout"
        exit 1
    fi
    
    log_success "Infrastructure services deployed successfully"
}

run_migrations() {
    log_step "Running database migrations..."
    
    cd "$PROJECT_ROOT"
    
    if [[ "$ENVIRONMENT" == "production" ]]; then
        pnpm migrate:deploy
    else
        pnpm migrate:dev
    fi
    
    log_success "Database migrations completed"
}

deploy_applications() {
    log_step "Deploying application services..."
    
    if [[ "$ENVIRONMENT" == "development" ]]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" -f "$DOCKER_COMPOSE_DEV_FILE" --profile dev up -d
    else
        docker-compose -f "$DOCKER_COMPOSE_FILE" up -d
    fi
    
    log_success "Application services deployed"
}

deploy_monitoring() {
    log_step "Deploying monitoring stack..."
    
    if [[ "$ENVIRONMENT" == "development" ]] || [[ "${MONITORING:-}" == "true" ]]; then
        docker-compose -f "$DOCKER_COMPOSE_FILE" --profile monitoring up -d
        log_success "Monitoring stack deployed"
    else
        log_info "Skipping monitoring stack (not enabled for $ENVIRONMENT)"
    fi
}

# Health check functions
run_health_checks() {
    log_step "Running health checks..."
    
    local health_script="$SCRIPT_DIR/health-check.sh"
    
    if [[ -f "$health_script" ]]; then
        if bash "$health_script" wait "$HEALTH_CHECK_TIMEOUT"; then
            log_success "All health checks passed"
        else
            log_error "Health checks failed"
            
            log_info "Service status:"
            docker-compose ps
            
            log_info "Recent logs:"
            docker-compose logs --tail=20
            
            exit 1
        fi
    else
        log_warning "Health check script not found, performing basic checks"
        
        # Basic health check
        local services=("postgres" "redis")
        for service in "${services[@]}"; do
            if docker-compose ps "$service" | grep -q "Up"; then
                log_success "$service is running"
            else
                log_error "$service is not running"
                exit 1
            fi
        done
    fi
}

# Post-deployment functions
seed_data() {
    if [[ "$ENVIRONMENT" == "development" ]] && [[ "${SEED_DATA:-}" == "true" ]]; then
        log_step "Seeding development data..."
        
        local seed_script="$SCRIPT_DIR/seed-data.sh"
        if [[ -f "$seed_script" ]]; then
            bash "$seed_script" development
            log_success "Development data seeded"
        else
            log_warning "Seed script not found, skipping data seeding"
        fi
    fi
}

display_deployment_info() {
    log_success "🎉 FlakeGuard deployment completed successfully!"
    
    echo
    log_info "📋 Deployment Summary:"
    log_info "   Environment: $ENVIRONMENT"
    log_info "   Image Tag: $IMAGE_TAG"
    log_info "   Started At: $(date)"
    
    echo
    log_info "🔗 Service URLs:"
    
    case "$ENVIRONMENT" in
        "development")
            log_info "   API: http://localhost:3000"
            log_info "   Web: http://localhost:3002"
            log_info "   Proxy: http://localhost:8080"
            log_info "   Database: localhost:5432"
            log_info "   Redis: localhost:6379"
            if [[ "${MONITORING:-}" == "true" ]]; then
                log_info "   Prometheus: http://localhost:9090"
                log_info "   Grafana: http://localhost:3001 (admin/admin)"
            fi
            if docker-compose ps | grep -q "pgadmin"; then
                log_info "   PgAdmin: http://localhost:5050 (admin@flakeguard.com/admin)"
            fi
            if docker-compose ps | grep -q "redis-commander"; then
                log_info "   Redis Commander: http://localhost:8081"
            fi
            ;;
        *)
            log_info "   Check your environment configuration for service URLs"
            ;;
    esac
    
    echo
    log_info "💡 Useful commands:"
    log_info "   View logs: docker-compose logs -f [service]"
    log_info "   Check status: docker-compose ps"
    log_info "   Scale service: docker-compose up -d --scale [service]=N"
    log_info "   Stop all: docker-compose down"
    log_info "   Health check: $SCRIPT_DIR/health-check.sh"
    
    if [[ "$ENVIRONMENT" == "development" ]]; then
        echo
        log_info "🔧 Development tools:"
        log_info "   Hot reload: Changes are automatically reflected"
        log_info "   Debug API: Debugging port 9229 is exposed"
        log_info "   Seed data: SEED_DATA=true $0 --environment development"
    fi
}

# Rollback function
rollback() {
    log_warning "Rolling back deployment..."
    
    docker-compose down
    
    if [[ "$ENVIRONMENT" == "production" ]] && [[ -n "${BACKUP_FILE:-}" ]]; then
        log_info "Restoring database from backup: $BACKUP_FILE"
        docker-compose up -d postgres
        sleep 10
        docker-compose exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS flakeguard;"
        docker-compose exec -T postgres psql -U postgres -c "CREATE DATABASE flakeguard;"
        docker-compose exec -T postgres psql -U postgres flakeguard < "$BACKUP_FILE"
    fi
    
    log_warning "Rollback completed"
}

# Cleanup function
cleanup() {
    log_info "Performing cleanup..."
    
    # Clean up unused Docker resources
    docker system prune -f --volumes
    
    log_success "Cleanup completed"
}

# Signal handlers
trap 'log_error "Deployment interrupted"; exit 1' INT TERM
trap 'rollback' ERR

# Main deployment function
main() {
    log_info "🚀 Starting FlakeGuard deployment..."
    log_info "Environment: $ENVIRONMENT"
    log_info "Registry: $DOCKER_REGISTRY"
    log_info "Tag: $IMAGE_TAG"
    
    validate_environment
    validate_prerequisites
    
    # Deployment steps
    create_backup
    build_images
    deploy_infrastructure
    run_migrations
    deploy_applications
    deploy_monitoring
    run_health_checks
    seed_data
    
    display_deployment_info
    
    log_success "🎊 FlakeGuard deployment completed successfully!"
}

# Command line argument parsing
while [[ $# -gt 0 ]]; do
    case $1 in
        --environment|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --tag|-t)
            IMAGE_TAG="$2"
            shift 2
            ;;
        --monitoring)
            export MONITORING=true
            shift
            ;;
        --seed-data)
            export SEED_DATA=true
            shift
            ;;
        --debug)
            export DEBUG=true
            set -x
            shift
            ;;
        --help|-h)
            echo "FlakeGuard Deployment Script"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --environment, -e    Deployment environment (development|staging|production)"
            echo "  --tag, -t           Docker image tag (default: latest)"
            echo "  --monitoring        Enable monitoring stack"
            echo "  --seed-data         Seed development data"
            echo "  --debug             Enable debug mode"
            echo "  --help, -h          Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --environment development --seed-data"
            echo "  $0 -e production -t v1.2.3"
            echo "  $0 --environment staging --monitoring"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Execute main function
main