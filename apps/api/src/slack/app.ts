/**
 * FlakeGuard Slack App - Bolt for JS Implementation
 * 
 * A comprehensive Slack bot for triaging flaky tests:
 * - Slash command `/flakeguard` with subcommands (status, topflaky, help)
 * - Interactive Block Kit messages with quarantine and issue creation buttons
 * - Integration with existing GitHub handlers for quarantine and issue management
 * - Comprehensive error handling and rate limiting
 * - Secure request verification
 */

import type { TestRun, QuarantineCandidate } from '@flakeguard/shared';
import { PrismaClient } from '@prisma/client';
import { App, BlockAction, SlashCommand, ButtonAction } from '@slack/bolt';

import { FlakinessScorer } from '../analytics/flakiness.js';
import { GitHubAuthManager } from '../github/auth.js';
import { CheckRunHandler } from '../github/handlers.js';
import { logger } from '../utils/logger.js';


/**
 * Slack App Configuration
 */
interface SlackAppConfig {
  signingSecret: string;
  token: string;
  port?: number;
  processBeforeResponse?: boolean;
}

/**
 * FlakeGuard dependencies injection
 */
interface FlakeGuardDependencies {
  prisma: PrismaClient;
  githubAuth: GitHubAuthManager;
  checkRunHandler: CheckRunHandler;
  flakinessScorer: FlakinessScorer;
}

/**
 * Repository flaky test summary
 */
interface RepositoryFlakeSummary {
  repositoryId: string;
  repositoryName: string;
  totalTests: number;
  flakyTests: number;
  quarantinedTests: number;
  topFlaky: Array<{
    testName: string;
    flakeScore: number;
    failureRate: number;
    lastFailure: Date;
  }>;
}

/**
 * Global top flaky tests across all repositories
 */
interface GlobalFlakyTest {
  testName: string;
  repositoryName: string;
  flakeScore: number;
  failureRate: number;
  lastFailure: Date;
  confidence: number;
}

/**
 * FlakeGuard Slack App
 * 
 * Provides slash commands and interactive elements for managing flaky tests
 */
export class FlakeGuardSlackApp {
  private app: App;
  private dependencies: FlakeGuardDependencies;
  private rateLimitMap = new Map<string, { count: number; resetTime: number }>();

  constructor(config: SlackAppConfig, dependencies: FlakeGuardDependencies) {
    this.dependencies = dependencies;

    // Initialize Slack Bolt app with comprehensive security
    this.app = new App({
      signingSecret: config.signingSecret,
      token: config.token,
      port: config.port || 3001,
      processBeforeResponse: config.processBeforeResponse ?? true,
      customRoutes: [
        {
          path: '/health',
          method: ['GET'],
          handler: (req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              status: 'healthy', 
              timestamp: new Date().toISOString(),
              service: 'flakeguard-slack-app'
            }));
          }
        }
      ],
      // Enhanced error handling
      errorHandler: async (error) => {
        logger.error({ error }, 'Slack app error occurred');
        console.error('Slack app error:', error);
      }
    });

    this.setupSlashCommands();
    this.setupBlockActions();
    this.setupErrorHandling();
  }

  /**
   * Setup slash commands with comprehensive handlers
   */
  private setupSlashCommands(): void {
    // Main /flakeguard command with subcommand routing
    this.app.command('/flakeguard', async ({ ack, body, respond, client }) => {
      await ack();

      try {
        // Rate limiting check
        if (!this.checkRateLimit(body.user_id)) {
          await respond({
            text: '🚫 Rate limit exceeded. Please wait a moment before trying again.',
            response_type: 'ephemeral'
          });
          return;
        }

        const text = body.text?.trim() || '';
        const [subcommand, ...args] = text.split(/\s+/);

        logger.info('Processing FlakeGuard slash command', {
          subcommand,
          userId: body.user_id,
          channelId: body.channel_id,
          teamId: body.team_id,
        });

        switch (subcommand?.toLowerCase()) {
          case 'status':
            await this.handleStatusCommand(args, respond, body);
            break;
          
          case 'topflaky':
            await this.handleTopFlakyCommand(args, respond, body);
            break;
          
          case 'help':
          default:
            await this.handleHelpCommand(respond, body);
            break;
        }

      } catch (error) {
        logger.error({ error, userId: body.user_id }, 'Failed to process slash command');
        await respond({
          text: '❌ An error occurred while processing your command. Please try again later.',
          response_type: 'ephemeral'
        });
      }
    });
  }

  /**
   * Setup Block Kit button actions for interactive messages
   */
  private setupBlockActions(): void {
    // Quarantine button action
    this.app.action('quarantine_test', async ({ ack, body, respond, client }) => {
      await ack();

      try {
        const action = body as BlockAction;
        const buttonAction = action.actions[0] as ButtonAction;
        const { repositoryId, testName } = JSON.parse(buttonAction.value);

        logger.info('Processing quarantine button action', {
          repositoryId,
          testName,
          userId: body.user.id,
        });

        // Call existing GitHub quarantine handler
        const result = await this.handleQuarantineAction(repositoryId, testName, body.user.id);
        
        // Update the message with result
        await this.updateMessageWithResult(respond, 'quarantine', result, testName);

      } catch (error) {
        logger.error({ error, userId: body.user.id }, 'Failed to process quarantine action');
        await respond({
          text: '❌ Failed to quarantine test. Please try again or contact support.',
          response_type: 'ephemeral'
        });
      }
    });

    // Open issue button action
    this.app.action('open_issue', async ({ ack, body, respond, client }) => {
      await ack();

      try {
        const action = body as BlockAction;
        const buttonAction = action.actions[0] as ButtonAction;
        const { repositoryId, testName } = JSON.parse(buttonAction.value);

        logger.info('Processing open issue button action', {
          repositoryId,
          testName,
          userId: body.user.id,
        });

        // Call existing GitHub issue handler
        const result = await this.handleOpenIssueAction(repositoryId, testName, body.user.id);
        
        // Update the message with result
        await this.updateMessageWithResult(respond, 'issue', result, testName);

      } catch (error) {
        logger.error({ error, userId: body.user.id }, 'Failed to process open issue action');
        await respond({
          text: '❌ Failed to create issue. Please try again or contact support.',
          response_type: 'ephemeral'
        });
      }
    });

    // View details action
    this.app.action('view_details', async ({ ack, body, respond, client }) => {
      await ack();

      try {
        const action = body as BlockAction;
        const buttonAction = action.actions[0] as ButtonAction;
        const { repositoryId, testName } = JSON.parse(buttonAction.value);

        const details = await this.getTestDetails(repositoryId, testName);
        
        await respond({
          blocks: this.buildTestDetailsBlocks(details),
          response_type: 'ephemeral'
        });

      } catch (error) {
        logger.error({ error }, 'Failed to fetch test details');
        await respond({
          text: '❌ Failed to fetch test details.',
          response_type: 'ephemeral'
        });
      }
    });
  }

  /**
   * Setup comprehensive error handling
   */
  private setupErrorHandling(): void {
    this.app.error(async (error) => {
      logger.error({ error }, 'Unhandled Slack app error');
      console.error('Unhandled Slack app error:', error);
    });

    // Handle Slack retry headers
    this.app.receiver.app.use((req, res, next) => {
      if (req.headers['x-slack-retry-num']) {
        logger.warn('Slack retry detected', {
          retryNum: req.headers['x-slack-retry-num'],
          retryReason: req.headers['x-slack-retry-reason'],
        });
      }
      next();
    });
  }

  /**
   * Handle status command - show repository flaky test summary
   */
  private async handleStatusCommand(
    args: string[], 
    respond: any, 
    body: SlashCommand
  ): Promise<void> {
    if (args.length === 0) {
      await respond({
        text: '❌ Please provide a repository in the format: `owner/repo`\nExample: `/flakeguard status microsoft/typescript`',
        response_type: 'ephemeral'
      });
      return;
    }

    const repoPath = args[0];
    const [owner, repo] = repoPath.split('/');

    if (!owner || !repo) {
      await respond({
        text: '❌ Invalid repository format. Use: `owner/repo`\nExample: `/flakeguard status microsoft/typescript`',
        response_type: 'ephemeral'
      });
      return;
    }

    try {
      // Find repository in database
      const repository = await this.dependencies.prisma.repository.findFirst({
        where: {
          fullName: `${owner}/${repo}`
        },
        select: {
          id: true,
          fullName: true,
          name: true,
        }
      });

      if (!repository) {
        await respond({
          text: `❌ Repository \`${owner}/${repo}\` not found or not monitored by FlakeGuard.`,
          response_type: 'ephemeral'
        });
        return;
      }

      // Get repository flake summary
      const summary = await this.getRepositoryFlakeSummary(repository.id);
      
      // Build response blocks
      const blocks = this.buildRepositoryStatusBlocks(summary);

      await respond({
        blocks,
        response_type: body.channel_name === 'directmessage' ? 'ephemeral' : 'in_channel'
      });

    } catch (error) {
      logger.error({ error, repoPath }, 'Failed to get repository status');
      await respond({
        text: '❌ Failed to retrieve repository status. Please try again later.',
        response_type: 'ephemeral'
      });
    }
  }

  /**
   * Handle topflaky command - show top 10 flakiest tests across all repos
   */
  private async handleTopFlakyCommand(
    args: string[], 
    respond: any, 
    body: SlashCommand
  ): Promise<void> {
    try {
      const limit = args.length > 0 ? parseInt(args[0]) || 10 : 10;
      const clampedLimit = Math.min(Math.max(limit, 1), 25); // Limit between 1-25

      // Get top flaky tests across all repositories
      const topFlaky = await this.getGlobalTopFlakyTests(clampedLimit);

      if (topFlaky.length === 0) {
        await respond({
          text: '🎉 No flaky tests detected across monitored repositories!',
          response_type: body.channel_name === 'directmessage' ? 'ephemeral' : 'in_channel'
        });
        return;
      }

      // Build response blocks
      const blocks = this.buildTopFlakyBlocks(topFlaky, clampedLimit);

      await respond({
        blocks,
        response_type: body.channel_name === 'directmessage' ? 'ephemeral' : 'in_channel'
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get top flaky tests');
      await respond({
        text: '❌ Failed to retrieve top flaky tests. Please try again later.',
        response_type: 'ephemeral'
      });
    }
  }

  /**
   * Handle help command - display usage instructions
   */
  private async handleHelpCommand(respond: any, body: SlashCommand): Promise<void> {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*FlakeGuard Slack Bot* 🛡️\n\nManage flaky tests directly from Slack!'
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Available Commands:*'
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: '*`/flakeguard status <owner/repo>`*\nShow flaky test summary for a repository\n_Example: `/flakeguard status microsoft/typescript`_'
          },
          {
            type: 'mrkdwn',
            text: '*`/flakeguard topflaky [limit]`*\nShow top flakiest tests across all repos\n_Example: `/flakeguard topflaky 15`_'
          }
        ]
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: '*`/flakeguard help`*\nShow this help message\n_Always available when you need it_'
          },
          {
            type: 'mrkdwn',
            text: '*Interactive Actions*\n🚫 Quarantine tests in GitHub\n🔗 Create detailed issues\n📊 View test analytics'
          }
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 *Tip:* Use commands in channels to share results with your team, or DM the bot for private results.'
          }
        ]
      }
    ];

    await respond({
      blocks,
      response_type: 'ephemeral'
    });
  }

  /**
   * Get repository flaky test summary
   */
  private async getRepositoryFlakeSummary(repositoryId: string): Promise<RepositoryFlakeSummary> {
    // Get test results for the last 30 days
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const testResults = await this.dependencies.prisma.testResult.findMany({
      where: {
        repositoryId,
        createdAt: {
          gte: cutoffDate
        }
      },
      select: {
        testFullName: true,
        name: true,
        status: true,
        message: true,
        time: true,
        attempt: true,
        runId: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Get repository info
    const repository = await this.dependencies.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { fullName: true }
    });

    // Group tests by name and compute flake scores
    const testGroups = new Map<string, TestRun[]>();
    
    for (const result of testResults) {
      const testRun: TestRun = {
        testName: result.name,
        testFullName: result.testFullName,
        status: result.status as TestRun['status'],
        message: result.message || undefined,
        duration: result.time,
        attempt: result.attempt,
        runId: result.runId,
        createdAt: result.createdAt,
      };

      if (!testGroups.has(result.testFullName)) {
        testGroups.set(result.testFullName, []);
      }
      testGroups.get(result.testFullName)!.push(testRun);
    }

    // Compute flake scores for each test
    const flakyTests: Array<{
      testName: string;
      flakeScore: number;
      failureRate: number;
      lastFailure: Date;
    }> = [];

    let quarantinedTests = 0;

    for (const [testFullName, runs] of testGroups) {
      if (runs.length < 3) continue; // Need minimum runs for meaningful analysis

      try {
        const flakeScore = this.dependencies.flakinessScorer.computeFlakeScore(runs);
        
        if (flakeScore.score > 0.3) { // Only include tests with meaningful flakiness
          const failedRuns = runs.filter(r => r.status === 'failed' || r.status === 'error');
          const lastFailure = failedRuns.length > 0 
            ? failedRuns.reduce((latest, run) => run.createdAt > latest ? run.createdAt : latest, failedRuns[0].createdAt)
            : runs[0].createdAt;

          flakyTests.push({
            testName: runs[0].testName,
            flakeScore: flakeScore.score,
            failureRate: flakeScore.features.failSuccessRatio,
            lastFailure,
          });

          if (flakeScore.recommendation.action === 'quarantine') {
            quarantinedTests++;
          }
        }
      } catch (error) {
        logger.warn({ error, testFullName }, 'Failed to compute flake score');
      }
    }

    // Sort by flake score (highest first) and take top 10
    flakyTests.sort((a, b) => b.flakeScore - a.flakeScore);

    return {
      repositoryId,
      repositoryName: repository?.fullName || 'Unknown',
      totalTests: testGroups.size,
      flakyTests: flakyTests.length,
      quarantinedTests,
      topFlaky: flakyTests.slice(0, 10),
    };
  }

  /**
   * Get global top flaky tests across all repositories
   */
  private async getGlobalTopFlakyTests(limit: number): Promise<GlobalFlakyTest[]> {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get flake detections from database (most recent first)
    const flakeDetections = await this.dependencies.prisma.flakeDetection.findMany({
      where: {
        updatedAt: {
          gte: cutoffDate
        },
        confidence: {
          gt: 0.5 // Only high-confidence detections
        }
      },
      include: {
        repository: {
          select: {
            fullName: true
          }
        }
      },
      orderBy: [
        { confidence: 'desc' },
        { updatedAt: 'desc' }
      ],
      take: limit * 2 // Get more to dedupe and filter
    });

    const globalFlaky: GlobalFlakyTest[] = flakeDetections
      .map(detection => ({
        testName: detection.testName,
        repositoryName: detection.repository?.fullName || 'Unknown Repository',
        flakeScore: detection.confidence,
        failureRate: detection.failureRate || 0,
        lastFailure: detection.updatedAt,
        confidence: detection.confidence,
      }))
      .slice(0, limit);

    return globalFlaky;
  }

  /**
   * Build repository status response blocks
   */
  private buildRepositoryStatusBlocks(summary: RepositoryFlakeSummary): any[] {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*FlakeGuard Status: ${summary.repositoryName}* 📊`
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Total Tests Analyzed:*\n${summary.totalTests}`
          },
          {
            type: 'mrkdwn',
            text: `*Flaky Tests Found:*\n${summary.flakyTests} ${summary.flakyTests > 0 ? '⚠️' : '✅'}`
          },
          {
            type: 'mrkdwn',
            text: `*Quarantined Tests:*\n${summary.quarantinedTests} ${summary.quarantinedTests > 0 ? '🚫' : '✅'}`
          },
          {
            type: 'mrkdwn',
            text: `*Health Score:*\n${this.calculateHealthScore(summary)}% ${this.getHealthEmoji(summary)}`
          }
        ]
      }
    ];

    if (summary.topFlaky.length > 0) {
      blocks.push({
        type: 'divider'
      } as any);

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Top Flaky Tests:*'
        }
      });

      for (const [index, test] of summary.topFlaky.slice(0, 5).entries()) {
        const actionValue = JSON.stringify({
          repositoryId: summary.repositoryId,
          testName: test.testName
        });

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${index + 1}. ${test.testName}*\n🎯 Flake Score: ${(test.flakeScore * 100).toFixed(1)}% | 💥 Failure Rate: ${(test.failureRate * 100).toFixed(1)}%\n📅 Last Failure: ${test.lastFailure.toLocaleDateString()}`
          },
          accessory: {
            type: 'overflow',
            options: [
              {
                text: {
                  type: 'plain_text',
                  text: '🚫 Quarantine in GitHub'
                },
                value: `quarantine:${actionValue}`
              },
              {
                text: {
                  type: 'plain_text',
                  text: '🔗 Open Issue'
                },
                value: `issue:${actionValue}`
              },
              {
                text: {
                  type: 'plain_text',
                  text: '📊 View Details'
                },
                value: `details:${actionValue}`
              }
            ],
            action_id: 'flaky_test_actions'
          }
        });
      }

      // Add action buttons for top test
      if (summary.topFlaky.length > 0) {
        const topTest = summary.topFlaky[0];
        const actionValue = JSON.stringify({
          repositoryId: summary.repositoryId,
          testName: topTest.testName
        });

        blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🚫 Quarantine Top Test',
                emoji: true
              },
              style: 'danger',
              action_id: 'quarantine_test',
              value: actionValue
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🔗 Create Issue',
                emoji: true
              },
              style: 'primary',
              action_id: 'open_issue',
              value: actionValue
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '📊 View Details',
                emoji: true
              },
              action_id: 'view_details',
              value: actionValue
            }
          ]
        });
      }
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🎉 *Great news!* No flaky tests detected in this repository.'
        }
      });
    }

    return blocks;
  }

  /**
   * Build top flaky tests response blocks
   */
  private buildTopFlakyBlocks(topFlaky: GlobalFlakyTest[], limit: number): any[] {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Top ${Math.min(topFlaky.length, limit)} Flakiest Tests Across All Repositories* 🌍`
        }
      },
      {
        type: 'divider'
      }
    ];

    for (const [index, test] of topFlaky.entries()) {
      const actionValue = JSON.stringify({
        repositoryId: test.repositoryName, // Using repository name as ID for global search
        testName: test.testName
      });

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${index + 1}. ${test.testName}*\n📁 Repository: \`${test.repositoryName}\`\n🎯 Flake Score: ${(test.flakeScore * 100).toFixed(1)}% | 💥 Failure Rate: ${(test.failureRate * 100).toFixed(1)}%\n🔒 Confidence: ${(test.confidence * 100).toFixed(1)}% | 📅 Last Failure: ${test.lastFailure.toLocaleDateString()}`
        }
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `📊 Analyzed tests from the last 30 days • Use \`/flakeguard status <owner/repo>\` for repository-specific actions`
        }
      ]
    } as any);

    return blocks;
  }

  /**
   * Build test details blocks for detailed view
   */
  private buildTestDetailsBlocks(details: any): any[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Test Details: ${details.testName}* 🔍`
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Repository:*\n${details.repositoryName}`
          },
          {
            type: 'mrkdwn',
            text: `*Total Runs:*\n${details.totalRuns}`
          },
          {
            type: 'mrkdwn',
            text: `*Success Rate:*\n${((1 - details.failureRate) * 100).toFixed(1)}%`
          },
          {
            type: 'mrkdwn',
            text: `*Avg Duration:*\n${details.avgDuration.toFixed(0)}ms`
          }
        ]
      }
    ];
  }

  /**
   * Handle quarantine action by calling existing GitHub handlers
   */
  private async handleQuarantineAction(
    repositoryId: string, 
    testName: string, 
    userId: string
  ): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      // Find the repository
      const repository = await this.dependencies.prisma.repository.findUnique({
        where: { id: repositoryId },
        select: {
          id: true,
          fullName: true,
          owner: true,
          name: true,
          installationId: true,
        }
      });

      if (!repository) {
        return {
          success: false,
          message: 'Repository not found'
        };
      }

      // Find recent flake detection for this test
      const flakeDetection = await this.dependencies.prisma.flakeDetection.findFirst({
        where: {
          testName,
          repositoryId: repository.id
        },
        orderBy: {
          updatedAt: 'desc'
        }
      });

      if (!flakeDetection) {
        return {
          success: false,
          message: 'No flake detection found for this test'
        };
      }

      // Create a mock check run payload to trigger quarantine
      const mockPayload = {
        action: 'requested_action' as const,
        check_run: {
          id: Date.now(),
          name: `FlakeGuard - ${testName}`,
          head_sha: 'latest',
          status: 'completed' as const,
          conclusion: 'failure' as const,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          output: {
            title: 'Flaky Test Detected',
            summary: `Test ${testName} has been identified as flaky`
          }
        },
        repository: {
          id: parseInt(repository.installationId),
          owner: { login: repository.owner },
          name: repository.name,
          full_name: repository.fullName,
          default_branch: 'main'
        },
        installation: {
          id: parseInt(repository.installationId)
        },
        requested_action: {
          identifier: 'quarantine' as const
        },
        sender: {
          login: 'flakeguard-bot',
          id: 1,
          type: 'Bot' as const
        }
      };

      // Call the existing quarantine handler
      await this.dependencies.checkRunHandler.process(mockPayload);

      logger.info('Quarantine action completed via Slack', {
        repositoryId: repository.id,
        testName,
        userId,
      });

      return {
        success: true,
        message: `Test "${testName}" has been quarantined in GitHub`,
        details: {
          repository: repository.fullName,
          action: 'quarantine'
        }
      };

    } catch (error) {
      logger.error({ error, repositoryId, testName }, 'Failed to quarantine test via Slack');
      return {
        success: false,
        message: 'Failed to quarantine test. Please try again or contact support.'
      };
    }
  }

  /**
   * Handle open issue action by calling existing GitHub handlers  
   */
  private async handleOpenIssueAction(
    repositoryId: string, 
    testName: string, 
    userId: string
  ): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      // Similar implementation to quarantine but calling the issue creation handler
      const repository = await this.dependencies.prisma.repository.findUnique({
        where: { id: repositoryId },
        select: {
          id: true,
          fullName: true,
          owner: true,
          name: true,
          installationId: true,
        }
      });

      if (!repository) {
        return {
          success: false,
          message: 'Repository not found'
        };
      }

      // Create mock payload for issue creation
      const mockPayload = {
        action: 'requested_action' as const,
        check_run: {
          id: Date.now(),
          name: `FlakeGuard - ${testName}`,
          head_sha: 'latest',
          status: 'completed' as const,
          conclusion: 'failure' as const,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          output: {
            title: 'Flaky Test Detected',
            summary: `Test ${testName} has been identified as flaky`
          }
        },
        repository: {
          id: parseInt(repository.installationId),
          owner: { login: repository.owner },
          name: repository.name,
          full_name: repository.fullName,
          default_branch: 'main'
        },
        installation: {
          id: parseInt(repository.installationId)
        },
        requested_action: {
          identifier: 'open_issue' as const
        },
        sender: {
          login: 'flakeguard-bot',
          id: 1,
          type: 'Bot' as const
        }
      };

      // Call the existing issue handler
      await this.dependencies.checkRunHandler.process(mockPayload);

      logger.info('Open issue action completed via Slack', {
        repositoryId: repository.id,
        testName,
        userId,
      });

      return {
        success: true,
        message: `Issue created for test "${testName}" in GitHub`,
        details: {
          repository: repository.fullName,
          action: 'open_issue'
        }
      };

    } catch (error) {
      logger.error({ error, repositoryId, testName }, 'Failed to create issue via Slack');
      return {
        success: false,
        message: 'Failed to create issue. Please try again or contact support.'
      };
    }
  }

  /**
   * Get detailed test information
   */
  private async getTestDetails(repositoryId: string, testName: string): Promise<any> {
    const repository = await this.dependencies.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { fullName: true }
    });

    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const results = await this.dependencies.prisma.testResult.findMany({
      where: {
        repositoryId,
        name: testName,
        createdAt: { gte: cutoffDate }
      },
      select: {
        status: true,
        time: true,
        createdAt: true
      }
    });

    const totalRuns = results.length;
    const failedRuns = results.filter(r => r.status === 'failed' || r.status === 'error').length;
    const failureRate = totalRuns > 0 ? failedRuns / totalRuns : 0;
    const avgDuration = totalRuns > 0 ? results.reduce((sum, r) => sum + r.time, 0) / totalRuns : 0;

    return {
      testName,
      repositoryName: repository?.fullName || 'Unknown',
      totalRuns,
      failureRate,
      avgDuration
    };
  }

  /**
   * Update message with action result
   */
  private async updateMessageWithResult(
    respond: any, 
    action: 'quarantine' | 'issue', 
    result: { success: boolean; message: string; details?: any },
    testName: string
  ): Promise<void> {
    const emoji = result.success ? '✅' : '❌';
    const actionText = action === 'quarantine' ? 'Quarantine' : 'Issue Creation';

    await respond({
      text: `${emoji} ${actionText} ${result.success ? 'Successful' : 'Failed'}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${actionText} ${result.success ? 'Completed' : 'Failed'}*\n\n*Test:* \`${testName}\`\n*Result:* ${result.message}`
          }
        }
      ],
      response_type: 'ephemeral'
    });
  }

  /**
   * Calculate repository health score
   */
  private calculateHealthScore(summary: RepositoryFlakeSummary): number {
    if (summary.totalTests === 0) return 100;
    
    const flakyPercent = (summary.flakyTests / summary.totalTests) * 100;
    return Math.max(0, Math.round(100 - flakyPercent));
  }

  /**
   * Get health emoji based on summary
   */
  private getHealthEmoji(summary: RepositoryFlakeSummary): string {
    const healthScore = this.calculateHealthScore(summary);
    
    if (healthScore >= 90) return '🟢';
    if (healthScore >= 70) return '🟡';
    return '🔴';
  }

  /**
   * Rate limiting check (simple in-memory implementation)
   */
  private checkRateLimit(userId: string, maxRequests = 10, windowMs = 60000): boolean {
    const now = Date.now();
    const userLimit = this.rateLimitMap.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      this.rateLimitMap.set(userId, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (userLimit.count >= maxRequests) {
      return false;
    }

    userLimit.count++;
    return true;
  }

  /**
   * Start the Slack app
   */
  public async start(): Promise<void> {
    try {
      await this.app.start();
      logger.info('FlakeGuard Slack app started successfully');
      console.log('⚡️ FlakeGuard Slack app is running!');
    } catch (error) {
      logger.error({ error }, 'Failed to start Slack app');
      throw error;
    }
  }

  /**
   * Stop the Slack app
   */
  public async stop(): Promise<void> {
    try {
      await this.app.stop();
      logger.info('FlakeGuard Slack app stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Slack app');
      throw error;
    }
  }

  /**
   * Get the underlying Slack app instance
   */
  public getApp(): App {
    return this.app;
  }
}

/**
 * Create and configure FlakeGuard Slack App
 */
export function createFlakeGuardSlackApp(
  config: SlackAppConfig,
  dependencies: FlakeGuardDependencies
): FlakeGuardSlackApp {
  return new FlakeGuardSlackApp(config, dependencies);
}

/**
 * Slack App configuration schema for validation
 */
export const slackAppConfigSchema = {
  signingSecret: { type: 'string', required: true },
  token: { type: 'string', required: true },
  port: { type: 'number', required: false, default: 3001 },
  processBeforeResponse: { type: 'boolean', required: false, default: true }
};