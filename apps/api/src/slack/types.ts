/**
 * Slack integration types for FlakeGuard P6 implementation
 */

// Note: Import from shared package when available
// import type { FlakeScore, QuarantineCandidate, TestStabilityMetrics } from '@flakeguard/shared';

// Temporary type definitions until shared package is properly integrated
export interface FlakeScore {
  testName: string;
  testFullName: string;
  score: number;
  confidence: number;
  features: {
    failSuccessRatio: number;
    rerunPassRate: number;
    intermittencyScore: number;
    consecutiveFailures: number;
  };
  recommendation: {
    action: 'none' | 'warn' | 'quarantine';
    reason: string;
  };
  lastUpdated: Date;
}

export interface QuarantineCandidate {
  testId: string;
  testName: string;
  score: number;
  reason: string;
}

export interface TestStabilityMetrics {
  testName: string;
  testFullName: string;
  repositoryId: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgDuration: number;
  firstSeen: Date;
  lastSeen: Date;
}

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
  blocks: any[];
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
  data: Record<string, any>;
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
    blocks?: any[];
    threadTs?: string;
    metadata?: Record<string, any>;
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
