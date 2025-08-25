/**
 * GitHub App Authentication and Client Management
 *
 * Provides robust authentication for GitHub App integration including:
 * - JWT generation for GitHub App authentication
 * - Installation token management with caching and auto-renewal
 * - GitHub API client instantiation with proper authentication
 * - Rate limiting and error handling
 * - Installation validation and access control
 */
import { createAppAuth } from '@octokit/auth-app';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { Octokit } from '@octokit/rest';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { CACHE_KEYS, CACHE_TTL, ERROR_MESSAGES, GITHUB_API, RATE_LIMITS, TIMEOUTS, } from './constants.js';
// Create enhanced Octokit with throttling and retry plugins
const OctokitWithPlugins = Octokit.plugin(throttling, retry);
/**
 * GitHub App authentication manager
 */
export class GitHubAuthManager {
    config;
    prisma;
    cache;
    clients;
    constructor(options) {
        this.config = options.config;
        this.prisma = options.prisma;
        this.cache = options.cache || new Map();
        this.clients = new Map();
    }
    /**
     * Generate GitHub App JWT for authentication
     */
    async generateJWT() {
        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iat: now - 60, // Issued 1 minute ago to account for clock skew
            exp: now + (10 * 60), // Expires in 10 minutes (GitHub's max)
            iss: this.config.appId,
        };
        try {
            return jwt.sign(payload, this.config.privateKey, {
                algorithm: 'RS256',
            });
        }
        catch (error) {
            logger.error('Failed to generate GitHub App JWT', { error });
            throw new Error('Failed to generate GitHub App JWT');
        }
    }
    /**
     * Get installation access token with caching
     */
    async getInstallationToken(installationId) {
        const cacheKey = CACHE_KEYS.INSTALLATION_TOKEN.replace('{installation_id}', installationId.toString());
        const cached = this.getCachedItem(cacheKey);
        if (cached) {
            logger.debug('Using cached installation token', { installationId });
            return cached;
        }
        try {
            const appJwt = await this.generateJWT();
            const appOctokit = new OctokitWithPlugins({
                auth: appJwt,
                baseUrl: GITHUB_API.BASE_URL,
                userAgent: GITHUB_API.USER_AGENT,
                request: {
                    timeout: TIMEOUTS.GITHUB_API_DEFAULT,
                },
                throttle: {
                    onRateLimit: this.handleRateLimit.bind(this),
                    onSecondaryRateLimit: this.handleSecondaryRateLimit.bind(this),
                },
                retry: {
                    doNotRetry: ['400', '401', '403', '404', '422'],
                },
            });
            const { data } = await appOctokit.rest.apps.createInstallationAccessToken({
                installation_id: installationId,
            });
            const token = {
                token: data.token,
                expiresAt: data.expires_at,
                permissions: data.permissions || {},
                repositorySelection: data.repository_selection || 'selected',
                repositories: data.repositories?.map(repo => ({
                    id: repo.id,
                    name: repo.name,
                    fullName: repo.full_name,
                })),
            };
            // Cache for 55 minutes (tokens expire in 1 hour)
            this.setCachedItem(cacheKey, token, CACHE_TTL.INSTALLATION_TOKEN);
            logger.info('Generated new installation token', { installationId });
            return token;
        }
        catch (error) {
            logger.error('Failed to get installation token', {
                installationId,
                error: error.message,
                status: error.status,
            });
            if (error.status === 404) {
                throw new Error(ERROR_MESSAGES.INSTALLATION_NOT_FOUND);
            }
            throw new Error(`Failed to get installation token: ${error.message}`);
        }
    }
    /**
     * Validate installation access to repository
     */
    async validateInstallationAccess(installationId, owner, repo) {
        try {
            const token = await this.getInstallationToken(installationId);
            // If repository selection is 'all', access is granted
            if (token.repositorySelection === 'all') {
                return true;
            }
            // If no specific repo requested, check if any repositories are accessible
            if (!repo) {
                return (token.repositories?.length ?? 0) > 0;
            }
            // Check if specific repository is accessible
            const fullName = `${owner}/${repo}`;
            return token.repositories?.some(r => r.fullName === fullName) ?? false;
        }
        catch (error) {
            logger.error('Failed to validate installation access', {
                installationId,
                owner,
                repo,
                error,
            });
            return false;
        }
    }
    /**
     * Get authenticated Octokit client for installation
     */
    async getInstallationClient(installationId) {
        // Return cached client if available
        const cachedClient = this.clients.get(installationId);
        if (cachedClient) {
            return cachedClient;
        }
        const token = await this.getInstallationToken(installationId);
        const client = new OctokitWithPlugins({
            auth: token.token,
            baseUrl: GITHUB_API.BASE_URL,
            userAgent: GITHUB_API.USER_AGENT,
            request: {
                timeout: TIMEOUTS.GITHUB_API_DEFAULT,
            },
            throttle: {
                onRateLimit: this.handleRateLimit.bind(this),
                onSecondaryRateLimit: this.handleSecondaryRateLimit.bind(this),
            },
            retry: {
                doNotRetry: ['400', '401', '403', '404', '422'],
            },
        });
        // Cache client for the token lifetime
        this.clients.set(installationId, client);
        // Clear cached client when token expires
        setTimeout(() => {
            this.clients.delete(installationId);
        }, 55 * 60 * 1000); // 55 minutes
        return client;
    }
    /**
     * Get authenticated context for installation
     */
    async getAuthenticatedContext(installationId) {
        const token = await this.getInstallationToken(installationId);
        return {
            installationId,
            permissions: token.permissions,
            repositories: token.repositories || 'all',
        };
    }
    /**
     * Create app authentication using Octokit auth
     */
    createAppAuth() {
        return createAppAuth({
            appId: this.config.appId,
            privateKey: this.config.privateKey,
            installationId: this.config.installationId,
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
        });
    }
    /**
     * Verify webhook signature
     */
    async verifyWebhookSignature(payload, signature) {
        if (!signature.startsWith('sha256=')) {
            return false;
        }
        const crypto = await import('crypto');
        const expectedSignature = crypto
            .createHmac('sha256', this.config.webhookSecret)
            .update(payload, 'utf8')
            .digest('hex');
        const receivedSignature = signature.slice(7); // Remove 'sha256=' prefix
        return crypto.timingSafeEqual(Buffer.from(expectedSignature, 'hex'), Buffer.from(receivedSignature, 'hex'));
    }
    /**
     * Get installation information
     */
    async getInstallation(installationId) {
        try {
            const appJwt = await this.generateJWT();
            const appOctokit = new OctokitWithPlugins({
                auth: appJwt,
                baseUrl: GITHUB_API.BASE_URL,
                userAgent: GITHUB_API.USER_AGENT,
            });
            const { data } = await appOctokit.rest.apps.getInstallation({
                installation_id: installationId,
            });
            return {
                id: data.id,
                account: {
                    login: data.account.login,
                    id: data.account.id,
                    type: data.account.type,
                },
                repositorySelection: data.repository_selection,
                permissions: data.permissions || {},
                events: data.events || [],
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                suspendedAt: data.suspended_at,
            };
        }
        catch (error) {
            logger.error('Failed to get installation', {
                installationId,
                error: error.message,
            });
            throw new Error(`Failed to get installation: ${error.message}`);
        }
    }
    /**
     * Handle GitHub API rate limiting
     */
    handleRateLimit(retryAfter, options, octokit, retryCount) {
        logger.warn('GitHub API rate limit hit', {
            retryAfter,
            retryCount,
            endpoint: options.url,
        });
        // Allow up to 3 retries for rate limiting
        if (retryCount <= RATE_LIMITS.MAX_RETRIES) {
            logger.info(`Retrying after ${retryAfter} seconds`, { retryCount });
            return true;
        }
        logger.error('Max rate limit retries exceeded');
        return false;
    }
    /**
     * Handle GitHub API secondary rate limiting
     */
    handleSecondaryRateLimit(retryAfter, options, octokit) {
        logger.warn('GitHub API secondary rate limit hit', {
            retryAfter,
            endpoint: options.url,
        });
        // Always retry for secondary rate limits (they're usually short)
        return retryAfter <= 60; // Only retry if wait time is <= 60 seconds
    }
    /**
     * Get cached item if not expired
     */
    getCachedItem(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }
        if (Date.now() > cached.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return cached.data;
    }
    /**
     * Set cached item with expiration
     */
    setCachedItem(key, data, ttlSeconds) {
        const expiresAt = Date.now() + (ttlSeconds * 1000);
        this.cache.set(key, { data, expiresAt });
    }
    /**
     * Clear expired cache entries
     */
    clearExpiredCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (value.expiresAt <= now) {
                this.cache.delete(key);
            }
        }
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
        const now = Date.now();
        let expired = 0;
        for (const [key, value] of this.cache.entries()) {
            if (value.expiresAt <= now) {
                expired++;
            }
        }
        return {
            size: this.cache.size,
            expired,
        };
    }
}
/**
 * Create GitHub auth manager instance
 */
export function createGitHubAuthManager(options) {
    return new GitHubAuthManager(options);
}
/**
 * Validate GitHub App configuration
 */
export function validateGitHubConfig(config) {
    const requiredFields = [
        'appId',
        'privateKey',
        'webhookSecret',
        'clientId',
        'clientSecret',
    ];
    for (const field of requiredFields) {
        if (!config[field]) {
            logger.error(`Missing required GitHub App configuration: ${field}`);
            return false;
        }
    }
    // Validate private key format
    if (!config.privateKey?.includes('BEGIN PRIVATE KEY') &&
        !config.privateKey?.includes('BEGIN RSA PRIVATE KEY')) {
        logger.error('Invalid GitHub App private key format');
        return false;
    }
    return true;
}
/**
 * Create installation credentials from environment
 */
export function createInstallationCredentials(config, installationId) {
    return {
        appId: config.appId,
        privateKey: config.privateKey,
        installationId,
    };
}
/**
 * Error factory for GitHub authentication errors
 */
export class GitHubAuthError extends Error {
    code;
    installationId;
    constructor(message, code, installationId) {
        super(message);
        this.code = code;
        this.installationId = installationId;
        this.name = 'GitHubAuthError';
    }
}
/**
 * Utility to extract installation ID from webhook payload
 */
export function extractInstallationId(payload) {
    return payload?.installation?.id || null;
}
/**
 * Utility to extract repository information from webhook payload
 */
export function extractRepositoryInfo(payload) {
    const repository = payload?.repository;
    if (!repository) {
        return null;
    }
    return {
        owner: repository.owner?.login,
        repo: repository.name,
        fullName: repository.full_name,
    };
}
//# sourceMappingURL=auth.js.map