#!/bin/bash

# Seed data script for FlakeGuard
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
    
    if ! timeout 10 bash -c "until pg_isready -d '$DATABASE_URL' &>/dev/null; do sleep 1; done"; then
        log_error "Database is not accessible. Please ensure PostgreSQL is running."
        exit 1
    fi
    
    log_success "Database connection established"
}

# Check if data already exists
check_existing_data() {
    log_info "Checking for existing seed data..."
    
    cd "$PROJECT_ROOT"
    
    # Run a simple query to check if data exists
    # This will be implemented once we have the actual schema
    local existing_count
    existing_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE '_prisma%';" 2>/dev/null || echo "0")
    
    if [[ "${existing_count// /}" -gt 0 ]]; then
        log_warning "Existing data found in database"
        return 1
    else
        log_info "No existing seed data found"
        return 0
    fi
}

# Seed development data
seed_development_data() {
    log_info "Seeding development data..."
    
    cd "$PROJECT_ROOT"
    
    # Run the Prisma seed command
    if pnpm prisma db seed 2>/dev/null; then
        log_success "Development data seeded successfully"
    else
        log_warning "Prisma seed not configured or failed, running custom seed script"
        
        # Run custom seed script if Prisma seed is not available
        if [[ -f "$SCRIPT_DIR/seed/development.js" ]]; then
            node "$SCRIPT_DIR/seed/development.js"
            log_success "Custom development seed completed"
        else
            log_warning "No seed scripts found"
        fi
    fi
}

# Seed test data
seed_test_data() {
    log_info "Seeding test data..."
    
    cd "$PROJECT_ROOT"
    
    if [[ -f "$SCRIPT_DIR/seed/test.js" ]]; then
        node "$SCRIPT_DIR/seed/test.js"
        log_success "Test data seeded successfully"
    else
        log_warning "No test seed script found"
    fi
}

# Seed demo data
seed_demo_data() {
    log_info "Seeding demo data..."
    
    cd "$PROJECT_ROOT"
    
    if [[ -f "$SCRIPT_DIR/seed/demo.js" ]]; then
        node "$SCRIPT_DIR/seed/demo.js"
        log_success "Demo data seeded successfully"
    else
        log_warning "No demo seed script found"
    fi
}

# Clear existing data
clear_data() {
    log_warning "Clearing existing data..."
    
    if [[ "$NODE_ENV" == "production" ]]; then
        log_error "Cannot clear data in production environment"
        exit 1
    fi
    
    read -p "Are you sure you want to clear all data? This cannot be undone. (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd "$PROJECT_ROOT"
        
        # Reset the database
        pnpm prisma migrate reset --force
        log_success "Database cleared and reset"
    else
        log_info "Data clearing cancelled"
        exit 0
    fi
}

# Health check after seeding
health_check() {
    log_info "Running health check after seeding..."
    
    cd "$PROJECT_ROOT"
    
    # Basic database connectivity test
    if psql "$DATABASE_URL" -c "SELECT 1;" &>/dev/null; then
        log_success "Database health check passed"
    else
        log_error "Database health check failed"
        exit 1
    fi
}

# Main execution
main() {
    local seed_type="${1:-development}"
    
    log_info "Starting FlakeGuard data seeding process..."
    log_info "Environment: $NODE_ENV"
    log_info "Seed type: $seed_type"
    log_info "Database URL: ${DATABASE_URL%@*}@***"
    
    check_database
    
    case "$seed_type" in
        "development"|"dev")
            if ! check_existing_data || [[ "${FORCE:-}" == "true" ]]; then
                seed_development_data
            else
                log_info "Development data already exists. Use --force to override."
            fi
            ;;
        "test")
            seed_test_data
            ;;
        "demo")
            seed_demo_data
            ;;
        "clear")
            clear_data
            ;;
        *)
            log_error "Unknown seed type: $seed_type"
            echo "Available types: development, test, demo, clear"
            exit 1
            ;;
    esac
    
    health_check
    
    log_success "FlakeGuard data seeding completed successfully!"
}

# Handle script arguments
case "${1:-development}" in
    --help|-h)
        echo "FlakeGuard Data Seeding Script"
        echo ""
        echo "Usage: $0 [seed_type] [options]"
        echo ""
        echo "Seed Types:"
        echo "  development    Seed development data (default)"
        echo "  test          Seed test data"
        echo "  demo          Seed demonstration data"
        echo "  clear         Clear all data (development only)"
        echo ""
        echo "Options:"
        echo "  --help, -h    Show this help message"
        echo "  --force       Force seed even if data exists"
        echo ""
        echo "Environment Variables:"
        echo "  DATABASE_URL  PostgreSQL connection string"
        echo "  NODE_ENV      Environment (development|test|production)"
        echo "  FORCE         Set to 'true' to force seeding"
        exit 0
        ;;
    --force)
        export FORCE=true
        main "development"
        ;;
    *)
        main "$1"
        ;;
esac