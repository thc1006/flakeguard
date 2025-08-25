#!/usr/bin/env tsx

/**
 * FlakeGuard Slack Integration Validation Report
 * 
 * This script creates a comprehensive report on the Slack integration
 * without requiring external API calls or complex test setup.
 * 
 * Usage: pnpm tsx scripts/slack-validation-report.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ValidationCheck {
  category: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  message: string;
  details?: any;
}

class SlackValidationReport {
  private checks: ValidationCheck[] = [];

  async generateReport(): Promise<void> {
    console.log('🛡️ FlakeGuard Slack Integration Validation Report');
    console.log('=================================================\n');

    this.checkFileStructure();
    this.checkEnvironmentConfig();
    this.checkSlackAppImplementation();
    this.checkSlashCommandHandlers();
    this.checkButtonActions();
    this.checkMessageFormatting();
    this.checkErrorHandling();
    this.checkTestCoverage();
    this.checkDocumentation();

    this.printReport();
  }

  private checkFileStructure(): void {
    console.log('📁 Checking File Structure...');

    const expectedFiles = [
      'apps/api/src/slack/app.ts',
      'apps/api/src/slack/service.ts',
      'apps/api/src/slack/config.ts',
      'apps/api/src/slack/message-builder.ts',
      'apps/api/src/slack/types.ts',
      'apps/api/src/slack/__tests__/app.test.ts',
      'apps/api/src/slack/__tests__/integration.test.ts'
    ];

    expectedFiles.forEach(filePath => {
      if (existsSync(filePath)) {
        this.addCheck('FILE_STRUCTURE', `${filePath}`, 'PASS', 'File exists');
      } else {
        this.addCheck('FILE_STRUCTURE', `${filePath}`, 'FAIL', 'File missing');
      }
    });
  }

  private checkEnvironmentConfig(): void {
    console.log('⚙️ Checking Environment Configuration...');

    try {
      const envExample = readFileSync('.env.example', 'utf8');
      
      const requiredSlackVars = [
        'SLACK_BOT_TOKEN',
        'SLACK_SIGNING_SECRET',
        'SLACK_APP_TOKEN',
        'SLACK_PORT'
      ];

      requiredSlackVars.forEach(varName => {
        if (envExample.includes(varName)) {
          this.addCheck('ENVIRONMENT', varName, 'PASS', 'Variable documented in .env.example');
        } else {
          this.addCheck('ENVIRONMENT', varName, 'FAIL', 'Variable missing from .env.example');
        }
      });

      // Check for security best practices
      if (envExample.includes('ENABLE_SLACK_APP=false')) {
        this.addCheck('ENVIRONMENT', 'Feature Flag', 'PASS', 'Slack app can be disabled via feature flag');
      } else {
        this.addCheck('ENVIRONMENT', 'Feature Flag', 'WARN', 'Consider adding ENABLE_SLACK_APP feature flag');
      }

    } catch (error) {
      this.addCheck('ENVIRONMENT', 'Config Check', 'FAIL', `Failed to read .env.example: ${error}`);
    }
  }

  private checkSlackAppImplementation(): void {
    console.log('🏗️ Checking Slack App Implementation...');

    try {
      const appCode = readFileSync('apps/api/src/slack/app.ts', 'utf8');

      // Check for essential imports
      const requiredImports = [
        '@slack/bolt',
        '@prisma/client',
        'FlakeGuardSlackApp'
      ];

      requiredImports.forEach(importName => {
        if (appCode.includes(importName)) {
          this.addCheck('IMPLEMENTATION', `Import ${importName}`, 'PASS', 'Required import present');
        } else {
          this.addCheck('IMPLEMENTATION', `Import ${importName}`, 'FAIL', 'Required import missing');
        }
      });

      // Check for essential methods
      const requiredMethods = [
        'setupSlashCommands',
        'setupBlockActions',
        'setupErrorHandling',
        'start',
        'stop'
      ];

      requiredMethods.forEach(methodName => {
        if (appCode.includes(methodName)) {
          this.addCheck('IMPLEMENTATION', `Method ${methodName}`, 'PASS', 'Required method present');
        } else {
          this.addCheck('IMPLEMENTATION', `Method ${methodName}`, 'FAIL', 'Required method missing');
        }
      });

      // Check for security features
      const securityFeatures = [
        'signingSecret',
        'checkRateLimit',
        'logger'
      ];

      securityFeatures.forEach(feature => {
        if (appCode.includes(feature)) {
          this.addCheck('SECURITY', feature, 'PASS', 'Security feature implemented');
        } else {
          this.addCheck('SECURITY', feature, 'WARN', 'Security feature missing or not visible');
        }
      });

    } catch (error) {
      this.addCheck('IMPLEMENTATION', 'Code Analysis', 'FAIL', `Failed to read app.ts: ${error}`);
    }
  }

  private checkSlashCommandHandlers(): void {
    console.log('⚡ Checking Slash Command Handlers...');

    try {
      const appCode = readFileSync('apps/api/src/slack/app.ts', 'utf8');

      const commands = [
        { name: 'help', handler: 'handleHelpCommand' },
        { name: 'status', handler: 'handleStatusCommand' },
        { name: 'topflaky', handler: 'handleTopFlakyCommand' }
      ];

      commands.forEach(cmd => {
        if (appCode.includes(cmd.handler)) {
          this.addCheck('SLASH_COMMANDS', `/${cmd.name}`, 'PASS', `Handler ${cmd.handler} implemented`);
        } else {
          this.addCheck('SLASH_COMMANDS', `/${cmd.name}`, 'FAIL', `Handler ${cmd.handler} missing`);
        }
      });

      // Check for input validation
      if (appCode.includes('args.length') && appCode.includes('split')) {
        this.addCheck('SLASH_COMMANDS', 'Input Validation', 'PASS', 'Command argument parsing implemented');
      } else {
        this.addCheck('SLASH_COMMANDS', 'Input Validation', 'WARN', 'Command argument validation unclear');
      }

    } catch (error) {
      this.addCheck('SLASH_COMMANDS', 'Handler Check', 'FAIL', `Failed to analyze handlers: ${error}`);
    }
  }

  private checkButtonActions(): void {
    console.log('🔘 Checking Button Actions...');

    try {
      const appCode = readFileSync('apps/api/src/slack/app.ts', 'utf8');

      const actions = [
        { id: 'quarantine_test', handler: 'handleQuarantineAction' },
        { id: 'open_issue', handler: 'handleOpenIssueAction' },
        { id: 'view_details', handler: 'getTestDetails' }
      ];

      actions.forEach(action => {
        if (appCode.includes(action.id)) {
          this.addCheck('BUTTON_ACTIONS', action.id, 'PASS', `Action handler registered`);
        } else {
          this.addCheck('BUTTON_ACTIONS', action.id, 'FAIL', `Action handler missing`);
        }
      });

      // Check for JSON payload parsing
      if (appCode.includes('JSON.parse') && appCode.includes('buttonAction.value')) {
        this.addCheck('BUTTON_ACTIONS', 'Payload Parsing', 'PASS', 'Button payload parsing implemented');
      } else {
        this.addCheck('BUTTON_ACTIONS', 'Payload Parsing', 'WARN', 'Button payload parsing unclear');
      }

      // Check for GitHub integration
      if (appCode.includes('checkRunHandler.process')) {
        this.addCheck('BUTTON_ACTIONS', 'GitHub Integration', 'PASS', 'GitHub handler integration present');
      } else {
        this.addCheck('BUTTON_ACTIONS', 'GitHub Integration', 'FAIL', 'GitHub handler integration missing');
      }

    } catch (error) {
      this.addCheck('BUTTON_ACTIONS', 'Action Check', 'FAIL', `Failed to analyze actions: ${error}`);
    }
  }

  private checkMessageFormatting(): void {
    console.log('💬 Checking Message Formatting...');

    try {
      const appCode = readFileSync('apps/api/src/slack/app.ts', 'utf8');

      // Check for Block Kit usage
      const blockKitFeatures = [
        'blocks',
        'type: \'section\'',
        'type: \'mrkdwn\'',
        'response_type'
      ];

      blockKitFeatures.forEach(feature => {
        if (appCode.includes(feature)) {
          this.addCheck('MESSAGE_FORMAT', `Block Kit ${feature}`, 'PASS', 'Feature used in messages');
        } else {
          this.addCheck('MESSAGE_FORMAT', `Block Kit ${feature}`, 'WARN', 'Feature not visible');
        }
      });

      // Check for health score calculation
      if (appCode.includes('calculateHealthScore') || appCode.includes('healthScore')) {
        this.addCheck('MESSAGE_FORMAT', 'Health Score', 'PASS', 'Health score calculation present');
      } else {
        this.addCheck('MESSAGE_FORMAT', 'Health Score', 'FAIL', 'Health score calculation missing');
      }

      // Check for emoji usage
      const emojiPattern = /[🟢🟡🔴✅❌⚠️📊🎯💥📅]/;
      if (emojiPattern.test(appCode)) {
        this.addCheck('MESSAGE_FORMAT', 'Emoji Usage', 'PASS', 'Emojis used for visual enhancement');
      } else {
        this.addCheck('MESSAGE_FORMAT', 'Emoji Usage', 'INFO', 'No emojis detected');
      }

    } catch (error) {
      this.addCheck('MESSAGE_FORMAT', 'Format Check', 'FAIL', `Failed to analyze formatting: ${error}`);
    }
  }

  private checkErrorHandling(): void {
    console.log('🚨 Checking Error Handling...');

    try {
      const appCode = readFileSync('apps/api/src/slack/app.ts', 'utf8');

      // Check for try-catch blocks
      const errorHandlingPatterns = [
        'try {',
        'catch (error)',
        'logger.error',
        'response_type: \'ephemeral\''
      ];

      errorHandlingPatterns.forEach(pattern => {
        const matches = (appCode.match(new RegExp(pattern, 'g')) || []).length;
        if (matches > 0) {
          this.addCheck('ERROR_HANDLING', pattern, 'PASS', `Found ${matches} instances`);
        } else {
          this.addCheck('ERROR_HANDLING', pattern, 'WARN', 'Pattern not found');
        }
      });

      // Check for rate limiting
      if (appCode.includes('rateLimitMap') || appCode.includes('checkRateLimit')) {
        this.addCheck('ERROR_HANDLING', 'Rate Limiting', 'PASS', 'Rate limiting implemented');
      } else {
        this.addCheck('ERROR_HANDLING', 'Rate Limiting', 'FAIL', 'Rate limiting missing');
      }

    } catch (error) {
      this.addCheck('ERROR_HANDLING', 'Error Analysis', 'FAIL', `Failed to analyze error handling: ${error}`);
    }
  }

  private checkTestCoverage(): void {
    console.log('🧪 Checking Test Coverage...');

    try {
      const testFiles = [
        'apps/api/src/slack/__tests__/app.test.ts',
        'apps/api/src/slack/__tests__/integration.test.ts',
        'apps/api/src/slack/__tests__/performance.test.ts'
      ];

      testFiles.forEach(testFile => {
        if (existsSync(testFile)) {
          const testCode = readFileSync(testFile, 'utf8');
          const testCount = (testCode.match(/it\(/g) || []).length;
          this.addCheck('TEST_COVERAGE', testFile, 'PASS', `${testCount} tests found`);
        } else {
          this.addCheck('TEST_COVERAGE', testFile, 'FAIL', 'Test file missing');
        }
      });

      // Check for mock usage
      if (existsSync('apps/api/src/slack/__tests__/app.test.ts')) {
        const testCode = readFileSync('apps/api/src/slack/__tests__/app.test.ts', 'utf8');
        if (testCode.includes('vi.mock') && testCode.includes('@slack/bolt')) {
          this.addCheck('TEST_COVERAGE', 'Slack App Mocking', 'PASS', 'Slack app properly mocked');
        } else {
          this.addCheck('TEST_COVERAGE', 'Slack App Mocking', 'WARN', 'Mocking strategy unclear');
        }
      }

    } catch (error) {
      this.addCheck('TEST_COVERAGE', 'Test Analysis', 'FAIL', `Failed to analyze tests: ${error}`);
    }
  }

  private checkDocumentation(): void {
    console.log('📚 Checking Documentation...');

    const docFiles = [
      'apps/api/slack-app-manifest.yaml',
      'README.md'
    ];

    docFiles.forEach(docFile => {
      if (existsSync(docFile)) {
        this.addCheck('DOCUMENTATION', docFile, 'PASS', 'Documentation file exists');
      } else {
        this.addCheck('DOCUMENTATION', docFile, 'WARN', 'Documentation file missing');
      }
    });

    // Check for inline documentation
    try {
      const appCode = readFileSync('apps/api/src/slack/app.ts', 'utf8');
      const commentLines = (appCode.match(/^\s*\*/gm) || []).length;
      
      if (commentLines > 50) {
        this.addCheck('DOCUMENTATION', 'Inline Comments', 'PASS', `${commentLines} comment lines found`);
      } else if (commentLines > 20) {
        this.addCheck('DOCUMENTATION', 'Inline Comments', 'WARN', `${commentLines} comment lines - could be improved`);
      } else {
        this.addCheck('DOCUMENTATION', 'Inline Comments', 'FAIL', `Only ${commentLines} comment lines found`);
      }
    } catch (error) {
      this.addCheck('DOCUMENTATION', 'Inline Documentation', 'FAIL', `Failed to analyze documentation: ${error}`);
    }
  }

  private addCheck(category: string, name: string, status: ValidationCheck['status'], message: string, details?: any): void {
    this.checks.push({ category, name, status, message, details });
    
    const icon = {
      PASS: '✅',
      FAIL: '❌',
      WARN: '⚠️',
      INFO: 'ℹ️'
    }[status];
    
    console.log(`  ${icon} ${category}: ${name} - ${message}`);
  }

  private printReport(): void {
    console.log('\n📊 Validation Summary');
    console.log('====================\n');

    const summary = this.checks.reduce((acc, check) => {
      acc[check.status] = (acc[check.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('Overall Results:');
    Object.entries(summary).forEach(([status, count]) => {
      const icon = {
        PASS: '✅',
        FAIL: '❌',
        WARN: '⚠️',
        INFO: 'ℹ️'
      }[status];
      console.log(`${icon} ${status}: ${count}`);
    });

    console.log(`\nTotal Checks: ${this.checks.length}`);

    // Category breakdown
    console.log('\nBy Category:');
    const byCategory = this.checks.reduce((acc, check) => {
      if (!acc[check.category]) acc[check.category] = { PASS: 0, FAIL: 0, WARN: 0, INFO: 0 };
      acc[check.category][check.status]++;
      return acc;
    }, {} as Record<string, Record<string, number>>);

    Object.entries(byCategory).forEach(([category, stats]) => {
      const total = Object.values(stats).reduce((sum, count) => sum + count, 0);
      const passRate = Math.round((stats.PASS / total) * 100);
      console.log(`  ${category}: ${passRate}% (${stats.PASS}/${total} passed)`);
    });

    // Critical issues
    const failures = this.checks.filter(c => c.status === 'FAIL');
    if (failures.length > 0) {
      console.log('\n❌ Critical Issues to Address:');
      failures.forEach(failure => {
        console.log(`  • ${failure.category}: ${failure.name} - ${failure.message}`);
      });
    }

    // Warnings
    const warnings = this.checks.filter(c => c.status === 'WARN');
    if (warnings.length > 0) {
      console.log('\n⚠️ Recommendations:');
      warnings.slice(0, 5).forEach(warning => {
        console.log(`  • ${warning.category}: ${warning.name} - ${warning.message}`);
      });
      if (warnings.length > 5) {
        console.log(`  ... and ${warnings.length - 5} more warnings`);
      }
    }

    // Overall assessment
    const passRate = Math.round((summary.PASS || 0) / this.checks.length * 100);
    console.log(`\n🎯 Overall Health: ${passRate}%`);
    
    if (passRate >= 90) {
      console.log('🟢 Excellent! Slack integration is well implemented.');
    } else if (passRate >= 75) {
      console.log('🟡 Good! Minor improvements recommended.');
    } else if (passRate >= 60) {
      console.log('🟠 Fair! Several issues should be addressed.');
    } else {
      console.log('🔴 Poor! Major issues need immediate attention.');
    }
  }
}

// Main execution
async function main() {
  const validator = new SlackValidationReport();
  await validator.generateReport();
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  });
}

export { SlackValidationReport };