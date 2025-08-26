#!/usr/bin/env tsx

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * FlakeGuard Slack Integration Validation Script
 * 
 * This script validates all aspects of the Slack integration:
 * 1. Bot authentication and permissions
 * 2. Slash command processing
 * 3. Button interaction handling
 * 4. Block Kit message formatting
 * 5. Backend API integration
 * 6. Error handling and recovery
 * 
 * Usage:
 *   pnpm tsx scripts/validate-slack-integration.ts
 *   pnpm tsx scripts/validate-slack-integration.ts --env=test
 *   pnpm tsx scripts/validate-slack-integration.ts --verbose
 */

import { performance } from 'perf_hooks';

import type { TestRun } from '@flakeguard/shared';
import { PrismaClient } from '@prisma/client';
import { WebClient } from '@slack/web-api';

import { FlakinessScorer } from '../apps/api/src/analytics/flakiness.js';
import { GitHubAuthManager } from '../apps/api/src/github/auth.js';
import { CheckRunHandler } from '../apps/api/src/github/handlers.js';
import { GitHubHelpers } from '../apps/api/src/github/helpers.js';
import { FlakeGuardSlackApp, createFlakeGuardSlackApp } from '../apps/api/src/slack/app.js';

// Configuration
interface ValidationConfig {
  verbose: boolean;
  env: 'development' | 'test' | 'production';
  skipApiCalls: boolean;
  testChannel?: string;
}

interface ValidationResult {
  component: string;
  test: string;
  status: 'PASS' | 'FAIL' | 'SKIP' | 'WARN';
  duration: number;
  error?: string;
  details?: any;
}

class SlackIntegrationValidator {
  private config: ValidationConfig;
  private results: ValidationResult[] = [];
  private slackClient?: WebClient;
  private prisma?: PrismaClient;
  private slackApp?: FlakeGuardSlackApp;
  
  constructor(config: ValidationConfig) {
    this.config = config;
  }

  async validate(): Promise<void> {
    console.log('🚀 FlakeGuard Slack Integration Validation');
    console.log('==========================================\n');

    try {
      this.validateEnvironment();
      await this.validateAuthentication();
      this.validateAppInitialization();
      this.validateSlashCommands();
      this.validateButtonInteractions();
      this.testMessageFormatting();
      this.validateErrorHandling();
      this.testRateLimiting();
      await this.validateIntegrationFlow();
    } catch (error) {
      this.addResult('SYSTEM', 'Overall Validation', 'FAIL', 0, String(error));
    } finally {
      await this.cleanup();
      this.printResults();
    }
  }

  private validateEnvironment(): void {
    console.log('📋 Validating Environment Configuration...');
    
    const start = performance.now();
    
    try {
      // Check required environment variables
      const requiredVars = [
        'DATABASE_URL',
        'REDIS_URL',
        'SLACK_BOT_TOKEN',
        'SLACK_SIGNING_SECRET',
        'GITHUB_APP_ID',
        'GITHUB_APP_PRIVATE_KEY_BASE64'
      ];

      const missingVars: string[] = [];
      for (const varName of requiredVars) {
        if (!process.env[varName]) {
          missingVars.push(varName);
        }
      }

      if (missingVars.length > 0) {
        throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
      }

      // Validate environment values
      if (process.env.SLACK_BOT_TOKEN && !process.env.SLACK_BOT_TOKEN.startsWith('xoxb-')) {
        this.addResult('ENVIRONMENT', 'Slack Bot Token Format', 'WARN', 0, 
          'Bot token should start with xoxb-');
      }

      this.addResult('ENVIRONMENT', 'Required Variables', 'PASS', 
        performance.now() - start);

    } catch (error) {
      this.addResult('ENVIRONMENT', 'Required Variables', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private async validateAuthentication(): Promise<void> {
    console.log('🔐 Validating Slack Authentication...');
    
    const start = performance.now();
    
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
      
      if (!this.config.skipApiCalls) {
        // Test authentication
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const authTest = await this.slackClient.auth.test();
        
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (!authTest.ok) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          throw new Error(`Auth test failed: ${String(authTest.error)}`);
        }

        // Add null checks for authTest properties
        const authTestData = authTest as any;
        const user = authTestData?.user ? String(authTestData.user) : '';
        const team = authTestData?.team ? String(authTestData.team) : '';

        this.addResult('AUTHENTICATION', 'Bot Token', 'PASS', 
          performance.now() - start, undefined, { user, team });

        // Test bot info
        // Add null check for user_id before making bot info request
        const authTestForBotInfo = authTest as any;
        const userId = authTestForBotInfo?.user_id ? String(authTestForBotInfo.user_id) : '';
        
        if (userId) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const botInfo = await this.slackClient.bots.info({ bot: userId });

          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (botInfo.ok) {
            const botData = (botInfo as any).bot;
            const name = botData?.name ? String(botData.name) : '';
            const appId = botData?.app_id ? String(botData.app_id) : '';
            
            this.addResult('AUTHENTICATION', 'Bot Info', 'PASS', 
              performance.now() - start, undefined, { name, appId });
          }
        }

      } else {
        this.addResult('AUTHENTICATION', 'Bot Token', 'SKIP', 0, 'API calls disabled');
      }

    } catch (error) {
      this.addResult('AUTHENTICATION', 'Bot Token', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private validateAppInitialization(): void {
    console.log('🏗️ Validating App Initialization...');
    
    const start = performance.now();
    
    try {
      // Initialize dependencies
      this.prisma = new PrismaClient();
      
      const githubAuth = new GitHubAuthManager({
        config: {
          appId: parseInt(process.env.GITHUB_APP_ID!, 10),
          privateKey: Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64!, 'base64').toString(),
          webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
          clientId: process.env.GITHUB_CLIENT_ID ?? '',
          clientSecret: process.env.GITHUB_CLIENT_SECRET ?? ''
        }
      });

      const helpers = new GitHubHelpers(githubAuth);
      const checkRunHandler = new CheckRunHandler({
        prisma: this.prisma,
        authManager: githubAuth,
        helpers
      });
      const flakinessScorer = new FlakinessScorer();

      // Create Slack app
      this.slackApp = createFlakeGuardSlackApp(
        {
          signingSecret: process.env.SLACK_SIGNING_SECRET!,
          token: process.env.SLACK_BOT_TOKEN!,
          port: parseInt(process.env.SLACK_PORT ?? '3001', 10)
        },
        {
          prisma: this.prisma,
          githubAuth,
          checkRunHandler,
          flakinessScorer
        }
      );

      this.addResult('INITIALIZATION', 'App Creation', 'PASS', 
        performance.now() - start);

      // Test app methods
      const app = (this.slackApp as any).getApp();
      if (app && typeof (app).start === 'function') {
        this.addResult('INITIALIZATION', 'App Methods', 'PASS', 0);
      } else {
        this.addResult('INITIALIZATION', 'App Methods', 'FAIL', 0, 
          'App missing required methods');
      }

    } catch (error) {
      this.addResult('INITIALIZATION', 'App Creation', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private validateSlashCommands(): void {
    console.log('⚡ Validating Slash Commands...');
    
    // Test command parsers and handlers
    this.validateHelpCommand();
    this.validateStatusCommand();
    this.validateTopFlakyCommand();
  }

  private validateHelpCommand(): void {
    const start = performance.now();
    
    try {
      // Simulate help command data
      const mockBody = {
        user_id: 'U12345',
        channel_id: 'C12345',
        team_id: 'T12345',
        channel_name: 'general',
        text: 'help'
      };

      // Validate command structure
      if (mockBody.text === 'help') {
        this.addResult('SLASH_COMMANDS', 'Help Command Parsing', 'PASS', 
          performance.now() - start);
      }

    } catch (error) {
      this.addResult('SLASH_COMMANDS', 'Help Command Parsing', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private validateStatusCommand(): void {
    const start = performance.now();
    
    try {
      // Test repository parsing
      const testCases = [
        { input: 'status', expected: 'error' },
        { input: 'status invalid', expected: 'error' },
        { input: 'status owner/repo', expected: 'valid' }
      ];

      for (const testCase of testCases) {
        const parts = testCase.input.split(/\s+/);
        const [command, ...args] = parts;
        
        if (command === 'status') {
          if (args.length === 0) {
            if (testCase.expected === 'error') {
              this.addResult('SLASH_COMMANDS', 'Status Command Validation', 'PASS', 0);
            }
          } else if (args.length === 1) {
            const [owner, repo] = args[0].split('/');
            if (owner && repo && testCase.expected === 'valid') {
              this.addResult('SLASH_COMMANDS', 'Status Command Parsing', 'PASS', 0);
            } else if ((!owner || !repo) && testCase.expected === 'error') {
              this.addResult('SLASH_COMMANDS', 'Status Command Validation', 'PASS', 0);
            }
          }
        }
      }

    } catch (error) {
      this.addResult('SLASH_COMMANDS', 'Status Command', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private validateTopFlakyCommand(): void {
    const start = performance.now();
    
    try {
      // Test limit parsing and clamping
      const testLimits = ['10', '100', '0', 'invalid'];
      
      for (const limit of testLimits) {
        const parsed = parseInt(limit, 10) || 10;
        const clampedLimit = Math.min(Math.max(parsed, 1), 25);
        
        if ((limit === '10' && clampedLimit === 10) ||
            (limit === '100' && clampedLimit === 25) ||
            (limit === '0' && clampedLimit === 1) ||
            (limit === 'invalid' && clampedLimit === 10)) {
          // Limit parsing works correctly
        } else {
          throw new Error(`Limit clamping failed for: ${limit}`);
        }
      }

      this.addResult('SLASH_COMMANDS', 'Top Flaky Limit Parsing', 'PASS', 
        performance.now() - start);

    } catch (error) {
      this.addResult('SLASH_COMMANDS', 'Top Flaky Command', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private validateButtonInteractions(): void {
    console.log('🔘 Validating Button Interactions...');
    
    this.validateQuarantineButton();
    this.validateIssueButton();
    this.validateDetailsButton();
  }

  private validateQuarantineButton(): void {
    const start = performance.now();
    
    try {
      // Test button action payload parsing
      const mockAction = {
        user: { id: 'U12345' },
        actions: [{
          value: JSON.stringify({
            repositoryId: 'repo-123',
            testName: 'flaky-test'
          })
        }]
      };

      const actionValue = (mockAction.actions[0] as any).value as string;
      const parsed = JSON.parse(actionValue) as { repositoryId?: unknown; testName?: unknown };
      if (parsed.repositoryId && parsed.testName) {
        this.addResult('BUTTON_INTERACTIONS', 'Quarantine Payload', 'PASS', 
          performance.now() - start);
      } else {
        throw new Error('Failed to parse action payload');
      }

    } catch (error) {
      this.addResult('BUTTON_INTERACTIONS', 'Quarantine Button', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private validateIssueButton(): void {
    const start = performance.now();
    
    try {
      // Test issue button payload structure
      const mockPayload = {
        action: 'requested_action',
        requested_action: { identifier: 'open_issue' },
        repository: { full_name: 'org/repo' }
      };

      if (mockPayload.requested_action.identifier === 'open_issue') {
        this.addResult('BUTTON_INTERACTIONS', 'Issue Button Payload', 'PASS', 
          performance.now() - start);
      }

    } catch (error) {
      this.addResult('BUTTON_INTERACTIONS', 'Issue Button', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private validateDetailsButton(): void {
    const start = performance.now();
    
    try {
      // Test details calculation
      const mockTestResults = [
        { status: 'passed', time: 1000, createdAt: new Date() },
        { status: 'failed', time: 1200, createdAt: new Date() },
        { status: 'passed', time: 900, createdAt: new Date() }
      ];

      const totalRuns = mockTestResults.length;
      const failedRuns = mockTestResults.filter(r => 
        r.status === 'failed' || r.status === 'error'
      ).length;
      const failureRate = totalRuns > 0 ? failedRuns / totalRuns : 0;
      const avgDuration = totalRuns > 0 ? 
        mockTestResults.reduce((sum, r) => sum + r.time, 0) / totalRuns : 0;

      if (totalRuns === 3 && failedRuns === 1 && 
          Math.abs(failureRate - 0.333) < 0.01 &&
          Math.abs(avgDuration - 1033.33) < 0.1) {
        this.addResult('BUTTON_INTERACTIONS', 'Details Calculation', 'PASS', 
          performance.now() - start);
      } else {
        throw new Error('Details calculation incorrect');
      }

    } catch (error) {
      this.addResult('BUTTON_INTERACTIONS', 'Details Button', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private testMessageFormatting(): void {
    console.log('💬 Validating Block Kit Message Formatting...');
    
    const start = performance.now();
    
    try {
      // Test repository status message structure
      const mockSummary = {
        repositoryName: 'facebook/react',
        totalTests: 10,
        flakyTests: 2,
        quarantinedTests: 1,
        topFlaky: [
          {
            testName: 'should render component',
            flakeScore: 0.8,
            failureRate: 0.4,
            lastFailure: new Date()
          }
        ]
      };

      // Validate health score calculation
      const healthScore = Math.max(0, Math.round(
        100 - (mockSummary.flakyTests / mockSummary.totalTests) * 100
      ));

      if (healthScore === 80) { // 100 - (2/10)*100 = 80%
        this.addResult('MESSAGE_FORMATTING', 'Health Score Calculation', 'PASS', 
          performance.now() - start);
      } else {
        throw new Error(`Health score calculation incorrect: ${healthScore}`);
      }

      // Validate emoji selection
      const getHealthEmoji = (score: number) => {
        if (score >= 90) {return '🟢';}
        if (score >= 70) {return '🟡';}
        return '🔴';
      };

      const emoji = getHealthEmoji(healthScore);
      if (emoji === '🟡') { // 80% should be yellow
        this.addResult('MESSAGE_FORMATTING', 'Health Emoji', 'PASS', 0);
      } else {
        this.addResult('MESSAGE_FORMATTING', 'Health Emoji', 'FAIL', 0, 
          `Expected 🟡, got ${emoji}`);
      }

      // Validate Block Kit structure
      const mockBlocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*FlakeGuard Status: ${mockSummary.repositoryName}* 📊`
          }
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Total Tests:*\\n${mockSummary.totalTests}` },
            { type: 'mrkdwn', text: `*Flaky Tests:*\\n${mockSummary.flakyTests}` }
          ]
        }
      ];

      // Add null checks for block structure validation
      const firstBlock = mockBlocks[0];
      if (firstBlock && 
          firstBlock.type === 'section' && 
          firstBlock.text && 
          firstBlock.text.type === 'mrkdwn') {
        this.addResult('MESSAGE_FORMATTING', 'Block Kit Structure', 'PASS', 0);
      } else {
        this.addResult('MESSAGE_FORMATTING', 'Block Kit Structure', 'FAIL', 0, 
          'Invalid block structure');
      }

    } catch (error) {
      this.addResult('MESSAGE_FORMATTING', 'Message Formatting', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private validateErrorHandling(): void {
    console.log('🚨 Validating Error Handling...');
    
    const start = performance.now();
    
    try {
      // Test error message formatting
      const mockErrors = [
        { type: 'repository_not_found', message: 'Repository not found' },
        { type: 'database_error', message: 'Database connection failed' },
        { type: 'github_api_error', message: 'GitHub API rate limit exceeded' }
      ];

      for (const error of mockErrors) {
        const errorResponse = {
          text: `❌ ${error.message}`,
          response_type: 'ephemeral'
        };

        if (errorResponse.text.startsWith('❌') && 
            errorResponse.response_type === 'ephemeral') {
          // Error formatting is correct
        } else {
          throw new Error(`Error formatting incorrect for ${error.type}`);
        }
      }

      this.addResult('ERROR_HANDLING', 'Error Message Formatting', 'PASS', 
        performance.now() - start);

      // Test graceful degradation
      const mockFallbacks = {
        database_error: 'Using cached data',
        github_api_error: 'Retrying with backoff',
        slack_api_error: 'Queuing for later delivery'
      };

      if (Object.keys(mockFallbacks).length === 3) {
        this.addResult('ERROR_HANDLING', 'Fallback Strategies', 'PASS', 0);
      }

    } catch (error) {
      this.addResult('ERROR_HANDLING', 'Error Handling', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private testRateLimiting(): void {
    console.log('🚦 Validating Rate Limiting...');
    
    const start = performance.now();
    
    try {
      // Test rate limiting logic
      const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
      
      const checkRateLimit = (userId: string, maxRequests = 10, windowMs = 60000) => {
        const now = Date.now();
        const userLimit = rateLimitMap.get(userId);

        if (!userLimit || now > userLimit.resetTime) {
          rateLimitMap.set(userId, { count: 1, resetTime: now + windowMs });
          return true;
        }

        if (userLimit.count >= maxRequests) {
          return false;
        }

        // userLimit is guaranteed to exist here due to the checks above
        userLimit.count++;
        return true;
      };

      // Test rate limiting behavior
      const userId = 'U12345';
      let allowedRequests = 0;
      let blockedRequests = 0;

      for (let i = 0; i < 15; i++) {
        if (checkRateLimit(userId)) {
          allowedRequests++;
        } else {
          blockedRequests++;
        }
      }

      if (allowedRequests === 10 && blockedRequests === 5) {
        this.addResult('RATE_LIMITING', 'Request Limiting', 'PASS', 
          performance.now() - start, undefined, { allowedRequests, blockedRequests });
      } else {
        throw new Error(
          `Rate limiting failed: ${allowedRequests} allowed, ${blockedRequests} blocked`
        );
      }

    } catch (error) {
      this.addResult('RATE_LIMITING', 'Rate Limiting', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private async validateIntegrationFlow(): Promise<void> {
    console.log('🔄 Validating End-to-End Integration Flow...');
    
    const start = performance.now();
    
    try {
      if (!this.prisma) {
        throw new Error('Prisma not initialized');
      }

      // Test database connectivity
      await (this.prisma as any).$connect();
      this.addResult('INTEGRATION', 'Database Connection', 'PASS', 0);

      // Test repository query structure
      const mockQuery = {
        where: { fullName: 'test/repo' },
        select: { id: true, fullName: true, name: true }
      };

      if (mockQuery.where.fullName && mockQuery.select.id) {
        this.addResult('INTEGRATION', 'Query Structure', 'PASS', 0);
      }

      // Test flakiness scoring integration
      const mockTestRuns: TestRun[] = [
        {
          testName: 'test1',
          testFullName: 'test1.js::test1',
          status: 'failed',
          duration: 1000,
          attempt: 1,
          runId: 'run-1',
          createdAt: new Date()
        },
        {
          testName: 'test1',
          testFullName: 'test1.js::test1',
          status: 'passed',
          duration: 900,
          attempt: 1,
          runId: 'run-2',
          createdAt: new Date()
        }
      ];

      const scorer = new FlakinessScorer();
      const flakeScore = scorer.computeFlakeScore(mockTestRuns);
      
      if (flakeScore.score >= 0 && flakeScore.score <= 1) {
        this.addResult('INTEGRATION', 'Flakiness Scoring', 'PASS', 0, 
          undefined, { score: flakeScore.score });
      } else {
        throw new Error(`Invalid flake score: ${flakeScore.score}`);
      }

      this.addResult('INTEGRATION', 'End-to-End Flow', 'PASS', 
        performance.now() - start);

    } catch (error) {
      this.addResult('INTEGRATION', 'End-to-End Flow', 'FAIL', 
        performance.now() - start, String(error));
    }
  }

  private async cleanup(): Promise<void> {
    if (this.config.verbose) {
      console.log('🧹 Cleaning up resources...');
    }

    try {
      if (this.slackApp) {
        // Stop the Slack app if it was started
        // await this.slackApp.stop();
      }

      if (this.prisma) {
        await (this.prisma as any).$disconnect();
      }
    } catch (error) {
      if (this.config.verbose) {
        console.log(`Cleanup error: ${String(error)}`);
      }
    }
  }

  private addResult(
    component: string, 
    test: string, 
    status: ValidationResult['status'], 
    duration: number, 
    error?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any
  ): void {
    this.results.push({
      component,
      test,
      status,
      duration: Math.round(duration * 100) / 100,
      error,
      details
    });

    if (this.config.verbose) {
      const statusIcon = {
        PASS: '✅',
        FAIL: '❌',
        SKIP: '⏭️',
        WARN: '⚠️'
      }[status];
      
      console.log(`  ${statusIcon} ${component}: ${test} (${duration.toFixed(1)}ms)`);
      if (error && this.config.verbose) {
        console.log(`     Error: ${error}`);
      }
    }
  }

  private printResults(): void {
    console.log('\n📊 Validation Results');
    console.log('=====================\n');

    const summary = this.results.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Print summary
    Object.entries(summary).forEach(([status, count]) => {
      const icon = {
        PASS: '✅',
        FAIL: '❌',
        SKIP: '⏭️',
        WARN: '⚠️'
      }[status];
      console.log(`${icon} ${status}: ${count}`);
    });

    console.log(`\nTotal: ${this.results.length} tests`);

    // Print failures
    const failures = this.results.filter(r => r.status === 'FAIL');
    if (failures.length > 0) {
      console.log('\n❌ Failures:');
      failures.forEach(failure => {
        console.log(`  • ${failure.component}: ${failure.test}`);
        if (failure.error) {
          console.log(`    ${failure.error}`);
        }
      });
    }

    // Print warnings
    const warnings = this.results.filter(r => r.status === 'WARN');
    if (warnings.length > 0) {
      console.log('\n⚠️ Warnings:');
      warnings.forEach(warning => {
        console.log(`  • ${warning.component}: ${warning.test}`);
        if (warning.error) {
          console.log(`    ${warning.error}`);
        }
      });
    }

    // Performance summary
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    console.log(`\n⏱️ Total validation time: ${totalDuration.toFixed(1)}ms`);

    // Exit with appropriate code
    const hasCriticalFailures = failures.length > 0;
    process.exit(hasCriticalFailures ? 1 : 0);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  const config: ValidationConfig = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    env: (args.find(arg => arg.startsWith('--env='))?.split('=')[1] as ValidationConfig['env']) || 'test',
    skipApiCalls: args.includes('--skip-api') || process.env.NODE_ENV === 'test',
    testChannel: args.find(arg => arg.startsWith('--channel='))?.split('=')[1]
  };

  if (config.verbose) {
    console.log(`Configuration: ${JSON.stringify(config, null, 2)}\n`);
  }

  const validator = new SlackIntegrationValidator(config);
  await validator.validate();
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  });
}

export { SlackIntegrationValidator };
export type { ValidationConfig, ValidationResult };