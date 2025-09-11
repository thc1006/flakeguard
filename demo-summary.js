#!/usr/bin/env node

/**
 * Demo script for FlakeGuard Summary Generator
 * Tests rich Markdown report generation for GitHub Actions job summaries
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
  console.log('📊 FlakeGuard Job Summary Generator Demo');
  console.log('═'.repeat(50));

  try {
    // Ensure .flakeguard directory exists
    console.log('\n📁 Creating .flakeguard directories...');
    mkdirSync('.flakeguard/out', { recursive: true });

    // Build the CLI tools
    console.log('\n🔨 Building CLI tools...');
    await runCommand('pnpm', ['--filter', '@flakeguard/cli', 'build']);

    // Set working directory to packages/cli for binary execution
    const cliDir = join(__dirname, 'packages', 'cli');
    
    console.log('\n📊 SCENARIO 1: Rich Summary with Test Data');
    console.log('─'.repeat(50));
    console.log('Generating comprehensive FlakeGuard summary report...\n');
    
    await runCommand('node', [
      'dist/summary.js', 'generate',
      '--report', '../../.flakeguard/out/report.json',
      '--quarantine', '../../.flakeguard/quarantine.yml',
      '--sha', 'a1b2c3d4e5f6789',
      '--run-id', '12345678',
      '--artifacts', 'https://github.com/example/flakeguard/actions/runs/12345678/artifacts',
      '--output', 'demo-summary.md'
    ], {
      cwd: cliDir
    });

    console.log('\n📊 SCENARIO 2: Summary with Environment Variables');
    console.log('─'.repeat(60));
    console.log('Testing with GitHub Actions environment simulation...\n');
    
    // Set environment variables to simulate GitHub Actions
    const env = {
      ...process.env,
      GITHUB_STEP_SUMMARY: join(cliDir, 'github-summary.md'),
      GITHUB_SHA: 'a1b2c3d4e5f6789abcdef',
      GITHUB_RUN_ID: '87654321'
    };
    
    await runCommand('node', [
      'dist/summary.js', 'generate',
      '--report', '../../.flakeguard/out/report.json',
      '--quarantine', '../../.flakeguard/quarantine.yml'
    ], {
      cwd: cliDir,
      env
    });

    console.log('\n📊 SCENARIO 3: Fallback Summary (No Data)');
    console.log('─'.repeat(45));
    console.log('Testing fallback behavior with missing data...\n');
    
    await runCommand('node', [
      'dist/summary.js', 'generate',
      '--report', 'missing-report.json',
      '--quarantine', 'missing-quarantine.yml',
      '--output', 'fallback-summary.md'
    ], {
      cwd: cliDir
    });

    console.log('\n✅ Demo completed successfully!');
    console.log('\n📋 Generated Summary Files:');
    console.log('   📄 demo-summary.md - Full summary with test data');
    console.log('   📄 github-summary.md - GitHub Actions simulation');
    console.log('   📄 fallback-summary.md - Fallback mode demo');
    
    console.log('\n📊 Summary Features Demonstrated:');
    console.log('   🎯 Top flaky tests by frequency × volatility');
    console.log('   🔒 Quarantine status with TTL and ownership');
    console.log('   🖥️ Environment analysis and failure correlation');
    console.log('   💡 Actionable recommendations and insights');
    console.log('   📈 Rich Markdown formatting with tables and badges');
    console.log('   ⏰ Timestamp and commit SHA tracking');
    console.log('   🔗 Artifact links and GitHub integration');
    console.log('   ✅ Overall health status (Green/Yellow/Red)');

  } catch (error) {
    console.error(`\n❌ Demo failed: ${error.message}`);
    
    if (error.message.includes('not found') || error.message.includes('No such file')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   1. Run "pnpm install" to install dependencies');
      console.log('   2. Run "pnpm --filter @flakeguard/cli build" to build CLI tools');
      console.log('   3. Ensure you are in the FlakeGuard root directory');
      console.log('   4. Check that .flakeguard/out/report.json exists');
    }
    
    process.exit(1);
  }
}

// Run the demo
setupDemo();