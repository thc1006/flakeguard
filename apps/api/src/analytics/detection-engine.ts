import type { 
  TestRun, 
  FlakeScore, 
  QuarantineRecommendation,
  QuarantinePolicy,
} from '@flakeguard/shared';

import { FailureClusteringAnalyzer, type ClusterAnalysisResult } from './clustering.js';
import { FlakinessScorer } from './flakiness.js';

/**
 * Unified detection engine that combines multiple analysis methods
 * for comprehensive flaky test detection and classification
 */
export class FlakeDetectionEngine {
  private readonly flakinessScorer: FlakinessScorer;
  private readonly clusteringAnalyzer: FailureClusteringAnalyzer;

  constructor(policy?: Partial<QuarantinePolicy>) {
    this.flakinessScorer = new FlakinessScorer(policy);
    this.clusteringAnalyzer = new FailureClusteringAnalyzer();
  }

  /**
   * Comprehensive flake detection analysis
   * Combines multiple detection methods for enhanced accuracy
   */
  public analyzeTest(runs: readonly TestRun[]): ComprehensiveAnalysis {
    if (runs.length === 0) {
      throw new Error('Cannot analyze test with no runs');
    }

    const testName = runs[0]?.testName ?? 'unknown';
    const testFullName = runs[0]?.testFullName ?? 'unknown';

    // Primary flakiness analysis
    const flakeScore = this.flakinessScorer.computeFlakeScore(runs);
    
    // Advanced clustering analysis
    const clusterAnalysis = this.clusteringAnalyzer.analyzeClusters(runs);
    
    // Pattern-based analysis
    const patternAnalysis = this.analyzeFailurePatterns(runs);
    
    // Environmental factors analysis
    const environmentalAnalysis = this.analyzeEnvironmentalFactors(runs);
    
    // Combined recommendation
    const recommendation = this.generateCombinedRecommendation(
      flakeScore,
      clusterAnalysis,
      patternAnalysis,
      environmentalAnalysis
    );

    return {
      testName,
      testFullName,
      flakeScore,
      clusterAnalysis,
      patternAnalysis,
      environmentalAnalysis,
      recommendation,
      analyzedAt: new Date(),
      confidence: this.calculateOverallConfidence(flakeScore, clusterAnalysis, patternAnalysis),
    };
  }

  /**
   * Analyze failure patterns for specific indicators of flakiness
   */
  private analyzeFailurePatterns(runs: readonly TestRun[]): PatternAnalysis {
    const failedRuns = runs.filter(r => r.status === 'failed' || r.status === 'error');
    const patterns: PatternIndicator[] = [];

    // Check for timeout patterns
    const timeoutPattern = this.detectTimeoutPattern(failedRuns);
    if (timeoutPattern.confidence > 0.3) {
      patterns.push(timeoutPattern);
    }

    // Check for resource contention patterns
    const resourcePattern = this.detectResourceContentionPattern(failedRuns);
    if (resourcePattern.confidence > 0.3) {
      patterns.push(resourcePattern);
    }

    // Check for race condition patterns
    const raceConditionPattern = this.detectRaceConditionPattern(failedRuns);
    if (raceConditionPattern.confidence > 0.3) {
      patterns.push(raceConditionPattern);
    }

    // Check for external dependency patterns
    const dependencyPattern = this.detectExternalDependencyPattern(failedRuns);
    if (dependencyPattern.confidence > 0.3) {
      patterns.push(dependencyPattern);
    }

    return {
      patterns,
      dominantPattern: this.findDominantPattern(patterns),
      overallConfidence: patterns.length > 0 
        ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length 
        : 0,
    };
  }

  /**
   * Detect timeout-related failure patterns
   */
  private detectTimeoutPattern(failedRuns: readonly TestRun[]): PatternIndicator {
    const timeoutMessages = failedRuns.filter(run => 
      (run.message?.toLowerCase().includes('timeout') ?? false) ||
      (run.message?.toLowerCase().includes('timed out') ?? false) ||
      (run.message?.toLowerCase().includes('time exceeded') ?? false)
    );

    const confidence = failedRuns.length > 0 ? timeoutMessages.length / failedRuns.length : 0;

    return {
      type: 'timeout',
      description: 'Test failures due to timeouts or time limits exceeded',
      confidence,
      occurrences: timeoutMessages.length,
      evidence: timeoutMessages.slice(0, 3).map(r => r.message ?? '').filter(Boolean),
    };
  }

  /**
   * Detect resource contention patterns
   */
  private detectResourceContentionPattern(failedRuns: readonly TestRun[]): PatternIndicator {
    const resourceMessages = failedRuns.filter(run => {
      const msg = run.message?.toLowerCase() ?? '';
      return msg.includes('memory') ||
             msg.includes('resource') ||
             msg.includes('disk') ||
             msg.includes('connection') ||
             msg.includes('pool') ||
             msg.includes('lock');
    });

    const confidence = failedRuns.length > 0 ? resourceMessages.length / failedRuns.length : 0;

    return {
      type: 'resource_contention',
      description: 'Test failures due to resource constraints or contention',
      confidence,
      occurrences: resourceMessages.length,
      evidence: resourceMessages.slice(0, 3).map(r => r.message ?? '').filter(Boolean),
    };
  }

  /**
   * Detect race condition patterns
   */
  private detectRaceConditionPattern(failedRuns: readonly TestRun[]): PatternIndicator {
    // Look for inconsistent failure messages and timing-sensitive keywords
    const uniqueMessages = new Set(failedRuns.map(r => 
      this.flakinessScorer.normalizeMessage(r.message ?? '')
    ));

    const raceKeywords = ['race', 'concurrent', 'parallel', 'sync', 'async', 'thread', 'order'];
    const raceMessages = failedRuns.filter(run => {
      const msg = run.message?.toLowerCase() ?? '';
      return raceKeywords.some(keyword => msg.includes(keyword));
    });

    // High message variance can indicate race conditions
    const messageVariance = failedRuns.length > 0 ? uniqueMessages.size / failedRuns.length : 0;
    const keywordConfidence = failedRuns.length > 0 ? raceMessages.length / failedRuns.length : 0;

    const confidence = Math.max(
      keywordConfidence,
      messageVariance > 0.5 ? messageVariance * 0.6 : 0 // Scaled variance contribution
    );

    return {
      type: 'race_condition',
      description: 'Test failures potentially due to race conditions or timing issues',
      confidence,
      occurrences: raceMessages.length,
      evidence: raceMessages.slice(0, 3).map(r => r.message ?? '').filter(Boolean),
    };
  }

  /**
   * Detect external dependency failure patterns
   */
  private detectExternalDependencyPattern(failedRuns: readonly TestRun[]): PatternIndicator {
    const dependencyMessages = failedRuns.filter(run => {
      const msg = run.message?.toLowerCase() ?? '';
      return msg.includes('connection') ||
             msg.includes('network') ||
             msg.includes('http') ||
             msg.includes('api') ||
             msg.includes('service') ||
             msg.includes('endpoint') ||
             msg.includes('refused') ||
             msg.includes('unreachable');
    });

    const confidence = failedRuns.length > 0 ? dependencyMessages.length / failedRuns.length : 0;

    return {
      type: 'external_dependency',
      description: 'Test failures due to external service or network dependencies',
      confidence,
      occurrences: dependencyMessages.length,
      evidence: dependencyMessages.slice(0, 3).map(r => r.message ?? '').filter(Boolean),
    };
  }

  /**
   * Find the dominant failure pattern
   */
  private findDominantPattern(patterns: readonly PatternIndicator[]): PatternIndicator | null {
    if (patterns.length === 0) {
      return null;
    }

    return patterns.reduce((max, pattern) => 
      pattern.confidence > max.confidence ? pattern : max
    );
  }

  /**
   * Analyze environmental factors that may contribute to flakiness
   */
  private analyzeEnvironmentalFactors(runs: readonly TestRun[]): EnvironmentalAnalysis {
    const factors: EnvironmentalFactor[] = [];

    // Analyze duration variance (performance instability)
    const durationFactor = this.analyzeDurationVariance(runs);
    if (durationFactor.significance > 0.3) {
      factors.push(durationFactor);
    }

    // Analyze time-of-day patterns
    const timeOfDayFactor = this.analyzeTimeOfDayPattern(runs);
    if (timeOfDayFactor.significance > 0.3) {
      factors.push(timeOfDayFactor);
    }

    // Analyze retry attempt patterns
    const retryFactor = this.analyzeRetryPatterns(runs);
    if (retryFactor.significance > 0.3) {
      factors.push(retryFactor);
    }

    return {
      factors,
      primaryFactor: factors.reduce((max, factor) => 
        factor.significance > max.significance ? factor : max
      , { type: 'none', significance: 0, description: '', evidence: [] } as EnvironmentalFactor),
      environmentalScore: factors.length > 0 
        ? factors.reduce((sum, f) => sum + f.significance, 0) / factors.length 
        : 0,
    };
  }

  /**
   * Analyze duration variance as a flakiness indicator
   */
  private analyzeDurationVariance(runs: readonly TestRun[]): EnvironmentalFactor {
    if (runs.length < 3) {
      return { type: 'duration_variance', significance: 0, description: '', evidence: [] };
    }

    const durations = runs.map(r => r.duration);
    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / durations.length;
    const coefficient = avgDuration > 0 ? Math.sqrt(variance) / avgDuration : 0;

    // High coefficient indicates unstable performance
    const significance = Math.min(1, coefficient);

    return {
      type: 'duration_variance',
      significance,
      description: `High duration variance (CV: ${coefficient.toFixed(3)}) indicates performance instability`,
      evidence: [`Average: ${avgDuration.toFixed(0)}ms`, `Std Dev: ${Math.sqrt(variance).toFixed(0)}ms`],
    };
  }

  /**
   * Analyze time-of-day failure patterns
   */
  private analyzeTimeOfDayPattern(runs: readonly TestRun[]): EnvironmentalFactor {
    const failedRuns = runs.filter(r => r.status === 'failed' || r.status === 'error');
    
    if (failedRuns.length < 2) {
      return { type: 'time_of_day', significance: 0, description: '', evidence: [] };
    }

    // Group by hour of day
    const hourCounts = new Map<number, number>();
    failedRuns.forEach(run => {
      const hour = run.createdAt.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    });

    // Find if failures are concentrated in specific hours
    const maxCount = Math.max(...Array.from(hourCounts.values()));
    const totalFailures = failedRuns.length;
    const concentration = maxCount / totalFailures;

    // High concentration indicates time-sensitive issues
    const significance = concentration > 0.5 ? concentration : 0;

    return {
      type: 'time_of_day',
      significance,
      description: `Failures concentrated at specific times (${(concentration * 100).toFixed(1)}% in peak hour)`,
      evidence: Array.from(hourCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([hour, count]) => `${hour}:00 - ${count} failures`),
    };
  }

  /**
   * Analyze retry attempt patterns
   */
  private analyzeRetryPatterns(runs: readonly TestRun[]): EnvironmentalFactor {
    const retriedRuns = runs.filter(r => r.attempt > 1);
    const successfulRetries = retriedRuns.filter(r => r.status === 'passed');
    
    if (retriedRuns.length === 0) {
      return { type: 'retry_pattern', significance: 0, description: '', evidence: [] };
    }

    const retrySuccessRate = successfulRetries.length / retriedRuns.length;
    
    // High retry success rate indicates flakiness
    const significance = retrySuccessRate;

    return {
      type: 'retry_pattern',
      significance,
      description: `High retry success rate (${(retrySuccessRate * 100).toFixed(1)}%) indicates intermittent issues`,
      evidence: [
        `${retriedRuns.length} retry attempts`,
        `${successfulRetries.length} successful retries`,
        `${(retrySuccessRate * 100).toFixed(1)}% retry success rate`,
      ],
    };
  }

  /**
   * Generate combined recommendation using all analysis methods
   */
  private generateCombinedRecommendation(
    flakeScore: FlakeScore,
    clusterAnalysis: ClusterAnalysisResult,
    patternAnalysis: PatternAnalysis,
    environmentalAnalysis: EnvironmentalAnalysis
  ): QuarantineRecommendation {
    // Base recommendation from flakiness scorer
    const baseRecommendation = flakeScore.recommendation;

    // Adjust based on additional analyses
    let adjustedConfidence = baseRecommendation.confidence;
    let adjustedAction = baseRecommendation.action;
    let adjustedPriority = baseRecommendation.priority;

    // Boost confidence if multiple analysis methods agree
    const agreementScore = this.calculateAnalysisAgreement(flakeScore, clusterAnalysis, patternAnalysis, environmentalAnalysis);
    adjustedConfidence *= (1 + agreementScore * 0.2); // Up to 20% boost

    // Adjust action based on dominant patterns
    if (patternAnalysis.dominantPattern?.confidence && patternAnalysis.dominantPattern.confidence > 0.7) {
      if (baseRecommendation.action === 'warn') {
        adjustedAction = 'quarantine'; // Promote to quarantine
      }
    }

    // Adjust priority based on environmental factors
    if (environmentalAnalysis.environmentalScore > 0.6) {
      if (adjustedPriority === 'low') {adjustedPriority = 'medium';}
      else if (adjustedPriority === 'medium') {adjustedPriority = 'high';}
    }

    // Build enhanced reason
    const reasons = [baseRecommendation.reason];
    
    if (clusterAnalysis.patterns.burstiness > 0.6) {
      reasons.push('Bursty failure pattern detected');
    }
    
    if (patternAnalysis.dominantPattern) {
      reasons.push(`Primary pattern: ${patternAnalysis.dominantPattern.type}`);
    }
    
    if (environmentalAnalysis.primaryFactor.significance > 0.5) {
      reasons.push(`Environmental factor: ${environmentalAnalysis.primaryFactor.type}`);
    }

    return {
      action: adjustedAction,
      reason: reasons.join('. '),
      confidence: Math.min(1, adjustedConfidence),
      priority: adjustedPriority,
    };
  }

  /**
   * Calculate agreement score between different analysis methods
   */
  private calculateAnalysisAgreement(
    flakeScore: FlakeScore,
    clusterAnalysis: ClusterAnalysisResult,
    patternAnalysis: PatternAnalysis,
    environmentalAnalysis: EnvironmentalAnalysis
  ): number {
    let agreements = 0;
    let totalComparisons = 0;

    // Compare flakiness score with clustering burstiness
    totalComparisons++;
    if ((flakeScore.score > 0.5) === (clusterAnalysis.patterns.burstiness > 0.5)) {
      agreements++;
    }

    // Compare flakiness score with pattern confidence
    totalComparisons++;
    if ((flakeScore.score > 0.5) === (patternAnalysis.overallConfidence > 0.5)) {
      agreements++;
    }

    // Compare flakiness score with environmental score
    totalComparisons++;
    if ((flakeScore.score > 0.5) === (environmentalAnalysis.environmentalScore > 0.5)) {
      agreements++;
    }

    return totalComparisons > 0 ? agreements / totalComparisons : 0;
  }

  /**
   * Calculate overall confidence from all analysis methods
   */
  private calculateOverallConfidence(
    flakeScore: FlakeScore,
    clusterAnalysis: ClusterAnalysisResult,
    patternAnalysis: PatternAnalysis
  ): number {
    const weights = {
      flakiness: 0.5,
      clustering: 0.3,
      patterns: 0.2,
    };

    const weightedSum = 
      (flakeScore.confidence * weights.flakiness) +
      (Math.min(1, clusterAnalysis.patterns.burstiness + clusterAnalysis.patterns.periodicity) * weights.clustering) +
      (patternAnalysis.overallConfidence * weights.patterns);

    return weightedSum;
  }
}

// Type definitions
export interface ComprehensiveAnalysis {
  readonly testName: string;
  readonly testFullName: string;
  readonly flakeScore: FlakeScore;
  readonly clusterAnalysis: ClusterAnalysisResult;
  readonly patternAnalysis: PatternAnalysis;
  readonly environmentalAnalysis: EnvironmentalAnalysis;
  readonly recommendation: QuarantineRecommendation;
  readonly analyzedAt: Date;
  readonly confidence: number;
}

export interface PatternAnalysis {
  readonly patterns: readonly PatternIndicator[];
  readonly dominantPattern: PatternIndicator | null;
  readonly overallConfidence: number;
}

export interface PatternIndicator {
  readonly type: 'timeout' | 'resource_contention' | 'race_condition' | 'external_dependency';
  readonly description: string;
  readonly confidence: number;
  readonly occurrences: number;
  readonly evidence: readonly string[];
}

export interface EnvironmentalAnalysis {
  readonly factors: readonly EnvironmentalFactor[];
  readonly primaryFactor: EnvironmentalFactor;
  readonly environmentalScore: number;
}

export interface EnvironmentalFactor {
  readonly type: 'duration_variance' | 'time_of_day' | 'retry_pattern' | 'none';
  readonly significance: number;
  readonly description: string;
  readonly evidence: readonly string[];
}