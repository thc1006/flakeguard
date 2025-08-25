/**
 * Slack integration performance tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createSlackConfig } from '../config.js';
import { SlackMessageBuilder } from '../message-builder.js';
import { SlackService } from '../service.js';
import type { FlakeNotification, SlackConfig } from '../types.js';
import { TestCrypto } from '@flakeguard/shared/utils';

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456' }),
      update: vi.fn().mockResolvedValue({ ok: true }),
    },
  })),
  LogLevel: {
    WARN: 'warn',
  },
}));

describe('Slack Integration Performance Tests', () => {
  let slackService: SlackService;
  let messageBuilder: SlackMessageBuilder;
  let config: SlackConfig;

  beforeEach(() => {
    config = {
      ...createSlackConfig(),
      botToken: TestCrypto.generateBotToken(),
      signingSecret: TestCrypto.generateSlackSigningSecret(),
      performance: {
        connectionPoolSize: 3,
        maxConcurrentMessages: 10,
        cacheTimeoutMs: 300000,
        batchSize: 5,
        retryAttempts: 3,
      },
    };
    
    slackService = new SlackService(config);
    messageBuilder = new SlackMessageBuilder(config);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Message Builder Performance', () => {
    it('should build flake alert in under 10ms', async () => {
      const flakeScore = {
        testName: 'TestPaymentFlow.testCreditCardValidation',
        testFullName: 'com.example.TestPaymentFlow.testCreditCardValidation',
        score: 0.75,
        confidence: 0.85,
        features: {
          failSuccessRatio: 0.3,
          rerunPassRate: 0.6,
          failureClustering: 0.4,
          intermittencyScore: 0.8,
          messageSignatureVariance: 0.2,
          totalRuns: 50,
          recentFailures: 8,
          consecutiveFailures: 3,
          maxConsecutiveFailures: 5,
          daysSinceFirstSeen: 14,
          avgTimeBetweenFailures: 2.5,
        },
        recommendation: {
          action: 'quarantine' as const,
          reason: 'High flakiness with strong intermittency pattern',
          confidence: 0.85,
          priority: 'high' as const,
        },
        lastUpdated: new Date(),
      };

      const startTime = Date.now();
      const template = messageBuilder.buildFlakeAlert(flakeScore, 'owner/repository');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(10);
      expect(template.blocks).toBeDefined();
      expect(template.text).toContain('Flaky test detected');
    });

    it('should handle concurrent notifications efficiently', async () => {
      const notifications: FlakeNotification[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'flake_detected',
        repository: `owner/repo${i}`,
        priority: 'medium',
        data: {
          flakeScore: {
            testName: `Test${i}`,
            testFullName: `com.example.Test${i}`,
            score: 0.6,
            confidence: 0.7,
            features: {
              failSuccessRatio: 0.3,
              rerunPassRate: 0.6,
              failureClustering: 0.4,
              intermittencyScore: 0.8,
              messageSignatureVariance: 0.2,
              totalRuns: 30,
              recentFailures: 5,
              consecutiveFailures: 2,
              maxConsecutiveFailures: 3,
              daysSinceFirstSeen: 10,
              avgTimeBetweenFailures: 1.5,
            },
            recommendation: {
              action: 'warn' as const,
              reason: 'Moderate flakiness detected',
              confidence: 0.7,
              priority: 'medium' as const,
            },
            lastUpdated: new Date(),
          },
        },
        routing: {
          channels: ['#dev-alerts'],
        },
      }));

      const startTime = Date.now();
      const promises = notifications.map(notification => 
        slackService.sendFlakeNotification(notification)
      );
      
      await Promise.allSettled(promises);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000);

      const metrics = slackService.getMetrics();
      expect(metrics.messagesDelivered).toBeGreaterThan(0);
      expect(metrics.errorRate).toBe(0);
    });
  });
});
