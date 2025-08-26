/**
 * Slack configuration with performance optimizations
 */

import type { SlackConfig } from './types.js';

export function createSlackConfig(): SlackConfig {
  return {
    botToken: process.env.SLACK_BOT_TOKEN || '',
    signingSecret: process.env.SLACK_SIGNING_SECRET || '',
    appToken: process.env.SLACK_APP_TOKEN,
    channels: {
      alerts: process.env.SLACK_ALERTS_CHANNEL || '#dev-alerts',
      quarantine: process.env.SLACK_QUARANTINE_CHANNEL || '#test-quality',
      summaries: process.env.SLACK_SUMMARIES_CHANNEL || '#daily-reports',
      critical: process.env.SLACK_CRITICAL_CHANNEL || '#incidents',
      team: {
        frontend: process.env.SLACK_FRONTEND_CHANNEL || '#frontend-team',
        backend: process.env.SLACK_BACKEND_CHANNEL || '#backend-team',
        qa: process.env.SLACK_QA_CHANNEL || '#qa-team',
        devops: process.env.SLACK_DEVOPS_CHANNEL || '#devops-team',
      },
    },
    notifications: {
      flakeThreshold: parseFloat(process.env.SLACK_FLAKE_THRESHOLD || '0.6'),
      enableDailySummary: process.env.SLACK_ENABLE_DAILY_SUMMARY === 'true',
      enableWeeklyReport: process.env.SLACK_ENABLE_WEEKLY_REPORT === 'true',
      criticalFailureRate: parseFloat(process.env.SLACK_CRITICAL_FAILURE_RATE || '0.3'),
      maxPayloadSize: parseInt(process.env.SLACK_MAX_PAYLOAD_SIZE || '40000'), // 40KB
      responseTimeoutMs: parseInt(process.env.SLACK_RESPONSE_TIMEOUT_MS || '3000'),
    },
    performance: {
      connectionPoolSize: parseInt(process.env.SLACK_CONNECTION_POOL_SIZE || '3'),
      maxConcurrentMessages: parseInt(process.env.SLACK_MAX_CONCURRENT_MESSAGES || '10'),
      cacheTimeoutMs: parseInt(process.env.SLACK_CACHE_TIMEOUT_MS || '300000'), // 5 minutes
      batchSize: parseInt(process.env.SLACK_BATCH_SIZE || '5'),
      retryAttempts: parseInt(process.env.SLACK_RETRY_ATTEMPTS || '3'),
    },
  };
}

export const DEFAULT_SLACK_CONFIG: Partial<SlackConfig> = {
  notifications: {
    flakeThreshold: 0.6,
    enableDailySummary: true,
    enableWeeklyReport: true,
    criticalFailureRate: 0.3,
    maxPayloadSize: 40000,
    responseTimeoutMs: 3000,
  },
  performance: {
    connectionPoolSize: 3,
    maxConcurrentMessages: 10,
    cacheTimeoutMs: 300000,
    batchSize: 5,
    retryAttempts: 3,
  },
};
