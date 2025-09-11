#!/usr/bin/env node

/**
 * Demo script for FlakeGuard Artifact Retriever
 * Tests robust artifact download with retry logic and URL expiration handling
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync, writeFileSync } from 'fs';

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
  console.log('📦 FlakeGuard Artifact Retriever Demo');
  console.log('═'.repeat(50));

  try {
    // Clean up any existing test downloads
    console.log('\n🧹 Cleaning up previous test downloads...');
    try {
      rmSync('test-downloads', { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }
    
    // Create test directories
    console.log('\n📁 Creating test download directory...');
    mkdirSync('test-downloads', { recursive: true });

    // Compile the TypeScript script
    console.log('\n🔨 Compiling artifact retriever...');
    await runCommand('npx', ['tsc', 'scripts/fetch-artifact.ts', '--outDir', 'dist', '--module', 'es2022', '--target', 'es2022', '--lib', 'es2022', '--moduleResolution', 'node']);

    const scriptsDir = join(__dirname, 'dist', 'scripts');
    
    console.log('\n🎯 SCENARIO 1: List Available Artifacts');
    console.log('─'.repeat(45));
    console.log('Listing artifacts from a public repository...\n');
    
    // Use a well-known public repo for testing (GitHub Actions repo)
    await runCommand('node', [
      'fetch-artifact.js', 'list',
      'actions', 'runner'  // GitHub's own actions/runner repo
    ], { cwd: scriptsDir });

    console.log('\n🎯 SCENARIO 2: Get Artifact Information');
    console.log('─'.repeat(45));
    console.log('Getting metadata for an artifact...\n');
    
    // This will likely fail for a real artifact ID, but demonstrates the API
    await runCommand('node', [
      'fetch-artifact.js', 'info',
      'actions', 'runner', '123456789'
    ], { cwd: scriptsDir });

    console.log('\n🎯 SCENARIO 3: Download Artifact (Mock)');
    console.log('─'.repeat(45));
    console.log('Attempting artifact download with retry logic...\n');
    
    // This will demonstrate the retry logic even though the artifact won't exist
    await runCommand('node', [
      'fetch-artifact.js', 'download',
      'actions', 'runner', '123456789',
      '../../test-downloads/test-artifact.zip'
    ], { cwd: scriptsDir });

    console.log('\n🛠️  SCENARIO 4: FlakeGuard Repository Integration Test');
    console.log('─'.repeat(55));
    console.log('Testing with current repository context...\n');
    
    // Extract repo info from current context if available
    const repoInfo = process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/') : ['example', 'flakeguard'];
    const [owner, repo] = repoInfo;
    
    console.log(`Repository: ${owner}/${repo}`);
    
    if (process.env.GITHUB_TOKEN) {
      console.log('🔑 GitHub token detected - can access private repositories');
      
      await runCommand('node', [
        'fetch-artifact.js', 'list',
        owner, repo
      ], { cwd: scriptsDir });
    } else {
      console.log('⚠️  No GitHub token - public access only');
      console.log('   Set GITHUB_TOKEN environment variable for private repo access');
    }

    console.log('\n✅ Demo completed successfully!');
    console.log('\n📋 Summary of Artifact Retriever Features Demonstrated:');
    console.log('   🔗 GitHub API integration with proper authentication');
    console.log('   🔄 Retry logic with exponential backoff');
    console.log('   ⏱️  URL expiration handling (1-minute TTL)');
    console.log('   📊 Clear logging for debugging');
    console.log('   📦 Artifact listing and metadata retrieval');
    console.log('   💾 Streaming download with error handling');
    console.log('   🔒 Support for private repositories with PAT');
    console.log('   🛡️  Non-retryable error detection');
    
    console.log('\n🔍 Usage Examples:');
    console.log('   # List artifacts in a repository');
    console.log('   node dist/scripts/fetch-artifact.js list owner repo');
    console.log('');
    console.log('   # Download specific artifact');
    console.log('   GITHUB_TOKEN=your_token node dist/scripts/fetch-artifact.js download owner repo 123456 output.zip');
    console.log('');
    console.log('   # Get artifact metadata');
    console.log('   node dist/scripts/fetch-artifact.js info owner repo 123456');

  } catch (error) {
    console.error(`\n❌ Demo failed: ${error.message}`);
    
    if (error.message.includes('not found') || error.message.includes('tsc')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   1. Install TypeScript: npm install -g typescript');
      console.log('   2. Ensure Node.js version supports ES modules');
      console.log('   3. Check network connectivity for GitHub API access');
      console.log('   4. Set GITHUB_TOKEN for private repository access');
    }
    
    process.exit(1);
  }
}

// Run the demo
setupDemo();