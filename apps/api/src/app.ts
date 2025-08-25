import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/index.js';
import { errorHandler } from './plugins/error-handler.js';
import { prismaPlugin } from './plugins/prisma.js';
import metricsPlugin from './plugins/metrics.js';
import securityPlugin from './plugins/security.js';
import githubAppPlugin from './github/index.js';
import slackAppPlugin from './slack/plugin.js';
import policyPlugin from './plugins/policy.js';
import { healthRoutes } from './routes/health.js';
import { userRoutes } from './routes/users.js';
import { taskRoutes } from './routes/tasks.js';
import { ingestionRoutes } from './routes/ingestion.js';
import { quarantineRoutes } from './routes/quarantine.js';
import { policyRoutes } from './routes/policy.js';
import organizationRoutes from './routes/organizations.js';
import adminRoutes from './routes/admin.js';
import tenantIsolationPlugin from './plugins/tenant-isolation.js';
import bullmqPlugin from './plugins/bullmq.js';
import { githubWebhookRoutes } from './routes/github-webhook.js';
import { logger } from './utils/logger.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    trustProxy: true,
  });

  // Register plugins
  await app.register(helmet, {
    contentSecurityPolicy: config.env === 'production',
  });

  await app.register(cors, {
    origin: config.env === 'production' ? config.corsOrigin : true,
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
  });

  // Swagger documentation
  await app.register(swagger, {
    swagger: {
      info: {
        title: 'FlakeGuard API',
        description: 'Production-grade API for FlakeGuard with optional Slack integration',
        version: '1.0.0',
      },
      externalDocs: {
        url: 'https://github.com/flakeguard/api',
        description: 'Find more info here',
      },
      schemes: ['http', 'https'],
      consumes: ['application/json'],
      produces: ['application/json'],
      tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Users', description: 'User management' },
        { name: 'Tasks', description: 'Task management' },
        { name: 'Ingestion', description: 'Test result ingestion' },
        { name: 'Quarantine', description: 'Flaky test quarantine' },
        { name: 'Policy', description: 'Policy-as-Code engine' },
        { name: 'Slack', description: 'Slack integration endpoints' },
        { name: 'Organizations', description: 'Multi-tenant organization management' },
        { name: 'Admin', description: 'Super admin dashboard and management' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Register custom plugins
  await app.register(errorHandler);
  await app.register(prismaPlugin);
  await app.register(metricsPlugin, {
    enabled: config.env !== 'test',
    excludeRoutes: ['/health', '/metrics', '/documentation'],
  });
  
  // Register security plugin (must be early in the chain)
  await app.register(securityPlugin, {
    config: {
      enableCSRF: config.env === 'production',
      enableAuditLogging: true,
      webhookSignatureRequired: config.env !== 'test',
    },
  });
  
  // Register BullMQ plugin (for webhook job queuing)
  await app.register(bullmqPlugin, {
    enabled: config.features.githubWebhooks, // Only enable if webhooks are enabled
    redisUrl: config.redisUrl,
  });
  
  // Register tenant isolation plugin (after security, before business logic)
  await app.register(tenantIsolationPlugin, {
    enabled: config.env !== 'test', // Disable in tests for simplicity
    bypassRoutes: ['/health', '/metrics', '/documentation', '/api/auth', '/admin', '/github/webhook'],
    requireInstallationId: false,
  });
  
  await app.register(githubAppPlugin);
  await app.register(policyPlugin);

  // Register Slack plugin (conditionally)
  if (config.features.slackApp) {
    logger.info('Slack app feature is enabled, registering Slack plugin');
    await app.register(slackAppPlugin, {
      enabled: true,
      autoStart: config.env !== 'test', // Don't auto-start in test environment
    });
  } else {
    logger.info('Slack app feature is disabled');
  }

  // Register routes
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(taskRoutes, { prefix: '/api/tasks' });
  await app.register(ingestionRoutes, { prefix: '/api/ingestion' });
  await app.register(quarantineRoutes, { prefix: '/v1/quarantine' });
  await app.register(policyRoutes);
  
  // Register GitHub webhook routes (P1 requirement)
  if (config.features.githubWebhooks) {
    await app.register(githubWebhookRoutes);
    logger.info('GitHub webhook routes registered');
  }
  
  // Multi-tenant routes
  await app.register(organizationRoutes);
  await app.register(adminRoutes);

  // Add comprehensive health check that includes all components
  app.get('/health/comprehensive', async (request, reply) => {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: config.env,
      version: '1.0.0',
      components: {
        database: 'healthy',
        github: config.features.githubWebhooks ? 'enabled' : 'disabled',
        slack: config.features.slackApp ? 'enabled' : 'disabled',
        quarantine: config.features.quarantineActions ? 'enabled' : 'disabled',
        policy: 'enabled',
        queue: config.features.githubWebhooks && app.queue ? 'healthy' : 'disabled',
      },
      features: config.features,
    };

    // Check database connection
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      health.components.database = 'healthy';
    } catch (error) {
      health.components.database = 'unhealthy';
      health.status = 'degraded';
    }

    // Check Slack app if enabled
    if (config.features.slackApp && app.slackApp) {
      try {
        // Simple check to see if Slack app is initialized
        health.components.slack = app.slackApp ? 'healthy' : 'unhealthy';
      } catch (error) {
        health.components.slack = 'unhealthy';
        health.status = 'degraded';
      }
    }

    return health;
  });

  return app;
}