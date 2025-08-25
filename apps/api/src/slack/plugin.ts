/**
 * Fastify plugin for FlakeGuard Slack App integration
 * 
 * Provides optional Slack bot functionality that can be enabled/disabled
 * through environment configuration. Integrates with existing GitHub handlers
 * and database for seamless flaky test management.
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';

import { FlakinessScorer } from '../analytics/flakiness.js';
import { config, requireSlackConfig } from '../config/index.js';
import { GitHubAuthManager } from '../github/auth.js';
import { createWebhookHandlers } from '../github/handlers.js';
import { logger } from '../utils/logger.js';

import { FlakeGuardSlackApp, createFlakeGuardSlackApp } from './app.js';

/**
 * Slack App plugin options
 */
export interface SlackPluginOptions {
  enabled?: boolean;
  autoStart?: boolean;
}

/**
 * Fastify plugin for Slack app integration
 */
async function slackPlugin(
  fastify: FastifyInstance,
  options: SlackPluginOptions & FastifyPluginOptions
): Promise<void> {
  // Skip if Slack is not enabled
  if (!config.features.slackApp || options.enabled === false) {
    fastify.log.info('Slack app is disabled, skipping initialization');
    return;
  }

  try {
    // Validate Slack configuration
    const slackConfig = requireSlackConfig();
    
    fastify.log.info('Initializing FlakeGuard Slack app');

    // Create dependencies for Slack app
    const githubAuth = new GitHubAuthManager({
      appId: config.github.appId,
      privateKey: config.github.privateKey,
      clientId: config.github.clientId,
      clientSecret: config.github.clientSecret,
    });

    const flakinessScorer = new FlakinessScorer();

    // Create GitHub handlers (reuse existing ones)
    const handlers = createWebhookHandlers({
      prisma: fastify.prisma,
      authManager: githubAuth,
      helpers: fastify.githubHelpers, // Assuming this is available from github plugin
    });

    // Create Slack app
    const slackApp = createFlakeGuardSlackApp(slackConfig, {
      prisma: fastify.prisma,
      githubAuth,
      checkRunHandler: handlers.checkRunHandler,
      flakinessScorer,
    });

    // Register Slack app in Fastify context
    fastify.decorate('slackApp', slackApp);

    // Auto-start if requested (default: true)
    const shouldAutoStart = options.autoStart !== false;
    
    if (shouldAutoStart) {
      // Start Slack app
      await slackApp.start();
      
      fastify.log.info({
        port: slackConfig.port,
        signingSecret: slackConfig.signingSecret.substring(0, 8) + '...',
      }, 'FlakeGuard Slack app started successfully');

      // Graceful shutdown handler
      fastify.addHook('onClose', async () => {
        fastify.log.info('Shutting down FlakeGuard Slack app');
        try {
          await slackApp.stop();
          fastify.log.info('FlakeGuard Slack app stopped gracefully');
        } catch (error) {
          fastify.log.error({ error }, 'Error stopping Slack app');
        }
      });
    }

    // Add health check endpoint for Slack app
    fastify.get('/slack/health', async (request, reply) => {
      return {
        status: 'healthy',
        service: 'flakeguard-slack-app',
        timestamp: new Date().toISOString(),
        config: {
          enabled: config.features.slackApp,
          port: slackConfig.port,
          processBeforeResponse: slackConfig.processBeforeResponse,
        }
      };
    });

    // Add Slack app information endpoint  
    fastify.get('/slack/info', async (request, reply) => {
      return {
        enabled: true,
        version: '1.0.0',
        features: [
          'slash_commands',
          'interactive_messages',
          'quarantine_actions',
          'issue_creation',
          'flakiness_analytics'
        ],
        commands: [
          {
            command: '/flakeguard status <owner/repo>',
            description: 'Show flaky test summary for repository'
          },
          {
            command: '/flakeguard topflaky [limit]',
            description: 'Show top flakiest tests across all repositories'
          },
          {
            command: '/flakeguard help',
            description: 'Show help and usage instructions'
          }
        ]
      };
    });

  } catch (error) {
    fastify.log.error({ error }, 'Failed to initialize FlakeGuard Slack app');
    
    // Don't fail the entire application if Slack fails to initialize
    // Log the error and continue without Slack functionality
    fastify.log.warn('Continuing without Slack app functionality');
    
    // Register disabled Slack endpoints
    fastify.get('/slack/health', async (request, reply) => {
      return reply.status(503).send({
        status: 'disabled',
        service: 'flakeguard-slack-app',
        timestamp: new Date().toISOString(),
        error: 'Slack app failed to initialize',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    });
  }
}

// Export as Fastify plugin
export default fp(slackPlugin, {
  name: 'slack-app',
  dependencies: ['prisma', 'github-app'] // Depends on these plugins being loaded first
});

/**
 * Type augmentation for Fastify to include Slack app
 */
declare module 'fastify' {
  interface FastifyInstance {
    slackApp?: FlakeGuardSlackApp;
  }
}