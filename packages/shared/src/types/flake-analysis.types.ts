/**
 * FlakeGuard Analysis Types
 * 
 * Comprehensive type definitions for FlakeGuard's flakiness analysis system.
 * These types ensure type safety across the entire application stack.
 */

// Temporarily commented out until @prisma/client is installed
// import type { 
//   FGRepository, 
//   FGTestCase, 
//   FGOccurrence, 
//   FGFlakeScore,
//   FGQuarantineDecision,
//   FGQuarantineState,
//   FGWorkflowRun,
//   FGJob,
//   FGFailureCluster,
//   FGIssueLink
// } from '@prisma/client';

// Temporary type definitions - replace with proper Prisma types when available
interface FGRepository {
  id: string;
  provider: string;
  owner: string;
  name: string;
  installationId: string;
}

interface FGTestCase {
  id: string;
  repoId: string;
  suite: string;
  className: string | null;
  name: string;
  file: string | null;
  ownerTeam: string | null;
}

interface FGOccurrence {
  id: string;
  testId: string;
  runId: string;
  status: string;
  durationMs: number | null;
  failureMsgSignature: string | null;
  failureStackDigest: string | null;
  attempt: number;
  createdAt: Date;
}

interface FGFlakeScore {
  testId: string;
  score: number;
  windowN: number;
  lastUpdatedAt: Date;
}

interface FGQuarantineDecision {
  id: string;
  testId: string;
  state: FGQuarantineState;
  rationale: string | null;
  byUser: string | null;
  until: Date | null;
  createdAt: Date;
}

type FGQuarantineState = 'NONE' | 'PARTIAL' | 'FULL';

interface FGWorkflowRun {
  id: string;
  repoId: string;
  runId: string;
  status: string;
  conclusion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FGJob {
  id: string;
  runId: string;
  jobId: string;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface FGFailureCluster {
  id: string;
  signature: string;
  tests: string[];
  count: number;
}

interface FGIssueLink {
  id: string;
  testId: string;
  provider: string;
  url: string;
  createdAt: Date;
}

// =============================================================================
// Core Analysis Types
// =============================================================================

/**
 * Configuration for flakiness analysis algorithms
 */
export interface FlakeAnalysisConfig {
  /** Number of recent runs to analyze (default: 50) */
  windowSize: number;
  /** Score threshold for warnings (default: 0.3) */
  warnThreshold: number;
  /** Score threshold for quarantine (default: 0.6) */
  quarantineThreshold: number;
  /** Minimum runs required for analysis (default: 10) */
  minOccurrences: number;
  /** Extra weight for tests that fail then pass on retry (default: 1.5) */
  retryWeightMultiplier: number;
}

/**
 * Test flakiness analysis result
 */
export interface TestFlakiness {
  testId: string;
  testCase: FGTestCase;
  score: number;
  totalRuns: number;
  failures: number;
  retrySuccesses: number;
  averageDurationMs: number;
  lastFailureAt: Date | null;
  failurePatterns: string[];
  recommendation: FlakinesRecommendation;
}

/**
 * Flakiness recommendation levels
 */
export type FlakinesRecommendation = 'STABLE' | 'MONITOR' | 'QUARANTINE';

/**
 * Quarantine proposal with impact assessment
 */
export interface QuarantineProposal {
  testId: string;
  testName: string;
  score: number;
  rationale: string;
  suggestedUntil: Date | null;
  priority: QuarantinePriority;
  impactAssessment: ImpactAssessment;
}

/**
 * Quarantine priority levels
 */
export type QuarantinePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Impact assessment for quarantine decisions
 */
export interface ImpactAssessment {
  affectedJobs: string[];
  ownerTeam: string | null;
  relatedIssues: string[];
  estimatedSavings: {
    computeMinutesPerWeek: number;
    developerHoursPerWeek: number;
  };
}

// =============================================================================
// Query Result Types
// =============================================================================

/**
 * Repository dashboard data
 */
export interface RepositoryDashboard {
  repository: {
    name: string;
    provider: string;
    owner: string;
  };
  metrics: RepositoryMetrics;
  trends: TrendData[];
  topFlakyTests: FlakySummary[];
  recentActivity: ActivitySummary[];
}

/**
 * Repository flakiness metrics
 */
export interface RepositoryMetrics {
  totalTests: number;
  flakyTests: number;
  quarantinedTests: number;
  recentRuns: number;
  failureClusters: number;
  flakinessTrend: string;
  averageFlakeScore: number;
  stabilityIndex: number;
}

/**
 * Trend data for time-series analysis
 */
export interface TrendData {
  date: Date;
  totalTests: number;
  flakyTests: number;
  flakeScore: number;
  runs: number;
}

/**
 * Flaky test summary for dashboards
 */
export interface FlakySummary {
  testId: string;
  name: string;
  suite: string;
  score: number;
  windowSize: number;
  recommendation: FlakinesRecommendation;
  lastFailureAt: Date | null;
  affectedJobs: string[];
}

/**
 * Activity summary for recent events
 */
export interface ActivitySummary {
  type: ActivityType;
  testName: string;
  timestamp: Date;
  details: string;
  severity: 'info' | 'warning' | 'error';
}

/**
 * Activity types for audit trail
 */
export type ActivityType = 
  | 'test_quarantined' 
  | 'test_dismissed' 
  | 'flake_detected' 
  | 'cluster_formed'
  | 'score_updated'
  | 'issue_linked';

// =============================================================================
// Test History & Analysis Types
// =============================================================================

/**
 * Complete test execution history
 */
export interface TestHistory {
  testId: string;
  testName: string;
  suite: string;
  repository: string;
  occurrences: TestOccurrenceDetail[];
  statistics: TestStatistics;
  patterns: FailurePattern[];
}

/**
 * Detailed test occurrence information
 */
export interface TestOccurrenceDetail {
  id: string;
  runId: string;
  jobId: string | null;
  status: TestStatus;
  durationMs: number | null;
  createdAt: Date;
  attempt: number;
  failureInfo: FailureInfo | null;
  runContext: RunContext;
}

/**
 * Test execution status
 */
export type TestStatus = 'passed' | 'failed' | 'skipped' | 'error';

/**
 * Failure information for failed tests
 */
export interface FailureInfo {
  message: string;
  stackTrace: string | null;
  signature: string;
  stackDigest: string | null;
  category: FailureCategory;
}

/**
 * Failure categories for classification
 */
export type FailureCategory = 
  | 'timeout'
  | 'assertion'
  | 'network'
  | 'race_condition'
  | 'environment'
  | 'dependency'
  | 'unknown';

/**
 * Run context information
 */
export interface RunContext {
  workflowName: string | null;
  jobName: string;
  branch: string | null;
  commit: string | null;
  author: string | null;
  trigger: string | null;
}

/**
 * Test execution statistics
 */
export interface TestStatistics {
  totalRuns: number;
  passRate: number;
  failRate: number;
  skipRate: number;
  averageDurationMs: number;
  medianDurationMs: number;
  p95DurationMs: number;
  retryRate: number;
  flakeScore: number;
  reliability: ReliabilityLevel;
}

/**
 * Test reliability levels
 */
export type ReliabilityLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

/**
 * Identified failure patterns
 */
export interface FailurePattern {
  signature: string;
  occurrences: number;
  exampleMessage: string;
  category: FailureCategory;
  affectedRuns: string[];
  firstSeen: Date;
  lastSeen: Date;
}

// =============================================================================
// Clustering & Pattern Analysis Types
// =============================================================================

/**
 * Failure cluster with analysis
 */
export interface FailureClusterAnalysis {
  cluster: FGFailureCluster;
  affectedTests: ClusterTestInfo[];
  timeline: ClusterTimelineEvent[];
  rootCauseHypotheses: RootCauseHypothesis[];
  recommendedActions: RecommendedAction[];
}

/**
 * Test information within a cluster
 */
export interface ClusterTestInfo {
  testCase: FGTestCase;
  occurrenceCount: number;
  flakeScore: number;
  lastFailure: Date;
  isQuarantined: boolean;
}

/**
 * Timeline event for cluster formation
 */
export interface ClusterTimelineEvent {
  timestamp: Date;
  eventType: 'first_occurrence' | 'pattern_detected' | 'spread_to_test' | 'resolution';
  testId?: string;
  details: string;
}

/**
 * Root cause hypothesis
 */
export interface RootCauseHypothesis {
  category: 'infrastructure' | 'dependency' | 'race_condition' | 'environment' | 'code_change';
  confidence: number;
  description: string;
  evidence: string[];
  suggestedInvestigation: string;
}

/**
 * Recommended action for cluster resolution
 */
export interface RecommendedAction {
  type: ActionType;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  description: string;
  estimatedEffort: string;
  expectedImpact: string;
}

/**
 * Action types for cluster resolution
 */
export type ActionType = 
  | 'quarantine_tests'
  | 'investigate_dependency'
  | 'review_infrastructure'
  | 'examine_code_changes'
  | 'increase_timeouts'
  | 'improve_test_isolation'
  | 'add_retry_logic'
  | 'open_issue';

// =============================================================================
// Query Filter & Pagination Types
// =============================================================================

/**
 * Filters for test queries
 */
export interface TestQueryFilters {
  repoId?: string;
  suites?: string[];
  ownerTeams?: string[];
  minScore?: number;
  maxScore?: number;
  statuses?: TestStatus[];
  dateRange?: DateRange;
  isQuarantined?: boolean;
  hasIssues?: boolean;
  categories?: FailureCategory[];
}

/**
 * Date range filter
 */
export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated results
 */
export interface PaginatedResults<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

/**
 * API error information
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  field?: string;
}

/**
 * Response metadata
 */
export interface ResponseMeta {
  timestamp: Date;
  requestId: string;
  executionTime: number;
  version: string;
}

// =============================================================================
// Configuration & Settings Types
// =============================================================================

/**
 * Repository-specific configuration
 */
export interface RepositoryConfig {
  repoId: string;
  settings: {
    analysisConfig: Partial<FlakeAnalysisConfig>;
    notifications: NotificationSettings;
    quarantinePolicy: QuarantinePolicy;
    excludedPaths: string[];
    requiredLabels: string[];
    ownerMapping: Record<string, string>;
  };
}

/**
 * Notification settings
 */
export interface NotificationSettings {
  enabled: boolean;
  channels: NotificationChannel[];
  thresholds: {
    newFlaky: number;
    quarantineProposed: boolean;
    clusterFormed: number;
  };
}

/**
 * Notification channels
 */
export interface NotificationChannel {
  type: 'slack' | 'email' | 'webhook';
  config: Record<string, unknown>;
  events: string[];
}

/**
 * Quarantine policy settings
 */
export interface QuarantinePolicy {
  autoQuarantineThreshold: number;
  maxQuarantineDays: number;
  requireApproval: boolean;
  approvers: string[];
  exemptPaths: string[];
  exemptTeams: string[];
}

// =============================================================================
// Extended Prisma Types with Relations
// =============================================================================

/**
 * Extended repository type with all relations
 */
export type RepositoryWithRelations = FGRepository & {
  workflowRuns: FGWorkflowRun[];
  testCases: (FGTestCase & {
    flakeScore: FGFlakeScore | null;
    quarantineDecisions: FGQuarantineDecision[];
    issueLinks: FGIssueLink[];
  })[];
  failureClusters: FGFailureCluster[];
};

/**
 * Extended test case type with analysis data
 */
export type TestCaseWithAnalysis = FGTestCase & {
  flakeScore: FGFlakeScore | null;
  occurrences: FGOccurrence[];
  quarantineDecisions: FGQuarantineDecision[];
  issueLinks: FGIssueLink[];
  _count: {
    occurrences: number;
  };
};

/**
 * Extended occurrence type with related data
 */
export type OccurrenceWithContext = FGOccurrence & {
  testCase: FGTestCase;
  workflowRun: FGWorkflowRun & {
    repository: FGRepository;
  };
  job: FGJob | null;
};

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Make all properties optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Extract keys that are of a specific type
 */
export type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

/**
 * Create a type with required fields
 */
export type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Create a type without specific fields
 */
export type WithoutFields<T, K extends keyof T> = Omit<T, K>;

export type {
  // Re-export Prisma types for convenience
  FGRepository,
  FGTestCase,
  FGOccurrence,
  FGFlakeScore,
  FGQuarantineDecision,
  FGQuarantineState,
  FGWorkflowRun,
  FGJob,
  FGFailureCluster,
  FGIssueLink,
};