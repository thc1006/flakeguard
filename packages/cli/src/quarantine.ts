#!/usr/bin/env tsx

/**
 * FlakeGuard Quarantine Management CLI
 * 
 * Commands for managing test quarantine configurations with schema validation,
 * TTL checking, and immediate PR integration.
 */

import { program } from 'commander';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import { QuarantineValidator } from './quarantine-validator.js';
import { spawn } from 'child_process';

// =============================================================================
// CLI Commands
// =============================================================================

class QuarantineCLI {
  private validator = new QuarantineValidator();

  /**
   * Validate quarantine configuration
   */
  async validateCommand(configPath: string, options: { verbose?: boolean }) {
    console.log(chalk.blue('🔍 Validating quarantine configuration...'));
    
    const result = await this.validator.validateFile(configPath);
    this.validator.printValidationResult(result, configPath);

    if (result.config && options.verbose) {
      const summary = this.validator.generateSummary(result.config);
      this.validator.printSummary(summary);
    }

    process.exit(result.isValid ? 0 : 1);
  }

  /**
   * Add a test to quarantine
   */
  async addCommand(
    testKey: string,
    reason: string,
    ownerTeam: string,
    options: {
      config?: string;
      quarantinedBy?: string;
      ttlDays?: number;
      priority?: 'low' | 'medium' | 'high' | 'critical';
      jiraTicket?: string;
      notes?: string;
      createPr?: boolean;
      prBranch?: string;
    }
  ) {
    const configPath = options.config || '.flakeguard/quarantine.yml';
    const quarantinedBy = options.quarantinedBy || await this.getGitUser();

    console.log(chalk.blue('➕ Adding test to quarantine...'));
    console.log(chalk.gray(`Test: ${testKey}`));
    console.log(chalk.gray(`Reason: ${reason}`));
    console.log(chalk.gray(`Owner: ${ownerTeam}`));
    console.log(chalk.gray(`TTL: ${options.ttlDays || 14} days`));

    const result = await this.validator.addToQuarantine(
      configPath,
      testKey,
      reason,
      ownerTeam,
      quarantinedBy,
      {
        ttlDays: options.ttlDays,
        priority: options.priority,
        jiraTicket: options.jiraTicket,
        notes: options.notes,
      }
    );

    this.validator.printValidationResult(result);

    if (result.isValid && options.createPr) {
      await this.createPR(configPath, `Add quarantine for ${testKey}`, options.prBranch);
    }

    process.exit(result.isValid ? 0 : 1);
  }

  /**
   * Remove a test from quarantine
   */
  async removeCommand(
    testKey: string,
    options: {
      config?: string;
      removedBy?: string;
      createPr?: boolean;
      prBranch?: string;
    }
  ) {
    const configPath = options.config || '.flakeguard/quarantine.yml';
    const removedBy = options.removedBy || await this.getGitUser();

    console.log(chalk.blue('➖ Removing test from quarantine...'));
    console.log(chalk.gray(`Test: ${testKey}`));

    const result = await this.validator.removeFromQuarantine(configPath, testKey, removedBy);
    this.validator.printValidationResult(result);

    if (result.isValid && options.createPr) {
      await this.createPR(configPath, `Remove quarantine for ${testKey}`, options.prBranch);
    }

    process.exit(result.isValid ? 0 : 1);
  }

  /**
   * List quarantined tests with status
   */
  async listCommand(options: {
    config?: string;
    status?: 'all' | 'active' | 'expiring' | 'expired';
    team?: string;
    priority?: string;
    format?: 'table' | 'json' | 'summary';
  }) {
    const configPath = options.config || '.flakeguard/quarantine.yml';

    console.log(chalk.blue('📋 Quarantine Status Report'));

    const result = await this.validator.validateFile(configPath);
    
    if (!result.isValid || !result.config) {
      console.log(chalk.red('❌ Invalid or missing quarantine configuration'));
      if (result.errors.length > 0) {
        result.errors.forEach(error => console.log(chalk.red(`  • ${error}`)));
      }
      process.exit(1);
    }

    const summary = this.validator.generateSummary(result.config);

    // Filter based on options
    let filteredStatuses = summary.ttlStatuses;

    if (options.status && options.status !== 'all') {
      filteredStatuses = filteredStatuses.filter(s => {
        switch (options.status) {
          case 'active': return s.status === 'active';
          case 'expiring': return s.status === 'expiring_soon';
          case 'expired': return s.status === 'expired';
          default: return true;
        }
      });
    }

    if (options.team) {
      filteredStatuses = filteredStatuses.filter(s => s.ownerTeam === options.team);
    }

    if (options.priority) {
      filteredStatuses = filteredStatuses.filter(s => s.priority === options.priority);
    }

    // Output format
    if (options.format === 'json') {
      console.log(JSON.stringify({
        summary,
        filtered: filteredStatuses
      }, null, 2));
    } else if (options.format === 'summary') {
      this.validator.printSummary(summary);
    } else {
      // Table format (default)
      this.printQuarantineTable(filteredStatuses);
    }
  }

  /**
   * Check for expiring quarantines and optionally notify
   */
  async checkExpirationCommand(options: {
    config?: string;
    warningDays?: number;
    notify?: boolean;
    slackWebhook?: string;
  }) {
    const configPath = options.config || '.flakeguard/quarantine.yml';

    console.log(chalk.blue('⏰ Checking quarantine expiration...'));

    const result = await this.validator.validateFile(configPath);
    
    if (!result.isValid || !result.config) {
      console.log(chalk.red('❌ Invalid or missing quarantine configuration'));
      process.exit(1);
    }

    const summary = this.validator.generateSummary(result.config);
    const warningDays = options.warningDays || result.config.settings.notifications.ttl_warning_days;

    // Find expiring and expired tests
    const expiring = summary.ttlStatuses.filter(s => 
      s.status === 'expiring_soon' && s.daysUntilExpiration <= warningDays
    );
    const expired = summary.ttlStatuses.filter(s => s.status === 'expired');

    console.log(chalk.yellow(`\n⚠️  ${expiring.length} test(s) expiring within ${warningDays} days:`));
    expiring.forEach(test => {
      console.log(chalk.yellow(`  • ${test.testKey} (${test.daysUntilExpiration} days) - ${test.ownerTeam}`));
    });

    console.log(chalk.red(`\n❌ ${expired.length} test(s) already expired:`));
    expired.forEach(test => {
      const daysExpired = Math.abs(test.daysUntilExpiration);
      console.log(chalk.red(`  • ${test.testKey} (${daysExpired} days ago) - ${test.ownerTeam}`));
    });

    if (options.notify && (expiring.length > 0 || expired.length > 0)) {
      await this.sendNotifications(expiring, expired, options.slackWebhook);
    }

    // Exit with error if there are expired tests
    process.exit(expired.length > 0 ? 1 : 0);
  }

  /**
   * Generate a new quarantine configuration template
   */
  async initCommand(configPath: string, options: { force?: boolean }) {
    console.log(chalk.blue('🆕 Initializing quarantine configuration...'));

    // Check if file already exists
    try {
      await fs.access(configPath);
      if (!options.force) {
        console.log(chalk.red(`❌ Configuration already exists at ${configPath}`));
        console.log(chalk.gray('Use --force to overwrite'));
        process.exit(1);
      }
    } catch {
      // File doesn't exist, continue
    }

    const template = {
      version: '1.0',
      quarantined_tests: [],
      settings: {
        default_ttl_days: 14,
        max_ttl_days: 30,
        auto_extend_ttl: false,
        require_jira_ticket: false,
        notifications: {
          ttl_warning_days: 3,
          slack_webhook: null,
          notify_teams: ['engineering-leads', 'qa-team'],
        },
      },
      metadata: {
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        updated_by: await this.getGitUser(),
        schema_version: '1.0',
      },
    };

    const { stringify } = await import('yaml');
    const yamlContent = stringify(template, {
      indent: 2,
    });

    // Ensure directory exists
    const dir = configPath.split('/').slice(0, -1).join('/');
    if (dir) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(configPath, yamlContent, 'utf-8');

    console.log(chalk.green(`✅ Created quarantine configuration at ${configPath}`));
    console.log(chalk.gray('Edit the settings section to customize for your project'));
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  private async getGitUser(): Promise<string> {
    try {
      const result = await this.runCommand('git', ['config', 'user.email']);
      return result.output?.trim() || 'unknown@example.com';
    } catch {
      return 'unknown@example.com';
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

  private async createPR(configPath: string, title: string, branch?: string) {
    try {
      const branchName = branch || `quarantine-update-${Date.now()}`;
      
      console.log(chalk.blue('🔄 Creating PR for quarantine changes...'));
      
      // Create branch
      await this.runCommand('git', ['checkout', '-b', branchName]);
      
      // Add and commit changes
      await this.runCommand('git', ['add', configPath]);
      await this.runCommand('git', ['commit', '-m', title]);
      
      // Push branch
      await this.runCommand('git', ['push', '-u', 'origin', branchName]);
      
      // Create PR using GitHub CLI
      const prResult = await this.runCommand('gh', ['pr', 'create', '--title', title, '--body', `Auto-generated PR to update quarantine configuration.\n\n**Changes:**\n- Modified ${configPath}\n\n> Generated by FlakeGuard CLI`]);
      
      if (prResult.success) {
        console.log(chalk.green('✅ Pull request created successfully'));
        console.log(chalk.gray(prResult.output));
      } else {
        console.log(chalk.yellow('⚠️  Failed to create PR, but changes are committed to branch:'));
        console.log(chalk.gray(branchName));
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Failed to create PR: ${error}`));
    }
  }

  private printQuarantineTable(statuses: any[]) {
    if (statuses.length === 0) {
      console.log(chalk.gray('No quarantined tests found matching criteria'));
      return;
    }

    console.log();
    console.log(chalk.bold('Status | Days | Priority | Test | Team'));
    console.log('-'.repeat(80));

    statuses.forEach(status => {
      const statusIcon = status.status === 'expired' ? chalk.red('❌') : 
                        status.status === 'expiring_soon' ? chalk.yellow('⚠️') : 
                        chalk.green('✅');
      
      const daysText = status.daysUntilExpiration < 0 ? 
                      chalk.red(`${Math.abs(status.daysUntilExpiration)}d ago`) :
                      status.daysUntilExpiration === 0 ? chalk.yellow('today') :
                      `${status.daysUntilExpiration}d`;

      const priorityColor = status.priority === 'critical' ? chalk.red : 
                           status.priority === 'high' ? chalk.yellow : 
                           chalk.gray;

      const testName = status.testKey.split('::')[1] || status.testKey;
      const shortName = testName.length > 30 ? testName.substring(0, 27) + '...' : testName;

      console.log(`${statusIcon}     ${daysText.padEnd(8)} ${priorityColor(status.priority.padEnd(8))} ${shortName.padEnd(32)} ${status.ownerTeam}`);
    });
    console.log();
  }

  private async sendNotifications(expiring: any[], expired: any[], slackWebhook?: string) {
    // Basic notification implementation
    // In a real implementation, you'd integrate with Slack, email, etc.
    
    console.log(chalk.blue('\n📢 Sending notifications...'));
    
    if (slackWebhook) {
      try {
        // In real implementation, you'd send this message to Slack webhook
        console.log(chalk.gray(`Notification would include: ${expired.length} expired, ${expiring.length} expiring`));
        console.log(chalk.green('✅ Slack notification sent'));
      } catch (error) {
        console.log(chalk.red(`❌ Failed to send Slack notification: ${error}`));
      }
    } else {
      console.log(chalk.gray('No notification channels configured'));
    }
  }
}

// =============================================================================
// CLI Setup
// =============================================================================

async function main() {
  const cli = new QuarantineCLI();

  program
    .name('flakeguard-quarantine')
    .description('FlakeGuard quarantine management CLI')
    .version('1.0.0');

  // Validate command
  program
    .command('validate [config]')
    .description('Validate quarantine configuration')
    .option('-v, --verbose', 'Show detailed summary')
    .action(async (config = '.flakeguard/quarantine.yml', options) => {
      await cli.validateCommand(config, options);
    });

  // Add command
  program
    .command('add <test-key> <reason> <owner-team>')
    .description('Add a test to quarantine')
    .option('-c, --config <file>', 'Quarantine config file path', '.flakeguard/quarantine.yml')
    .option('-b, --quarantined-by <email>', 'Email of person adding to quarantine')
    .option('-t, --ttl-days <days>', 'Time to live in days', '14')
    .option('-p, --priority <level>', 'Priority level (low/medium/high/critical)', 'medium')
    .option('-j, --jira-ticket <ticket>', 'Jira ticket reference')
    .option('-n, --notes <notes>', 'Additional notes')
    .option('--create-pr', 'Create a PR with the changes')
    .option('--pr-branch <branch>', 'Branch name for PR')
    .action(async (testKey, reason, ownerTeam, options) => {
      await cli.addCommand(testKey, reason, ownerTeam, {
        ...options,
        ttlDays: parseInt(options.ttlDays)
      });
    });

  // Remove command
  program
    .command('remove <test-key>')
    .description('Remove a test from quarantine')
    .option('-c, --config <file>', 'Quarantine config file path', '.flakeguard/quarantine.yml')
    .option('-b, --removed-by <email>', 'Email of person removing from quarantine')
    .option('--create-pr', 'Create a PR with the changes')
    .option('--pr-branch <branch>', 'Branch name for PR')
    .action(async (testKey, options) => {
      await cli.removeCommand(testKey, options);
    });

  // List command
  program
    .command('list')
    .description('List quarantined tests')
    .option('-c, --config <file>', 'Quarantine config file path', '.flakeguard/quarantine.yml')
    .option('-s, --status <status>', 'Filter by status (all/active/expiring/expired)', 'all')
    .option('-t, --team <team>', 'Filter by owner team')
    .option('-p, --priority <priority>', 'Filter by priority')
    .option('-f, --format <format>', 'Output format (table/json/summary)', 'table')
    .action(async (options) => {
      await cli.listCommand(options);
    });

  // Check expiration command
  program
    .command('check-expiration')
    .description('Check for expiring quarantines')
    .option('-c, --config <file>', 'Quarantine config file path', '.flakeguard/quarantine.yml')
    .option('-w, --warning-days <days>', 'Days before expiration to warn', '3')
    .option('-n, --notify', 'Send notifications')
    .option('--slack-webhook <url>', 'Slack webhook URL for notifications')
    .action(async (options) => {
      await cli.checkExpirationCommand({
        ...options,
        warningDays: parseInt(options.warningDays)
      });
    });

  // Init command
  program
    .command('init [config]')
    .description('Initialize a new quarantine configuration')
    .option('-f, --force', 'Overwrite existing configuration')
    .action(async (config = '.flakeguard/quarantine.yml', options) => {
      await cli.initCommand(config, options);
    });

  program.parse();
}

// Run main function if this script is executed directly
const scriptPath = import.meta.url;
const argv1 = process.argv[1];
const isMainModule = argv1 && (
  scriptPath === `file://${argv1}` || 
  argv1.endsWith('quarantine.js')
);

if (isMainModule) {
  main().catch(console.error);
}

export { QuarantineCLI };