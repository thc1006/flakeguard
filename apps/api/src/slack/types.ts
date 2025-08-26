/**
 * Slack integration types for FlakeGuard P6 implementation
 */

import type {
  Block as SlackBlock,
  KnownBlock,
} from '@slack/web-api';

// Use broader types to avoid strict typing issues with Slack blocks
export type SlackSectionBlock = {
  type: 'section';
  text?: {
    type: 'mrkdwn' | 'plain_text';
    text: string;
  };
  fields?: Array<{
    type: 'mrkdwn' | 'plain_text';
    text: string;
  }>;
  accessory?: unknown;
};

export type SlackHeaderBlock = {
  type: 'header';
  text: {
    type: 'plain_text';
    text: string;
    emoji?: boolean;
  };
};

export type SlackActionsBlock = {
  type: 'actions';
  elements: SlackButton[];
};

export type SlackContextBlock = {
  type: 'context';
  elements: Array<{
    type: 'mrkdwn' | 'plain_text';
    text: string;
  }>;
};

export type SlackDividerBlock = {
  type: 'divider';
};

// Union of all common block types
export type SlackMessageBlock = 
  | SlackSectionBlock 
  | SlackHeaderBlock 
  | SlackActionsBlock 
  | SlackContextBlock 
  | SlackDividerBlock;

// Additional types for Slack elements
export interface SlackButton {
  type: 'button';
  text: {
    type: 'plain_text';
    text: string;
    emoji?: boolean;
  };
  action_id: string;
  value?: string;
  url?: string;
  style?: 'primary' | 'danger';
}

export interface PlainTextElement {
  type: 'plain_text';
  text: string;
  emoji?: boolean;
}

export interface MrkdwnElement {
  type: 'mrkdwn';
  text: string;
}

// Note: Import from shared package when available
// import type { FlakeScore, QuarantineCandidate, TestStabilityMetrics } from '@flakeguard/shared';

// Import types from shared package
import type {
  FlakeScore as SharedFlakeScore,
  QuarantineCandidate as SharedQuarantineCandidate,
  TestStabilityMetrics as SharedTestStabilityMetrics,
} from '@flakeguard/shared';

// Re-export shared types
export type FlakeScore = SharedFlakeScore;
export type QuarantineCandidate = SharedQuarantineCandidate;
export type TestStabilityMetrics = SharedTestStabilityMetrics;

// Re-export Slack types for convenience
export type {
  SlackBlock,
  KnownBlock,
};

// TestStabilityMetrics is now imported from shared package

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appToken?: string;
  channels: {
    alerts: string;
    quarantine: string;
    summaries: string;
    critical: string;
    team: Record<string, string>;
  };
  notifications: {
    flakeThreshold: number;
    enableDailySummary: boolean;
    enableWeeklyReport: boolean;
    criticalFailureRate: number;
    maxPayloadSize: number;
    responseTimeoutMs: number;
  };
  performance: {
    connectionPoolSize: number;
    maxConcurrentMessages: number;
    cacheTimeoutMs: number;
    batchSize: number;
    retryAttempts: number;
  };
}

export interface SlackMessageTemplate {
  id: string;
  blocks: SlackMessageBlock[];
  text: string;
  metadata?: {
    version: string;
    checksum: string;
    lastUsed: Date;
  };
}

export interface FlakeNotification {
  type: 'flake_detected' | 'quarantine_recommended' | 'critical_spike' | 'quality_summary';
  repository: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  data: FlakeNotificationData;
  routing: {
    channels: string[];
    teams?: string[];
    users?: string[];
  };
  threading?: {
    parentTs?: string;
    threadKey?: string;
  };
}

export interface FlakeNotificationData {
  flakeScore?: FlakeScore;
  quarantineCandidates?: QuarantineCandidate[];
  metrics?: TestStabilityMetrics[];
  summary?: QualitySummaryData;
}

export interface QualitySummaryData {
  repository: string;
  period: {
    start: Date;
    end: Date;
  };
  overview: {
    passRate: number;
    passRateChange: number;
    flakyTests: number;
    flakyTestsChange: number;
    quarantinedTests: number;
    avgTestTime: number;
    avgTestTimeChange: number;
  };
  topIssues: Array<{
    category: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
  }>;
}

export interface SlackMessageState {
  messageTs: string;
  channelId: string;
  type: FlakeNotification['type'];
  data: Record<string, unknown>;
  interactions: number;
  lastUpdated: Date;
}

export interface SlackInteractionPayload {
  type: string;
  action_id: string;
  block_id?: string;
  value?: string;
  user: {
    id: string;
    username: string;
  };
  channel: {
    id: string;
    name: string;
  };
  message?: {
    ts: string;
  };
  response_url?: string;
}

export interface BatchMessageRequest {
  channel: string;
  messages: Array<{
    text: string;
    blocks?: SlackMessageBlock[];
    threadTs?: string;
    metadata?: Record<string, unknown>;
  }>;
  options?: {
    parallel?: boolean;
    failOnError?: boolean;
    delayMs?: number;
  };
}

export interface SlackMetrics {
  messagesDelivered: number;
  messagesDeliveryTime: number[];
  interactionsReceived: number;
  quarantineActionsTriggered: number;
  dismissalRate: number;
  errorRate: number;
  cacheHitRate: number;
  channelEngagement: Record<string, {
    messages: number;
    interactions: number;
    lastActivity: Date;
  }>;
}

export interface EscalationPolicy {
  name: string;
  triggers: {
    failureRateThreshold: number;
    flakinessScoreThreshold: number;
    consecutiveFailures: number;
    timeWindowMinutes?: number;
  };
  actions: {
    notifyChannels: string[];
    pingUsers: string[];
    createIncident: boolean;
  };
}

export interface NotificationFilter {
  repositories: string[];
  excludePatterns: string[];
  minScore: number;
  minConfidence: number;
  testNameFilters: string[];
  timeFilters: {
    businessHoursOnly: boolean;
    timezone?: string;
    quietHours?: {
      start: string;
      end: string;
    };
  };
}
