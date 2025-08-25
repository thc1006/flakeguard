import {
  DEFAULT_QUARANTINE_POLICY,
  type FailureCluster,
  type FlakeFeatures,
  type FlakeScore,
  type MessageSignature,
  type QuarantinePolicy,
  type QuarantineRecommendation,
  type TestRun,
  type TestStabilityMetrics,
} from '@flakeguard/shared';

/**
 * Comprehensive flakiness scoring engine with rolling window algorithm
 * Weights intermittent failures higher than permanent failures
 */
export class FlakinessScorer {
  private readonly policy: QuarantinePolicy;

  constructor(policy: Partial<QuarantinePolicy> = {}) {
    this.policy = { ...DEFAULT_QUARANTINE_POLICY, ...policy };
  }

  /**
   * Compute flakiness score for a test using rolling window algorithm
   * Score ranges from 0.0 (stable) to 1.0 (highly flaky)
   */
  public computeFlakeScore(runs: readonly TestRun[]): FlakeScore {
    if (runs.length === 0) {
      throw new Error('Cannot compute flake score with no test runs');
    }

    const testName = runs[0]?.testName;
    const testFullName = runs[0]?.testFullName;
    
    if (!testName || !testFullName) {
      throw new Error('Invalid test run data: missing testName or testFullName');
    }

    // Use rolling window of last N runs
    const windowRuns = this.applyRollingWindow(runs);
    const features = this.extractFeatures(windowRuns, runs);
    const score = this.calculateCompositeScore(features);
    const recommendation = this.generateRecommendation(score, features);

    return {
      testName,
      testFullName,
      score,
      confidence: this.calculateConfidence(features),
      features,
      recommendation,
      lastUpdated: new Date(),
    };
  }

  /**
   * Apply rolling window algorithm to focus on recent test behavior
   */
  private applyRollingWindow(runs: readonly TestRun[]): readonly TestRun[] {
    const sortedRuns = [...runs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return sortedRuns.slice(0, this.policy.rollingWindowSize);
  }

  /**
   * Extract comprehensive features for flakiness scoring
   */
  private extractFeatures(windowRuns: readonly TestRun[], allRuns: readonly TestRun[]): FlakeFeatures {
    const failedRuns = windowRuns.filter(run => run.status === 'failed' || run.status === 'error');
    const totalRuns = windowRuns.length;

    // Basic ratios
    const failSuccessRatio = totalRuns > 0 ? failedRuns.length / totalRuns : 0;

    // Re-run analysis - weight this heavily for flakiness detection
    const rerunPassRate = this.calculateRerunPassRate(windowRuns);

    // Failure clustering - intermittent failures cluster differently than permanent ones
    const failureClustering = this.calculateFailureClustering(windowRuns);

    // Intermittency score - key differentiator between flaky and permanently broken tests
    const intermittencyScore = this.calculateIntermittencyScore(windowRuns);

    // Message signature variance - flaky tests often have varying error messages
    const messageSignatureVariance = this.calculateMessageVariance(failedRuns);

    // Recent failure analysis
    const recentRuns = this.getRecentRuns(windowRuns, this.policy.lookbackDays);
    const recentFailures = recentRuns.filter(run => run.status === 'failed' || run.status === 'error').length;

    // Consecutive failure analysis
    const { consecutive, max } = this.analyzeConsecutiveFailures(windowRuns);

    // Historical context
    const firstRun = allRuns.reduce((earliest, run) => 
      run.createdAt < earliest.createdAt ? run : earliest
    );
    const daysSinceFirstSeen = Math.floor(
      (Date.now() - firstRun.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    const avgTimeBetweenFailures = this.calculateAvgTimeBetweenFailures(failedRuns);

    return {
      failSuccessRatio,
      rerunPassRate,
      failureClustering,
      intermittencyScore,
      messageSignatureVariance,
      totalRuns,
      recentFailures,
      consecutiveFailures: consecutive,
      maxConsecutiveFailures: max,
      daysSinceFirstSeen,
      avgTimeBetweenFailures,
    };
  }

  /**
   * Calculate re-run pass rate - critical for flaky test identification
   * Flaky tests often pass on retry, while broken tests consistently fail
   */
  private calculateRerunPassRate(runs: readonly TestRun[]): number {
    const groupedByRunId = new Map<string, TestRun[]>();
    
    for (const run of runs) {
      if (!groupedByRunId.has(run.runId)) {
        groupedByRunId.set(run.runId, []);
      }
      const runGroup = groupedByRunId.get(run.runId);
      if (runGroup) {
        runGroup.push(run);
      }
    }

    let totalRetries = 0;
    let successfulRetries = 0;

    for (const [, runsInSameWorkflow] of groupedByRunId) {
      const sortedRuns = runsInSameWorkflow.sort((a, b) => a.attempt - b.attempt);
      
      for (let i = 1; i < sortedRuns.length; i++) {
        totalRetries++;
        if (sortedRuns[i]?.status === 'passed') {
          successfulRetries++;
        }
      }
    }

    return totalRetries > 0 ? successfulRetries / totalRetries : 0;
  }

  /**
   * Calculate failure clustering score
   * Intermittent failures tend to be more scattered, while permanent failures cluster
   */
  private calculateFailureClustering(runs: readonly TestRun[]): number {
    const failedRuns = runs.filter(run => run.status === 'failed' || run.status === 'error');
    
    if (failedRuns.length < 2) {
      return 0;
    }

    const sortedRuns = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const clusters = this.identifyFailureClusters(sortedRuns);
    
    if (clusters.length === 0) {
      return 0;
    }
    
    // More clusters with smaller sizes indicate higher intermittency
    const avgClusterSize = clusters.reduce((sum, cluster) => sum + cluster.runs.length, 0) / clusters.length;
    const clusterDensityVariance = this.calculateVariance(clusters.map(c => c.density));
    
    // Protect against NaN from variance calculation or zero denominators
    if (isNaN(clusterDensityVariance) || avgClusterSize === 0 || failedRuns.length === 0) {
      return 0;
    }
    
    // Normalize to 0-1 scale where higher values indicate more intermittent behavior
    const score = (clusters.length * clusterDensityVariance) / (avgClusterSize * failedRuns.length);
    return Math.min(1, isNaN(score) ? 0 : score);
  }

  /**
   * Calculate intermittency score - the key metric for flaky test detection
   * This weighs alternating pass/fail patterns heavily
   */
  private calculateIntermittencyScore(runs: readonly TestRun[]): number {
    if (runs.length < 2) {
      return 0;
    }

    const sortedRuns = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let transitions = 0;
    let totalTransitions = 0;

    for (let i = 1; i < sortedRuns.length; i++) {
      const current = sortedRuns[i];
      const previous = sortedRuns[i - 1];
      
      // Skip skipped tests for intermittency calculation
      if (current?.status === 'skipped' || previous?.status === 'skipped') {
        continue;
      }

      totalTransitions++;
      
      const currentFailed = current?.status === 'failed' || current?.status === 'error';
      const previousFailed = previous?.status === 'failed' || previous?.status === 'error';
      
      if (currentFailed !== previousFailed) {
        transitions++;
      }
    }

    return totalTransitions > 0 ? transitions / totalTransitions : 0;
  }

  /**
   * Calculate message signature variance
   * Flaky tests often fail with different error messages
   */
  private calculateMessageVariance(failedRuns: readonly TestRun[]): number {
    if (failedRuns.length < 2) {
      return 0;
    }

    const normalizedMessages = failedRuns
      .filter(run => run.message)
      .map(run => this.normalizeMessage(run.message || ''));

    const uniqueMessages = new Set(normalizedMessages);
    return uniqueMessages.size / normalizedMessages.length;
  }

  /**
   * Normalize failure messages by removing variable parts
   * This helps identify flaky tests that fail with similar but not identical messages
   */
  public normalizeMessage(message: string): string {
    let normalized = message;
    
    // Remove timestamps (various formats)
    normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?/g, '[TIMESTAMP]');
    normalized = normalized.replace(/\d{2}:\d{2}:\d{2}[.\d]*/g, '[TIME]');
    
    // Remove file paths with line numbers first (more specific)
    normalized = normalized.replace(/[/\\]?[\w\-. /\\]*[/\\][\w\-.]+\.(?:js|ts|py|java|cs|rb|go|php|cpp|c|h):\d+(?::\d+)?/g, '[FILE:LINE]');
    
    // Remove memory addresses and hex values  
    normalized = normalized.replace(/0x[0-9a-fA-F]+/g, '[HEX]');
    
    // Remove process IDs and thread IDs - be more specific
    normalized = normalized.replace(/\bPID\s+\d+/gi, '[PID]');
    normalized = normalized.replace(/\b(?:thread|tid)[\s=:]+\d+/gi, '[PID]');
    
    // Remove port numbers
    normalized = normalized.replace(/:\d{4,5}\b/g, ':[PORT]');
    
    // Remove UUIDs and similar identifiers
    normalized = normalized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID]');
    normalized = normalized.replace(/\b[0-9a-f]{32}\b/gi, '[HASH]');
    
    // Remove numbers that appear to be variable (timeouts, sizes, etc)
    normalized = normalized.replace(/\b\d+\s*(ms|seconds?|minutes?|bytes?|kb|mb|gb)\b/gi, '[NUM] $1');
    normalized = normalized.replace(/timeout\s+\d+/gi, 'timeout [NUM]');
    normalized = normalized.replace(/after\s+\d+/gi, 'after [NUM]');
    normalized = normalized.replace(/line\s+\d+/gi, 'line [NUM]');
    
    // Normalize common assertion patterns - be more specific
    normalized = normalized.replace(/expected[:=]\s*[^\n,]+/gi, 'expected: [VALUE]');
    normalized = normalized.replace(/actual[:=]\s*[^\n,]+/gi, 'actual: [VALUE]');
    normalized = normalized.replace(/got[:=]\s*[^\n,]+/gi, 'got: [VALUE]');
    
    // Remove stack trace noise - only multi-line stack traces
    normalized = normalized.replace(/\n\s*at\s+[^\n]+/g, ' [STACK]');
    
    // Normalize whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    return normalized;
  }

  /**
   * Get recent runs within the specified lookback period
   */
  private getRecentRuns(runs: readonly TestRun[], lookbackDays: number): readonly TestRun[] {
    const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    return runs.filter(run => run.createdAt >= cutoffDate);
  }

  /**
   * Analyze consecutive failure patterns
   */
  private analyzeConsecutiveFailures(runs: readonly TestRun[]): { consecutive: number; max: number } {
    const sortedRuns = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    
    let currentConsecutive = 0;
    let maxConsecutive = 0;
    let endConsecutive = 0;

    for (let i = sortedRuns.length - 1; i >= 0; i--) {
      const run = sortedRuns[i];
      if (!run) continue;
      const isFailed = run.status === 'failed' || run.status === 'error';
      
      if (isFailed) {
        currentConsecutive++;
        if (i === sortedRuns.length - 1) {
          endConsecutive = currentConsecutive;
        }
        maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
      } else {
        if (i === sortedRuns.length - 1) {
          endConsecutive = 0;
        }
        currentConsecutive = 0;
      }
    }

    return { consecutive: endConsecutive, max: maxConsecutive };
  }

  /**
   * Calculate average time between failures
   */
  private calculateAvgTimeBetweenFailures(failedRuns: readonly TestRun[]): number {
    if (failedRuns.length < 2) {
      return 0;
    }

    const sortedRuns = [...failedRuns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let totalGap = 0;
    
    for (let i = 1; i < sortedRuns.length; i++) {
      const currentRun = sortedRuns[i];
      const previousRun = sortedRuns[i - 1];
      if (currentRun && previousRun) {
        totalGap += currentRun.createdAt.getTime() - previousRun.createdAt.getTime();
      }
    }

    return totalGap / (sortedRuns.length - 1) / (1000 * 60 * 60); // Convert to hours
  }

  /**
   * Identify failure clusters in the test run timeline
   */
  private identifyFailureClusters(runs: readonly TestRun[]): FailureCluster[] {
    const failedRuns = runs.filter(run => run.status === 'failed' || run.status === 'error');
    
    if (failedRuns.length < 2) {
      return [];
    }

    const clusters: FailureCluster[] = [];
    const sortedRuns = [...failedRuns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    
    // Define cluster threshold as 2 hours
    const clusterThreshold = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    
    const firstRun = sortedRuns[0];
    if (!firstRun) {
      return [];
    }
    
    let currentCluster: TestRun[] = [firstRun];
    
    for (let i = 1; i < sortedRuns.length; i++) {
      const current = sortedRuns[i];
      const previous = sortedRuns[i - 1];
      
      if (!current || !previous) continue;
      
      const gap = current.createdAt.getTime() - previous.createdAt.getTime();
      
      if (gap <= clusterThreshold) {
        currentCluster.push(current);
      } else {
        if (currentCluster.length > 1) {
          clusters.push(this.createCluster(currentCluster));
        }
        currentCluster = [current];
      }
    }
    
    if (currentCluster.length > 1) {
      clusters.push(this.createCluster(currentCluster));
    }
    
    return clusters;
  }

  /**
   * Create a failure cluster from a group of runs
   */
  private createCluster(runs: TestRun[]): FailureCluster {
    const sortedRuns = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const start = sortedRuns[0]?.createdAt;
    const end = sortedRuns[sortedRuns.length - 1]?.createdAt;
    
    if (!start || !end) {
      throw new Error('Invalid run data: missing createdAt timestamps');
    }
    const duration = end.getTime() - start.getTime();
    
    const density = runs.length / Math.max(1, duration / (1000 * 60)); // failures per minute
    
    let totalGap = 0;
    for (let i = 1; i < sortedRuns.length; i++) {
      const currentRun = sortedRuns[i];
      const previousRun = sortedRuns[i - 1];
      if (currentRun && previousRun) {
        totalGap += currentRun.createdAt.getTime() - previousRun.createdAt.getTime();
      }
    }
    const avgGap = runs.length > 1 ? totalGap / (runs.length - 1) / 1000 : 0; // average gap in seconds
    
    return {
      timeWindow: { start, end },
      runs: sortedRuns,
      density,
      avgGap,
    };
  }

  /**
   * Calculate statistical variance
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }

  /**
   * Calculate composite flakiness score
   * Weights intermittent behavior higher than permanent failures
   */
  private calculateCompositeScore(features: FlakeFeatures): number {
    const {
      failSuccessRatio,
      rerunPassRate,
      failureClustering,
      intermittencyScore,
      messageSignatureVariance,
      consecutiveFailures,
      maxConsecutiveFailures,
      totalRuns,
    } = features;

    // For single test runs, no flakiness can be determined
    if (totalRuns === 1) {
      return 0;
    }

    // For tests with only passes or only failures, score is 0 (not flaky)
    if (failSuccessRatio === 0 || failSuccessRatio === Infinity) {
      return 0;
    }

    // Weight factors - intermittency and re-run pass rate are most important for flaky detection
    const intermittencyWeight = 0.30;
    const rerunWeight = 0.25;
    const clusteringWeight = 0.15;
    const messageVarianceWeight = 0.10;
    const failRatioWeight = 0.10;
    const consecutiveFailurePenalty = 0.10;

    // Sanitize inputs to prevent NaN propagation
    const safeIntermittencyScore = isNaN(intermittencyScore) ? 0 : intermittencyScore;
    const safeRerunPassRate = isNaN(rerunPassRate) ? 0 : rerunPassRate;
    const safeFailureClustering = isNaN(failureClustering) ? 0 : failureClustering;
    const safeMessageVariance = isNaN(messageSignatureVariance) ? 0 : messageSignatureVariance;
    const safeFailRatio = isNaN(failSuccessRatio) ? 0 : failSuccessRatio;

    // Base score from weighted features
    let score = 
      (safeIntermittencyScore * intermittencyWeight) +
      (safeRerunPassRate * rerunWeight) +
      (safeFailureClustering * clusteringWeight) +
      (safeMessageVariance * messageVarianceWeight) +
      (safeFailRatio * failRatioWeight);

    // Apply consecutive failure penalty (reduces flakiness score for always-failing tests)
    if (totalRuns > 0 && maxConsecutiveFailures >= totalRuns * 0.8) {
      // If test fails consistently, it's likely broken, not flaky
      const penalty = consecutiveFailurePenalty * (maxConsecutiveFailures / totalRuns);
      score *= (1 - (isNaN(penalty) ? 0 : penalty));
    }

    // Boost score if test shows classic flaky patterns
    if (safeRerunPassRate > 0.3 && safeIntermittencyScore > 0.4) {
      score *= 1.2; // 20% boost for clear flaky behavior
    }

    // Penalize if test has been failing consistently at the end
    if (totalRuns > 0 && consecutiveFailures >= Math.min(5, totalRuns * 0.6)) {
      score *= 0.8; // 20% penalty for recent consistent failures
    }

    // Final NaN protection
    if (isNaN(score)) {
      return 0;
    }

    return Math.min(1.0, Math.max(0.0, score));
  }

  /**
   * Calculate confidence in the flakiness score
   */
  private calculateConfidence(features: FlakeFeatures): number {
    const { totalRuns, daysSinceFirstSeen } = features;
    
    // Base confidence on amount of data available
    let confidence = Math.min(1.0, totalRuns / 20); // Full confidence at 20+ runs
    
    // Boost confidence if we have data over a longer time period
    if (daysSinceFirstSeen > 7) {
      confidence = Math.min(1.0, confidence * 1.2);
    }
    
    // Reduce confidence for very new tests
    if (daysSinceFirstSeen < 1) {
      confidence *= 0.5;
    }
    
    return confidence;
  }

  /**
   * Generate quarantine recommendation based on score and features
   */
  private generateRecommendation(score: number, features: FlakeFeatures): QuarantineRecommendation {
    const { totalRuns, recentFailures } = features;
    
    // Check minimum criteria for any action
    if (totalRuns < this.policy.minRunsForQuarantine) {
      return {
        action: 'none',
        reason: `Insufficient data: only ${totalRuns} runs (minimum: ${this.policy.minRunsForQuarantine})`,
        confidence: 0.2,
        priority: 'low',
      };
    }

    // Check recent failure requirement
    if (recentFailures < this.policy.minRecentFailures) {
      return {
        action: 'none',
        reason: `Too few recent failures: ${recentFailures} in last ${this.policy.lookbackDays} days (minimum: ${this.policy.minRecentFailures})`,
        confidence: 0.3,
        priority: 'low',
      };
    }

    // Determine action based on score
    if (score >= this.policy.quarantineThreshold) {
      const priority = this.determinePriority(score, features);
      return {
        action: 'quarantine',
        reason: `High flakiness score (${score.toFixed(3)}) exceeds quarantine threshold (${this.policy.quarantineThreshold})`,
        confidence: this.calculateConfidence(features),
        priority,
      };
    }

    if (score >= this.policy.warnThreshold) {
      return {
        action: 'warn',
        reason: `Moderate flakiness score (${score.toFixed(3)}) exceeds warning threshold (${this.policy.warnThreshold})`,
        confidence: this.calculateConfidence(features),
        priority: 'medium',
      };
    }

    return {
      action: 'none',
      reason: `Low flakiness score (${score.toFixed(3)}) below warning threshold (${this.policy.warnThreshold})`,
      confidence: this.calculateConfidence(features),
      priority: 'low',
    };
  }

  /**
   * Determine priority level for quarantine recommendations
   */
  private determinePriority(score: number, features: FlakeFeatures): 'low' | 'medium' | 'high' | 'critical' {
    const { rerunPassRate, intermittencyScore } = features;
    
    // Critical: very high flakiness with clear intermittent behavior
    if (score > 0.8 && rerunPassRate > 0.5 && intermittencyScore > 0.6) {
      return 'critical';
    }
    
    // High: high flakiness score with good indicators
    if (score > 0.7 || (rerunPassRate > 0.4 && intermittencyScore > 0.5)) {
      return 'high';
    }
    
    // Medium: moderate flakiness
    if (score > 0.5) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Build test stability metrics for comprehensive analysis
   */
  public buildStabilityMetrics(testName: string, testFullName: string, repositoryId: string, runs: readonly TestRun[]): TestStabilityMetrics {
    if (runs.length === 0) {
      throw new Error('Cannot build stability metrics with no test runs');
    }

    const sortedRuns = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    
    const totalRuns = runs.length;
    const successfulRuns = runs.filter(r => r.status === 'passed').length;
    const failedRuns = runs.filter(r => r.status === 'failed').length;
    const skippedRuns = runs.filter(r => r.status === 'skipped').length;
    const errorRuns = runs.filter(r => r.status === 'error').length;
    
    const rerunAttempts = runs.filter(r => r.attempt > 1).length;
    const rerunSuccesses = runs.filter(r => r.attempt > 1 && r.status === 'passed').length;
    
    const firstSeen = sortedRuns[0]?.createdAt;
    const lastSeen = sortedRuns[sortedRuns.length - 1]?.createdAt;
    
    if (!firstSeen || !lastSeen) {
      throw new Error('Invalid run data: missing createdAt timestamps');
    }
    const lastFailure = sortedRuns.reverse().find(r => r.status === 'failed' || r.status === 'error')?.createdAt;
    
    const avgDuration = runs.reduce((sum, r) => sum + r.duration, 0) / runs.length;
    
    const failedRunsWithMessages = runs.filter(r => (r.status === 'failed' || r.status === 'error') && r.message);
    const failureMessages = this.buildMessageSignatures(failedRunsWithMessages);
    
    const failureClusters = this.identifyFailureClusters(runs);
    
    return {
      testName,
      testFullName,
      repositoryId,
      totalRuns,
      successfulRuns,
      failedRuns,
      skippedRuns,
      errorRuns,
      rerunAttempts,
      rerunSuccesses,
      firstSeen,
      lastSeen,
      lastFailure,
      avgDuration,
      failureMessages,
      failureClusters,
    };
  }

  /**
   * Build message signatures for failure analysis
   */
  private buildMessageSignatures(runs: readonly TestRun[]): MessageSignature[] {
    const messageGroups = new Map<string, TestRun[]>();
    
    for (const run of runs) {
      if (!run.message) continue;
      
      const normalized = this.normalizeMessage(run.message);
      if (!messageGroups.has(normalized)) {
        messageGroups.set(normalized, []);
      }
      const messageGroup = messageGroups.get(normalized);
      if (messageGroup) {
        messageGroup.push(run);
      }
    }
    
    return Array.from(messageGroups.entries()).map(([normalized, runsWithMessage]) => {
      const category = this.categorizeMessage(normalized);
      const confidence = Math.min(1.0, runsWithMessage.length / runs.length);
      
      return {
        normalized,
        originalCount: runsWithMessage.length,
        category,
        confidence,
      };
    });
  }

  /**
   * Categorize failure message by type
   */
  private categorizeMessage(message: string): MessageSignature['category'] {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      return 'timeout';
    }
    
    if (lowerMessage.includes('connection') || lowerMessage.includes('network') || lowerMessage.includes('socket')) {
      return 'connection';
    }
    
    if (lowerMessage.includes('memory') || lowerMessage.includes('resource') || lowerMessage.includes('disk')) {
      return 'resource';
    }
    
    if (lowerMessage.includes('assert') || lowerMessage.includes('expect') || lowerMessage.includes('should')) {
      return 'assertion';
    }
    
    return 'unknown';
  }
}