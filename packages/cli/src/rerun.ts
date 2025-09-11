#!/usr/bin/env tsx

/**
 * FlakeGuard Auto-Rerun Script
 * 
 * Triggers a single rerun of failed jobs when failures are flaky-dominated.
 * Uses GitHub CLI to trigger reruns and prevents infinite loops.
 */

import { program } from 'commander';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import { spawn } from 'child_process';

// =============================================================================
// Types
// =============================================================================

interface RerunOptions {
  runId: string;
  repository: string;
  sha: string;
  maxAttempts: number;
  currentAttempt: number;
  dryRun: boolean;
}

interface RerunResult {
  success: boolean;
  triggered: boolean;
  message: string;
  newRunId?: string;
  error?: string;
}

// =============================================================================
// Rerun Logic
// =============================================================================

class FlakeGuardRerunner {
  
  async triggerRerun(options: RerunOptions): Promise<RerunResult> {
    console.log(chalk.blue('🔄 FlakeGuard Auto-Rerun'));
    console.log(chalk.gray(`Repository: ${options.repository}`));
    console.log(chalk.gray(`Run ID: ${options.runId}`));
    console.log(chalk.gray(`SHA: ${options.sha}`));
    console.log(chalk.gray(`Attempt: ${options.currentAttempt}/${options.maxAttempts}`));
    console.log();

    // Check if we've exceeded max attempts
    if (options.currentAttempt >= options.maxAttempts) {
      return {
        success: false,
        triggered: false,
        message: `Maximum rerun attempts (${options.maxAttempts}) reached`,
        error: 'Max attempts exceeded'
      };
    }

    // Check if this is already a rerun attempt
    if (options.currentAttempt > 1) {
      return {
        success: false,
        triggered: false,
        message: `Already attempted rerun (attempt ${options.currentAttempt})`,
        error: 'Already retried'
      };
    }

    if (options.dryRun) {
      console.log(chalk.yellow('🧪 Dry run mode - rerun would be triggered'));
      return {
        success: true,
        triggered: false,
        message: 'Dry run: rerun would be triggered'
      };
    }

    // Trigger the rerun using GitHub CLI
    return await this.executeRerun(options);
  }

  private async executeRerun(options: RerunOptions): Promise<RerunResult> {
    try {
      console.log(chalk.blue('🚀 Triggering rerun of failed jobs...'));
      
      // Use GitHub CLI to rerun failed jobs
      const result = await this.runCommand('gh', [
        'run', 'rerun', options.runId,
        '--failed',
        '--repo', options.repository
      ]);

      if (result.success) {
        console.log(chalk.green('✅ Rerun triggered successfully'));
        return {
          success: true,
          triggered: true,
          message: 'Auto-rerun triggered for failed jobs',
          newRunId: options.runId // Same run ID but new attempt
        };
      } else {
        console.error(chalk.red('❌ Failed to trigger rerun:'), result.error);
        return {
          success: false,
          triggered: false,
          message: 'Failed to trigger rerun',
          error: result.error
        };
      }
    } catch (error) {
      console.error(chalk.red('❌ Error during rerun execution:'), error);
      return {
        success: false,
        triggered: false,
        message: 'Error during rerun execution',
        error: String(error)
      };
    }
  }

  private runCommand(command: string, args: string[]): Promise<{success: boolean; output?: string; error?: string}> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, { 
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout.trim() });
        } else {
          resolve({ 
            success: false, 
            error: stderr.trim() || stdout.trim() || `Command failed with exit code ${code}`
          });
        }
      });

      proc.on('error', (error) => {
        resolve({ 
          success: false, 
          error: `Failed to spawn command: ${error.message}`
        });
      });
    });
  }

  async logRerunSummary(result: RerunResult, options: RerunOptions): Promise<void> {
    // Log to GitHub Actions summary if available
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    
    if (summaryFile) {
      try {
        let summaryContent = '';
        
        if (result.triggered) {
          summaryContent = `### 🔄 FlakeGuard Auto-Rerun Triggered

**Status:** ✅ Rerun Successful
**Action:** Triggered rerun of failed jobs
**Reason:** Flaky-dominated failures detected
**Run ID:** [\`${options.runId}\`](https://github.com/${options.repository}/actions/runs/${options.runId})
**SHA:** \`${options.sha.substring(0, 8)}\`
**Attempt:** ${options.currentAttempt}/${options.maxAttempts}

> Auto-rerun was triggered because most failures appear to be from known flaky tests. The pipeline will retry failed jobs once to filter out transient issues.

`;
        } else {
          summaryContent = `### 🔄 FlakeGuard Auto-Rerun

**Status:** ⏸️ Rerun Skipped  
**Reason:** ${result.message}
**Run ID:** [\`${options.runId}\`](https://github.com/${options.repository}/actions/runs/${options.runId})
**SHA:** \`${options.sha.substring(0, 8)}\`
**Attempt:** ${options.currentAttempt}/${options.maxAttempts}

> ${result.error ? `Error: ${result.error}` : 'Conditions for auto-rerun were not met.'}

`;
        }

        await fs.appendFile(summaryFile, summaryContent, 'utf-8');
        console.log(chalk.gray('📋 Added summary to GitHub Actions step summary'));
      } catch (error) {
        console.warn(chalk.yellow('⚠️  Failed to write to GitHub Actions summary:'), error);
      }
    }
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  program
    .name('flakeguard-rerun')
    .description('Trigger auto-rerun of failed jobs for flaky-dominated failures')
    .requiredOption('--run-id <id>', 'GitHub Actions run ID to rerun')
    .requiredOption('--repository <repo>', 'Repository in owner/repo format')
    .requiredOption('--sha <sha>', 'Git commit SHA')
    .option('--max-attempts <number>', 'Maximum number of rerun attempts', '2')
    .option('--current-attempt <number>', 'Current attempt number', '1')
    .option('--dry-run', 'Show what would be done without actually triggering rerun')
    .option('--verbose', 'Enable verbose output')
    .parse();

  const options = program.opts();
  
  try {
    const rerunner = new FlakeGuardRerunner();
    
    const rerunOptions: RerunOptions = {
      runId: options.runId,
      repository: options.repository,
      sha: options.sha,
      maxAttempts: parseInt(options.maxAttempts),
      currentAttempt: parseInt(options.currentAttempt),
      dryRun: !!options.dryRun
    };
    
    const result = await rerunner.triggerRerun(rerunOptions);
    
    // Log summary
    await rerunner.logRerunSummary(result, rerunOptions);
    
    // Print final status
    console.log();
    if (result.success) {
      if (result.triggered) {
        console.log(chalk.green('🎉 Auto-rerun: TRIGGERED'));
        console.log(chalk.gray('The workflow will restart with failed jobs only'));
      } else {
        console.log(chalk.yellow('⏸️  Auto-rerun: SKIPPED'));
        console.log(chalk.gray(result.message));
      }
      process.exit(0);
    } else {
      console.log(chalk.red('❌ Auto-rerun: FAILED'));
      console.log(chalk.red(result.error || result.message));
      process.exit(1);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Rerun execution failed:'), error);
    process.exit(1);
  }
}

// Run main function if this script is executed directly
const scriptPath = import.meta.url;
const argv1 = process.argv[1];
const isMainModule = argv1 && (
  scriptPath === `file://${argv1}` || 
  argv1.endsWith('rerun.js')
);

if (isMainModule) {
  main().catch(console.error);
}

export { FlakeGuardRerunner };