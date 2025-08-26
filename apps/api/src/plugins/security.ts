/**
 * Comprehensive Security Plugin for FlakeGuard API
 * 
 * Implements enterprise-grade security features including:
 * - Secret management with Docker secrets and file-based loading
 * - Webhook signature verification (GitHub and Slack)
 * - Rate limiting with user-based controls
 * - CSRF protection for dashboard endpoints
 * - Security headers and CSP policies
 * - Input validation and sanitization
 * - Audit logging for security events
 */

import * as crypto from 'crypto';
import * as fs from 'fs';

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

interface SecurityConfig {
  enableCSRF: boolean;
  enableAuditLogging: boolean;
  webhookSignatureRequired: boolean;
  rateLimiting: {
    global: { max: number; window: number };
    api: { max: number; window: number };
    webhook: { max: number; window: number };
  };
  csp: {
    directives: Record<string, string[]>;
  };
}

interface WebhookVerificationRequest {
  signature: string;
  timestamp?: string;
  payload: string | Buffer;
  provider: 'github' | 'slack';
}

interface SecurityAuditEvent {
  type: 'webhook_verification' | 'rate_limit' | 'csrf_violation' | 'authentication_failure';
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string;
  details: Record<string, unknown>;
  timestamp: Date;
  userAgent?: string;
  ip?: string;
}

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Schema for validating webhook headers (used in validation middleware)
export const webhookHeadersSchema = z.object({
  'x-github-event': z.string().optional(),
  'x-github-delivery': z.string().optional(),
  'x-hub-signature-256': z.string().optional(),
  'x-slack-signature': z.string().optional(),
  'x-slack-request-timestamp': z.string().optional(),
  'content-type': z.string(),
  'user-agent': z.string().optional(),
});

// Schema for validating CSRF tokens (used in token validation)
export const csrfTokenSchema = z.object({
  token: z.string().min(32),
  expires: z.number(),
  userSession: z.string().optional(),
});

// =============================================================================
// SECURITY PLUGIN IMPLEMENTATION
// =============================================================================

export interface SecurityPluginOptions {
  config?: Partial<SecurityConfig>;
  secretsManager?: SecretsManager;
}

const defaultSecurityConfig: SecurityConfig = {
  enableCSRF: config.env === 'production',
  enableAuditLogging: true,
  webhookSignatureRequired: true,
  rateLimiting: {
    global: { max: 1000, window: 60000 }, // 1000 requests per minute globally
    api: { max: 100, window: 60000 },     // 100 API requests per minute per user
    webhook: { max: 50, window: 60000 },  // 50 webhook requests per minute per IP
  },
  csp: {
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'connect-src': ["'self'"],
      'font-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
    },
  },
};

async function securityPlugin(
  fastify: FastifyInstance,
  options: SecurityPluginOptions = {}
): Promise<void> {
  const securityConfig = { ...defaultSecurityConfig, ...options.config };
  const secretsManager = options.secretsManager || new SecretsManager();
  
  // Initialize security state
  const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
  const csrfTokenStore = new Map<string, { token: string; expires: number }>();
  const auditEvents: SecurityAuditEvent[] = [];

  // =============================================================================
  // SECRET MANAGEMENT
  // =============================================================================

  fastify.decorate('secrets', secretsManager);
  fastify.decorate('securityConfig', securityConfig);

  // =============================================================================
  // WEBHOOK SIGNATURE VERIFICATION
  // =============================================================================

  fastify.decorateRequest('verifyWebhookSignature', function(
    this: FastifyRequest,
    options: WebhookVerificationRequest
  ): boolean {
    try {
      if (options.provider === 'github') {
        return verifyGitHubWebhookSignature(
          options.payload,
          options.signature,
          secretsManager.getSecret('GITHUB_WEBHOOK_SECRET')
        );
      } else if (options.provider === 'slack') {
        return verifySlackWebhookSignature(
          options.payload,
          options.signature,
          options.timestamp!,
          secretsManager.getSecret('SLACK_SIGNING_SECRET')
        );
      }
      return false;
    } catch (error) {
      logSecurityEvent({
        type: 'webhook_verification',
        severity: 'medium',
        source: this.ip,
        details: {
          provider: options.provider,
          error: error instanceof Error ? error.message : 'Unknown error',
          userAgent: this.headers['user-agent'],
        },
        timestamp: new Date(),
        ip: this.ip,
        userAgent: this.headers['user-agent'],
      });
      return false;
    }
  });

  // =============================================================================
  // RATE LIMITING MIDDLEWARE
  // =============================================================================

  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = getRateLimitKey(request);
    const limits = getRateLimitsForRoute(request.url);
    
    if (!checkRateLimit(key, limits, rateLimitStore)) {
      logSecurityEvent({
        type: 'rate_limit',
        severity: 'medium',
        source: request.ip,
        details: {
          route: request.url,
          method: request.method,
          rateLimitKey: key,
          userAgent: request.headers['user-agent'],
        },
        timestamp: new Date(),
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      
      void reply.status(429).send({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil(limits.window / 1000),
        },
      });
      return;
    }
  });

  // =============================================================================
  // CSRF PROTECTION
  // =============================================================================

  if (securityConfig.enableCSRF) {
    // Generate CSRF token endpoint
    fastify.get('/api/security/csrf-token', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = generateCSRFToken();
      const sessionId = request.headers['x-session-id'] as string || 'anonymous';
      
      csrfTokenStore.set(sessionId, {
        token,
        expires: Date.now() + (30 * 60 * 1000), // 30 minutes
      });
      
      void reply.send({ token });
    });

    // CSRF validation for state-changing operations
    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      if (shouldValidateCSRF(request)) {
        const csrfToken = request.headers['x-csrf-token'] as string;
        const sessionId = request.headers['x-session-id'] as string || 'anonymous';
        
        if (!validateCSRFToken(csrfToken, sessionId, csrfTokenStore)) {
          logSecurityEvent({
            type: 'csrf_violation',
            severity: 'high',
            source: request.ip,
            details: {
              route: request.url,
              method: request.method,
              sessionId,
              providedToken: csrfToken ? 'present' : 'missing',
            },
            timestamp: new Date(),
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          });
          
          void reply.status(403).send({
            success: false,
            error: {
              code: 'CSRF_TOKEN_INVALID',
              message: 'Invalid or missing CSRF token.',
            },
          });
          return;
        }
      }
    });
  }

  // =============================================================================
  // SECURITY HEADERS
  // =============================================================================

  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    // Add security headers
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    
    // Content Security Policy
    const cspDirectives = Object.entries(securityConfig.csp.directives)
      .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
      .join('; ');
    reply.header('Content-Security-Policy', cspDirectives);

    // HSTS for HTTPS
    if (request.protocol === 'https') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  // =============================================================================
  // AUDIT LOGGING ENDPOINTS
  // =============================================================================

  if (securityConfig.enableAuditLogging) {
    fastify.get('/api/security/audit-events', {
      preHandler: [requireAuthentication],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
            severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            type: { type: 'string', enum: ['webhook_verification', 'rate_limit', 'csrf_violation', 'authentication_failure'] },
          },
        },
      },
    }, async (request, reply) => {
      const query = request.query as {
        limit?: number;
        severity?: SecurityAuditEvent['severity'];
        type?: SecurityAuditEvent['type'];
      };
      const { limit = 50, severity, type } = query;
      
      let filteredEvents = auditEvents.slice(-1000); // Keep last 1000 events
      
      if (severity) {
        filteredEvents = filteredEvents.filter((event: SecurityAuditEvent) => event.severity === severity);
      }
      
      if (type) {
        filteredEvents = filteredEvents.filter((event: SecurityAuditEvent) => event.type === type);
      }
      
      const paginatedEvents = filteredEvents
        .sort((a: SecurityAuditEvent, b: SecurityAuditEvent) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, limit);
      
      void reply.send({
        success: true,
        data: paginatedEvents,
        totalCount: filteredEvents.length,
      });
    });
  }

  // =============================================================================
  // HELPER FUNCTIONS
  // =============================================================================

  function logSecurityEvent(event: SecurityAuditEvent): void {
    if (securityConfig.enableAuditLogging) {
      auditEvents.push(event);
      
      // Log to structured logger
      logger.warn('Security event detected', {
        securityEvent: event,
      });
      
      // Keep only last 1000 events in memory
      if (auditEvents.length > 1000) {
        auditEvents.shift();
      }
    }
  }

  function getRateLimitKey(request: FastifyRequest): string {
    // Use authentication info if available, otherwise fall back to IP
    const userId = (request as FastifyRequest & { user?: { id: string } }).user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    
    // For webhooks, use installation ID if available
    if (request.url.includes('/webhook')) {
      const installationId = (request.body as { installation?: { id: string } })?.installation?.id;
      if (installationId) {
        return `installation:${installationId}`;
      }
    }
    
    return `ip:${request.ip}`;
  }

  function getRateLimitsForRoute(url: string): { max: number; window: number } {
    if (url.includes('/webhook')) {
      return securityConfig.rateLimiting.webhook;
    } else if (url.startsWith('/api/')) {
      return securityConfig.rateLimiting.api;
    }
    return securityConfig.rateLimiting.global;
  }

  function checkRateLimit(
    key: string,
    limits: { max: number; window: number },
    store: Map<string, { count: number; resetTime: number }>
  ): boolean {
    const now = Date.now();
    const entry = store.get(key);
    
    if (!entry || now > entry.resetTime) {
      store.set(key, { count: 1, resetTime: now + limits.window });
      return true;
    }
    
    if (entry.count >= limits.max) {
      return false;
    }
    
    entry.count++;
    return true;
  }

  function shouldValidateCSRF(request: FastifyRequest): boolean {
    // Only validate CSRF for state-changing operations
    const method = request.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return false;
    }
    
    // Skip CSRF for API endpoints (they should use API tokens)
    if (request.url.startsWith('/api/') && !request.url.includes('/dashboard/')) {
      return false;
    }
    
    // Skip CSRF for webhooks
    if (request.url.includes('/webhook')) {
      return false;
    }
    
    return true;
  }

  function generateCSRFToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  function validateCSRFToken(
    token: string | undefined,
    sessionId: string,
    store: Map<string, { token: string; expires: number }>
  ): boolean {
    if (!token) {
      return false;
    }
    
    const storedToken = store.get(sessionId);
    if (!storedToken || Date.now() > storedToken.expires) {
      return false;
    }
    
    return crypto.timingSafeEqual(
      Buffer.from(token, 'hex'),
      Buffer.from(storedToken.token, 'hex')
    );
  }

  async function requireAuthentication(request: FastifyRequest, reply: FastifyReply) {
    // This is a placeholder - implement actual authentication logic
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      void reply.status(401).send({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Valid authentication token is required.',
        },
      });
      return;
    }
  }
}

// =============================================================================
// SECRETS MANAGER
// =============================================================================

export class SecretsManager {
  private secrets: Map<string, string> = new Map();
  private dockerSecretsPath = '/run/secrets';
  
  constructor(options: { dockerSecretsPath?: string } = {}) {
    if (options.dockerSecretsPath) {
      this.dockerSecretsPath = options.dockerSecretsPath;
    }
    this.loadSecrets();
  }

  /**
   * Load secrets from various sources in priority order:
   * 1. Environment variables ending with _FILE (file paths)
   * 2. Docker secrets
   * 3. Direct environment variables
   */
  private loadSecrets(): void {
    const secretKeys = [
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'SLACK_SIGNING_SECRET',
      'SLACK_BOT_TOKEN',
      'JWT_SECRET',
      'API_KEY',
    ];

    for (const key of secretKeys) {
      let value: string | undefined;
      
      // 1. Check for _FILE environment variable
      const fileKey = `${key}_FILE`;
      const filePath = process.env[fileKey];
      if (filePath) {
        value = this.loadFromFile(filePath, key);
      }
      
      // 2. Check Docker secrets
      if (!value) {
        value = this.loadFromDockerSecret(key);
      }
      
      // 3. Check direct environment variable
      if (!value) {
        value = process.env[key];
      }
      
      if (value) {
        this.secrets.set(key, value);
        logger.debug(`Loaded secret: ${key}`, {
          source: filePath ? 'file' : (this.hasDockerSecret(key) ? 'docker-secret' : 'env'),
        });
      }
    }
  }

  private loadFromFile(filePath: string, secretKey: string): string | undefined {
    try {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      logger.info(`Loaded secret from file`, { secretKey, filePath });
      return content;
    } catch (error) {
      logger.warn(`Failed to load secret from file`, {
        secretKey,
        filePath,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  private loadFromDockerSecret(secretKey: string): string | undefined {
    try {
      const secretPath = `${this.dockerSecretsPath}/${secretKey.toLowerCase()}`;
      const content = fs.readFileSync(secretPath, 'utf8').trim();
      logger.info(`Loaded secret from Docker secret`, { secretKey });
      return content;
    } catch (error) {
      // Docker secrets not available - this is normal in non-Docker environments
      return undefined;
    }
  }

  private hasDockerSecret(secretKey: string): boolean {
    try {
      const secretPath = `${this.dockerSecretsPath}/${secretKey.toLowerCase()}`;
      return fs.existsSync(secretPath);
    } catch {
      return false;
    }
  }

  public getSecret(key: string): string {
    const value = this.secrets.get(key);
    if (!value) {
      throw new Error(`Secret not found: ${key}`);
    }
    return value;
  }

  public hasSecret(key: string): boolean {
    return this.secrets.has(key);
  }

  public refreshSecrets(): void {
    this.loadSecrets();
  }

  public getSecretMetadata(): Array<{ key: string; source: string; loaded: boolean }> {
    const secretKeys = [
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
      'SLACK_SIGNING_SECRET',
      'SLACK_BOT_TOKEN',
      'JWT_SECRET',
      'API_KEY',
    ];

    return secretKeys.map(key => {
      let source = 'not-loaded';
      if (this.secrets.has(key)) {
        if (process.env[`${key}_FILE`]) {
          source = 'file';
        } else if (this.hasDockerSecret(key)) {
          source = 'docker-secret';
        } else if (process.env[key]) {
          source = 'env';
        }
      }
      
      return {
        key,
        source,
        loaded: this.secrets.has(key),
      };
    });
  }
}

// =============================================================================
// WEBHOOK VERIFICATION FUNCTIONS
// =============================================================================

function verifyGitHubWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const receivedSignature = signature.slice(7); // Remove 'sha256=' prefix
  
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(receivedSignature, 'hex')
  );
}

function verifySlackWebhookSignature(
  payload: string | Buffer,
  signature: string,
  timestamp: string,
  signingSecret: string
): boolean {
  const time = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  
  // Prevent replay attacks - reject requests older than 5 minutes
  if (Math.abs(now - time) > 300) {
    return false;
  }

  const sigBaseString = `v0:${timestamp}:${payload}`;
  const expectedSignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBaseString)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

// =============================================================================
// PLUGIN REGISTRATION
// =============================================================================

export default fp(securityPlugin, {
  name: 'security',
  dependencies: [],
});

// =============================================================================
// TYPE AUGMENTATION FOR FASTIFY
// =============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    secrets: SecretsManager;
    securityConfig: SecurityConfig;
  }
  
  interface FastifyRequest {
    verifyWebhookSignature(options: WebhookVerificationRequest): boolean;
  }
}