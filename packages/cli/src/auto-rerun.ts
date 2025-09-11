#!/usr/bin/env node

/**
 * FlakeGuard Auto-Rerun Engine
 * 
 * Automatically triggers reruns for flaky-dominant test failures with
 * robust loop prevention and comprehensive logging.
 */

import { Command } from 'commander';
import { readFile, writeFile, access, appendFile } from 'fs/promises';
import { join } from 'path';
import { QuarantineValidator } from './quarantine-validator.js';

// Interfaces
interface TestReport {
  timestamp: string;
  runId: string;
  sha: string;
  ref: string;
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    flakyCandidates: number;
    quarantinedTests: number;
  };
  failures: TestFailure[];
}

interface TestFailure {
  testKey: string;
  name: string;
  file: string;
  line?: number;
  message: string;
  isFlaky: boolean;
  isQuarantined: boolean;
  volatility: number;
  frequency: number;
}

interface RerunDecision {
  shouldRerun: boolean;
  reason: string;
  flakyCoverage: number;
  quarantineCoverage: number;
  unquarantinedFlakes: number;
  deterministicFailures: number;
  lockFileExists: boolean;
  previousRerunAttempts: number;
}

interface RerunLock {
  sha: string;
  timestamp: string;
  runId: string;
  attempt: number;
  reason: string;
  triggeredBy: string;
}

class AutoRerunEngine {
  private readonly lockDir = '.flakeguard';
  private readonly maxRerunsPerSha = 1;
  private readonly flakeDominanceThreshold = 0.7; // 70% of failures must be flaky

  /**
   * Check if a rerun lock exists for the given SHA
   */
  async checkRerunLock(sha: string): Promise<{ exists: boolean; lock?: RerunLock }> {
    const lockFile = join(this.lockDir, `.rerun.lock.${sha}`);
    
    try {
      await access(lockFile);
      const lockData = await readFile(lockFile, 'utf-8');
      const lock = JSON.parse(lockData) as RerunLock;
      return { exists: true, lock };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Create a rerun lock file to prevent duplicate reruns
   */
  async createRerunLock(sha: string, runId: string, attempt: number, reason: string): Promise<void> {
    const lockFile = join(this.lockDir, `.rerun.lock.${sha}`);
    
    const lock: RerunLock = {
      sha,
      timestamp: new Date().toISOString(),
      runId,
      attempt,
      reason,
      triggeredBy: process.env.GITHUB_ACTOR || 'flakeguard-auto-rerun'
    };

    await writeFile(lockFile, JSON.stringify(lock, null, 2));
    console.log(`✅ Created rerun lock: ${lockFile}`);
  }

  /**
   * Load test report data
   */
  async loadTestReport(reportPath: string): Promise<TestReport | null> {
    try {
      const reportData = await readFile(reportPath, 'utf-8');
      return JSON.parse(reportData) as TestReport;
    } catch (error) {
      console.warn(`⚠️ Could not load test report from ${reportPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Load quarantine configuration
   */
  async loadQuarantineData(configPath: string): Promise<string[]> {
    try {
      const validator = new QuarantineValidator();
      const result = await validator.validateFile(configPath);
      
      if (!result.isValid || !result.config) {
        return [];
      }

      return result.config.quarantined_tests.map((entry: any) => entry.test_key);
    } catch (error) {
      console.warn(`⚠️ Could not load quarantine data from ${configPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Analyze whether reruns should be triggered based on failure patterns
   */
  async analyzeRerunDecision(
    report: TestReport | null,
    quarantinedTests: string[],
    sha: string,
    currentAttempt: number
  ): Promise<RerunDecision> {
    
    const lockCheck = await this.checkRerunLock(sha);
    
    // Default decision - no rerun
    const defaultDecision: RerunDecision = {
      shouldRerun: false,
      reason: 'No valid test report available',
      flakyCoverage: 0,
      quarantineCoverage: 0,
      unquarantinedFlakes: 0,
      deterministicFailures: 0,
      lockFileExists: lockCheck.exists,
      previousRerunAttempts: lockCheck.exists ? (lockCheck.lock?.attempt || 0) : 0
    };

    if (!report) {
      return defaultDecision;
    }

    const { failures, summary } = report;
    const { failedTests } = summary;

    if (failedTests === 0) {
      return {
        ...defaultDecision,
        reason: 'No test failures to rerun'
      };
    }

    // Check rerun lock
    if (lockCheck.exists) {
      const lockAttempts = lockCheck.lock?.attempt || 0;
      if (lockAttempts >= this.maxRerunsPerSha) {
        return {
          ...defaultDecision,
          reason: `Maximum reruns (${this.maxRerunsPerSha}) already attempted for SHA ${sha}`,
          previousRerunAttempts: lockAttempts
        };
      }
    }

    // Check if this is already a rerun attempt
    if (currentAttempt > 1) {
      return {
        ...defaultDecision,
        reason: `Already on attempt ${currentAttempt} - no further reruns allowed`
      };
    }

    // Analyze failure patterns
    const flakyFailures = failures.filter(f => f.isFlaky);
    const quarantinedFailures = failures.filter(f => f.isQuarantined || quarantinedTests.includes(f.testKey));
    const unquarantinedFlakes = failures.filter(f => f.isFlaky && !f.isQuarantined && !quarantinedTests.includes(f.testKey));
    const deterministicFailures = failures.filter(f => !f.isFlaky);

    const flakyCoverage = flakyFailures.length / failures.length;
    const quarantineCoverage = quarantinedFailures.length / failures.length;

    // Decision logic: Rerun if flaky-dominant
    const shouldRerun = flakyCoverage >= this.flakeDominanceThreshold;

    let reason: string;
    if (shouldRerun) {
      reason = `Flaky-dominant failures detected (${(flakyCoverage * 100).toFixed(1)}% flaky, threshold: ${(this.flakeDominanceThreshold * 100)}%)`;
    } else if (deterministicFailures.length > flakyFailures.length) {
      reason = `Deterministic failures dominate (${deterministicFailures.length} deterministic vs ${flakyFailures.length} flaky)`;
    } else {
      reason = `Flaky coverage ${(flakyCoverage * 100).toFixed(1)}% below threshold ${(this.flakeDominanceThreshold * 100)}%`;
    }

    return {
      shouldRerun,
      reason,
      flakyCoverage,
      quarantineCoverage,
      unquarantinedFlakes: unquarantinedFlakes.length,
      deterministicFailures: deterministicFailures.length,
      lockFileExists: lockCheck.exists,
      previousRerunAttempts: lockCheck.exists ? (lockCheck.lock?.attempt || 0) : 0
    };
  }

  /**
   * Execute rerun using GitHub CLI (Option A)
   */
  async executeRerunWithGH(runId: string): Promise<{ success: boolean; output: string; error?: string }> {
    const { spawn } = await import('child_process');
    
    return new Promise((resolve) => {
      console.log(`🔄 Triggering rerun using gh CLI for run ${runId}...`);
      
      const child = spawn('gh', ['run', 'rerun', runId, '--failed'], {
        stdio: 'pipe',
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: stdout
          });
        } else {
          resolve({
            success: false,
            output: stderr,
            error: `gh CLI failed with exit code ${code}`
          });
        }
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          output: '',
          error: `Failed to execute gh CLI: ${error.message}`
        });
      });
    });
  }

  /**
   * Execute rerun using GitHub REST API (Option B)
   */
  async executeRerunWithREST(repository: string, runId: string, token: string): Promise<{ success: boolean; output: string; error?: string }> {
    const [owner, repo] = repository.split('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`;

    console.log(`🔄 Triggering rerun using REST API for run ${runId}...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'FlakeGuard-Auto-Rerun/1.0'
        }
      });

      if (response.ok) {
        return {
          success: true,
          output: `Successfully triggered rerun for run ${runId}`
        };
      } else {
        const errorText = await response.text();
        return {
          success: false,
          output: errorText,
          error: `REST API failed with status ${response.status}: ${response.statusText}`
        };
      }
    } catch (error) {
      return {
        success: false,
        output: '',
        error: `REST API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Log rerun action to GitHub Step Summary
   */
  async logRerunToSummary(decision: RerunDecision, rerunResult: { success: boolean; output: string; error?: string }, sha: string, runId: string): Promise<void> {
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryFile) {
      console.log('📋 GITHUB_STEP_SUMMARY not set, logging to console');
      this.printRerunSummary(decision, rerunResult, sha, runId);
      return;
    }

    const timestamp = new Date().toISOString();
    const statusEmoji = rerunResult.success ? '✅' : '❌';
    
    let summary = `\n## ${statusEmoji} FlakeGuard Auto-Rerun Report\n\n`;
    summary += `**Timestamp:** ${timestamp}\n`;
    summary += `**Commit SHA:** \`${sha}\`\n`;
    summary += `**Run ID:** ${runId}\n`;
    summary += `**Decision:** ${decision.shouldRerun ? 'RERUN TRIGGERED' : 'NO RERUN'}\n\n`;

    // Decision analysis
    summary += `### 📊 Failure Analysis\n\n`;
    summary += `| Metric | Value |\n`;
    summary += `|--------|-------|\n`;
    summary += `| **Flaky Coverage** | ${(decision.flakyCoverage * 100).toFixed(1)}% |\n`;
    summary += `| **Quarantine Coverage** | ${(decision.quarantineCoverage * 100).toFixed(1)}% |\n`;
    summary += `| **Unquarantined Flakes** | ${decision.unquarantinedFlakes} |\n`;
    summary += `| **Deterministic Failures** | ${decision.deterministicFailures} |\n`;
    summary += `| **Previous Rerun Attempts** | ${decision.previousRerunAttempts} |\n\n`;

    // Decision reason
    summary += `### 🤔 Decision Reasoning\n\n`;
    summary += `${decision.reason}\n\n`;

    // Rerun result
    if (decision.shouldRerun) {
      summary += `### 🔄 Rerun Execution\n\n`;
      if (rerunResult.success) {
        summary += `✅ **Rerun successfully triggered**\n\n`;
        summary += `${rerunResult.output}\n\n`;
      } else {
        summary += `❌ **Rerun failed**\n\n`;
        summary += `**Error:** ${rerunResult.error || 'Unknown error'}\n\n`;
        if (rerunResult.output) {
          summary += `**Output:** \`\`\`\n${rerunResult.output}\n\`\`\`\n\n`;
        }
      }
    }

    // Lock file status
    summary += `### 🔒 Rerun Protection\n\n`;
    if (decision.lockFileExists) {
      summary += `🔒 Lock file exists for SHA \`${sha}\` (${decision.previousRerunAttempts} previous attempts)\n\n`;
    } else {
      summary += `🔓 No existing lock file for SHA \`${sha}\`\n\n`;
    }

    summary += `---\n`;
    summary += `*FlakeGuard Auto-Rerun v1.0.0 - Preventing infinite rerun loops while maximizing CI reliability*\n`;

    try {
      await appendFile(summaryFile, summary);
      console.log(`✅ Rerun report added to GitHub Step Summary`);
    } catch (error) {
      console.error(`❌ Failed to write to step summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.printRerunSummary(decision, rerunResult, sha, runId);
    }
  }

  /**
   * Print rerun summary to console
   */
  private printRerunSummary(decision: RerunDecision, rerunResult: { success: boolean; output: string; error?: string }, sha: string, runId: string): void {
    console.log('\n📋 FlakeGuard Auto-Rerun Summary');
    console.log('═'.repeat(40));
    console.log(`SHA: ${sha}`);
    console.log(`Run ID: ${runId}`);
    console.log(`Decision: ${decision.shouldRerun ? 'RERUN' : 'NO RERUN'}`);
    console.log(`Reason: ${decision.reason}`);
    console.log(`Flaky Coverage: ${(decision.flakyCoverage * 100).toFixed(1)}%`);
    console.log(`Previous Attempts: ${decision.previousRerunAttempts}`);
    
    if (decision.shouldRerun) {
      console.log(`Rerun Result: ${rerunResult.success ? 'SUCCESS' : 'FAILED'}`);
      if (!rerunResult.success && rerunResult.error) {
        console.log(`Error: ${rerunResult.error}`);
      }
    }
  }
}

// CLI Commands
async function rerunCommand(options: {
  report?: string;
  quarantine?: string;
  sha?: string;
  runId?: string;
  repository?: string;
  attempt?: string;
  token?: string;
  method?: 'gh' | 'rest' | 'auto';
  dryRun?: boolean;
}) {
  const engine = new AutoRerunEngine();
  
  const reportPath = options.report || '.flakeguard/out/report.json';
  const quarantinePath = options.quarantine || '.flakeguard/quarantine.yml';
  const sha = options.sha || process.env.GITHUB_SHA || 'unknown';
  const runId = options.runId || process.env.GITHUB_RUN_ID || 'unknown';
  const repository = options.repository || process.env.GITHUB_REPOSITORY || 'unknown/unknown';
  const currentAttempt = parseInt(options.attempt || process.env.GITHUB_RUN_ATTEMPT || '1');
  const token = options.token || process.env.GITHUB_TOKEN || '';
  const method = options.method || 'auto';
  const dryRun = options.dryRun || false;

  console.log('🔄 FlakeGuard Auto-Rerun Analysis');
  console.log('═'.repeat(40));
  console.log(`Report: ${reportPath}`);
  console.log(`Quarantine: ${quarantinePath}`);
  console.log(`SHA: ${sha}`);
  console.log(`Run ID: ${runId}`);
  console.log(`Repository: ${repository}`);
  console.log(`Current Attempt: ${currentAttempt}`);
  console.log(`Method: ${method}`);
  console.log(`Dry Run: ${dryRun}`);

  try {
    // Load data
    const [report, quarantinedTests] = await Promise.all([
      engine.loadTestReport(reportPath),
      engine.loadQuarantineData(quarantinePath)
    ]);

    // Analyze rerun decision
    const decision = await engine.analyzeRerunDecision(report, quarantinedTests, sha, currentAttempt);
    
    console.log('\n📊 Analysis Results:');
    console.log(`  Should Rerun: ${decision.shouldRerun ? 'YES' : 'NO'}`);
    console.log(`  Reason: ${decision.reason}`);
    console.log(`  Flaky Coverage: ${(decision.flakyCoverage * 100).toFixed(1)}%`);
    console.log(`  Quarantine Coverage: ${(decision.quarantineCoverage * 100).toFixed(1)}%`);
    console.log(`  Previous Attempts: ${decision.previousRerunAttempts}`);

    let rerunResult = { success: false, output: 'Dry run mode - no actual rerun executed' };

    if (decision.shouldRerun && !dryRun) {
      // Create lock file
      await engine.createRerunLock(sha, runId, currentAttempt, decision.reason);

      // Execute rerun
      if (method === 'gh' || (method === 'auto' && token === '')) {
        rerunResult = await engine.executeRerunWithGH(runId);
      } else {
        rerunResult = await engine.executeRerunWithREST(repository, runId, token);
      }
    } else if (decision.shouldRerun && dryRun) {
      console.log('\n🧪 DRY RUN: Would have triggered rerun');
    }

    // Log to GitHub Step Summary
    await engine.logRerunToSummary(decision, rerunResult, sha, runId);

    // Exit with appropriate code
    if (decision.shouldRerun && !rerunResult.success && !dryRun) {
      console.error('\n❌ Rerun execution failed');
      process.exit(1);
    }

    console.log('\n✅ Auto-rerun analysis completed');

  } catch (error) {
    console.error(`❌ Auto-rerun failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}

// CLI Setup
const program = new Command();

program
  .name('flakeguard-auto-rerun')
  .description('FlakeGuard Auto-Rerun Engine for flaky-dominant test failures')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze test failures and trigger rerun if flaky-dominant')
  .option('-r, --report <path>', 'Path to test report JSON file', '.flakeguard/out/report.json')
  .option('-q, --quarantine <path>', 'Path to quarantine config file', '.flakeguard/quarantine.yml')
  .option('--sha <sha>', 'Git commit SHA (defaults to GITHUB_SHA)')
  .option('--run-id <id>', 'GitHub Actions run ID (defaults to GITHUB_RUN_ID)')
  .option('--repository <repo>', 'Repository in owner/repo format (defaults to GITHUB_REPOSITORY)')
  .option('--attempt <num>', 'Current run attempt number (defaults to GITHUB_RUN_ATTEMPT)')
  .option('--token <token>', 'GitHub token for REST API (defaults to GITHUB_TOKEN)')
  .option('--method <method>', 'Rerun method: gh, rest, or auto', 'auto')
  .option('--dry-run', 'Analyze only, do not trigger actual reruns')
  .action(rerunCommand);

// Parse CLI arguments or show help
if (process.argv.length === 2) {
  program.help();
} else {
  program.parse();
}

export { AutoRerunEngine, RerunDecision, RerunLock };