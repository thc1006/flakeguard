/**
 * Fastify Metrics Plugin
 * 
 * Integrates Prometheus metrics collection into Fastify lifecycle:
 * - Automatic HTTP request metrics
 * - Request duration tracking
 * - Error rate monitoring
 * - Memory and system metrics
 */

import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  initializeApiMetrics,
  recordHttpRequest,
  httpRequestsInProgress,
  getMetricsRegistry
} from '../utils/metrics.js';
import { logger } from '../utils/logger.js';

interface MetricsPluginOptions {
  enabled?: boolean;
  excludeRoutes?: string[];
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics: {
      registry: any;
      enabled: boolean;
    };
  }
}

async function metricsPlugin(
  fastify: FastifyInstance,
  options: MetricsPluginOptions = {}
) {
  const { enabled = true, excludeRoutes = ['/health', '/metrics'] } = options;

  if (!enabled) {
    logger.info('Metrics plugin disabled');
    return;
  }

  // Initialize metrics collection
  initializeApiMetrics();
  const registry = getMetricsRegistry();

  // Decorate fastify instance with metrics
  fastify.decorate('metrics', {
    registry,
    enabled: true,
  });

  // Add metrics endpoint
  fastify.get('/metrics', {
    schema: {
      description: 'Prometheus metrics endpoint',
      tags: ['Monitoring'],
      response: {
        200: {
          type: 'string',
          description: 'Prometheus metrics in text format',
        },
      },
    },
  }, async (request, reply) => {
    try {
      const metrics = await registry.metrics();
      reply
        .header('Content-Type', registry.contentType)
        .header('Cache-Control', 'no-cache, no-store, must-revalidate')
        .header('Pragma', 'no-cache')
        .header('Expires', '0')
        .send(metrics);
    } catch (error) {
      logger.error({ error }, 'Failed to collect metrics');
      reply.status(500).send({ error: 'Failed to collect metrics' });
    }
  });

  // Request tracking hooks
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const route = request.routerPath || request.url;
    const method = request.method;

    // Skip excluded routes
    if (excludeRoutes.some(excluded => route.startsWith(excluded))) {
      return;
    }

    // Track request start time
    (request as any).startTime = Date.now();
    
    // Increment in-progress counter
    httpRequestsInProgress.inc({ method, route });
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routerPath || request.url;
    const method = request.method;
    const statusCode = reply.statusCode;
    const startTime = (request as any).startTime;

    // Skip excluded routes
    if (excludeRoutes.some(excluded => route.startsWith(excluded))) {
      return;
    }

    if (startTime) {
      const duration = Date.now() - startTime;
      const errorType = statusCode >= 400 ? getErrorType(statusCode) : undefined;
      
      recordHttpRequest(method, route, statusCode, duration, errorType);
    }
  });

  fastify.addHook('onError', async (request: FastifyRequest, reply: FastifyReply, error: Error) => {
    const route = request.routerPath || request.url;
    const method = request.method;
    const statusCode = reply.statusCode || 500;
    const startTime = (request as any).startTime;

    // Skip excluded routes
    if (excludeRoutes.some(excluded => route.startsWith(excluded))) {
      return;
    }

    if (startTime) {
      const duration = Date.now() - startTime;
      const errorType = getErrorTypeFromException(error);
      
      recordHttpRequest(method, route, statusCode, duration, errorType);
    }
  });

  logger.info('Metrics plugin initialized with Prometheus endpoint at /metrics');
}

/**
 * Get error type from HTTP status code
 */
function getErrorType(statusCode: number): string {
  if (statusCode >= 500) return 'server_error';
  if (statusCode >= 400) return 'client_error';
  return 'unknown';
}

/**
 * Get error type from exception
 */
function getErrorTypeFromException(error: Error): string {
  if (error.name === 'ValidationError') return 'validation_error';
  if (error.name === 'UnauthorizedError') return 'auth_error';
  if (error.name === 'TimeoutError') return 'timeout_error';
  if (error.message.includes('database')) return 'database_error';
  if (error.message.includes('network')) return 'network_error';
  return 'application_error';
}

export default fp(metricsPlugin, {
  fastify: '4.x',
  name: 'metrics-plugin',
});