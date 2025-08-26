/**
 * Analytics types for flakiness scoring and quarantine policy engine
 */

export interface TestRun {
  readonly testName: string;
  readonly testFullName: string;
  readonly status: 'passed' | 'failed' | 'skipped' | 'error';
  readonly message?: string;
  readonly stack?: string;
  readonly duration: number;
  readonly attempt: number;
  readonly runId: string;
  readonly createdAt: Date;
}

export interface FlakeScore {
  readonly testName: string;
  readonly testFullName: string;
  readonly score: number;
  readonly confidence: number;
  readonly features: FlakeFeatures;
  readonly recommendation: QuarantineRecommendation;
  readonly lastUpdated: Date;
}

export interface FlakeFeatures {
  readonly failSuccessRatio: number;
  readonly rerunPassRate: number;
  readonly failureClustering: number;
  readonly intermittencyScore: number;
  readonly messageSignatureVariance: number;
  readonly totalRuns: number;
  readonly recentFailures: number;
  readonly consecutiveFailures: number;
  readonly maxConsecutiveFailures: number;
  readonly daysSinceFirstSeen: number;
  readonly avgTimeBetweenFailures: number;
}

export interface QuarantinePolicy {
  readonly warnThreshold: number;
  readonly quarantineThreshold: number;
  readonly minRunsForQuarantine: number;
  readonly minRecentFailures: number;
  readonly lookbackDays: number;
  readonly rollingWindowSize: number;
}

// DEFAULT_QUARANTINE_POLICY is exported from constants/index.ts

export interface QuarantineRecommendation {
  readonly action: 'none' | 'warn' | 'quarantine';
  readonly reason: string;
  readonly confidence: number;
  readonly priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface QuarantineCandidate {
  readonly testName: string;
  readonly testFullName: string;
  readonly flakeScore: FlakeScore;
  readonly rationale: string;
  readonly suggestedAnnotation: string;
  readonly repositoryId: string;
  readonly lastFailures: readonly TestRun[];
}

export interface QuarantinePlan {
  readonly repositoryId: string;
  readonly candidates: readonly QuarantineCandidate[];
  readonly summary: {
    readonly totalCandidates: number;
    readonly highPriority: number;
    readonly mediumPriority: number;
    readonly lowPriority: number;
  };
  readonly generatedAt: Date;
}

export interface MessageSignature {
  readonly normalized: string;
  readonly originalCount: number;
  readonly category: 'timeout' | 'assertion' | 'connection' | 'resource' | 'unknown';
  readonly confidence: number;
}

export interface FailureCluster {
  readonly timeWindow: {
    readonly start: Date;
    readonly end: Date;
  };
  readonly runs: readonly TestRun[];
  readonly density: number;
  readonly avgGap: number;
}

export interface TestStabilityMetrics {
  readonly testName: string;
  readonly testFullName: string;
  readonly repositoryId: string;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly skippedRuns: number;
  readonly errorRuns: number;
  readonly rerunAttempts: number;
  readonly rerunSuccesses: number;
  readonly firstSeen: Date;
  readonly lastSeen: Date;
  readonly lastFailure?: Date;
  readonly avgDuration: number;
  readonly failureMessages: readonly MessageSignature[];
  readonly failureClusters: readonly FailureCluster[];
}

export interface QuarantinePlanRequest {
  readonly repositoryId: string;
  readonly policy?: Partial<QuarantinePolicy>;
  readonly lookbackDays?: number;
  readonly includeAnnotations?: boolean;
}

export interface QuarantinePlanResponse {
  readonly success: boolean;
  readonly data?: QuarantinePlan;
  readonly error?: string;
  readonly processedAt: Date;
  readonly metricsCount: number;
}

// Test result types for policy evaluation
export interface TestResult {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'skipped' | 'error';
  readonly duration?: number;
  readonly errorMessage?: string;
  readonly stackTrace?: string;
  readonly flakeAnalysis?: {
    readonly isFlaky: boolean;
    readonly confidence: number;
    readonly failurePattern?: string;
    readonly historicalFailures: number;
    readonly totalRuns: number;
    readonly failureRate: number;
    readonly lastFailureAt?: string;
    readonly suggestedAction?: 'quarantine' | 'warn' | 'ignore';
  };
}

// Policy-as-Code types
export interface PolicyEvaluation {
  readonly repositoryId: string;
  readonly policySource: 'file' | 'defaults' | 'env';
  readonly decisions: readonly PolicyDecision[];
  readonly evaluatedAt: Date;
  readonly summary: {
    readonly totalTests: number;
    readonly actionsRecommended: number;
    readonly quarantineCandidates: number;
    readonly warnings: number;
  };
}

export interface PolicyDecision {
  readonly testName: string;
  readonly action: 'none' | 'warn' | 'quarantine';
  readonly reason: string;
  readonly confidence: number;
  readonly priority: 'low' | 'medium' | 'high' | 'critical';
  readonly metadata: {
    readonly policyVersion: string;
    readonly evaluatedAt: Date;
    readonly testPath?: string;
    readonly teamOverride?: string;
    readonly exempted?: boolean;
  };
}