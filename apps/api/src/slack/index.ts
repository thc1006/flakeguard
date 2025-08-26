/**
 * Slack integration entry point
 */

export { SlackService } from './service.js';
export { SlackMessageBuilder } from './message-builder.js';
export { NotificationFilterService, DEFAULT_FILTERS, DEFAULT_ESCALATION_POLICIES } from './notification-filter.js';
export { createSlackConfig, DEFAULT_SLACK_CONFIG } from './config.js';
export type {
  SlackConfig,
  FlakeNotification,
  SlackMessageTemplate,
  SlackMetrics,
  NotificationFilter,
  EscalationPolicy,
  SlackInteractionPayload,
  BatchMessageRequest,
} from './types.js';
