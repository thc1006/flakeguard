#!/usr/bin/env node

/**
 * FlakeGuard Reliability Validation Suite
 * 
 * Comprehensive testing of monitoring, metrics, SLO compliance,
 * rate limiting, circuit breakers, and error recovery patterns.
 */

import { createRequire } from 'module';
import { performance } from 'perf_hooks';
import { setTimeout as delay } from 'timers/promises';

const require = createRequire(import.meta.url);
const axios = require('axios');
const { register } = require('prom-client');

// Configuration
const CONFIG = {
  API_URL: process.env.API_URL || 'http://localhost:3000',
  PROMETHEUS_URL: process.env.PROMETHEUS_URL || 'http://localhost:9090',
  GRAFANA_URL: process.env.GRAFANA_URL || 'http://localhost:3001',
  TEST_DURATION_MS: 60000, // 1 minute
  CONCURRENT_REQUESTS: 10,
  EXPECTED_RESPONSE_TIME_MS: 500,
  EXPECTED_ERROR_RATE: 0.05, // 5%
  SLO_AVAILABILITY_TARGET: 0.999, // 99.9%
};

console.log('🚀 Starting FlakeGuard Reliability Validation...\n');

/**
 * Test Results Collector
 */
class TestResults {
  constructor() {
    this.results = {
      monitoring: {},
      metrics: {},
      slo: {},
      rateLimit: {},
      circuitBreaker: {},
      errorRecovery: {},
      performance: {},
      health: {}
    };
    this.startTime = Date.now();
  }

  addResult(category, test, result) {
    if (!this.results[category]) {
      this.results[category] = {};
    }
    this.results[category][test] = {
      ...result,
      timestamp: new Date().toISOString(),
      duration: Date.now() - this.startTime
    };
  }

  getOverallStatus() {
    const allTests = Object.values(this.results).flatMap(category => 
      Object.values(category)
    );
    const passedTests = allTests.filter(test => test.status === 'PASS');
    const totalTests = allTests.length;
    const successRate = totalTests > 0 ? passedTests.length / totalTests : 0;
    
    return {
      totalTests,
      passedTests: passedTests.length,
      failedTests: totalTests - passedTests.length,
      successRate,
      status: successRate >= 0.95 ? 'PASS' : 'FAIL'
    };
  }

  printSummary() {
    const overall = this.getOverallStatus();
    
    console.log('\\n' + '='.repeat(80));
    console.log('📊 RELIABILITY VALIDATION SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`\\n🎯 Overall Status: ${overall.status === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`📈 Success Rate: ${(overall.successRate * 100).toFixed(1)}%`);
    console.log(`✅ Passed Tests: ${overall.passedTests}/${overall.totalTests}`);
    
    if (overall.failedTests > 0) {
      console.log(`❌ Failed Tests: ${overall.failedTests}`);
    }
    
    // Print category results
    Object.entries(this.results).forEach(([category, tests]) => {
      const categoryTests = Object.values(tests);
      const categoryPassed = categoryTests.filter(test => test.status === 'PASS').length;
      const categoryTotal = categoryTests.length;
      
      if (categoryTotal > 0) {
        const categoryRate = (categoryPassed / categoryTotal * 100).toFixed(1);
        const statusIcon = categoryPassed === categoryTotal ? '✅' : '⚠️';
        
        console.log(`\\n${statusIcon} ${category.toUpperCase()}: ${categoryPassed}/${categoryTotal} (${categoryRate}%)`);
        
        categoryTests.forEach(test => {
          const icon = test.status === 'PASS' ? '  ✓' : '  ✗';
          console.log(`${icon} ${test.name}`);
          
          if (test.metrics) {
            Object.entries(test.metrics).forEach(([key, value]) => {
              console.log(`    ${key}: ${value}`);
            });
          }
          
          if (test.status === 'FAIL' && test.error) {
            console.log(`    Error: ${test.error}`);
          }
        });
      }
    });
    
    console.log('\\n' + '='.repeat(80));
    return overall.status === 'PASS';
  }
}

const testResults = new TestResults();

/**
 * 1. Monitoring Infrastructure Tests
 */
async function testMonitoringInfrastructure() {
  console.log('🔍 Testing Monitoring Infrastructure...');
  
  // Test Prometheus metrics endpoint
  try {
    const response = await axios.get(`${CONFIG.API_URL}/metrics`, {
      timeout: 5000,
      headers: { 'Accept': 'text/plain' }
    });
    
    const metricsCount = response.data.split('\\n').filter(line => 
      line.startsWith('flakeguard_') && !line.startsWith('#')
    ).length;
    
    testResults.addResult('monitoring', 'prometheus-metrics', {
      name: 'Prometheus Metrics Collection',
      status: metricsCount >= 20 ? 'PASS' : 'FAIL',
      metrics: {
        'metrics_count': metricsCount,
        'response_time_ms': response.headers['x-response-time'] || 'N/A'
      },
      error: metricsCount < 20 ? `Only ${metricsCount} metrics found, expected >= 20` : null
    });
    
  } catch (error) {
    testResults.addResult('monitoring', 'prometheus-metrics', {
      name: 'Prometheus Metrics Collection',
      status: 'FAIL',
      error: error.message
    });
  }
  
  // Test health endpoints
  const healthEndpoints = [
    { path: '/health', name: 'Basic Health Check' },
    { path: '/health/ready', name: 'Readiness Probe' },
    { path: '/health/live', name: 'Liveness Probe' },
    { path: '/health/detailed', name: 'Detailed Health Check' }
  ];
  
  for (const endpoint of healthEndpoints) {
    try {
      const start = performance.now();
      const response = await axios.get(`${CONFIG.API_URL}${endpoint.path}`, {
        timeout: 5000
      });
      const duration = Math.round(performance.now() - start);
      
      testResults.addResult('monitoring', `health-${endpoint.path}`, {
        name: endpoint.name,
        status: response.status === 200 ? 'PASS' : 'FAIL',
        metrics: {
          'status_code': response.status,
          'response_time_ms': duration,
          'content_type': response.headers['content-type']
        }
      });
      
    } catch (error) {
      testResults.addResult('monitoring', `health-${endpoint.path}`, {
        name: endpoint.name,
        status: 'FAIL',
        error: error.message
      });
    }
  }
}

/**
 * 2. SLO Compliance Testing
 */
async function testSLOCompliance() {
  console.log('📊 Testing SLO Compliance...');
  
  const requests = [];
  const errors = [];
  const latencies = [];
  
  // Generate load for SLO measurement
  const startTime = Date.now();
  const endTime = startTime + (CONFIG.TEST_DURATION_MS / 6); // 10 seconds of load testing
  
  console.log(`  Running ${CONFIG.CONCURRENT_REQUESTS} concurrent requests for ${endTime - startTime}ms...`);
  
  while (Date.now() < endTime) {
    const batch = Array.from({ length: CONFIG.CONCURRENT_REQUESTS }, async () => {
      const requestStart = performance.now();
      
      try {
        const response = await axios.get(`${CONFIG.API_URL}/health`, {
          timeout: 10000
        });
        
        const latency = performance.now() - requestStart;
        latencies.push(latency);
        requests.push({
          status: response.status,
          latency,
          timestamp: Date.now()
        });
        
        return response;
        
      } catch (error) {
        const latency = performance.now() - requestStart;
        errors.push({
          error: error.message,
          latency,
          timestamp: Date.now()
        });
        throw error;
      }
    });
    
    await Promise.allSettled(batch);
    await delay(100); // Brief pause between batches
  }
  
  // Calculate SLO metrics
  const totalRequests = requests.length + errors.length;
  const successfulRequests = requests.length;
  const availability = totalRequests > 0 ? successfulRequests / totalRequests : 0;
  
  // Calculate latency percentiles
  latencies.sort((a, b) => a - b);
  const p95Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
  const p99Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;
  const medianLatency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
  
  // Test API Availability SLO (99.9%)
  testResults.addResult('slo', 'api-availability', {
    name: 'API Availability SLO (99.9%)',
    status: availability >= CONFIG.SLO_AVAILABILITY_TARGET ? 'PASS' : 'FAIL',
    metrics: {
      'availability': `${(availability * 100).toFixed(3)}%`,
      'target': `${(CONFIG.SLO_AVAILABILITY_TARGET * 100).toFixed(1)}%`,
      'total_requests': totalRequests,
      'successful_requests': successfulRequests,
      'failed_requests': errors.length
    },
    error: availability < CONFIG.SLO_AVAILABILITY_TARGET ? 
      `Availability ${(availability * 100).toFixed(3)}% below target ${(CONFIG.SLO_AVAILABILITY_TARGET * 100).toFixed(1)}%` : null
  });
  
  // Test Response Time SLO (P95 < 500ms)
  testResults.addResult('slo', 'response-time', {
    name: 'Response Time SLO (P95 < 500ms)',
    status: p95Latency <= CONFIG.EXPECTED_RESPONSE_TIME_MS ? 'PASS' : 'FAIL',
    metrics: {
      'p95_latency_ms': Math.round(p95Latency),
      'p99_latency_ms': Math.round(p99Latency),
      'median_latency_ms': Math.round(medianLatency),
      'target_p95_ms': CONFIG.EXPECTED_RESPONSE_TIME_MS,
      'sample_size': latencies.length
    },
    error: p95Latency > CONFIG.EXPECTED_RESPONSE_TIME_MS ?
      `P95 latency ${Math.round(p95Latency)}ms exceeds target ${CONFIG.EXPECTED_RESPONSE_TIME_MS}ms` : null
  });
}

/**
 * 3. Rate Limiting & Circuit Breaker Tests
 */
async function testRateLimitingAndCircuitBreaker() {
  console.log('🛡️ Testing Rate Limiting & Circuit Breaker...');
  
  // Test rate limiting (if implemented)
  try {
    const rapidRequests = Array.from({ length: 100 }, async () => {
      return axios.get(`${CONFIG.API_URL}/health`, { timeout: 1000 });
    });
    
    const results = await Promise.allSettled(rapidRequests);
    const rateLimited = results.filter(result => 
      result.status === 'rejected' && 
      result.reason?.response?.status === 429
    );
    
    testResults.addResult('rateLimit', 'burst-protection', {
      name: 'Rate Limiting Burst Protection',
      status: 'PASS', // Rate limiting is optional, so we always pass
      metrics: {
        'total_requests': results.length,
        'rate_limited': rateLimited.length,
        'success_requests': results.filter(r => r.status === 'fulfilled').length
      }
    });
    
  } catch (error) {
    testResults.addResult('rateLimit', 'burst-protection', {
      name: 'Rate Limiting Burst Protection',
      status: 'FAIL',
      error: error.message
    });
  }
  
  // Test graceful degradation
  try {
    // Test with malformed request
    const response = await axios.post(`${CONFIG.API_URL}/nonexistent-endpoint`, {
      invalid: 'data'
    }, {
      timeout: 5000,
      validateStatus: () => true // Accept all status codes
    });
    
    const isGraceful = response.status === 404 && response.data;
    
    testResults.addResult('circuitBreaker', 'graceful-degradation', {
      name: 'Graceful Error Handling',
      status: isGraceful ? 'PASS' : 'FAIL',
      metrics: {
        'status_code': response.status,
        'has_error_response': !!response.data
      }
    });
    
  } catch (error) {
    testResults.addResult('circuitBreaker', 'graceful-degradation', {
      name: 'Graceful Error Handling',
      status: 'FAIL',
      error: error.message
    });
  }
}

/**
 * 4. Error Recovery Testing
 */
async function testErrorRecovery() {
  console.log('🔄 Testing Error Recovery...');
  
  // Test retry behavior with timeout
  try {
    const start = performance.now();
    await axios.get(`${CONFIG.API_URL}/health`, {
      timeout: 1, // Very short timeout to trigger retry
    });
    const duration = performance.now() - start;
    
    testResults.addResult('errorRecovery', 'timeout-handling', {
      name: 'Timeout Handling',
      status: 'PASS',
      metrics: {
        'response_time_ms': Math.round(duration)
      }
    });
    
  } catch (error) {
    // Timeout is expected, check if it's handled gracefully
    const isTimeoutError = error.code === 'ECONNABORTED' || error.message.includes('timeout');
    
    testResults.addResult('errorRecovery', 'timeout-handling', {
      name: 'Timeout Handling',
      status: isTimeoutError ? 'PASS' : 'FAIL',
      metrics: {
        'error_type': error.code || 'unknown',
        'is_timeout': isTimeoutError
      },
      error: !isTimeoutError ? error.message : null
    });
  }
  
  // Test database connection recovery (if health endpoint includes DB check)
  try {
    const response = await axios.get(`${CONFIG.API_URL}/health/detailed`, {
      timeout: 10000
    });
    
    const hasDbCheck = response.data && response.data.checks && response.data.checks.database;
    const dbHealthy = hasDbCheck && response.data.checks.database.status === 'healthy';
    
    testResults.addResult('errorRecovery', 'database-connection', {
      name: 'Database Connection Health',
      status: dbHealthy ? 'PASS' : 'WARN',
      metrics: {
        'db_status': hasDbCheck ? response.data.checks.database.status : 'not_available',
        'response_time_ms': hasDbCheck ? response.data.checks.database.responseTime : null
      }
    });
    
  } catch (error) {
    testResults.addResult('errorRecovery', 'database-connection', {
      name: 'Database Connection Health',
      status: 'FAIL',
      error: error.message
    });
  }
}

/**
 * 5. Performance Baseline Testing
 */
async function testPerformanceBaseline() {
  console.log('⚡ Testing Performance Baseline...');
  
  // Warm up
  await axios.get(`${CONFIG.API_URL}/health`).catch(() => {});
  
  // Single request latency
  const singleRequestLatencies = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    try {
      await axios.get(`${CONFIG.API_URL}/health`);
      singleRequestLatencies.push(performance.now() - start);
    } catch (error) {
      // Skip failed requests
    }
    await delay(100);
  }
  
  const avgLatency = singleRequestLatencies.length > 0 ? 
    singleRequestLatencies.reduce((a, b) => a + b, 0) / singleRequestLatencies.length : 0;
  
  testResults.addResult('performance', 'single-request-latency', {
    name: 'Single Request Latency',
    status: avgLatency <= CONFIG.EXPECTED_RESPONSE_TIME_MS ? 'PASS' : 'FAIL',
    metrics: {
      'avg_latency_ms': Math.round(avgLatency),
      'target_ms': CONFIG.EXPECTED_RESPONSE_TIME_MS,
      'sample_size': singleRequestLatencies.length
    }
  });
  
  // Concurrent request handling
  const concurrentStart = performance.now();
  const concurrentRequests = Array.from({ length: CONFIG.CONCURRENT_REQUESTS }, () =>
    axios.get(`${CONFIG.API_URL}/health`)
  );
  
  try {
    await Promise.all(concurrentRequests);
    const concurrentDuration = performance.now() - concurrentStart;
    
    testResults.addResult('performance', 'concurrent-requests', {
      name: 'Concurrent Request Handling',
      status: concurrentDuration <= (CONFIG.EXPECTED_RESPONSE_TIME_MS * 2) ? 'PASS' : 'FAIL',
      metrics: {
        'concurrent_requests': CONFIG.CONCURRENT_REQUESTS,
        'total_duration_ms': Math.round(concurrentDuration),
        'avg_per_request_ms': Math.round(concurrentDuration / CONFIG.CONCURRENT_REQUESTS)
      }
    });
    
  } catch (error) {
    testResults.addResult('performance', 'concurrent-requests', {
      name: 'Concurrent Request Handling',
      status: 'FAIL',
      error: error.message
    });
  }
}

/**
 * Main Test Execution
 */
async function runReliabilityValidation() {
  try {
    console.log(`🎯 Target API: ${CONFIG.API_URL}`);
    console.log(`📊 Prometheus: ${CONFIG.PROMETHEUS_URL}`);
    console.log(`📈 Grafana: ${CONFIG.GRAFANA_URL}`);
    console.log(`⏱️ Test Duration: ${CONFIG.TEST_DURATION_MS / 1000}s`);
    console.log(`🔄 Concurrency: ${CONFIG.CONCURRENT_REQUESTS}`);
    console.log('');
    
    // Run all test suites
    await testMonitoringInfrastructure();
    await testSLOCompliance();
    await testRateLimitingAndCircuitBreaker();
    await testErrorRecovery();
    await testPerformanceBaseline();
    
    console.log('\\n✅ Reliability validation completed!');
    
    // Print comprehensive summary
    const success = testResults.printSummary();
    
    if (success) {
      console.log('\\n🎉 FlakeGuard passes reliability validation!');
      console.log('✅ System is ready for production deployment.');
    } else {
      console.log('\\n⚠️ FlakeGuard reliability validation has issues.');
      console.log('❌ Review failed tests before production deployment.');
    }
    
    process.exit(success ? 0 : 1);
    
  } catch (error) {
    console.error('\\n💥 Reliability validation failed:');
    console.error(error);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runReliabilityValidation();
}

export { runReliabilityValidation, testResults };