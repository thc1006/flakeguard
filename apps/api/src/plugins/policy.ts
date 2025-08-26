/**
 * Policy Plugin
 * 
 * Fastify plugin to register policy service and cleanup tasks.
 */

import type { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { PolicyService, createPolicyService } from '../policy/service.js';
import { logger } from '../utils/logger.js';

// Extend FastifyInstance type to include policyService
declare module 'fastify' {
  interface FastifyInstance {
    policyService: PolicyService;
  }
}

/**
 * Policy plugin options
 */
interface PolicyPluginOptions {
  cleanupIntervalMs?: number;
}

/**
 * Policy service plugin
 */
async function policyPlugin(
  fastify: FastifyInstance,
  options: PolicyPluginOptions = {}
) {
  const { cleanupIntervalMs = 5 * 60 * 1000 } = options; // 5 minutes default
  
  logger.info('Registering policy service plugin', {
    cleanupIntervalMs,
  });

  // Ensure GitHub auth manager is available
  if (!fastify.githubAuth) {
    throw new Error('GitHub authentication plugin must be registered before policy plugin');
  }

  // Create policy service instance
  const policyService = createPolicyService(fastify.githubAuth);
  
  // Decorate fastify instance
  fastify.decorate('policyService', policyService);

  // Set up periodic cleanup of expired cache entries
  const cleanupInterval = setInterval(() => {
    try {
      policyService.cleanup();
      logger.debug('Policy cache cleanup completed');
    } catch (error) {
      logger.error('Policy cache cleanup failed', { error });
    }
  }, cleanupIntervalMs);

  // Clean up interval on app close
  fastify.addHook('onClose', async () => {
    logger.info('Cleaning up policy service plugin');
    clearInterval(cleanupInterval);
  });

  logger.info('Policy service plugin registered successfully');
}

// Export as fastify plugin
export default fastifyPlugin(policyPlugin, {
  name: 'policy',
  dependencies: ['github-auth'],
});
