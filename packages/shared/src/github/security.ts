/**
 * Security utilities for GitHub API wrapper
 * Handles webhook verification, request sanitization, and audit logging
 */

import { createHmac, timingSafeEqual } from 'crypto';

import type { Logger } from 'pino';

import { GitHubApiError } from './types.js';
import type {
  SecurityConfig,
  AuditLogEntry,
} from './types.js';

/**
 * Type for sanitizable data structures
 */
type SanitizableData = 
  | string
  | number
  | boolean
  | null
  | undefined
  | SanitizableData[]
  | { [key: string]: SanitizableData };

/**
 * Type for request validation options
 */
interface RequestValidationOptions {
  method: string;
  endpoint: string;
  data?: unknown;
  headers?: Record<string, string>;
}

/**
 * Type guard to check if a value is a valid object for sanitization
 */
function isValidObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if a value is sanitizable
 */
function isSanitizableData(value: unknown): value is SanitizableData {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isSanitizableData);
  if (isValidObject(value)) {
    return Object.values(value).every(isSanitizableData);
  }
  return false;
}

/**
 * Security manager for GitHub API operations
 */
export class SecurityManager {
  private readonly auditLog: AuditLogEntry[] = [];

  constructor(
    private readonly config: SecurityConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Verify GitHub webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    if (!this.config.verifyWebhookSignatures) {
      this.logger.warn('Webhook signature verification is disabled');
      return true;
    }

    try {
      // GitHub sends signature as "sha256=<hash>"
      if (!signature.startsWith('sha256=')) {
        this.logger.error(
          { signaturePrefix: signature.substring(0, 10) },
          'Invalid webhook signature format'
        );
        return false;
      }

      const expectedSignature = signature.substring(7); // Remove "sha256=" prefix
      const computedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      const computedBuffer = Buffer.from(computedSignature, 'hex');

      if (expectedBuffer.length !== computedBuffer.length) {
        this.logger.error(
          {
            expectedLength: expectedBuffer.length,
            computedLength: computedBuffer.length,
          },
          'Webhook signature length mismatch'
        );
        return false;
      }

      const isValid = timingSafeEqual(expectedBuffer, computedBuffer);

      if (!isValid) {
        this.logger.error('Webhook signature verification failed');
      } else {
        this.logger.debug('Webhook signature verified successfully');
      }

      return isValid;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error during webhook signature verification'
      );
      return false;
    }
  }

  /**
   * Sanitize request data for logging
   */
  sanitizeRequest(data: unknown): SanitizableData {
    if (!this.config.sanitizeRequests) {
      return isSanitizableData(data) ? data : '[UNSANITIZABLE_DATA]';
    }

    return this.recursiveSanitize(data);
  }

  /**
   * Sanitize response data for logging
   */
  sanitizeResponse(data: unknown): SanitizableData {
    if (!this.config.sanitizeRequests) {
      return isSanitizableData(data) ? data : '[UNSANITIZABLE_DATA]';
    }

    return this.recursiveSanitize(data);
  }

  /**
   * Validate request parameters
   */
  validateRequest(options: RequestValidationOptions): void {
    // Validate HTTP method
    const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
    if (!allowedMethods.includes(options.method.toUpperCase())) {
      throw new GitHubApiError(
        'CONFIGURATION_INVALID',
        `Invalid HTTP method: ${options.method}`,
        { retryable: false }
      );
    }

    // Validate endpoint format
    if (!options.endpoint.startsWith('/')) {
      throw new GitHubApiError(
        'CONFIGURATION_INVALID',
        'Endpoint must start with /',
        { retryable: false }
      );
    }

    // Check for suspicious patterns
    this.detectSuspiciousPatterns(options);

    // Validate headers
    if (options.headers) {
      this.validateHeaders(options.headers);
    }
  }

  /**
   * Record audit log entry
   */
  recordAuditLog(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    if (!this.config.auditLogging) {
      return;
    }

    const auditEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date(),
    };

    this.auditLog.push(auditEntry);

    // Keep only last 10000 entries
    if (this.auditLog.length > 10000) {
      this.auditLog.shift();
    }

    // Log security-relevant events
    if (!entry.success || (entry.error && this.isSecurityRelevantError(entry.error))) {
      this.logger.warn(
        {
          requestId: entry.requestId,
          method: entry.method,
          endpoint: entry.endpoint,
          success: entry.success,
          duration: entry.duration,
          error: entry.error,
        },
        'Security audit log entry'
      );
    }
  }

  /**
   * Get audit log entries
   */
  getAuditLog(options: {
    since?: Date;
    until?: Date;
    limit?: number;
    filterFailures?: boolean;
  } = {}): AuditLogEntry[] {
    let entries = this.auditLog;

    // Apply time filters
    if (options.since) {
      const sinceDate = options.since;
      entries = entries.filter(entry => entry.timestamp >= sinceDate);
    }

    if (options.until) {
      const untilDate = options.until;
      entries = entries.filter(entry => entry.timestamp <= untilDate);
    }

    // Filter failures only
    if (options.filterFailures) {
      entries = entries.filter(entry => !entry.success);
    }

    // Apply limit
    if (options.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  /**
   * Generate security report
   */
  generateSecurityReport(windowMs: number = 24 * 60 * 60 * 1000): {
    totalRequests: number;
    failedRequests: number;
    authFailures: number;
    rateLimitHits: number;
    suspiciousActivity: number;
    avgResponseTime: number;
    topFailureReasons: Array<{ reason: string; count: number }>;
  } {
    const since = new Date(Date.now() - windowMs);
    const entries = this.getAuditLog({ since });

    const failedEntries = entries.filter(e => !e.success);
    const authFailures = failedEntries.filter(e => 
      e.error?.code === 'AUTHENTICATION_FAILED' ||
      e.error?.message?.toLowerCase().includes('auth')
    );
    const rateLimitHits = failedEntries.filter(e =>
      e.error?.code === 'RATE_LIMITED' ||
      e.error?.message?.toLowerCase().includes('rate limit')
    );

    // Calculate average response time
    const totalDuration = entries.reduce((sum, e) => sum + e.duration, 0);
    const avgResponseTime = entries.length > 0 ? totalDuration / entries.length : 0;

    // Count failure reasons
    const failureReasons = new Map<string, number>();
    failedEntries.forEach(entry => {
      const reason = entry.error?.code || entry.error?.message || 'Unknown';
      failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1);
    });

    const topFailureReasons = Array.from(failureReasons.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Detect suspicious activity
    const suspiciousActivity = this.detectSuspiciousActivity(entries);

    return {
      totalRequests: entries.length,
      failedRequests: failedEntries.length,
      authFailures: authFailures.length,
      rateLimitHits: rateLimitHits.length,
      suspiciousActivity,
      avgResponseTime,
      topFailureReasons,
    };
  }

  /**
   * Recursively sanitize object
   */
  private recursiveSanitize(obj: unknown, depth: number = 0): SanitizableData {
    // Prevent infinite recursion
    if (depth > 10) {
      return '[MAX_DEPTH_REACHED]';
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (typeof obj === 'object') {
      if (Array.isArray(obj)) {
        return obj.map(item => this.recursiveSanitize(item, depth + 1));
      }

      if (isValidObject(obj)) {
        const sanitized: Record<string, SanitizableData> = {};
        for (const [key, value] of Object.entries(obj)) {
          if (this.isSensitiveField(key)) {
            sanitized[key] = this.redactValue(value);
          } else {
            sanitized[key] = this.recursiveSanitize(value, depth + 1);
          }
        }
        return sanitized;
      }
    }

    // For any other type (functions, symbols, etc.), return a safe representation
    return '[UNSANITIZABLE_TYPE]';
  }

  /**
   * Check if field is sensitive
   */
  private isSensitiveField(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return this.config.sensitiveFields.some(field => 
      lowerKey.includes(field.toLowerCase())
    );
  }

  /**
   * Redact sensitive value
   */
  private redactValue(value: unknown): string {
    if (typeof value === 'string' && value.length > 0) {
      if (value.length <= 4) {
        return '*'.repeat(value.length);
      }
      return value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2);
    }
    return '[REDACTED]';
  }

  /**
   * Sanitize string by removing potential sensitive data
   */
  private sanitizeString(str: string): string {
    // Remove potential tokens (long alphanumeric strings)
    return str.replace(/\b[a-zA-Z0-9]{20,}\b/g, '[TOKEN]');
  }

  /**
   * Detect suspicious patterns in request
   */
  private detectSuspiciousPatterns(options: RequestValidationOptions): void {
    // Check for path traversal attempts
    if (options.endpoint.includes('..') || options.endpoint.includes('//')) {
      this.logger.warn(
        { endpoint: options.endpoint },
        'Potential path traversal attempt detected'
      );
      
      throw new GitHubApiError(
        'PERMISSION_DENIED',
        'Suspicious request pattern detected',
        { retryable: false }
      );
    }

    // Check for SQL injection patterns in data
    if (options.data && typeof options.data === 'string') {
      const sqlPatterns = [
        /union\s+select/i,
        /drop\s+table/i,
        /insert\s+into/i,
        /delete\s+from/i,
        /update\s+.*\s+set/i,
      ];

      for (const pattern of sqlPatterns) {
        if (pattern.test(options.data)) {
          this.logger.warn(
            { pattern: pattern.source },
            'Potential SQL injection attempt detected'
          );
          
          throw new GitHubApiError(
            'PERMISSION_DENIED',
            'Suspicious request data detected',
            { retryable: false }
          );
        }
      }
    } else if (options.data && typeof options.data === 'object') {
      // Handle object data by converting to string for pattern checking
      const dataStr = JSON.stringify(options.data);
      const sqlPatterns = [
        /union\s+select/i,
        /drop\s+table/i,
        /insert\s+into/i,
        /delete\s+from/i,
        /update\s+.*\s+set/i,
      ];

      for (const pattern of sqlPatterns) {
        if (pattern.test(dataStr)) {
          this.logger.warn(
            { pattern: pattern.source },
            'Potential SQL injection attempt detected in object data'
          );
          
          throw new GitHubApiError(
            'PERMISSION_DENIED',
            'Suspicious request data detected',
            { retryable: false }
          );
        }
      }
    }
  }

  /**
   * Validate request headers
   */
  private validateHeaders(headers: Record<string, string>): void {
    // Check for suspicious headers
    const suspiciousHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'x-originating-ip',
      'x-cluster-client-ip',
    ];

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      
      // Warn about suspicious headers that could indicate proxy manipulation
      if (suspiciousHeaders.includes(lowerKey)) {
        this.logger.warn(
          { header: key, value: this.redactValue(value) },
          'Suspicious header detected'
        );
      }

      // Validate header values
      if (typeof value !== 'string') {
        throw new GitHubApiError(
          'CONFIGURATION_INVALID',
          `Header value must be string: ${key}`,
          { retryable: false }
        );
      }

      // Check for header injection
      if (value.includes('\n') || value.includes('\r')) {
        throw new GitHubApiError(
          'PERMISSION_DENIED',
          'Header injection attempt detected',
          { retryable: false }
        );
      }
    }
  }

  /**
   * Check if error is security relevant
   */
  private isSecurityRelevantError(error: { code?: string; message?: string }): boolean {
    const securityCodes = [
      'AUTHENTICATION_FAILED',
      'PERMISSION_DENIED',
      'WEBHOOK_VERIFICATION_FAILED',
    ];

    return securityCodes.includes(error.code || '') ||
           error.message?.toLowerCase().includes('unauthorized') === true ||
           error.message?.toLowerCase().includes('forbidden') === true;
  }

  /**
   * Detect suspicious activity patterns
   */
  private detectSuspiciousActivity(entries: AuditLogEntry[]): number {
    let suspiciousCount = 0;

    // Group by endpoint and look for unusual patterns
    const endpointStats = new Map<string, {
      count: number;
      failures: number;
      avgDuration: number;
    }>();

    entries.forEach(entry => {
      const key = `${entry.method} ${entry.endpoint}`;
      const stats = endpointStats.get(key) || { count: 0, failures: 0, avgDuration: 0 };
      
      stats.count++;
      stats.avgDuration = (stats.avgDuration * (stats.count - 1) + entry.duration) / stats.count;
      
      if (!entry.success) {
        stats.failures++;
      }
      
      endpointStats.set(key, stats);
    });

    // Check for suspicious patterns
    endpointStats.forEach((stats, endpoint) => {
      const failureRate = stats.failures / stats.count;
      
      // High failure rate (>50%) with many attempts (>10)
      if (failureRate > 0.5 && stats.count > 10) {
        this.logger.warn(
          {
            endpoint,
            failureRate,
            attempts: stats.count,
          },
          'Suspicious activity: High failure rate detected'
        );
        suspiciousCount++;
      }

      // Unusually high request volume (>100 requests in time window)
      if (stats.count > 100) {
        this.logger.warn(
          {
            endpoint,
            requestCount: stats.count,
          },
          'Suspicious activity: High request volume detected'
        );
        suspiciousCount++;
      }
    });

    return suspiciousCount;
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog.length = 0;
    this.logger.info('Audit log cleared');
  }
}

/**
 * Token manager for secure token handling
 */
export class TokenManager {
  private readonly tokens = new Map<string, {
    value: string;
    expiresAt?: Date;
    lastUsed: Date;
  }>();

  constructor(private readonly logger: Logger) {}

  /**
   * Store token securely
   */
  storeToken(key: string, token: string, expiresAt?: Date): void {
    this.tokens.set(key, {
      value: token,
      expiresAt,
      lastUsed: new Date(),
    });

    this.logger.debug(
      { 
        key, 
        expiresAt,
        tokenLength: token.length,
      },
      'Token stored securely'
    );
  }

  /**
   * Retrieve token
   */
  getToken(key: string): string | null {
    const tokenInfo = this.tokens.get(key);
    
    if (!tokenInfo) {
      return null;
    }

    // Check expiry
    if (tokenInfo.expiresAt && tokenInfo.expiresAt <= new Date()) {
      this.tokens.delete(key);
      this.logger.warn({ key }, 'Token expired and removed');
      return null;
    }

    // Update last used
    tokenInfo.lastUsed = new Date();
    
    return tokenInfo.value;
  }

  /**
   * Remove token
   */
  removeToken(key: string): boolean {
    const removed = this.tokens.delete(key);
    if (removed) {
      this.logger.debug({ key }, 'Token removed');
    }
    return removed;
  }

  /**
   * Clear expired tokens
   */
  clearExpiredTokens(): number {
    const now = new Date();
    let cleared = 0;

    for (const [key, tokenInfo] of Array.from(this.tokens.entries())) {
      if (tokenInfo.expiresAt && tokenInfo.expiresAt <= now) {
        this.tokens.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      this.logger.debug({ clearedCount: cleared }, 'Expired tokens cleared');
    }

    return cleared;
  }

  /**
   * Get token statistics
   */
  getTokenStats(): {
    totalTokens: number;
    expiredTokens: number;
    tokensUsedLast24h: number;
  } {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    let expiredTokens = 0;
    let tokensUsedLast24h = 0;

    for (const tokenInfo of Array.from(this.tokens.values())) {
      if (tokenInfo.expiresAt && tokenInfo.expiresAt <= now) {
        expiredTokens++;
      }
      
      if (tokenInfo.lastUsed >= yesterday) {
        tokensUsedLast24h++;
      }
    }

    return {
      totalTokens: this.tokens.size,
      expiredTokens,
      tokensUsedLast24h,
    };
  }
}