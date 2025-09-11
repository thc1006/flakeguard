#!/usr/bin/env tsx

/**
 * FlakeGuard Pipeline Gate
 * 
 * Implements soft gating to prevent known flaky tests from failing the pipeline.
 * Reads quarantine configuration and test results to determine if pipeline should pass.
 */

import { program } from 'commander';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import { QuarantineValidator } from './quarantine-validator.js';

// =============================================================================
// Types
// =============================================================================

interface QuarantineConfig {
  version: string;
  quarantined_tests: QuarantinedTest[];
  settings?: {
    default_ttl_days?: number;
    max_ttl_days?: number;
    auto_extend_ttl?: boolean;
    notifications?: {
      ttl_warning_days?: number;
      slack_webhook?: string | null;
      notify_teams?: string[];
    };
  };
  metadata?: {
    created_at?: string;
    last_updated?: string;
    updated_by?: string;
  };
}

interface QuarantinedTest {
  test_key: string;
  reason: string;
  quarantined_by?: string;
  quarantined_at: string;
  expires_at: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  jira_ticket?: string;
  owner_team?: string;
}

interface TestFailure {
  testKey: string;
  suite: string;
  className?: string;
  name: string;
  messageHash: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  envHash: string;
  duration?: number;
  attempt: number;
}

interface TestReport {
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    flakyCandidates: number;
    runId: string;
    sha: string;
    ref: string;
    timestamp: string;
  };
  failures: TestFailure[];
  environment: {
    os?: string;
    node?: string;
    runner?: string;
    workflow?: string;
  };
}

interface GateResult {
  shouldPass: boolean;
  totalFailures: number;
  quarantinedFailures: number;
  nonQuarantinedFailures: number;
  expiredQuarantines: number;
  summary: string;
  shouldRerun: boolean;
  rerunReason: string;
  details: {
    quarantinedTests: string[];
    nonQuarantinedTests: string[];
    expiredTests: string[];
    expiringSoonTests: Array<{testKey: string; expiresAt: string; daysLeft: number}>;
    flakyDominanceRatio: number;
    isFirstAttempt: boolean;
  };
}

// =============================================================================
// Gate Logic
// =============================================================================

class FlakeGuardGate {
  
  async evaluateGate(
    quarantineConfigPath: string,
    testReportPath: string,
    runAttempt: number = 1
  ): Promise<GateResult> {
    console.log(chalk.blue('🚪 FlakeGuard Pipeline Gate'));
    console.log(chalk.gray(`Config: ${quarantineConfigPath}`));
    console.log(chalk.gray(`Report: ${testReportPath}`));
    console.log();

    // Load quarantine configuration
    const quarantineConfig = await this.loadQuarantineConfig(quarantineConfigPath);
    
    // Load test report
    const testReport = await this.loadTestReport(testReportPath);

    // Evaluate failures against quarantine
    return this.evaluateFailures(quarantineConfig, testReport, runAttempt);
  }

  private async loadQuarantineConfig(configPath: string): Promise<QuarantineConfig> {
    const validator = new QuarantineValidator();
    
    try {
      const validation = await validator.validateFile(configPath);
      
      if (!validation.isValid) {
        console.log(chalk.red('❌ Invalid quarantine configuration:'));
        validation.errors.forEach(error => {
          console.log(chalk.red(`  • ${error}`));
        });
        
        // Return empty config if validation fails
        return {
          version: '1.0',
          quarantined_tests: [],
          settings: {
            default_ttl_days: 14,
            max_ttl_days: 30,
            notifications: { ttl_warning_days: 3 }
          }
        };
      }

      if (validation.warnings.length > 0) {
        console.log(chalk.yellow('⚠️  Quarantine config warnings:'));
        validation.warnings.forEach(warning => {
          console.log(chalk.yellow(`  • ${warning}`));
        });
      }

      const config = validation.config!;
      console.log(chalk.gray(`📋 Loaded ${config.quarantined_tests?.length || 0} quarantined tests`));
      
      // Generate and display summary with derived fields
      const summary = validator.generateSummary(config);
      console.log(chalk.gray(`📊 Active: ${summary.activeTests}, Expiring: ${summary.expiringSoon}, Expired: ${summary.expired}`));
      
      return config;
    } catch (error) {
      console.log(chalk.yellow('⚠️  No quarantine config found - all failures will block pipeline'));
      return {
        version: '1.0',
        quarantined_tests: [],
        settings: {
          default_ttl_days: 14,
          max_ttl_days: 30,
          notifications: { ttl_warning_days: 3 }
        }
      };
    }
  }

  private async loadTestReport(reportPath: string): Promise<TestReport> {
    try {
      const reportContent = await fs.readFile(reportPath, 'utf-8');
      const report = JSON.parse(reportContent) as TestReport;
      
      console.log(chalk.gray(`📊 Test report: ${report.failures.length} failures from ${report.summary.totalTests} tests`));
      return report;
    } catch (error) {
      throw new Error(`Failed to load test report from ${reportPath}: ${error}`);
    }
  }

  private evaluateFailures(
    quarantineConfig: QuarantineConfig,
    testReport: TestReport,
    runAttempt: number = 1
  ): GateResult {
    const now = new Date();
    const failures = testReport.failures;
    
    // Build lookup map of quarantined tests
    const quarantinedMap = new Map<string, QuarantinedTest>();
    const expiredTests: string[] = [];
    const expiringSoonTests: Array<{testKey: string; expiresAt: string; daysLeft: number}> = [];
    
    for (const quarantinedTest of quarantineConfig.quarantined_tests || []) {
      const expiresAt = new Date(quarantinedTest.expires_at);
      
      if (expiresAt <= now) {
        // Quarantine has expired
        expiredTests.push(quarantinedTest.test_key);
        console.log(chalk.red(`⏰ Quarantine expired: ${this.getShortTestName(quarantinedTest.test_key)}`));
      } else {
        // Check if expiring soon
        const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const warningDays = quarantineConfig.settings?.notifications?.ttl_warning_days || 3;
        
        if (daysLeft <= warningDays) {
          expiringSoonTests.push({
            testKey: quarantinedTest.test_key,
            expiresAt: quarantinedTest.expires_at,
            daysLeft
          });
          console.log(chalk.yellow(`⏳ Quarantine expires soon: ${this.getShortTestName(quarantinedTest.test_key)} (${daysLeft} days)`));
        }
        
        quarantinedMap.set(quarantinedTest.test_key, quarantinedTest);
      }
    }

    // Categorize failures
    const quarantinedFailures: string[] = [];
    const nonQuarantinedFailures: string[] = [];

    for (const failure of failures) {
      if (quarantinedMap.has(failure.testKey)) {
        quarantinedFailures.push(failure.testKey);
        console.log(chalk.green(`✅ Quarantined failure: ${this.getShortTestName(failure.testKey)}`));
      } else {
        nonQuarantinedFailures.push(failure.testKey);
        console.log(chalk.red(`❌ Non-quarantined failure: ${this.getShortTestName(failure.testKey)}`));
      }
    }

    // Calculate flaky dominance ratio
    const totalFailures = failures.length;
    const flakyDominanceRatio = totalFailures > 0 
      ? quarantinedFailures.length / totalFailures 
      : 0;
    
    const isFirstAttempt = runAttempt <= 1;
    
    // Determine gate decision
    const shouldPass = nonQuarantinedFailures.length === 0 && expiredTests.length === 0;
    
    // Determine if rerun should be triggered
    const shouldRerun = this.shouldTriggerRerun(
      totalFailures, 
      quarantinedFailures.length, 
      nonQuarantinedFailures.length,
      expiredTests.length,
      isFirstAttempt,
      flakyDominanceRatio
    );
    
    // Generate rerun reason
    const rerunReason = this.generateRerunReason(
      shouldRerun, 
      flakyDominanceRatio, 
      quarantinedFailures.length,
      nonQuarantinedFailures.length,
      isFirstAttempt
    );
    
    // Generate summary
    let summary = '';
    if (shouldPass) {
      if (quarantinedFailures.length === 0) {
        summary = '✅ All tests passed - pipeline approved';
      } else {
        summary = `✅ ${quarantinedFailures.length} quarantined test(s) failed but pipeline approved`;
      }
    } else {
      const reasons = [];
      if (nonQuarantinedFailures.length > 0) {
        reasons.push(`${nonQuarantinedFailures.length} non-quarantined failure(s)`);
      }
      if (expiredTests.length > 0) {
        reasons.push(`${expiredTests.length} expired quarantine(s)`);
      }
      
      if (shouldRerun && isFirstAttempt) {
        summary = `🔄 Rerun recommended: failures are ${Math.round(flakyDominanceRatio * 100)}% flaky-dominated`;
      } else {
        summary = `❌ Pipeline blocked by ${reasons.join(' and ')}`;
      }
    }

    return {
      shouldPass,
      totalFailures: failures.length,
      quarantinedFailures: quarantinedFailures.length,
      nonQuarantinedFailures: nonQuarantinedFailures.length,
      expiredQuarantines: expiredTests.length,
      summary,
      shouldRerun,
      rerunReason,
      details: {
        quarantinedTests: quarantinedFailures,
        nonQuarantinedTests: nonQuarantinedFailures,
        expiredTests,
        expiringSoonTests,
        flakyDominanceRatio,
        isFirstAttempt
      }
    };
  }

  private getShortTestName(testKey: string): string {
    // Extract test name from testKey format: "suite::name::file"
    const parts = testKey.split('::');
    return parts.length > 1 ? (parts[1] || testKey) : testKey;
  }

  private shouldTriggerRerun(
    totalFailures: number,
    _quarantinedFailures: number,
    nonQuarantinedFailures: number,
    expiredQuarantines: number,
    isFirstAttempt: boolean,
    flakyDominanceRatio: number
  ): boolean {
    // Don't rerun if this isn't the first attempt
    if (!isFirstAttempt) {
      return false;
    }
    
    // Don't rerun if there are no failures
    if (totalFailures === 0) {
      return false;
    }
    
    // Don't rerun if there are expired quarantines (they need attention)
    if (expiredQuarantines > 0) {
      return false;
    }
    
    // Rerun if failures are flaky-dominated (>60% of failures are quarantined)
    // and there are some non-quarantined failures that might be transient
    const flakyDominanceThreshold = 0.6;
    const shouldRerunBasedOnDominance = flakyDominanceRatio >= flakyDominanceThreshold;
    
    // Only rerun if we have a reasonable mix (some flaky, some potentially transient)
    const hasReasonableMix = nonQuarantinedFailures > 0 && nonQuarantinedFailures <= 3;
    
    return shouldRerunBasedOnDominance && hasReasonableMix;
  }

  private generateRerunReason(
    shouldRerun: boolean,
    flakyDominanceRatio: number,
    _quarantinedFailures: number,
    nonQuarantinedFailures: number,
    isFirstAttempt: boolean
  ): string {
    if (!shouldRerun) {
      if (!isFirstAttempt) {
        return 'Rerun not recommended: already attempted retry';
      }
      if (flakyDominanceRatio < 0.6) {
        return 'Rerun not recommended: failures not flaky-dominated';
      }
      if (nonQuarantinedFailures === 0) {
        return 'Rerun not recommended: all failures already quarantined';
      }
      if (nonQuarantinedFailures > 3) {
        return 'Rerun not recommended: too many non-quarantined failures (likely not transient)';
      }
      return 'Rerun not recommended: conditions not met';
    }
    
    return `Rerun recommended: ${Math.round(flakyDominanceRatio * 100)}% flaky dominance ` +
           `with ${nonQuarantinedFailures} potentially transient failure(s)`;
  }

  printGateResult(result: GateResult): void {
    console.log();
    console.log(chalk.bold('🚪 Gate Decision'));
    console.log('================');
    console.log();
    
    // Status
    if (result.shouldPass) {
      console.log(chalk.green.bold(result.summary));
    } else {
      console.log(chalk.red.bold(result.summary));
    }
    
    console.log();
    
    // Statistics
    console.log(chalk.bold('📊 Test Failure Breakdown'));
    console.log(`Total failures: ${result.totalFailures}`);
    console.log(`├─ Quarantined: ${result.quarantinedFailures} ${chalk.gray('(allowed)')}`);
    console.log(`├─ Non-quarantined: ${result.nonQuarantinedFailures} ${result.nonQuarantinedFailures > 0 ? chalk.red('(blocking)') : chalk.gray('(none)')}`);
    console.log(`├─ Expired quarantines: ${result.expiredQuarantines} ${result.expiredQuarantines > 0 ? chalk.red('(blocking)') : chalk.gray('(none)')}`);
    console.log(`└─ Flaky dominance: ${Math.round(result.details.flakyDominanceRatio * 100)}% ${result.details.flakyDominanceRatio >= 0.6 ? chalk.yellow('(high)') : chalk.gray('(low)')}`);
    
    // Rerun recommendation
    if (result.totalFailures > 0) {
      console.log();
      console.log(chalk.bold('🔄 Rerun Analysis'));
      if (result.shouldRerun) {
        console.log(chalk.yellow(`✨ ${result.rerunReason}`));
        if (result.details.isFirstAttempt) {
          console.log(chalk.gray('   Auto-rerun will be triggered to retry potentially transient failures'));
        }
      } else {
        console.log(chalk.gray(`❌ ${result.rerunReason}`));
      }
    }
    // Detailed breakdown
    if (result.details.nonQuarantinedTests.length > 0) {
      console.log();
      console.log(chalk.red.bold('❌ Non-quarantined failures (blocking):'));
      result.details.nonQuarantinedTests.forEach(testKey => {
        console.log(`  • ${this.getShortTestName(testKey)}`);
      });
    }

    if (result.details.expiredTests.length > 0) {
      console.log();
      console.log(chalk.red.bold('⏰ Expired quarantines (blocking):'));
      result.details.expiredTests.forEach(testKey => {
        console.log(`  • ${this.getShortTestName(testKey)}`);
      });
    }

    if (result.details.quarantinedTests.length > 0) {
      console.log();
      console.log(chalk.green.bold('✅ Quarantined failures (allowed):'));
      result.details.quarantinedTests.forEach(testKey => {
        console.log(`  • ${this.getShortTestName(testKey)}`);
      });
    }

    if (result.details.expiringSoonTests.length > 0) {
      console.log();
      console.log(chalk.yellow.bold('⏳ Quarantines expiring soon:'));
      result.details.expiringSoonTests.forEach(test => {
        console.log(`  • ${this.getShortTestName(test.testKey)} (${test.daysLeft} days left)`);
      });
    }

    // Actionable next steps
    if (!result.shouldPass) {
      console.log();
      console.log(chalk.bold('🎯 Next Steps'));
      console.log('To unblock the pipeline:');
      
      if (result.details.nonQuarantinedTests.length > 0) {
        console.log(`1. Fix the ${result.details.nonQuarantinedTests.length} non-quarantined test failure(s)`);
        console.log('   OR quarantine them temporarily if they are flaky');
      }
      
      if (result.details.expiredTests.length > 0) {
        console.log(`2. Either fix or extend TTL for ${result.details.expiredTests.length} expired quarantine(s)`);
      }
      
      console.log();
      console.log(chalk.gray('💡 To quarantine a flaky test:'));
      console.log(chalk.gray('   Add it to .flakeguard/quarantine.yml with an appropriate TTL'));
    } else if (result.details.expiringSoonTests.length > 0) {
      console.log();
      console.log(chalk.yellow.bold('⚠️  Action Required'));
      console.log(`${result.details.expiringSoonTests.length} quarantine(s) expire soon - schedule fixes to avoid future pipeline blocks.`);
    }
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  program
    .name('flakeguard-gate')
    .description('FlakeGuard pipeline gate for soft test gating')
    .requiredOption('--quarantine-config <file>', 'Path to quarantine YAML configuration')
    .requiredOption('--test-report <file>', 'Path to FlakeGuard test report JSON')
    .option('--run-id <id>', 'GitHub Actions run ID')
    .option('--current-attempt <number>', 'Current attempt number (1 = first attempt)', '1')
    .option('--run-attempt <number>', 'Current run attempt number (1 = first attempt)', '1')
    .option('--verbose', 'Enable verbose output')
    .parse();

  const options = program.opts();
  
  try {
    const gate = new FlakeGuardGate();
    const result = await gate.evaluateGate(
      options.quarantineConfig,
      options.testReport,
      parseInt(options.currentAttempt || options.runAttempt)
    );
    
    gate.printGateResult(result);
    
    // Set GitHub Actions outputs for workflow integration
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, `should_rerun=${result.shouldRerun ? 'true' : 'false'}\n`);
      await fs.appendFile(process.env.GITHUB_OUTPUT, `rerun_reason=${result.rerunReason}\n`);
      await fs.appendFile(process.env.GITHUB_OUTPUT, `flaky_dominance=${Math.round(result.details.flakyDominanceRatio * 100)}\n`);
      await fs.appendFile(process.env.GITHUB_OUTPUT, `non_quarantined_failures=${result.nonQuarantinedFailures}\n`);
    }
    
    // Exit with appropriate code
    if (result.shouldPass) {
      console.log();
      console.log(chalk.green('🎉 Pipeline gate: PASS'));
      if (result.shouldRerun) {
        console.log(chalk.blue('🔄 Auto-rerun will be triggered'));
      }
      process.exit(0);
    } else {
      console.log();
      console.log(chalk.red('🚫 Pipeline gate: FAIL'));
      process.exit(1);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Gate evaluation failed:'), error);
    process.exit(1);
  }
}

// Run main function if this script is executed directly
const scriptPath = import.meta.url;
const argv1 = process.argv[1];
const isMainModule = argv1 && (
  scriptPath === `file://${argv1}` || 
  argv1.endsWith('gate.js')
);

if (isMainModule) {
  main().catch(console.error);
}

export { FlakeGuardGate };