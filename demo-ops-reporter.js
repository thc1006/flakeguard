#!/usr/bin/env node

/**
 * Demo script for FlakeGuard Ops Reporter
 * Tests risk scoring and SLA breach detection functionality
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

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
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function setupDemo() {
  console.log('📊 FlakeGuard Ops Reporter Demo');
  console.log('═'.repeat(50));

  try {
    // Ensure .flakeguard directory exists
    console.log('\n📁 Creating .flakeguard directory...');
    mkdirSync('.flakeguard', { recursive: true });

    // Build the CLI tools
    console.log('\n🔨 Building CLI tools...');
    await runCommand('pnpm', ['--filter', '@flakeguard/cli', 'build']);

    // Set working directory to packages/cli for binary execution
    const cliDir = join(__dirname, 'packages', 'cli');
    
    console.log('\n📊 SCENARIO 1: Risk Assessment with Mock Data');
    console.log('─'.repeat(50));
    console.log('Testing risk scoring with simulated test metrics...\n');
    
    await runCommand('node', ['dist/ops-reporter.js', 'report'], {
      cwd: cliDir
    });

    console.log('\n📊 SCENARIO 2: Risk Assessment with Custom SLA Policy');
    console.log('─'.repeat(60));
    console.log('Testing with stricter SLA limits (3 days, 2 attempts)...\n');
    
    await runCommand('node', ['dist/ops-reporter.js', 'report', '--max-days', '3', '--max-attempts', '2'], {
      cwd: cliDir
    });

    console.log('\n📊 SCENARIO 3: JSON Output Format');
    console.log('─'.repeat(40));
    console.log('Generating machine-readable JSON report...\n');
    
    await runCommand('node', ['dist/ops-reporter.js', 'report', '--format', 'json'], {
      cwd: cliDir
    });

    console.log('\n✅ Demo completed successfully!');
    console.log('\n📋 Summary of Ops Reporter Features:');
    console.log('   🎯 Risk Score Calculation: f(volatility, entropy, density)');
    console.log('   ⚠️  SLA Breach Detection: quarantine days & attempt limits');
    console.log('   📊 Risk Badges: 🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low');
    console.log('   📈 Sorted Risk Table: highest risk tests first');
    console.log('   📋 Summary Statistics: breaches, critical risks');
    console.log('   🔄 Multiple Output Formats: table, JSON');
    console.log('   ⚙️  Configurable SLA Policies: custom thresholds');

  } catch (error) {
    console.error(`\n❌ Demo failed: ${error.message}`);
    
    if (error.message.includes('not found') || error.message.includes('No such file')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   1. Run "pnpm install" to install dependencies');
      console.log('   2. Run "pnpm --filter @flakeguard/cli build" to build CLI tools');
      console.log('   3. Ensure you are in the FlakeGuard root directory');
    }
    
    process.exit(1);
  }
}

// Run the demo
setupDemo();