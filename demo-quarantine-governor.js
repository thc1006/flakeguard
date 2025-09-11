#!/usr/bin/env node

/**
 * Demo script for FlakeGuard Quarantine Governor
 * Tests quarantine schema validation, CODEOWNERS mapping, and PR comment generation
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
  console.log('🛡️ FlakeGuard Quarantine Governor Demo');
  console.log('═'.repeat(50));

  try {
    // Build the CLI tools
    console.log('\n🔨 Building CLI tools...');
    await runCommand('pnpm', ['--filter', '@flakeguard/cli', 'build']);

    const cliDir = join(__dirname, 'packages', 'cli');
    
    console.log('\n🎯 SCENARIO 1: Quarantine Configuration Validation');
    console.log('─'.repeat(55));
    console.log('Testing schema validation with current quarantine.yml...\n');
    
    await runCommand('node', [
      'dist/quarantine-governor.js', 'validate',
      '../../.flakeguard/quarantine.yml'
    ], { cwd: cliDir });

    console.log('\n🧹 SCENARIO 2: Expired Quarantine Cleanup');
    console.log('─'.repeat(45));
    console.log('Cleaning up expired quarantine entries...\n');
    
    await runCommand('node', [
      'dist/quarantine-governor.js', 'cleanup',
      '../../.flakeguard/quarantine.yml'
    ], { cwd: cliDir });

    console.log('\n👥 SCENARIO 3: Governance Report Generation');
    console.log('─'.repeat(45));
    console.log('Generating PR governance comment with owner mentions...\n');
    
    await runCommand('node', [
      'dist/quarantine-governor.js', 'report',
      '../../.flakeguard/out/flaky-report.json',
      '../../.flakeguard/quarantine.yml'
    ], { cwd: cliDir });

    console.log('\n✅ Demo completed successfully!');
    console.log('\n📋 Summary of Quarantine Governor Features Demonstrated:');
    console.log('   📝 Schema validation with Zod for type safety');
    console.log('   🔒 TTL validation and expired entry cleanup');
    console.log('   📂 CODEOWNERS file parsing and path-to-owner mapping');
    console.log('   💬 Consolidated PR comment generation');
    console.log('   👥 Owner mention system for accountability');
    console.log('   ⏰ Expiring soon warnings (≤7 days)');
    console.log('   🚨 Unquarantined failure detection');
    console.log('   🎯 Governance quick actions');

  } catch (error) {
    console.error(`\n❌ Demo failed: ${error.message}`);
    
    if (error.message.includes('not found') || error.message.includes('No such file')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   1. Run "pnpm install" to install dependencies');
      console.log('   2. Run "pnpm --filter @flakeguard/cli build" to build CLI tools');
      console.log('   3. Ensure you are in the FlakeGuard root directory');
      console.log('   4. Check that test report files exist in .flakeguard/out/');
      console.log('   5. Verify quarantine.yml exists in .flakeguard/');
    }
    
    process.exit(1);
  }
}

// Run the demo
setupDemo();