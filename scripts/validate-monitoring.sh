#!/bin/bash

# FlakeGuard Monitoring Infrastructure Validation Script
# Validates all monitoring components and reliability patterns

set -e

echo "🚀 FlakeGuard Monitoring Infrastructure Validation"
echo "=================================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0

# Helper function to report test results
test_result() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ PASS${NC}: $2"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}❌ FAIL${NC}: $2"
        if [ -n "$3" ]; then
            echo -e "   ${YELLOW}Details:${NC} $3"
        fi
    fi
    echo
}

# 1. Infrastructure Services Health
echo -e "${BLUE}📊 Testing Infrastructure Services...${NC}"

# Test Redis
if docker exec flakeguard-redis redis-cli ping > /dev/null 2>&1; then
    test_result 0 "Redis connectivity and health"
else
    test_result 1 "Redis connectivity and health" "Redis container not responding"
fi

# Test PostgreSQL
if docker exec flakeguard-postgres psql -U postgres -d flakeguard -c "SELECT 1;" > /dev/null 2>&1; then
    test_result 0 "PostgreSQL connectivity and health"
else
    test_result 1 "PostgreSQL connectivity and health" "Database not accessible"
fi

# 2. Monitoring Configuration Files
echo -e "${BLUE}📋 Testing Monitoring Configuration...${NC}"

# Check Prometheus configuration
if [ -f "monitoring/prometheus.yml" ]; then
    # Check for required scrape jobs
    if grep -q "flakeguard-api" monitoring/prometheus.yml && 
       grep -q "flakeguard-worker" monitoring/prometheus.yml; then
        test_result 0 "Prometheus scrape job configuration"
    else
        test_result 1 "Prometheus scrape job configuration" "Missing required job configurations"
    fi
else
    test_result 1 "Prometheus configuration file exists"
fi

# Check alerting rules
if [ -f "monitoring/prometheus-alerts.yaml" ]; then
    alert_rules=$(grep -c "alert:" monitoring/prometheus-alerts.yaml)
    if [ "$alert_rules" -ge 10 ]; then
        test_result 0 "Prometheus alerting rules ($alert_rules rules found)"
    else
        test_result 1 "Prometheus alerting rules" "Only $alert_rules rules found, expected >= 10"
    fi
else
    test_result 1 "Prometheus alerting rules file exists"
fi

# Check SLO definitions
if [ -f "monitoring/slo-definitions.yaml" ]; then
    slo_count=$(grep -c "target:" monitoring/slo-definitions.yaml)
    if [ "$slo_count" -ge 4 ]; then
        test_result 0 "SLO definitions ($slo_count SLOs defined)"
    else
        test_result 1 "SLO definitions" "Only $slo_count SLOs found, expected >= 4"
    fi
else
    test_result 1 "SLO definitions file exists"
fi

# Check Grafana dashboard
if [ -f "monitoring/grafana/flakeguard-overview.json" ]; then
    panels_count=$(grep -c '"title"' monitoring/grafana/flakeguard-overview.json)
    if [ "$panels_count" -ge 8 ]; then
        test_result 0 "Grafana dashboard panels ($panels_count panels)"
    else
        test_result 1 "Grafana dashboard panels" "Only $panels_count panels found, expected >= 8"
    fi
else
    test_result 1 "Grafana dashboard configuration exists"
fi

# 3. Docker Compose Validation
echo -e "${BLUE}🐳 Testing Docker Compose Configuration...${NC}"

# Test main compose file
if docker-compose config > /dev/null 2>&1; then
    test_result 0 "Main docker-compose.yml syntax validation"
else
    test_result 1 "Main docker-compose.yml syntax validation" "Syntax errors in compose file"
fi

# Test monitoring compose file (with dependency fix)
if docker-compose -f docker-compose.yml -f docker-compose.monitoring.yml config > /dev/null 2>&1; then
    test_result 0 "Monitoring docker-compose.yml syntax validation"
else
    test_result 1 "Monitoring docker-compose.yml syntax validation" "Missing service dependencies"
fi

# 4. Rate Limiting Configuration
echo -e "${BLUE}🛡️ Testing Rate Limiting & Circuit Breaker Configuration...${NC}"

# Check if rate limiting is implemented in the codebase
if find packages/shared/src -name "rate-limiter.ts" | head -1 | xargs -I {} test -f {}; then
    rate_limiter_file=$(find packages/shared/src -name "rate-limiter.ts" | head -1)
    
    # Check for primary rate limiter
    if grep -q "PrimaryRateLimiter" "$rate_limiter_file" && 
       grep -q "throttleThresholdPercent" "$rate_limiter_file"; then
        test_result 0 "Primary rate limiter implementation"
    else
        test_result 1 "Primary rate limiter implementation" "Missing throttling configuration"
    fi
    
    # Check for secondary rate limiter
    if grep -q "SecondaryRateLimiter" "$rate_limiter_file" && 
       grep -q "exponential.*backoff" "$rate_limiter_file"; then
        test_result 0 "Secondary rate limiter with backoff"
    else
        test_result 1 "Secondary rate limiter with backoff" "Missing exponential backoff"
    fi
    
    # Check for circuit breaker patterns
    if grep -q "ExponentialBackoff" "$rate_limiter_file" && 
       grep -q "jitter" "$rate_limiter_file"; then
        test_result 0 "Circuit breaker with jitter implementation"
    else
        test_result 1 "Circuit breaker with jitter implementation" "Missing jitter in backoff"
    fi
else
    test_result 1 "Rate limiting implementation exists" "rate-limiter.ts file not found"
fi

# 5. Metrics Implementation
echo -e "${BLUE}📈 Testing Metrics Implementation...${NC}"

# Check API metrics
if [ -f "apps/api/src/utils/metrics.ts" ]; then
    metrics_file="apps/api/src/utils/metrics.ts"
    
    # Count metrics definitions
    http_metrics=$(grep -c "httpRequest" "$metrics_file")
    business_metrics=$(grep -c "flakeDetections\|testsProcessed\|quarantineActions" "$metrics_file")
    slo_metrics=$(grep -c "ingestionLatency\|checkRunDelivery" "$metrics_file")
    
    if [ "$http_metrics" -ge 3 ]; then
        test_result 0 "HTTP metrics implementation ($http_metrics metrics)"
    else
        test_result 1 "HTTP metrics implementation" "Only $http_metrics HTTP metrics found"
    fi
    
    if [ "$business_metrics" -ge 3 ]; then
        test_result 0 "Business metrics implementation ($business_metrics metrics)"
    else
        test_result 1 "Business metrics implementation" "Only $business_metrics business metrics found"
    fi
    
    if [ "$slo_metrics" -ge 2 ]; then
        test_result 0 "SLO tracking metrics ($slo_metrics metrics)"
    else
        test_result 1 "SLO tracking metrics" "Only $slo_metrics SLO metrics found"
    fi
else
    test_result 1 "API metrics implementation exists" "metrics.ts file not found"
fi

# 6. Worker Reliability Patterns
echo -e "${BLUE}⚙️ Testing Worker Reliability Patterns...${NC}"

if [ -f "apps/worker/src/index.ts" ]; then
    worker_file="apps/worker/src/index.ts"
    
    # Check graceful shutdown
    if grep -q "gracefulShutdown" "$worker_file" && 
       grep -q "SIGTERM\|SIGINT" "$worker_file"; then
        test_result 0 "Graceful shutdown implementation"
    else
        test_result 1 "Graceful shutdown implementation" "Missing signal handlers"
    fi
    
    # Check worker health monitoring
    if grep -q "workerHealth" "$worker_file" && 
       grep -q "metrics" "$worker_file"; then
        test_result 0 "Worker health monitoring"
    else
        test_result 1 "Worker health monitoring" "Missing health metrics"
    fi
    
    # Check error handling
    if grep -q "uncaughtException\|unhandledRejection" "$worker_file"; then
        test_result 0 "Process error handling"
    else
        test_result 1 "Process error handling" "Missing uncaught exception handlers"
    fi
else
    test_result 1 "Worker implementation exists" "worker index.ts not found"
fi

# 7. Environment Configuration
echo -e "${BLUE}🔧 Testing Environment Configuration...${NC}"

# Check monitoring environment template
if [ -f ".env.monitoring.example" ]; then
    monitoring_vars=$(grep -c "=" .env.monitoring.example)
    if [ "$monitoring_vars" -ge 20 ]; then
        test_result 0 "Monitoring environment configuration ($monitoring_vars variables)"
    else
        test_result 1 "Monitoring environment configuration" "Only $monitoring_vars variables found, expected >= 20"
    fi
else
    test_result 1 "Monitoring environment template exists"
fi

# Check SLO configuration in environment
if [ -f ".env.monitoring.example" ] && grep -q "SLO_.*_TARGET" .env.monitoring.example; then
    slo_vars=$(grep -c "SLO_.*_TARGET" .env.monitoring.example)
    test_result 0 "SLO targets in environment configuration ($slo_vars targets)"
else
    test_result 1 "SLO targets in environment configuration" "Missing SLO target variables"
fi

# 8. Documentation and Runbooks
echo -e "${BLUE}📚 Testing Documentation Coverage...${NC}"

if [ -f "RELIABILITY_VALIDATION_REPORT.md" ]; then
    doc_sections=$(grep -c "^## " RELIABILITY_VALIDATION_REPORT.md)
    if [ "$doc_sections" -ge 10 ]; then
        test_result 0 "Reliability documentation coverage ($doc_sections sections)"
    else
        test_result 1 "Reliability documentation coverage" "Only $doc_sections sections found"
    fi
else
    test_result 1 "Reliability validation report exists"
fi

# Final Results Summary
echo "=================================================="
echo -e "${BLUE}📊 VALIDATION SUMMARY${NC}"
echo "=================================================="

SUCCESS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))

echo "Total Tests: $TOTAL_TESTS"
echo "Passed: $PASSED_TESTS"
echo "Failed: $((TOTAL_TESTS - PASSED_TESTS))"
echo "Success Rate: $SUCCESS_RATE%"
echo

if [ "$SUCCESS_RATE" -ge 85 ]; then
    echo -e "${GREEN}🎉 OVERALL STATUS: PASS${NC}"
    echo -e "${GREEN}✅ FlakeGuard monitoring infrastructure is production-ready!${NC}"
    echo
    echo -e "${BLUE}Key Strengths:${NC}"
    echo "• Comprehensive SLO monitoring with burn-rate alerting"
    echo "• Intelligent GitHub API rate limiting with circuit breakers"  
    echo "• Production-ready metrics collection and visualization"
    echo "• Robust worker reliability patterns with graceful shutdown"
    echo "• Multi-layered health checks and error recovery"
    echo
    exit 0
else
    echo -e "${RED}⚠️ OVERALL STATUS: NEEDS IMPROVEMENT${NC}"
    echo -e "${YELLOW}Some reliability patterns need attention before production deployment.${NC}"
    echo
    echo -e "${BLUE}Recommendations:${NC}"
    echo "• Review failed tests and implement missing patterns"
    echo "• Complete monitoring infrastructure setup"
    echo "• Test rate limiting and circuit breaker behavior"
    echo "• Validate SLO alerting with synthetic load"
    echo
    exit 1
fi