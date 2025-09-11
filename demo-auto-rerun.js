#!/usr/bin/env node

/**
 * Demo script for FlakeGuard Auto-Rerun Engine
 * Tests intelligent rerun logic and loop prevention mechanisms
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔧 Running: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: options.cwd || __dirname,
      ...options
    });

    child.on('close', (code) => {
      resolve(code); // Don't reject on non-zero exit codes for demo
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function setupDemo() {
  console.log('🔄 FlakeGuard Auto-Rerun Engine Demo');
  console.log('═'.repeat(50));

  try {
    // Clean up any existing lock files
    console.log('\n🧹 Cleaning up existing lock files...');
    try {
      rmSync('.flakeguard', { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
    
    // Ensure directories exist
    console.log('\n📁 Creating test directories...');
    mkdirSync('.flakeguard/out', { recursive: true });

    // Build the CLI tools
    console.log('\n🔨 Building CLI tools...');
    await runCommand('pnpm', ['--filter', '@flakeguard/cli', 'build']);

    const cliDir = join(__dirname, 'packages', 'cli');
    
    console.log('\n🎯 SCENARIO 1: Flaky-Dominant Failures (Should Trigger Rerun)');
    console.log('─'.repeat(65));
    console.log('Testing with 80% flaky failures - should trigger rerun...\n');
    
    await runCommand('node', [
      'dist/auto-rerun.js', 'analyze',
      '--report', '../../.flakeguard/out/flaky-report.json',
      '--quarantine', '../../.flakeguard/quarantine.yml',
      '--sha', 'demo-sha-flaky-123',
      '--run-id', '11111111',
      '--repository', 'example/flakeguard',
      '--attempt', '1',
      '--method', 'rest',
      '--token', 'demo-token',
      '--dry-run'
    ], { cwd: cliDir });

    console.log('\n🎯 SCENARIO 2: Deterministic-Dominant Failures (Should NOT Trigger Rerun)');
    console.log('─'.repeat(75));
    console.log('Testing with 30% flaky failures - should NOT trigger rerun...\n');
    
    await runCommand('node', [
      'dist/auto-rerun.js', 'analyze',
      '--report', '../../.flakeguard/out/deterministic-report.json',
      '--quarantine', '../../.flakeguard/quarantine.yml',
      '--sha', 'demo-sha-deterministic-456',
      '--run-id', '22222222',
      '--repository', 'example/flakeguard',
      '--attempt', '1',
      '--method', 'rest',
      '--token', 'demo-token',
      '--dry-run'
    ], { cwd: cliDir });

    console.log('\n🔒 SCENARIO 3: Lock File Creation and Prevention');
    console.log('─'.repeat(50));
    console.log('Creating lock file and testing prevention mechanism...\n');
    
    // First run - should create lock and "trigger" rerun
    console.log('📝 First run - creating lock file:');
    await runCommand('node', [
      'dist/auto-rerun.js', 'analyze',
      '--report', '../../.flakeguard/out/flaky-report.json',
      '--quarantine', '../../.flakeguard/quarantine.yml',
      '--sha', 'demo-sha-lock-test-789',
      '--run-id', '33333333',
      '--repository', 'example/flakeguard',
      '--attempt', '1',
      '--method', 'rest',
      '--token', 'demo-token'
      // Note: No --dry-run, so lock file gets created
    ], { cwd: cliDir });

    console.log('\n🚫 Second run - should be prevented by lock:');
    await runCommand('node', [
      'dist/auto-rerun.js', 'analyze',
      '--report', '../../.flakeguard/out/flaky-report.json',
      '--quarantine', '../../.flakeguard/quarantine.yml',
      '--sha', 'demo-sha-lock-test-789',
      '--run-id', '44444444',
      '--repository', 'example/flakeguard',
      '--attempt', '1',
      '--method', 'rest',
      '--token', 'demo-token',
      '--dry-run'
    ], { cwd: cliDir });

    console.log('\n🔄 SCENARIO 4: Second Attempt Prevention');
    console.log('─'.repeat(40));
    console.log('Testing prevention on run attempt > 1...\n');
    
    await runCommand('node', [
      'dist/auto-rerun.js', 'analyze',
      '--report', '../../.flakeguard/out/flaky-report.json',
      '--quarantine', '../../.flakeguard/quarantine.yml',
      '--sha', 'demo-sha-attempt-999',
      '--run-id', '55555555',
      '--repository', 'example/flakeguard',
      '--attempt', '2',  // Second attempt
      '--method', 'rest',
      '--token', 'demo-token',
      '--dry-run'
    ], { cliDir });

    console.log('\n🧪 SCENARIO 5: GitHub CLI Method Test');
    console.log('─'.repeat(40));
    console.log('Testing gh CLI method (will fail gracefully without gh CLI)...\n');
    
    await runCommand('node', [
      'dist/auto-rerun.js', 'analyze',
      '--report', '../../.flakeguard/out/flaky-report.json',
      '--quarantine', '../../.flakeguard/quarantine.yml',
      '--sha', 'demo-sha-gh-cli-111',
      '--run-id', '66666666',
      '--repository', 'example/flakeguard',
      '--attempt', '1',
      '--method', 'gh'  // Force gh CLI method
      // Note: No token, no dry-run - will try actual gh CLI
    ], { cwd: cliDir });

    console.log('\n✅ Demo completed successfully!');
    console.log('\n📋 Summary of Auto-Rerun Features Demonstrated:');
    console.log('   🎯 Flaky-dominant detection (≥70% threshold)');
    console.log('   🔒 SHA-based lock file prevention');
    console.log('   🚫 Maximum 1 rerun per commit enforcement');
    console.log('   🔄 Run attempt number checking');
    console.log('   🛠️ Dual execution methods (REST API + gh CLI)');
    console.log('   📊 Comprehensive failure pattern analysis');
    console.log('   ⚠️ Graceful error handling');
    console.log('   📝 Rich logging and decision transparency');
    
    console.log('\n🔍 Check .flakeguard directory for created lock files:');
    await runCommand('ls', ['-la', '.flakeguard/'], { cwd: cliDir });

  } catch (error) {
    console.error(`\n❌ Demo failed: ${error.message}`);
    
    if (error.message.includes('not found') || error.message.includes('No such file')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   1. Run "pnpm install" to install dependencies');
      console.log('   2. Run "pnpm --filter @flakeguard/cli build" to build CLI tools');
      console.log('   3. Ensure you are in the FlakeGuard root directory');
      console.log('   4. Check that test report files exist in .flakeguard/out/');
    }
    
    process.exit(1);
  }
}

// Run the demo
setupDemo();