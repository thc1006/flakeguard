import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import { z } from 'zod';
// Load environment variables from .env file
dotenv.config();
// Remove this import as we're inlining the GitHub schema to avoid merge issues
// import { githubEnvSchema } from '../github/schemas.js';
// Slack configuration schema
const slackEnvSchema = z.object({
    SLACK_SIGNING_SECRET: z.string().min(1),
    SLACK_BOT_TOKEN: z.string().min(1).regex(/^xoxb-/),
    SLACK_APP_TOKEN: z.string().min(1).regex(/^xapp-/).optional(),
    SLACK_PORT: z.string().transform(Number).default('3001'),
    SLACK_PROCESS_BEFORE_RESPONSE: z.string().transform(Boolean).default('true'),
});
// Base environment schema
const baseEnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).default('3000'),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string(),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    JWT_SECRET: z.string().min(32),
    API_KEY: z.string().min(16),
    RATE_LIMIT_MAX: z.string().transform(Number).default('100'),
    RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('60000'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    // Policy defaults
    FLAKE_WARN_THRESHOLD: z.string().transform(Number).default('0.3'),
    FLAKE_QUARANTINE_THRESHOLD: z.string().transform(Number).default('0.6'),
    // Feature flags
    ENABLE_SLACK_APP: z.string().transform(Boolean).default('false'),
    ENABLE_GITHUB_WEBHOOKS: z.string().transform(Boolean).default('true'),
    ENABLE_QUARANTINE_ACTIONS: z.string().transform(Boolean).default('true'),
    // GitHub configuration (inline to avoid merge issues)
    GITHUB_APP_ID: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()),
    GITHUB_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_PRIVATE_KEY_PATH: z.string().min(1).optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(1),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
}).merge(slackEnvSchema.partial());
// Apply GitHub private key validation
const envSchema = baseEnvSchema.refine((data) => data.GITHUB_PRIVATE_KEY || data.GITHUB_PRIVATE_KEY_PATH, {
    message: "Either GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH must be provided",
    path: ["GITHUB_PRIVATE_KEY"],
});
const env = envSchema.parse(process.env);
/**
 * Load GitHub private key from environment variable or file path
 */
function loadGitHubPrivateKey() {
    if (env.GITHUB_PRIVATE_KEY) {
        return env.GITHUB_PRIVATE_KEY;
    }
    if (env.GITHUB_PRIVATE_KEY_PATH) {
        try {
            return readFileSync(env.GITHUB_PRIVATE_KEY_PATH, 'utf8');
        }
        catch (error) {
            throw new Error(`Failed to read GitHub private key from file: ${env.GITHUB_PRIVATE_KEY_PATH}`);
        }
    }
    throw new Error('Either GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH must be provided');
}
/**
 * Validate Slack configuration if Slack app is enabled
 */
function validateSlackConfig() {
    if (!env.ENABLE_SLACK_APP) {
        return null;
    }
    if (!env.SLACK_SIGNING_SECRET || !env.SLACK_BOT_TOKEN) {
        throw new Error('SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN are required when ENABLE_SLACK_APP is true');
    }
    return {
        signingSecret: env.SLACK_SIGNING_SECRET,
        token: env.SLACK_BOT_TOKEN,
        appToken: env.SLACK_APP_TOKEN,
        port: env.SLACK_PORT,
        processBeforeResponse: env.SLACK_PROCESS_BEFORE_RESPONSE,
    };
}
export const config = {
    env: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwtSecret: env.JWT_SECRET,
    apiKey: env.API_KEY,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindow: env.RATE_LIMIT_WINDOW_MS,
    logLevel: env.LOG_LEVEL,
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    // Policy defaults
    policy: {
        warnThreshold: env.FLAKE_WARN_THRESHOLD,
        quarantineThreshold: env.FLAKE_QUARANTINE_THRESHOLD,
    },
    // Feature flags
    features: {
        slackApp: env.ENABLE_SLACK_APP,
        githubWebhooks: env.ENABLE_GITHUB_WEBHOOKS,
        quarantineActions: env.ENABLE_QUARANTINE_ACTIONS,
    },
    // GitHub App Configuration
    github: {
        appId: env.GITHUB_APP_ID,
        privateKey: loadGitHubPrivateKey(),
        webhookSecret: env.GITHUB_WEBHOOK_SECRET,
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
    },
    // Slack App Configuration (null if disabled)
    slack: validateSlackConfig(),
};
// Validation helper for runtime config checks
export function requireSlackConfig() {
    if (!config.slack) {
        throw new Error('Slack configuration is required but not available. Set ENABLE_SLACK_APP=true and provide Slack credentials.');
    }
    return config.slack;
}
//# sourceMappingURL=index.js.map