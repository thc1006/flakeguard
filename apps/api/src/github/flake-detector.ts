/**
 * Flake Detection Engine
 * 
 * Core algorithms for detecting flaky tests with:
 * - Statistical analysis of test failure patterns
 * - Machine learning-inspired confidence scoring
 * - Historical data analysis and trend detection
 * - Pattern matching for common flaky test indicators
 * - Database persistence for tracking and reporting
 * - Integration with check run updates and actions
 */

import type { PrismaClient } from '@prisma/client';
import type {
  FlakeAnalysis,
  TestResult,
  CheckRunAction,
  WorkflowRunWebhookPayload,
  CheckRunWebhookPayload,
  WorkflowJobWebhookPayload,
} from './types.js';
import {
  FLAKE_DETECTION,
  CHECK_RUN_ACTION_CONFIGS,
  ERROR_MESSAGES,
} from './constants.js';
import { logger } from '../utils/logger.js';

/**
 * Flake detection configuration
 */
export interface FlakeDetectionConfig {
  readonly minRunsForAnalysis: number;
  readonly flakeThreshold: number;
  readonly highConfidenceThreshold: number;
  readonly mediumConfidenceThreshold: number;
  readonly analysisWindowDays: number;
  readonly recentFailuresWindowDays: number;
  readonly commonFlakePatterns: readonly string[];
}

/**
 * Test execution context for flake analysis
 */
export interface TestExecutionContext {
  readonly testName: string;
  readonly repositoryId: string;
  readonly installationId: string;
  readonly checkRunId?: string;
  readonly workflowJobId?: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly duration?: number;
  readonly errorMessage?: string;
  readonly stackTrace?: string;
  readonly timestamp: Date;
}

/**
 * Flake detection result
 */
export interface FlakeDetectionResult {
  readonly analysis: FlakeAnalysis;
  readonly shouldUpdateCheckRun: boolean;
  readonly suggestedActions: readonly CheckRunAction[];
  readonly confidenceLevel: 'low' | 'medium' | 'high';
}

/**
 * Core flake detection engine
 */
export class FlakeDetector {
  private readonly prisma: PrismaClient;
  private readonly config: FlakeDetectionConfig;

  constructor(options: {
    prisma: PrismaClient;
    config?: Partial<FlakeDetectionConfig>;
  }) {
    this.prisma = options.prisma;
    this.config = {
      minRunsForAnalysis: FLAKE_DETECTION.MIN_RUNS_FOR_ANALYSIS,
      flakeThreshold: FLAKE_DETECTION.FLAKY_THRESHOLD,
      highConfidenceThreshold: FLAKE_DETECTION.HIGH_CONFIDENCE_THRESHOLD,
      mediumConfidenceThreshold: FLAKE_DETECTION.MEDIUM_CONFIDENCE_THRESHOLD,
      analysisWindowDays: FLAKE_DETECTION.ANALYSIS_WINDOW_DAYS,
      recentFailuresWindowDays: FLAKE_DETECTION.RECENT_FAILURES_WINDOW_DAYS,
      commonFlakePatterns: FLAKE_DETECTION.COMMON_FLAKE_PATTERNS,
      ...options.config,
    };
  }

  /**
   * Analyze test execution for flaky behavior
   */
  async analyzeTestExecution(context: TestExecutionContext): Promise<FlakeDetectionResult> {
    const startTime = Date.now();
    
    try {
      // Store test result
      await this.storeTestResult(context);

      // Get historical data for analysis
      const historicalData = await this.getHistoricalTestData(
        context.testName,
        context.repositoryId
      );

      // Perform flake analysis
      const analysis = await this.performFlakeAnalysis(context, historicalData);

      // Determine confidence level
      const confidenceLevel = this.determineConfidenceLevel(analysis.confidence);

      // Generate suggested actions
      const suggestedActions = this.generateSuggestedActions(analysis, confidenceLevel);

      // Determine if check run should be updated
      const shouldUpdateCheckRun = analysis.isFlaky && analysis.confidence >= this.config.mediumConfidenceThreshold;

      // Update or create flake detection record
      await this.updateFlakeDetection(context, analysis);

      const duration = Date.now() - startTime;
      logger.info('Flake analysis completed', {
        testName: context.testName,
        isFlaky: analysis.isFlaky,
        confidence: analysis.confidence,
        duration,
      });

      return {
        analysis,
        shouldUpdateCheckRun,
        suggestedActions,
        confidenceLevel,
      };

    } catch (error) {
      logger.error('Flake analysis failed', {
        testName: context.testName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Batch analyze multiple test executions
   */
  async batchAnalyzeTests(contexts: readonly TestExecutionContext[]): Promise<FlakeDetectionResult[]> {
    const results: FlakeDetectionResult[] = [];
    
    // Group tests by repository for efficient database queries
    const testsByRepo = this.groupTestsByRepository(contexts);

    for (const [repositoryId, tests] of testsByRepo.entries()) {
      logger.debug('Analyzing tests for repository', {
        repositoryId,
        testCount: tests.length,
      });

      // Analyze tests in parallel for each repository
      const repoResults = await Promise.all(
        tests.map(context => this.analyzeTestExecution(context))
      );

      results.push(...repoResults);
    }

    return results;
  }

  /**
   * Get flake detection status for a test
   */
  async getFlakeStatus(testName: string, repositoryId: string): Promise<FlakeAnalysis | null> {
    try {
      const flakeDetection = await this.prisma.flakeDetection.findUnique({
        where: {
          testName_repositoryId: {
            testName,
            repositoryId,
          },
        },
      });

      if (!flakeDetection) {
        return null;
      }

      return {
        isFlaky: flakeDetection.isFlaky,
        confidence: flakeDetection.confidence,
        failurePattern: flakeDetection.failurePattern,
        historicalFailures: flakeDetection.historicalFailures,
        totalRuns: flakeDetection.totalRuns,
        failureRate: flakeDetection.failureRate,
        lastFailureAt: flakeDetection.lastFailureAt?.toISOString() || null,
        suggestedAction: flakeDetection.suggestedAction as CheckRunAction | null,
      };

    } catch (error) {
      logger.error('Failed to get flake status', {
        testName,
        repositoryId,
        error,
      });
      return null;
    }
  }

  /**
   * Update flake detection status (e.g., quarantine, dismiss)
   */
  async updateFlakeStatus(
    testName: string,
    repositoryId: string,
    action: CheckRunAction,
    context: { userId?: string; reason?: string }
  ): Promise<void> {
    try {
      const statusMap: Record<CheckRunAction, string> = {
        quarantine: 'quarantined',
        dismiss_flake: 'dismissed',
        mark_stable: 'stable',
        rerun_failed: 'pending', // No status change for rerun
        open_issue: 'pending', // No status change for issue creation
      };

      const newStatus = statusMap[action];
      if (!newStatus || newStatus === 'pending') {
        return; // No status update needed
      }

      await this.prisma.flakeDetection.update({
        where: {
          testName_repositoryId: {
            testName,
            repositoryId,
          },
        },
        data: {
          status: newStatus,
          updatedAt: new Date(),
        },
      });

      logger.info('Updated flake detection status', {
        testName,
        repositoryId,
        action,
        newStatus,
      });

    } catch (error) {
      logger.error('Failed to update flake status', {
        testName,
        repositoryId,
        action,
        error,
      });
      throw error;
    }
  }

  /**
   * Get flaky tests summary for a repository
   */
  async getRepositoryFlakeSummary(repositoryId: string): Promise<{
    totalFlaky: number;
    totalQuarantined: number;
    recentlyDetected: number;
    topFlaky: Array<{
      testName: string;
      confidence: number;
      failureRate: number;
      lastFailureAt: string | null;
    }>;
  }> {
    try {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - this.config.recentFailuresWindowDays);

      const [totalFlaky, totalQuarantined, recentlyDetected, topFlaky] = await Promise.all([
        // Total flaky tests
        this.prisma.flakeDetection.count({
          where: {
            repositoryId,
            isFlaky: true,
          },
        }),

        // Total quarantined tests
        this.prisma.flakeDetection.count({
          where: {
            repositoryId,
            status: 'quarantined',
          },
        }),

        // Recently detected flaky tests
        this.prisma.flakeDetection.count({
          where: {
            repositoryId,
            isFlaky: true,
            lastFailureAt: {
              gte: recentDate,
            },
          },
        }),

        // Top flaky tests
        this.prisma.flakeDetection.findMany({
          where: {
            repositoryId,
            isFlaky: true,
          },
          select: {
            testName: true,
            confidence: true,
            failureRate: true,
            lastFailureAt: true,
          },
          orderBy: [
            { confidence: 'desc' },
            { failureRate: 'desc' },
          ],
          take: 10,
        }),
      ]);

      return {
        totalFlaky,
        totalQuarantined,
        recentlyDetected,
        topFlaky: topFlaky.map(test => ({
          testName: test.testName,
          confidence: test.confidence,
          failureRate: test.failureRate,
          lastFailureAt: test.lastFailureAt?.toISOString() || null,
        })),
      };

    } catch (error) {
      logger.error('Failed to get repository flake summary', {
        repositoryId,
        error,
      });
      throw error;
    }
  }

  /**
   * Store test result in database
   */
  private async storeTestResult(context: TestExecutionContext): Promise<void> {
    try {
      await this.prisma.testResult.create({
        data: {
          name: context.testName,
          status: context.status,
          duration: context.duration,
          errorMessage: context.errorMessage,
          stackTrace: context.stackTrace,
          repositoryId: context.repositoryId,
          checkRunId: context.checkRunId,
          workflowJobId: context.workflowJobId,
        },
      });
    } catch (error) {
      logger.error('Failed to store test result', {
        testName: context.testName,
        error,
      });
      // Don't throw here - analysis can continue without storing the result
    }
  }

  /**
   * Get historical test data for analysis
   */
  private async getHistoricalTestData(
    testName: string,
    repositoryId: string
  ): Promise<TestResult[]> {
    const analysisWindow = new Date();
    analysisWindow.setDate(analysisWindow.getDate() - this.config.analysisWindowDays);

    try {
      const results = await this.prisma.testResult.findMany({
        where: {
          name: testName,
          repositoryId,
          createdAt: {
            gte: analysisWindow,
          },
        },
        select: {
          name: true,
          status: true,
          duration: true,
          errorMessage: true,
          stackTrace: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return results.map(result => ({
        name: result.name,
        status: result.status as 'passed' | 'failed' | 'skipped',
        duration: result.duration || undefined,
        errorMessage: result.errorMessage || undefined,
        stackTrace: result.stackTrace || undefined,
      }));

    } catch (error) {
      logger.error('Failed to get historical test data', {
        testName,
        repositoryId,
        error,
      });
      return [];
    }
  }

  /**
   * Perform comprehensive flake analysis
   */
  private async performFlakeAnalysis(
    context: TestExecutionContext,
    historicalData: TestResult[]
  ): Promise<FlakeAnalysis> {
    // Add current test to historical data
    const allResults = [
      ...historicalData,
      {
        name: context.testName,
        status: context.status,
        duration: context.duration,
        errorMessage: context.errorMessage,
        stackTrace: context.stackTrace,
      },
    ];

    // Calculate basic statistics
    const totalRuns = allResults.length;
    const failures = allResults.filter(r => r.status === 'failed');
    const historicalFailures = failures.length;
    const failureRate = totalRuns > 0 ? historicalFailures / totalRuns : 0;

    // Find last failure
    const lastFailureAt = context.status === 'failed' 
      ? context.timestamp.toISOString()
      : this.findLastFailureDate(historicalData);

    // Analyze failure patterns
    const failurePattern = this.analyzeFailurePattern(failures);

    // Calculate confidence score
    const confidence = this.calculateConfidenceScore({
      totalRuns,
      historicalFailures,
      failureRate,
      failurePattern,
      currentStatus: context.status,
      hasRecentFailure: Boolean(lastFailureAt),
    });

    // Determine if test is flaky
    const isFlaky = this.determineFlakiness({
      totalRuns,
      failureRate,
      confidence,
      failurePattern,
    });

    // Suggest action based on analysis
    const suggestedAction = this.suggestAction({
      isFlaky,
      confidence,
      failureRate,
      totalRuns,
    });

    return {
      isFlaky,
      confidence,
      failurePattern,
      historicalFailures,
      totalRuns,
      failureRate,
      lastFailureAt,
      suggestedAction,
    };
  }

  /**
   * Analyze failure patterns in error messages and stack traces
   */
  private analyzeFailurePattern(failures: TestResult[]): string | null {
    if (failures.length === 0) {
      return null;
    }

    const errorMessages = failures
      .map(f => f.errorMessage)
      .filter(Boolean) as string[];

    if (errorMessages.length === 0) {
      return null;
    }

    // Check for common flake patterns
    for (const pattern of this.config.commonFlakePatterns) {
      const matches = errorMessages.filter(msg => 
        msg.toLowerCase().includes(pattern.toLowerCase())
      );
      
      if (matches.length >= Math.min(2, failures.length * 0.5)) {
        return pattern;
      }
    }

    // Look for repeated error patterns
    const errorFrequency = new Map<string, number>();
    
    for (const message of errorMessages) {
      // Extract first line or first 100 characters for pattern matching
      const key = message.split('\n')[0].substring(0, 100);
      errorFrequency.set(key, (errorFrequency.get(key) || 0) + 1);
    }

    // Find most common error pattern
    let mostCommonError = '';
    let maxFrequency = 0;
    
    for (const [error, frequency] of errorFrequency.entries()) {
      if (frequency > maxFrequency && frequency >= 2) {
        mostCommonError = error;
        maxFrequency = frequency;
      }
    }

    return mostCommonError || null;
  }

  /**
   * Calculate confidence score for flake detection
   */
  private calculateConfidenceScore(params: {
    totalRuns: number;
    historicalFailures: number;
    failureRate: number;
    failurePattern: string | null;
    currentStatus: string;
    hasRecentFailure: boolean;
  }): number {
    const {
      totalRuns,
      historicalFailures,
      failureRate,
      failurePattern,
      currentStatus,
      hasRecentFailure,
    } = params;

    let confidence = 0;

    // Base confidence from failure rate and sample size
    if (totalRuns >= this.config.minRunsForAnalysis) {
      confidence += Math.min(0.4, failureRate * 2); // Max 40% from failure rate
      
      // Bonus for adequate sample size
      const sampleSizeBonus = Math.min(0.2, (totalRuns - this.config.minRunsForAnalysis) * 0.01);
      confidence += sampleSizeBonus;
    }

    // Pattern matching bonus
    if (failurePattern) {
      if (this.config.commonFlakePatterns.some(p => 
        failurePattern.toLowerCase().includes(p.toLowerCase())
      )) {
        confidence += 0.3; // Known flaky patterns get higher confidence
      } else {
        confidence += 0.15; // Any pattern is better than random
      }
    }

    // Recent failure bonus
    if (hasRecentFailure && currentStatus === 'failed') {
      confidence += 0.1;
    }

    // Consistency bonus (intermittent failures are more likely flaky)
    if (historicalFailures > 0 && historicalFailures < totalRuns) {
      const intermittencyScore = 1 - Math.abs(failureRate - 0.5) * 2;
      confidence += intermittencyScore * 0.15;
    }

    return Math.min(1.0, Math.max(0.0, confidence));
  }

  /**
   * Determine if test is flaky based on analysis
   */
  private determineFlakiness(params: {
    totalRuns: number;
    failureRate: number;
    confidence: number;
    failurePattern: string | null;
  }): boolean {
    const { totalRuns, failureRate, confidence } = params;

    // Need minimum runs for analysis
    if (totalRuns < this.config.minRunsForAnalysis) {
      return false;
    }

    // Must have intermittent failures (not always passing or always failing)
    if (failureRate === 0 || failureRate === 1) {
      return false;
    }

    // Check if failure rate is in flaky range and confidence is sufficient
    return failureRate >= this.config.flakeThreshold && 
           confidence >= this.config.mediumConfidenceThreshold;
  }

  /**
   * Suggest appropriate action based on analysis
   */
  private suggestAction(params: {
    isFlaky: boolean;
    confidence: number;
    failureRate: number;
    totalRuns: number;
  }): CheckRunAction | null {
    const { isFlaky, confidence, failureRate, totalRuns } = params;

    if (!isFlaky) {
      return null;
    }

    // High confidence flaky tests should be quarantined
    if (confidence >= this.config.highConfidenceThreshold) {
      return 'quarantine';
    }

    // Medium confidence with high failure rate
    if (confidence >= this.config.mediumConfidenceThreshold && failureRate > 0.3) {
      return 'quarantine';
    }

    // Medium confidence with adequate sample size
    if (confidence >= this.config.mediumConfidenceThreshold && totalRuns >= 10) {
      return 'open_issue';
    }

    // Low confidence or insufficient data
    return 'rerun_failed';
  }

  /**
   * Determine confidence level category
   */
  private determineConfidenceLevel(confidence: number): 'low' | 'medium' | 'high' {
    if (confidence >= this.config.highConfidenceThreshold) {
      return 'high';
    } else if (confidence >= this.config.mediumConfidenceThreshold) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Generate suggested actions based on analysis
   */
  private generateSuggestedActions(
    analysis: FlakeAnalysis,
    confidenceLevel: 'low' | 'medium' | 'high'
  ): readonly CheckRunAction[] {
    const actions: CheckRunAction[] = [];

    if (analysis.isFlaky) {
      // Always allow rerunning failed jobs
      actions.push('rerun_failed');

      if (confidenceLevel === 'high') {
        actions.push('quarantine', 'open_issue');
      } else if (confidenceLevel === 'medium') {
        actions.push('open_issue', 'quarantine');
      } else {
        actions.push('open_issue');
      }

      // Always allow dismissing as not flaky
      actions.push('dismiss_flake');
    } else {
      // For non-flaky tests, still allow rerunning
      actions.push('rerun_failed');
    }

    return actions;
  }

  /**
   * Update or create flake detection record
   */
  private async updateFlakeDetection(
    context: TestExecutionContext,
    analysis: FlakeAnalysis
  ): Promise<void> {
    try {
      await this.prisma.flakeDetection.upsert({
        where: {
          testName_repositoryId: {
            testName: context.testName,
            repositoryId: context.repositoryId,
          },
        },
        update: {
          isFlaky: analysis.isFlaky,
          confidence: analysis.confidence,
          failurePattern: analysis.failurePattern,
          historicalFailures: analysis.historicalFailures,
          totalRuns: analysis.totalRuns,
          failureRate: analysis.failureRate,
          lastFailureAt: analysis.lastFailureAt ? new Date(analysis.lastFailureAt) : null,
          suggestedAction: analysis.suggestedAction,
          checkRunId: context.checkRunId,
          updatedAt: new Date(),
        },
        create: {
          testName: context.testName,
          repositoryId: context.repositoryId,
          installationId: context.installationId,
          checkRunId: context.checkRunId,
          isFlaky: analysis.isFlaky,
          confidence: analysis.confidence,
          failurePattern: analysis.failurePattern,
          historicalFailures: analysis.historicalFailures,
          totalRuns: analysis.totalRuns,
          failureRate: analysis.failureRate,
          lastFailureAt: analysis.lastFailureAt ? new Date(analysis.lastFailureAt) : null,
          suggestedAction: analysis.suggestedAction,
          status: 'pending',
        },
      });

    } catch (error) {
      logger.error('Failed to update flake detection', {
        testName: context.testName,
        repositoryId: context.repositoryId,
        error,
      });
      throw error;
    }
  }

  /**
   * Find the last failure date from historical data
   */
  private findLastFailureDate(historicalData: TestResult[]): string | null {
    const failures = historicalData.filter(r => r.status === 'failed');
    if (failures.length === 0) {
      return null;
    }

    // Assuming historicalData is ordered by creation date desc
    return failures[0].createdAt?.toISOString() || null;
  }

  /**
   * Group test contexts by repository for efficient processing
   */
  private groupTestsByRepository(
    contexts: readonly TestExecutionContext[]
  ): Map<string, TestExecutionContext[]> {
    const grouped = new Map<string, TestExecutionContext[]>();
    
    for (const context of contexts) {
      const tests = grouped.get(context.repositoryId) || [];
      tests.push(context);
      grouped.set(context.repositoryId, tests);
    }
    
    return grouped;
  }
}

/**
 * Create flake detector instance
 */
export function createFlakeDetector(options: {
  prisma: PrismaClient;
  config?: Partial<FlakeDetectionConfig>;
}): FlakeDetector {
  return new FlakeDetector(options);
}

/**
 * Extract test results from workflow job payload
 */
export function extractTestResultsFromJob(payload: WorkflowJobWebhookPayload): TestExecutionContext[] {
  // This is a placeholder implementation
  // In practice, you would parse job logs or artifacts to extract test results
  const job = payload.workflow_job;
  
  // Example: extract from job name if it follows a pattern
  if (job.conclusion === 'failure' && job.name.includes('test')) {
    return [{
      testName: job.name,
      repositoryId: '', // Would need to be resolved from repository info
      installationId: '', // Would need to be resolved from installation info
      workflowJobId: job.id.toString(),
      status: 'failed',
      timestamp: new Date(job.completed_at || job.started_at || new Date().toISOString()),
    }];
  }

  return [];
}

/**
 * Extract test results from check run payload
 */
export function extractTestResultsFromCheckRun(payload: CheckRunWebhookPayload): TestExecutionContext[] {
  // This is a placeholder implementation
  // In practice, you would parse check run output or annotations
  const checkRun = payload.check_run;
  
  if (checkRun.conclusion === 'failure') {
    return [{
      testName: checkRun.name,
      repositoryId: '', // Would need to be resolved
      installationId: '', // Would need to be resolved
      checkRunId: checkRun.id.toString(),
      status: 'failed',
      errorMessage: checkRun.output?.summary || undefined,
      timestamp: new Date(checkRun.completed_at || checkRun.started_at || new Date().toISOString()),
    }];
  }

  return [];
}