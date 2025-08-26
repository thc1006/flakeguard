#!/bin/bash

# Database Connection Test Script
# This script helps troubleshoot database connection issues in CI/CD environments

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-flakeguard}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

echo -e "${BLUE}=== Database Connection Test Script ===${NC}"
echo -e "${BLUE}Checking PostgreSQL connection configuration...${NC}"
echo

# Display current configuration
echo -e "${YELLOW}Configuration:${NC}"
echo "  POSTGRES_USER: ${POSTGRES_USER}"
echo "  POSTGRES_DB: ${POSTGRES_DB}"
echo "  POSTGRES_HOST: ${POSTGRES_HOST}" 
echo "  POSTGRES_PORT: ${POSTGRES_PORT}"
echo "  DATABASE_URL: ${DATABASE_URL:-not set}"
echo "  PGUSER: ${PGUSER:-not set}"
echo "  USER: ${USER:-not set}"
echo

# Test 1: Check if PostgreSQL is running
echo -e "${YELLOW}Test 1: Checking if PostgreSQL is running...${NC}"
if pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ PostgreSQL is running and accepting connections${NC}"
else
    echo -e "${RED}✗ PostgreSQL is not running or not accepting connections${NC}"
    echo "Trying alternative connection methods..."
    
    # Try with different users
    for test_user in postgres root "${USER:-}" admin; do
        echo -n "  Testing with user '$test_user': "
        if pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$test_user" >/dev/null 2>&1; then
            echo -e "${GREEN}✓ Success${NC}"
            echo -e "${YELLOW}  Warning: Connection works with user '$test_user' but not '$POSTGRES_USER'${NC}"
        else
            echo -e "${RED}✗ Failed${NC}"
        fi
    done
    
    exit 1
fi

# Test 2: Test database connection with psql
echo -e "${YELLOW}Test 2: Testing database connection with psql...${NC}"
if PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version();" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Successfully connected to database${NC}"
else
    echo -e "${RED}✗ Failed to connect to database${NC}"
    echo "Detailed error:"
    PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version();" 2>&1 || true
    exit 1
fi

# Test 3: Check database roles and permissions
echo -e "${YELLOW}Test 3: Checking database roles and permissions...${NC}"
ROLES=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -c "SELECT rolname FROM pg_roles ORDER BY rolname;" 2>/dev/null || echo "ERROR")

if [[ "$ROLES" != "ERROR" ]]; then
    echo "Available database roles:"
    echo "$ROLES" | grep -v "^$" | sed 's/^/  /'
    echo
    
    # Check if the current user exists
    if echo "$ROLES" | grep -q "^\s*${POSTGRES_USER}\s*$"; then
        echo -e "${GREEN}✓ User '$POSTGRES_USER' exists in the database${NC}"
    else
        echo -e "${RED}✗ User '$POSTGRES_USER' does not exist in the database${NC}"
        echo -e "${YELLOW}  Available users that could work:${NC}"
        echo "$ROLES" | head -5 | sed 's/^/    /'
    fi
else
    echo -e "${RED}✗ Could not check database roles${NC}"
fi

# Test 4: Test Prisma connection if available
if command -v prisma >/dev/null 2>&1; then
    echo -e "${YELLOW}Test 4: Testing Prisma database connection...${NC}"
    if prisma db execute --stdin <<< "SELECT 1;" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Prisma can connect to the database${NC}"
    else
        echo -e "${RED}✗ Prisma cannot connect to the database${NC}"
        echo "Make sure DATABASE_URL is correctly set and Prisma client is generated"
    fi
else
    echo -e "${YELLOW}Test 4: Prisma not found, skipping Prisma connection test${NC}"
fi

echo
echo -e "${GREEN}=== Database connection test completed ===${NC}"

# Recommendations
echo -e "${BLUE}Recommendations:${NC}"
echo "1. Ensure POSTGRES_USER environment variable is set consistently"
echo "2. Make sure PGUSER matches POSTGRES_USER to avoid role conflicts"
echo "3. Verify DATABASE_URL uses the same user as POSTGRES_USER"
echo "4. In CI environments, use explicit user flags: pg_isready -U \$POSTGRES_USER"
echo "5. Check that PostgreSQL service in Docker Compose uses correct user"