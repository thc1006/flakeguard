/**
 * Example usage of optimized Slack integration
 */

import type { FlakeNotification } from './types.js';

import { SlackService, NotificationFilterService, createSlackConfig } from './index.js';

// Initialize services
const config = createSlackConfig();
const slackService = new SlackService(config);
const filterService = new NotificationFilterService();

// Example: Send flake detection notification
export async function notifyFlakeDetected(flakeScore: any, repository: string): Promise<void> {
  const notification: FlakeNotification = {
    type: 'flake_detected',
    repository,
    priority: flakeScore.recommendation.priority,
    data: { flakeScore },
    routing: {
      channels: ['#dev-alerts'],
      teams: ['backend'],
    },
  };

  if (filterService.shouldSendNotification(notification)) {
    await slackService.sendFlakeNotification(notification);
  }
}

// Example: Send quarantine report
export async function sendQuarantineReport(repository: string, candidates: any[]): Promise<void> {
  const notification: FlakeNotification = {
    type: 'quarantine_recommended',
    repository,
    priority: candidates.length > 10 ? 'high' : 'medium',
    data: { quarantineCandidates: candidates },
    routing: {
      channels: ['#test-quality'],
    },
  };

  await slackService.sendFlakeNotification(notification);
}

// Example: Monitor performance
export function monitorSlackPerformance(): void {
  setInterval(() => {
    const metrics = slackService.getMetrics();
    console.log('Slack metrics:', {
      delivered: metrics.messagesDelivered,
      errorRate: metrics.errorRate,
      cacheHitRate: metrics.cacheHitRate,
    });
  }, 60000);
}
