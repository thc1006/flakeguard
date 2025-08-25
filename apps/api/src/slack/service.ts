/**
 * High-performance Slack service with connection pooling and async operations
 */

import { WebClient, LogLevel } from '@slack/web-api';

import { logger } from '../utils/logger.js';

import { SlackMessageBuilder } from './message-builder.js';
import type {
  SlackConfig,
  FlakeNotification,
  // BatchMessageRequest - unused for now
  SlackMessageState,
  // SlackInteractionPayload - unused for now
  SlackMetrics,
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
      throw error;
    }
  }

  public getMetrics(): SlackMetrics {
    return { ...this.metrics, cacheHitRate: this.calculateCacheHitRate() };
  }

  private buildNotificationTemplate(notification: FlakeNotification) {
    switch (notification.type) {
      case 'flake_detected':
        return this.messageBuilder.buildFlakeAlert(notification.data.flakeScore || { testId: '', score: 0, windowN: 0, lastUpdatedAt: new Date() }, notification.repository);
      case 'quarantine_recommended':
        return this.messageBuilder.buildQuarantineReport(notification.repository, notification.data.quarantineCandidates || []);
      case 'critical_spike':
        const affectedTests = notification.data.metrics?.map(m => m.testName) || [];
        return this.messageBuilder.buildCriticalAlert(notification.repository, 0.45, affectedTests);
      case 'quality_summary':
        return this.messageBuilder.buildQualitySummary(notification.data.summary!);
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

    return [...new Set(channels)];
  }

  private async sendBatchParallel(channels: string[], template: any, notification: FlakeNotification): Promise<void> {
    const promises = channels.map(channel => this.sendToChannel(channel, template, notification));
    await Promise.allSettled(promises);
  }

  private async sendBatchSequential(channels: string[], template: any, notification: FlakeNotification): Promise<void> {
    for (const channel of channels) {
      try {
        await this.sendToChannel(channel, template, notification);
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.warn({ channel, error: (error as Error).message }, 'Failed to send to channel');
      }
    }
  }

  private async sendToChannel(channel: string, template: any, notification: FlakeNotification): Promise<void> {
    const client = this.getOptimalClient();
    
    const result = await client.chat.postMessage({
      channel,
      blocks: template.blocks,
      text: template.text,
      thread_ts: notification.threading?.parentTs,
    });

    if (result.ok && result.ts) {
      this.messageStates.set(result.ts, {
        messageTs: result.ts,
        channelId: channel,
        type: notification.type,
        data: notification.data,
        interactions: 0,
        lastUpdated: new Date(),
      });
    }

    this.updateChannelEngagement(channel);
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
      await Promise.allSettled(batch.map(fn => fn()));
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
