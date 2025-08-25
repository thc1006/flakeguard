#!/bin/bash

# Database migration script for FlakeGuard
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
    echo -e "${BLUE}Loading environment from $ENV_FILE${NC}"
    source "$ENV_FILE"
else
    echo -e "${YELLOW}Warning: .env file not found. Using defaults.${NC}"
fi

# Set defaults if not provided
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/flakeguard}"
NODE_ENV="${NODE_ENV:-development}"

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

# Check if database is accessible
check_database() {
    log_info "Checking database connection..."
    
    if ! timeout 30 bash -c "until pg_isready -d '$DATABASE_URL' &>/dev/null; do sleep 1; done"; then
        log_error "Database is not accessible. Please ensure PostgreSQL is running."
        exit 1
    fi
    
    log_success "Database connection established"
}

# Wait for database to be ready
wait_for_database() {
    log_info "Waiting for database to be ready..."
    
    local max_attempts=30
    local attempt=0
    
    while [[ $attempt -lt $max_attempts ]]; do
        if pg_isready -d "$DATABASE_URL" &>/dev/null; then
            log_success "Database is ready"
            return 0
        fi
        
        attempt=$((attempt + 1))
        log_info "Attempt $attempt/$max_attempts - waiting for database..."
        sleep 2
    done
    
    log_error "Database did not become ready within timeout"
    exit 1
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."
    
    cd "$PROJECT_ROOT"
    
    if [[ "$NODE_ENV" == "production" ]]; then
        log_info "Running production migrations..."
        pnpm migrate:deploy
    else
        log_info "Running development migrations..."
        pnpm migrate:dev
    fi
    
    log_success "Database migrations completed"
}

# Create backup before migration (production only)
create_backup() {
    if [[ "$NODE_ENV" == "production" ]]; then
        log_info "Creating database backup..."
        
        local backup_dir="$PROJECT_ROOT/backups"
        local backup_file="$backup_dir/flakeguard_$(date +%Y%m%d_%H%M%S).sql"
        
        mkdir -p "$backup_dir"
        
        if pg_dump "$DATABASE_URL" > "$backup_file"; then
            log_success "Database backup created: $backup_file"
        else
            log_error "Failed to create database backup"
            exit 1
        fi
    fi
}

# Verify migration success
verify_migrations() {
    log_info "Verifying migration status..."
    
    cd "$PROJECT_ROOT"
    
    if pnpm prisma migrate status &>/dev/null; then
        log_success "All migrations are up to date"
    else
        log_error "Migration verification failed"
        exit 1
    fi
}

# Main execution
main() {
    log_info "Starting FlakeGuard database migration process..."
    log_info "Environment: $NODE_ENV"
    log_info "Database URL: ${DATABASE_URL%@*}@***"
    
    check_database
    wait_for_database
    create_backup
    run_migrations
    verify_migrations
    
    log_success "FlakeGuard database migration completed successfully!"
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "FlakeGuard Database Migration Script"
        echo ""
        echo "Usage: $0 [options]"
        echo ""
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --dry-run      Show what would be done without executing"
        echo ""
        echo "Environment Variables:"
        echo "  DATABASE_URL   PostgreSQL connection string"
        echo "  NODE_ENV       Environment (development|production)"
        exit 0
        ;;
    --dry-run)
        log_info "DRY RUN MODE - showing what would be executed"
        log_info "Would run migrations with:"
        log_info "  NODE_ENV: $NODE_ENV"
        log_info "  DATABASE_URL: ${DATABASE_URL%@*}@***"
        exit 0
        ;;
    "")
        main
        ;;
    *)
        log_error "Unknown option: $1"
        echo "Use --help for usage information"
        exit 1
        ;;
esac