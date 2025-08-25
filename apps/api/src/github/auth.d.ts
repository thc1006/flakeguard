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
import { Octokit } from '@octokit/rest';
import { ErrorCode } from './api-spec.js';
import type { AppInstallation, AuthenticatedContext, GitHubAppAuth, GitHubAppConfig, GitHubAppCredentials, InstallationToken } from './types.js';
export interface RepositoryInfo {
    readonly owner: string;
    readonly repo: string;
    readonly fullName: string;
}
/**
 * GitHub App authentication manager
 */
export declare class GitHubAuthManager implements GitHubAppAuth {
    private readonly config;
    private readonly cache;
    private readonly clients;
    constructor(options: {
        config: GitHubAppConfig;
        cache?: Map<string, {
            data: any;
            expiresAt: number;
        }>;
    });
    /**
     * Generate GitHub App JWT for authentication
     */
    generateJWT(): Promise<string>;
    /**
     * Get installation access token with caching
     */
    getInstallationToken(installationId: number): Promise<InstallationToken>;
    /**
     * Validate installation access to repository
     */
    validateInstallationAccess(installationId: number, owner: string, repo?: string): Promise<boolean>;
    /**
     * Get authenticated Octokit client for installation
     */
    getInstallationClient(installationId: number): Promise<Octokit>;
    /**
     * Get authenticated context for installation
     */
    getAuthenticatedContext(installationId: number): Promise<AuthenticatedContext>;
    /**
     * Create app authentication using Octokit auth
     */
    createAppAuth(): ReturnType<typeof createAppAuth>;
    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(payload: string, signature: string): Promise<boolean>;
    /**
     * Get installation information
     */
    getInstallation(installationId: number): Promise<AppInstallation>;
    /**
     * Handle GitHub API rate limiting
     */
    private handleRateLimit;
    /**
     * Handle GitHub API secondary rate limiting
     */
    private handleSecondaryRateLimit;
    /**
     * Get cached item if not expired
     */
    private getCachedItem;
    /**
     * Set cached item with expiration
     */
    private setCachedItem;
    /**
     * Clear expired cache entries
     */
    clearExpiredCache(): void;
    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        expired: number;
    };
}
/**
 * Create GitHub auth manager instance
 */
export declare function createGitHubAuthManager(options: {
    config: GitHubAppConfig;
}): GitHubAuthManager;
/**
 * Validate GitHub App configuration
 */
export declare function validateGitHubConfig(config: Partial<GitHubAppConfig>): config is GitHubAppConfig;
/**
 * Create installation credentials from environment
 */
export declare function createInstallationCredentials(config: GitHubAppConfig, installationId: number): GitHubAppCredentials;
/**
 * Error factory for GitHub authentication errors
 */
export declare class GitHubAuthError extends Error {
    readonly code: ErrorCode;
    readonly installationId?: number | undefined;
    constructor(message: string, code: ErrorCode, installationId?: number | undefined);
}
/**
 * Utility to extract installation ID from webhook payload
 */
export declare function extractInstallationId(payload: any): number | null;
/**
 * Utility to extract repository information from webhook payload
 */
export declare function extractRepositoryInfo(payload: any): {
    owner: string;
    repo: string;
    fullName: string;
} | null;
//# sourceMappingURL=auth.d.ts.map