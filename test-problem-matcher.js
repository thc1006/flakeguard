#!/usr/bin/env node

/**
 * Test Problem Matcher Functionality
 * 
 * This script generates output that should be captured by our GitHub Actions
 * problem matchers to create PR annotations.
 */

console.log('🧪 Testing GitHub Actions Problem Matchers');
console.log('==========================================');
console.log('');

console.log('📋 The following lines should generate PR annotations:');
console.log('');

// Test FlakeGuard-specific patterns
console.log('[FLAKY] Auth token validation in src/auth/auth.test.ts:14 - Random timeout behavior detected');
console.log('[FAILED] Payment timeout handling in src/payment/payment.test.ts:25 - Network timeout error');
console.log('[QUARANTINED] Modal flicker test in src/ui/modal.test.ts:18 - Known flaky test quarantined for 7 days');
console.log('');

// Test Vitest patterns
console.log('FAIL src/auth/auth.test.ts > Authentication Service › should validate JWT token');
console.log('  src/auth/auth.test.ts:14:23');
console.log('');

// Test Jest patterns  
console.log('  ✖ Authentication flow › should handle JWT token validation');
console.log('    at src/auth/auth.test.ts:14:23');
console.log('');

// Test TypeScript patterns
console.log('src/payment/payment.test.ts(25,15): error TS2345: Argument of type \'string\' is not assignable to parameter of type \'number\'');
console.log('');

// Test ESLint patterns
console.log('src/ui/modal.test.ts:18:10: error \'unused-variable\' is never used  @typescript-eslint/no-unused-vars');
console.log('');

console.log('✅ Problem matcher test output complete');
console.log('');
console.log('Expected annotations in PR:');
console.log('- src/auth/auth.test.ts:14 - FlakeGuard analysis warnings');
console.log('- src/payment/payment.test.ts:25 - Test failure and TypeScript error');
console.log('- src/ui/modal.test.ts:18 - Quarantine notice and ESLint warning');