# Database Role Issues - Fix Summary

## Problem Description
The CI builds were failing with `FATAL: role 'root' does not exist` errors, indicating that database connections were attempting to use a 'root' user instead of the configured 'postgres' user.

## Root Cause Analysis
The issue was caused by inconsistent database user configuration across CI workflows and environment variables:
1. Some processes were inheriting the system `USER` environment variable (which could be 'root' in CI)
2. Missing explicit `POSTGRES_USER` and `PGUSER` environment variables in some workflow steps
3. Database health checks using hardcoded 'postgres' user instead of environment variables
4. Inconsistent environment variable propagation in CI steps

## Fixes Applied

### 1. Updated CI Workflow Environment Variables

**File: `.github/workflows/ci.yml`**

- Added explicit `USER: postgres` to global environment to prevent root user inheritance
- Enhanced database configuration with comprehensive environment variables:
```yaml
env:
  # Database configuration - ensure consistent user across all connections
  POSTGRES_USER: postgres
  POSTGRES_PASSWORD: postgres  
  POSTGRES_DB: flakeguard_test
  DATABASE_URL: postgresql://postgres:postgres@localhost:5432/flakeguard_test
  # PostgreSQL client environment variables
  PGUSER: postgres
  PGPASSWORD: postgres
  PGDATABASE: flakeguard_test
  PGHOST: localhost
  PGPORT: 5432
  # Prevent any root user connections
  USER: postgres
```

### 2. Fixed Database Connection Commands

**Before:**
```bash
timeout 30 bash -c 'until pg_isready -h localhost -p 5432 -U postgres; do sleep 1; done'
```

**After:**
```bash
timeout 30 bash -c 'until pg_isready -h localhost -p 5432 -U $POSTGRES_USER; do sleep 1; done'
```

### 3. Enhanced Environment Variable Propagation

All database-related steps now explicitly set:
```yaml
env:
  POSTGRES_USER: ${{ env.POSTGRES_USER }}
  PGUSER: ${{ env.POSTGRES_USER }}
  PGPASSWORD: ${{ env.POSTGRES_PASSWORD }}
```

### 4. Updated PostgreSQL Service Configuration

**Before:**
```yaml
options: >-
  --health-cmd pg_isready
```

**After:**
```yaml
env:
  POSTGRES_USER: ${{ env.POSTGRES_USER }}
  POSTGRES_PASSWORD: ${{ env.POSTGRES_PASSWORD }}
  POSTGRES_DB: ${{ env.POSTGRES_DB }}
  PGUSER: ${{ env.POSTGRES_USER }}
options: >-
  --health-cmd "pg_isready -U $POSTGRES_USER"
```

### 5. Updated Database Monitoring Workflow

**File: `.github/workflows/database-monitoring.yml`**

- Added explicit `POSTGRES_USER` environment variable to all database operations
- Ensured consistency with main CI workflow configuration

### 6. Fixed Docker Compose Health Check

**File: `docker-compose.yml`**

**Before:**
```yaml
test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-flakeguard}']
```

**After:**
```yaml
test: ['CMD-SHELL', 'pg_isready -U postgres -d ${POSTGRES_DB:-flakeguard}']
```

### 7. Created Database Connection Test Script

**File: `scripts/test-db-connection.sh`**

- Created comprehensive database connection testing utility
- Helps troubleshoot database role issues in CI/CD environments
- Provides diagnostic information about available database roles
- Tests multiple connection methods and provides recommendations

## Key Changes Summary

1. **Consistent User Configuration**: All database operations now use explicit user configuration
2. **Environment Variable Propagation**: Ensured POSTGRES_USER and PGUSER are set in all workflow steps
3. **Hardcoded Reference Removal**: Replaced hardcoded 'postgres' references with environment variables
4. **Root User Prevention**: Added explicit USER environment variable to prevent system user inheritance
5. **Comprehensive Testing**: Added diagnostic script for troubleshooting database connections

## Verification Steps

To verify the fixes work correctly:

1. **Run the database connection test script:**
```bash
./scripts/test-db-connection.sh
```

2. **Check CI workflow environment variables:**
- Ensure POSTGRES_USER, PGUSER, and DATABASE_URL are all consistent
- Verify no hardcoded database user references remain

3. **Test local development:**
```bash
docker-compose up -d postgres
./scripts/test-db-connection.sh
```

4. **Monitor CI builds:**
- Check that database connection steps now pass
- Verify no "role 'root' does not exist" errors occur

## Prevention Measures

To prevent this issue from recurring:

1. **Always use environment variables for database users in CI**
2. **Set explicit POSTGRES_USER and PGUSER in all database steps**
3. **Avoid hardcoding database user names in scripts and configurations**
4. **Use the database connection test script during development and debugging**
5. **Ensure consistent environment variable naming across all environments**

## Files Modified

1. `.github/workflows/ci.yml` - Main CI workflow with database fixes
2. `.github/workflows/database-monitoring.yml` - Database monitoring workflow fixes  
3. `docker-compose.yml` - Docker Compose health check fix
4. `scripts/test-db-connection.sh` - New database connection testing utility

The fixes ensure that all database connections use the correct 'postgres' user consistently across all environments, preventing the "role 'root' does not exist" errors that were causing CI build failures.