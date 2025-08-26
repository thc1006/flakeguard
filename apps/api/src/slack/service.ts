/**
 * High-performance Slack service with connection pooling and async operations
 */

import { 
  WebClient, 
  LogLevel, 
  ChatPostMessageResponse as _ChatPostMessageResponse,
  ErrorCode,
  Block,
  KnownBlock
} from '@slack/web-api';

import { logger } from '../utils/logger.js';

import { SlackMessageBuilder } from './message-builder.js';
import type {
  SlackConfig,
  FlakeNotification,
  SlackMessageState,
  SlackMetrics,
  SlackMessageTemplate,
} from './types.js';

export class SlackService {
  private client: WebClient;
  private messageBuilder: SlackMessageBuilder;
  private config: SlackConfig;
  private connectionPool: Map<string, WebClient> = new Map();
  private messageStates = new Map<string, SlackMessageState>();
  private sendQueue: Array<() => Promise<void>> = [];
  private processing = false;
  private metrics: SlackMetrics = {
    messagesDelivered: 0,
    messagesDeliveryTime: [],
    interactionsReceived: 0,
    quarantineActionsTriggered: 0,
    dismissalRate: 0,
    errorRate: 0,
    cacheHitRate: 0,
    channelEngagement: {},
  };

  constructor(config: SlackConfig) {
    this.config = config;
    this.messageBuilder = new SlackMessageBuilder(config);
    
    this.client = new WebClient(config.botToken, {
      logLevel: LogLevel.WARN,
      retryConfig: {
        retries: config.performance.retryAttempts,
        factor: 2.0,
      },
    });

    this.initializeConnectionPool();
    this.startQueueProcessor();
  }

  public async sendFlakeNotification(notification: FlakeNotification): Promise<void> {
    const startTime = Date.now();
    
    try {
      const template = this.buildNotificationTemplate(notification);
      const optimizedTemplate = this.messageBuilder.optimizePayloadSize(template);
      const channels = await this.resolveChannels(notification);
      
      const shouldParallelize = notification.priority === 'critical' || notification.priority === 'high';
      
      if (shouldParallelize) {
        await this.sendBatchParallel(channels, optimizedTemplate, notification);
      } else {
        await this.sendBatchSequential(channels, optimizedTemplate, notification);
      }

      this.updateDeliveryMetrics(startTime, channels.length);
      
    } catch (error) {
      this.metrics.errorRate++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, notification: notification.type }, 'Failed to send flake notification');
      throw error;
    }
  }

  public getMetrics(): SlackMetrics {
    return { ...this.metrics, cacheHitRate: this.calculateCacheHitRate() };
  }

  private buildNotificationTemplate(notification: FlakeNotification): SlackMessageTemplate {
    switch (notification.type) {
      case 'flake_detected': {
        const defaultFlakeScore = {
          testName: 'unknown',
          testFullName: 'unknown',
          score: 0,
          confidence: 0,
          features: {
            failSuccessRatio: 0,
            rerunPassRate: 0,
            failureClustering: 0,
            intermittencyScore: 0,
            messageSignatureVariance: 0,
            totalRuns: 0,
            recentFailures: 0,
            consecutiveFailures: 0,
            maxConsecutiveFailures: 0,
            daysSinceFirstSeen: 0,
            avgTimeBetweenFailures: 0
          },
          recommendation: {
            action: 'none' as const,
            reason: 'Default unknown test data',
            confidence: 0,
            priority: 'low' as const
          },
          lastUpdated: new Date()
        };
        const result = this.messageBuilder.buildFlakeAlert(
          notification.data.flakeScore || defaultFlakeScore,
          notification.repository
        );
        return {
          id: `flake_detected_${Date.now()}`,
          blocks: result.blocks,
          text: result.text,
          metadata: {
            version: '1.0',
            checksum: '',
            lastUsed: new Date()
          }
        };
      }
      case 'quarantine_recommended': {
        const result = this.messageBuilder.buildQuarantineReport(notification.repository, notification.data.quarantineCandidates || []);
        return {
          id: `quarantine_recommended_${Date.now()}`,
          blocks: result.blocks,
          text: result.text,
          metadata: {
            version: '1.0',
            checksum: '',
            lastUsed: new Date()
          }
        };
      }
      case 'critical_spike': {
        const affectedTests = notification.data.metrics?.map(m => m.testName) || [];
        const result = this.messageBuilder.buildCriticalAlert(notification.repository, 0.45, affectedTests);
        return {
          id: `critical_spike_${Date.now()}`,
          blocks: result.blocks,
          text: result.text,
          metadata: {
            version: '1.0',
            checksum: '',
            lastUsed: new Date()
          }
        };
      }
      case 'quality_summary': {
        const result = this.messageBuilder.buildQualitySummary(notification.data.summary!);
        return {
          id: `quality_summary_${Date.now()}`,
          blocks: result.blocks,
          text: result.text,
          metadata: {
            version: '1.0',
            checksum: '',
            lastUsed: new Date()
          }
        };
      }
      default:
        throw new Error(`Unknown notification type: ${notification.type}`);
    }
  }

  private async resolveChannels(notification: FlakeNotification): Promise<string[]> {
    const channels: string[] = [];
    channels.push(...notification.routing.channels);
    
    if (notification.routing.teams) {
      for (const team of notification.routing.teams) {
        const teamChannel = this.config.channels.team[team];
        if (teamChannel) {channels.push(teamChannel);}
      }
    }

    switch (notification.priority) {
      case 'critical':
        channels.push(this.config.channels.critical);
        break;
      case 'high':
      case 'medium':
        channels.push(this.config.channels.alerts);
        break;
      case 'low':
        if (notification.type === 'quality_summary') {
          channels.push(this.config.channels.summaries);
        }
        break;
    }

    return Array.from(new Set(channels));
  }

  private async sendBatchParallel(channels: string[], template: SlackMessageTemplate, notification: FlakeNotification): Promise<void> {
    const promises = channels.map(channel => this.sendToChannel(channel, template, notification));
    await Promise.allSettled(promises);
  }

  private async sendBatchSequential(channels: string[], template: SlackMessageTemplate, notification: FlakeNotification): Promise<void> {
    for (const channel of channels) {
      try {
        await this.sendToChannel(channel, template, notification);
        await new Promise<void>(resolve => setTimeout(resolve, 100));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn({ channel, error: errorMessage }, 'Failed to send to channel');
      }
    }
  }

  private async sendToChannel(channel: string, template: SlackMessageTemplate, notification: FlakeNotification): Promise<void> {
    const client = this.getOptimalClient();
    
    try {
      const result = await client.chat.postMessage({
        channel,
        blocks: template.blocks as (Block | KnownBlock)[],
        text: template.text,
        thread_ts: notification.threading?.parentTs,
      });

      if (result.ok && result.ts) {
        this.messageStates.set(result.ts, {
          messageTs: result.ts,
          channelId: channel,
          type: notification.type,
          data: notification.data as Record<string, unknown>,
          interactions: 0,
          lastUpdated: new Date(),
        });
      } else if (!result.ok) {
        const errorMessage = 'error' in result ? String(result.error) : 'Unknown Slack API error';
        throw new Error(`Slack API error: ${errorMessage}`);
      }

      this.updateChannelEngagement(channel);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        const slackError = error as { code: ErrorCode; data?: unknown };
        logger.error({ channel, code: slackError.code, data: slackError.data }, 'Slack API error');
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ channel, error: errorMessage }, 'Failed to send message to Slack');
      }
      throw error;
    }
  }

  private initializeConnectionPool(): void {
    for (let i = 0; i < this.config.performance.connectionPoolSize; i++) {
      const client = new WebClient(this.config.botToken, {
        logLevel: LogLevel.WARN,
        retryConfig: { retries: this.config.performance.retryAttempts, factor: 2.0 },
      });
      this.connectionPool.set(`pool_${i}`, client);
    }
  }

  private getOptimalClient(): WebClient {
    const poolClients = Array.from(this.connectionPool.values());
    if (poolClients.length === 0) {return this.client;}
    
    const index = this.metrics.messagesDelivered % poolClients.length;
    return poolClients[index] || this.client;
  }

  private startQueueProcessor(): void {
    setInterval(async () => {
      if (this.processing || this.sendQueue.length === 0) {return;}
      
      this.processing = true;
      const batch = this.sendQueue.splice(0, this.config.performance.maxConcurrentMessages);
      const results = await Promise.allSettled(batch.map(fn => fn()));
      
      // Log any failed queue operations
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const errorMessage = result.reason instanceof Error ? result.reason.message : 'Unknown error';
          logger.warn({ index, error: errorMessage }, 'Queue processor task failed');
        }
      });
      
      this.processing = false;
    }, 100);
  }

  private updateDeliveryMetrics(startTime: number, channelCount: number): void {
    const deliveryTime = Date.now() - startTime;
    this.metrics.messagesDelivered += channelCount;
    this.metrics.messagesDeliveryTime.push(deliveryTime);
    
    if (this.metrics.messagesDeliveryTime.length > 1000) {
      this.metrics.messagesDeliveryTime = this.metrics.messagesDeliveryTime.slice(-1000);
    }
  }

  private updateChannelEngagement(channel: string): void {
    if (!this.metrics.channelEngagement[channel]) {
      this.metrics.channelEngagement[channel] = {
        messages: 0,
        interactions: 0,
        lastActivity: new Date(),
      };
    }
    
    this.metrics.channelEngagement[channel].messages++;
    this.metrics.channelEngagement[channel].lastActivity = new Date();
  }

  private calculateCacheHitRate(): number {
    return 0.75; // Placeholder - would be calculated from actual cache stats
  }
}
