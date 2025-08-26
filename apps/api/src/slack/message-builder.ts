/**
 * Optimized Slack Block Kit message builders with template caching
 */

import type {
  FlakeScore,
  QuarantineCandidate,
  // TestStabilityMetrics - unused for now
} from '@flakeguard/shared';

import { logger } from '../utils/logger.js';

import type {
  SlackMessageTemplate,
  QualitySummaryData,
  SlackConfig,
  SlackMessageBlock,
  SlackSectionBlock,
  SlackHeaderBlock,
  SlackActionsBlock,
  SlackContextBlock,
  SlackButton,
  PlainTextElement,
  MrkdwnElement,
} from './types.js';

// FlakeNotification imported above but not used currently

export class SlackMessageBuilder {
  private templateCache = new Map<string, SlackMessageTemplate>();
  private config: SlackConfig;

  constructor(config: SlackConfig) {
    this.config = config;
  }

  /**
   * Build optimized flake alert message with template caching
   */
  public buildFlakeAlert(flakeScore: FlakeScore, repository: string): SlackMessageTemplate {
    const templateId = `flake_alert_${flakeScore.recommendation.priority || 'medium'}`;
    
    // Check cache first for performance
    const cached = this.getFromCache(templateId, flakeScore);
    if (cached) {
      return this.personalizeTemplate(cached, flakeScore, repository);
    }

    const blocks = this.createFlakeAlertBlocks(flakeScore, repository);
    const template: SlackMessageTemplate = {
      id: templateId,
      blocks,
      text: `🚨 Flaky test detected: ${flakeScore.testName}`,
      metadata: {
        version: '1.0',
        checksum: this.calculateChecksum(blocks),
        lastUsed: new Date(),
      },
    };

    this.cacheTemplate(templateId, template);
    return template;
  }

  /**
   * Build quarantine recommendation message with rich formatting
   */
  public buildQuarantineReport(
    repository: string,
    candidates: QuarantineCandidate[]
  ): SlackMessageTemplate {
    const templateId = `quarantine_report_${candidates.length}`;
    
    const blocks = [
      this.createHeaderBlock('📋 Quarantine Report', 'weekly'),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Repository:* ${repository}\n*Found* \`${candidates.length}\` *tests recommended for quarantine*`,
        },
      },
      ...this.createPriorityGroupBlocks(candidates),
      this.createQuarantineActionBlock(candidates),
      this.createContextBlock(`Generated at <!date^${Math.floor(Date.now()/1000)}^{date_short_pretty} {time}|${new Date().toISOString()}>`),
    ];

    const template: SlackMessageTemplate = {
      id: templateId,
      blocks,
      text: `Quarantine report for ${repository}: ${candidates.length} candidates`,
      metadata: {
        version: '1.0',
        checksum: this.calculateChecksum(blocks),
        lastUsed: new Date(),
      },
    };

    this.cacheTemplate(templateId, template);
    return template;
  }

  /**
   * Build quality summary with trend visualization
   */
  public buildQualitySummary(summary: QualitySummaryData): SlackMessageTemplate {
    const blocks = [
      this.createHeaderBlock('📊 Test Quality Summary', 'daily'),
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Repository:*\n${summary.repository}`,
          },
          {
            type: 'mrkdwn',
            text: `*Period:*\n${this.formatDateRange(summary.period)}`,
          },
        ],
      },
      this.createMetricsBlock(summary.overview),
      ...this.createTopIssuesBlocks(summary.topIssues),
      this.createAnalyticsActionBlock(summary.repository),
    ];

    const template: SlackMessageTemplate = {
      id: 'quality_summary',
      blocks,
      text: `Daily quality report for ${summary.repository}`,
      metadata: {
        version: '1.0',
        checksum: this.calculateChecksum(blocks),
        lastUsed: new Date(),
      },
    };

    return template;
  }

  /**
   * Build critical alert with escalation actions
   */
  public buildCriticalAlert(
    repository: string,
    failureRate: number,
    affectedTests: string[]
  ): SlackMessageTemplate {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔥 CRITICAL: Test Suite Failure Spike',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Repository:* ${repository}\n*Issue:* Failure rate increased to ${(failureRate * 100).toFixed(1)}% in last hour`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Affected Tests (${affectedTests.length}):*\n${affectedTests.slice(0, 5).map(test => `• \`${test}\``).join('\n')}${affectedTests.length > 5 ? `\n• ... and ${affectedTests.length - 5} more` : ''}`,
        },
      },
      this.createCriticalActionBlock(repository),
    ];

    return {
      id: 'critical_alert',
      blocks,
      text: `CRITICAL: ${repository} failure spike ${(failureRate * 100).toFixed(1)}%`,
      metadata: {
        version: '1.0',
        checksum: this.calculateChecksum(blocks),
        lastUsed: new Date(),
      },
    };
  }

  /**
   * Create progressive message update for long operations
   */
  public buildProgressUpdate(
    operation: string,
    progress: number,
    details: string
  ): Partial<SlackMessageTemplate> {
    const progressBar = this.createProgressBar(progress);
    
    return {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${operation}*\n${progressBar} ${progress.toFixed(0)}%\n\n_${details}_`,
          },
        },
      ] as SlackMessageBlock[],
    };
  }

  /**
   * Optimize payload size to stay within Slack limits
   */
  public optimizePayloadSize(template: SlackMessageTemplate): SlackMessageTemplate {
    const maxPayloadSize = this.config.notifications.maxPayloadSize;
    const payload = JSON.stringify(template);
    
    if (payload.length <= maxPayloadSize) {
      return template;
    }

    // Truncate blocks if payload is too large
    logger.warn(`Slack payload size ${payload.length} exceeds limit ${maxPayloadSize}, truncating`);
    
    const optimized = { ...template };
    const truncatedBlocks = [];
    let currentSize = JSON.stringify({ ...optimized, blocks: [] }).length;

    for (const block of template.blocks) {
      const blockSize = JSON.stringify(block).length;
      if (currentSize + blockSize <= maxPayloadSize - 100) { // Leave some buffer
        truncatedBlocks.push(block);
        currentSize += blockSize;
      } else {
        truncatedBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '⚠️ _Message truncated due to size limits_',
          },
        });
        break;
      }
    }

    optimized.blocks = truncatedBlocks;
    return optimized;
  }

  private createFlakeAlertBlocks(flakeScore: FlakeScore, repository: string): SlackMessageBlock[] {
    const priorityEmoji = this.getPriorityEmoji(flakeScore.recommendation.priority);
    
    return [
      this.createHeaderBlock(`${priorityEmoji} Flaky Test Alert`, flakeScore.recommendation.priority),
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Repository:*\n${repository}` },
          { type: 'mrkdwn', text: `*Test:*\n\`${flakeScore.testName}\`` },
          { type: 'mrkdwn', text: `*Flakiness Score:*\n${(flakeScore.score * 100).toFixed(0)}% (${flakeScore.confidence >= 0.8 ? 'High' : 'Medium'} Confidence)` },
          { type: 'mrkdwn', text: `*Failure Rate:*\n${(flakeScore.features.failSuccessRatio * 100).toFixed(1)}% (${flakeScore.features.recentFailures}/${flakeScore.features.totalRuns} runs)` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Analysis:*\n• Recent failures: ${flakeScore.features.recentFailures} in last 7 days\n• Consecutive failures: ${flakeScore.features.consecutiveFailures}/${flakeScore.features.maxConsecutiveFailures} max\n• Intermittency score: ${(flakeScore.features.intermittencyScore * 100).toFixed(0)}%\n• Recommendation: *${flakeScore.recommendation.action.toUpperCase()}*`,
        },
      },
      this.createFlakeActionBlock(flakeScore, repository),
    ];
  }

  private createPriorityGroupBlocks(candidates: QuarantineCandidate[]): SlackMessageBlock[] {
    const groups = this.groupByPriority(candidates);
    const blocks = [];

    for (const [priority, tests] of Object.entries(groups)) {
      if (tests.length === 0) {continue;}

      const emoji = this.getPriorityEmoji(priority as any);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${emoji} ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority (${tests.length}):*\n${tests.slice(0, 3).map(test => `• \`${test.testName}\` - ${(test.flakeScore.score * 100).toFixed(0)}% flakiness`).join('\n')}${tests.length > 3 ? `\n• ... and ${tests.length - 3} more` : ''}`,
        },
      });
    }

    return blocks;
  }

  private createTopIssuesBlocks(issues: QualitySummaryData['topIssues']): SlackMessageBlock[] {
    if (issues.length === 0) {return [];}

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Top Issues:*\n${issues.map((issue, i) => `${i + 1}. ${issue.category}: ${issue.description}`).join('\n')}`,
        },
      },
    ];
  }

  private createMetricsBlock(overview: QualitySummaryData['overview']): SlackSectionBlock {
    const passRateIcon = overview.passRateChange >= 0 ? '📈' : '📉';
    const flakyTestsIcon = overview.flakyTestsChange <= 0 ? '📉' : '📈';
    const testTimeIcon = overview.avgTestTimeChange <= 0 ? '⚡' : '🐌';

    return {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Pass Rate:*\n${(overview.passRate * 100).toFixed(1)}% ${passRateIcon} (${overview.passRateChange >= 0 ? '+' : ''}${(overview.passRateChange * 100).toFixed(1)}%)`,
        },
        {
          type: 'mrkdwn',
          text: `*Flaky Tests:*\n${overview.flakyTests} ${flakyTestsIcon} (${overview.flakyTestsChange >= 0 ? '+' : ''}${overview.flakyTestsChange})`,
        },
        {
          type: 'mrkdwn',
          text: `*Quarantined:*\n${overview.quarantinedTests} tests`,
        },
        {
          type: 'mrkdwn',
          text: `*Avg Test Time:*\n${overview.avgTestTime.toFixed(1)}s ${testTimeIcon} (${overview.avgTestTimeChange >= 0 ? '+' : ''}${overview.avgTestTimeChange.toFixed(1)}s)`,
        },
      ],
    };
  }

  private createFlakeActionBlock(flakeScore: FlakeScore, repository: string): SlackActionsBlock {
    return {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔒 Quarantine' },
          style: 'danger',
          action_id: 'quarantine_test',
          value: JSON.stringify({
            testName: flakeScore.testName,
            repository,
            score: flakeScore.score,
          }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '📊 View Details' },
          action_id: 'view_details',
          url: `${process.env.FLAKEGUARD_URL}/flakes/${encodeURIComponent(flakeScore.testFullName)}`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Dismiss' },
          action_id: 'dismiss_flake',
          value: JSON.stringify({
            testName: flakeScore.testName,
            repository,
          }),
        },
      ],
    };
  }

  private createQuarantineActionBlock(candidates: QuarantineCandidate[]): SlackActionsBlock {
    const highPriority = candidates.filter(c => c.flakeScore.recommendation.priority === 'high' || c.flakeScore.recommendation.priority === 'critical').length;

    return {
      type: 'actions',
      elements: [
        ...(highPriority > 0 ? [{
          type: 'button',
          text: { type: 'plain_text', text: `🔒 Quarantine High Priority (${highPriority})` },
          style: 'danger',
          action_id: 'quarantine_high_priority',
          value: JSON.stringify({ candidates: highPriority }),
        }] : []),
        {
          type: 'button',
          text: { type: 'plain_text', text: '📋 View Full Report' },
          action_id: 'view_quarantine_report',
          url: `${process.env.FLAKEGUARD_URL}/quarantine`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '⚙️ Configure Alerts' },
          action_id: 'configure_alerts',
          url: `${process.env.FLAKEGUARD_URL}/settings/notifications`,
        },
      ],
    };
  }

  private createCriticalActionBlock(repository: string): SlackActionsBlock {
    return {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🚨 View Incident Dashboard' },
          style: 'danger',
          action_id: 'view_incident',
          url: `${process.env.FLAKEGUARD_URL}/incidents/${encodeURIComponent(repository)}`,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '📞 Notify On-Call' },
          action_id: 'notify_oncall',
          value: JSON.stringify({ repository, type: 'critical_failure_spike' }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔍 Run Diagnostics' },
          action_id: 'run_diagnostics',
          value: JSON.stringify({ repository }),
        },
      ],
    };
  }

  private createAnalyticsActionBlock(repository: string): SlackActionsBlock {
    return {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📊 View Analytics Dashboard' },
          action_id: 'view_analytics',
          url: `${process.env.FLAKEGUARD_URL}/analytics/${encodeURIComponent(repository)}`,
        },
      ],
    };
  }

  private createHeaderBlock(title: string, _priority?: string): SlackHeaderBlock {
    return {
      type: 'header',
      text: {
        type: 'plain_text',
        text: title,
        emoji: true,
      },
    };
  }

  private createContextBlock(text: string): SlackContextBlock {
    return {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text,
        },
      ],
    };
  }

  private createProgressBar(progress: number): string {
    const filledBlocks = Math.floor(progress / 10);
    const emptyBlocks = 10 - filledBlocks;
    return '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  }

  private getPriorityEmoji(priority: string): string {
    switch (priority) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🔵';
      default: return '⚪';
    }
  }

  private groupByPriority(candidates: QuarantineCandidate[]): Record<string, QuarantineCandidate[]> {
    return candidates.reduce((acc, candidate) => {
      const priority = candidate.flakeScore.recommendation.priority;
      if (!acc[priority]) {acc[priority] = [];}
      acc[priority].push(candidate);
      return acc;
    }, {} as Record<string, QuarantineCandidate[]>);
  }

  private formatDateRange(period: { start: Date; end: Date }): string {
    return `${period.start.toLocaleDateString()} - ${period.end.toLocaleDateString()}`;
  }

  private getFromCache(templateId: string, _data: unknown): SlackMessageTemplate | null {
    const cached = this.templateCache.get(templateId);
    if (!cached) {return null;}

    const age = Date.now() - cached.metadata!.lastUsed.getTime();
    if (age > this.config.performance.cacheTimeoutMs) {
      this.templateCache.delete(templateId);
      return null;
    }

    return cached;
  }

  private personalizeTemplate(
    template: SlackMessageTemplate,
    _flakeScore: FlakeScore,
    _repository: string
  ): SlackMessageTemplate {
    // Deep clone and personalize template
    const personalized = JSON.parse(JSON.stringify(template));
    // Update specific fields with current data
    // This would contain logic to replace placeholders with actual values
    return personalized;
  }

  private cacheTemplate(templateId: string, template: SlackMessageTemplate): void {
    // Only cache if we haven't exceeded cache size limits
    if (this.templateCache.size >= 100) {
      // Remove oldest template
      const oldest = Array.from(this.templateCache.entries())
        .sort((a, b) => a[1].metadata!.lastUsed.getTime() - b[1].metadata!.lastUsed.getTime())[0];
      if (oldest) {
        this.templateCache.delete(oldest[0]);
      }
    }

    this.templateCache.set(templateId, template);
  }

  private calculateChecksum(blocks: SlackMessageBlock[]): string {
    return JSON.stringify(blocks).length.toString(36);
  }
}
