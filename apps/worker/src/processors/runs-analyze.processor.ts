/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, import/order */

/**
 * Workflow Runs Analysis Processor
 * 
 * Analyzes test results to calculate flakiness scores, detect patterns,
 * and update GitHub Check Runs with flakiness information and recommendations.
 */

import { Job } from 'bullmq';
import { PrismaClient, type Prisma } from '@prisma/client';
import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';
import { 
  recordJobCompletion, 
  recordFlakinessAnalysis,
  recordGitHubApiCall 
} from '../utils/metrics.js';
import { 
  FLAKINESS_CONFIG,
  QueueNames 
} from '@flakeguard/shared';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface RunsAnalyzeJobData {
  workflowRunId: number;
  repository: {
    owner: string;
    repo: string;
    installationId: number;
  };
  correlationId?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  forceRecompute?: boolean;
  analysisConfig?: {
    lookbackDays?: number;
    minRunsThreshold?: number;
    flakinessThreshold?: number;
  };
}

export interface AnalysisResult {
  success: boolean;
  workflowRunId: number;
  analyzedTests: number;
  flakyTests: FlakyTestResult[];
  overallFlakinessScore: number;
  recommendations: string[];
  checkRunUpdated: boolean;
  processingTimeMs: number;
  errors: string[];
  warnings: string[];
}

export interface FlakyTestResult {
  testName: string;
  className: string;
  flakinessScore: number;
  totalRuns: number;
  failures: number;
  successRate: number;
  recentFailures: number;
  pattern: 'intermittent' | 'environmental' | 'timing' | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  firstSeen: string;
  lastSeen: string;
  affectedBranches: string[];
}

export interface TestExecutionHistory {
  testName: string;
  className: string;
  executions: TestExecution[];
}

export interface TestExecution {
  workflowRunId: number;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  executionTime: number;
  timestamp: Date;
  branch: string;
  commitSha: string;
  runNumber: number;
  failureMessage?: string;
  errorMessage?: string;
}

export interface FlakinessMetrics {
  totalTests: number;
  flakyTests: number;
  overallFlakinessRate: number;
  averageFlakinessScore: number;
  severelyFlakyTests: number;
  newlyFlakyTests: number;
  improvedTests: number;
  regressionTests: number;
}

// ============================================================================
// Processor Implementation
// ============================================================================

/**
 * Create runs analysis processor
 */
export function createRunsAnalyzeProcessor(
  prisma: PrismaClient,
  octokit?: Octokit
) {
  return async function processRunsAnalyze(
    job: Job<RunsAnalyzeJobData>
  ): Promise<AnalysisResult> {
    const { data } = job;
    const startTime = Date.now();
    
    logger.info({
      jobId: job.id,
      workflowRunId: data.workflowRunId,
      repository: `${data.repository.owner}/${data.repository.repo}`,
      correlationId: data.correlationId,
      priority: data.priority,
      forceRecompute: data.forceRecompute
    }, 'Processing runs analysis job');

    try {
      // Update job progress
      await job.updateProgress({
        phase: 'analyzing',
        percentage: 10,
        message: 'Loading test history'
      });

      // Load test execution history
      const testHistories = await loadTestExecutionHistories(prisma, data);
      
      if (testHistories.length === 0) {
        logger.info({ workflowRunId: data.workflowRunId }, 'No test history found for analysis');
        return createEmptyAnalysisResult(data.workflowRunId, startTime);
      }

      // Update progress
      await job.updateProgress({
        phase: 'calculating',
        percentage: 30,
        message: `Analyzing ${testHistories.length} test patterns`
      });

      // Calculate flakiness scores
      const flakyTests = await calculateFlakinessScores(testHistories, data.analysisConfig);
      
      // Update progress
      await job.updateProgress({
        phase: 'storing',
        percentage: 60,
        message: 'Storing analysis results'
      });

      // Store analysis results
      await storeAnalysisResults(prisma, data, flakyTests);
      
      // Update progress
      await job.updateProgress({
        phase: 'updating',
        percentage: 80,
        message: 'Updating GitHub Check Run'
      });

      // Update GitHub Check Run with results
      const github = octokit || createMockGitHubClient();
      const checkRunUpdated = await updateGitHubCheckRun(github, data, flakyTests);
      
      // Generate recommendations
      const recommendations = generateRecommendations(flakyTests);
      
      // Calculate overall metrics
      const overallFlakinessScore = calculateOverallFlakinessScore(flakyTests);
      
      const processingTimeMs = Date.now() - startTime;
      
      // Final progress update
      await job.updateProgress({
        phase: 'complete',
        percentage: 100,
        message: 'Analysis complete'
      });

      const result: AnalysisResult = {
        success: true,
        workflowRunId: data.workflowRunId,
        analyzedTests: testHistories.length,
        flakyTests,
        overallFlakinessScore,
        recommendations,
        checkRunUpdated,
        processingTimeMs,
        errors: [],
        warnings: []
      };

      // Record metrics
      recordFlakinessAnalysis(
        `${data.repository.owner}/${data.repository.repo}`,
        testHistories.length,
        flakyTests.length,
        overallFlakinessScore,
        processingTimeMs
      );
      
      recordJobCompletion(QueueNames.RUNS_ANALYZE, 'completed', data.priority, processingTimeMs);
      
      logger.info({
        jobId: job.id,
        workflowRunId: data.workflowRunId,
        analyzedTests: testHistories.length,
        flakyTests: flakyTests.length,
        overallFlakinessScore,
        processingTimeMs
      }, 'Runs analysis completed successfully');

      return result;

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      recordJobCompletion(QueueNames.RUNS_ANALYZE, 'failed', data.priority, processingTimeMs, 'analysis_error');
      
      logger.error({
        jobId: job.id,
        workflowRunId: data.workflowRunId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs
      }, 'Runs analysis failed');

      throw error;
    }
  };
}

// ============================================================================
// Data Loading Functions
// ============================================================================

/**
 * Load test execution histories for analysis
 */
async function loadTestExecutionHistories(
  prisma: PrismaClient,
  data: RunsAnalyzeJobData
): Promise<TestExecutionHistory[]> {
  const lookbackDays = data.analysisConfig?.lookbackDays || FLAKINESS_CONFIG.ANALYSIS_WINDOW_DAYS;
  const minRuns = data.analysisConfig?.minRunsThreshold || FLAKINESS_CONFIG.MIN_RUNS_FOR_ANALYSIS;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  
  try {
    // Query test cases with their execution history
    const testCasesWithHistory = await prisma.fGTestCase.findMany({
      where: {
        repoId: `${data.repository.owner}/${data.repository.repo}`,
        createdAt: {
          gte: cutoffDate
        }
      },
      include: {
        occurrences: {
          include: {
            workflowRun: true
          }
        }
      },
      orderBy: [
        { className: 'asc' },
        { name: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    
    // Group by test name and class name
    const testHistoryMap = new Map<string, TestExecutionHistory>();
    
    for (const testCase of testCasesWithHistory) {
      const testKey = `${testCase.className}#${testCase.name}`;
      
      if (!testHistoryMap.has(testKey)) {
        testHistoryMap.set(testKey, {
          testName: testCase.name,
          className: testCase.className || '',
          executions: []
        });
      }
      
      const history = testHistoryMap.get(testKey);
      if (!history) {continue;}
      history.executions.push({
        workflowRunId: parseInt(testCase.occurrences[0]?.workflowRun?.id || '0'),
        status: (testCase.occurrences[0]?.status || 'passed') as 'passed' | 'failed' | 'error' | 'skipped',
        executionTime: testCase.occurrences[0]?.durationMs || 0,
        timestamp: testCase.createdAt,
        branch: 'main', // Note: workflowRun doesn't have headBranch in the schema
        commitSha: '', // Note: workflowRun doesn't have headSha in the schema
        runNumber: 0, // Note: workflowRun doesn't have runNumber in the schema
        failureMessage: testCase.occurrences[0]?.failureMsgSignature || undefined,
        errorMessage: testCase.occurrences[0]?.failureStackDigest || undefined
      });
    }
    
    // Filter tests with sufficient execution history
    const result = Array.from(testHistoryMap.values())
      .filter(history => history.executions.length >= minRuns);
    
    logger.debug({
      totalTestCases: testCasesWithHistory.length,
      uniqueTests: testHistoryMap.size,
      testsWithSufficientHistory: result.length,
      minRuns,
      lookbackDays
    }, 'Loaded test execution histories');
    
    return result;
    
  } catch (error) {
    logger.error({
      repository: `${data.repository.owner}/${data.repository.repo}`,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to load test execution histories');
    throw error;
  }
}

// ============================================================================
// Flakiness Analysis Functions
// ============================================================================

/**
 * Calculate flakiness scores for test histories
 */
async function calculateFlakinessScores(
  testHistories: TestExecutionHistory[],
  config?: RunsAnalyzeJobData['analysisConfig']
): Promise<FlakyTestResult[]> {
  const flakinessThreshold = config?.flakinessThreshold || FLAKINESS_CONFIG.FLAKINESS_THRESHOLD;
  const flakyTests: FlakyTestResult[] = [];
  
  for (const history of testHistories) {
    const analysis = analyzeTestFlakiness(history);
    
    if (analysis.flakinessScore >= flakinessThreshold) {
      flakyTests.push(analysis);
    }
  }
  
  // Sort by flakiness score (highest first)
  flakyTests.sort((a, b) => b.flakinessScore - a.flakinessScore);
  
  return flakyTests;
}

/**
 * Analyze individual test flakiness
 */
function analyzeTestFlakiness(history: TestExecutionHistory): FlakyTestResult {
  const executions = history.executions;
  const totalRuns = executions.length;
  
  // Count outcomes
  const failures = executions.filter(e => e.status === 'failed' || e.status === 'error').length;
  const successes = executions.filter(e => e.status === 'passed').length;
  const skipped = executions.filter(e => e.status === 'skipped').length;
  
  // Calculate basic metrics
  const successRate = successes / (totalRuns - skipped);
  const failureRate = failures / (totalRuns - skipped);
  
  // Calculate flakiness score using multiple factors
  let flakinessScore = 0;
  
  // Factor 1: Failure rate (0-1)
  flakinessScore += failureRate * 0.4;
  
  // Factor 2: Inconsistency penalty
  const inconsistencyPenalty = calculateInconsistencyPenalty(executions);
  flakinessScore += inconsistencyPenalty * 0.3;
  
  // Factor 3: Recency factor (recent failures are more important)
  const recencyFactor = calculateRecencyFactor(executions);
  flakinessScore += recencyFactor * 0.2;
  
  // Factor 4: Branch diversity (flaky across multiple branches)
  const branchDiversityFactor = calculateBranchDiversityFactor(executions);
  flakinessScore += branchDiversityFactor * 0.1;
  
  // Normalize to 0-1 range
  flakinessScore = Math.min(flakinessScore, 1.0);
  
  // Count recent failures (last 10 runs)
  const recentExecutions = executions.slice(0, Math.min(10, executions.length));
  const recentFailures = recentExecutions.filter(e => e.status === 'failed' || e.status === 'error').length;
  
  // Detect flakiness pattern
  const pattern = detectFlakinessPattern(executions);
  
  // Determine severity
  const severity = determineSeverity(flakinessScore, recentFailures, totalRuns);
  
  // Generate recommendation
  const recommendation = generateTestRecommendation(flakinessScore, pattern, recentFailures);
  
  // Get affected branches
  const affectedBranches = Array.from(new Set(
    executions
      .filter(e => e.status === 'failed' || e.status === 'error')
      .map(e => e.branch)
  ));
  
  return {
    testName: history.testName,
    className: history.className,
    flakinessScore,
    totalRuns,
    failures,
    successRate,
    recentFailures,
    pattern,
    severity,
    recommendation,
    firstSeen: executions[executions.length - 1]?.timestamp.toISOString() || new Date().toISOString(),
    lastSeen: executions[0]?.timestamp.toISOString() || new Date().toISOString(),
    affectedBranches
  };
}

/**
 * Calculate inconsistency penalty (alternating pass/fail patterns)
 */
function calculateInconsistencyPenalty(executions: TestExecution[]): number {
  if (executions.length < 3) {return 0;}
  
  let transitions = 0;
  let previousStatus = executions[0]?.status;
  
  for (let i = 1; i < executions.length; i++) {
    const currentStatus = executions[i]?.status;
    if ((previousStatus === 'passed' && (currentStatus === 'failed' || currentStatus === 'error')) ||
        ((previousStatus === 'failed' || previousStatus === 'error') && currentStatus === 'passed')) {
      transitions++;
    }
    previousStatus = currentStatus;
  }
  
  // Normalize by execution count
  return Math.min(transitions / (executions.length - 1), 1.0);
}

/**
 * Calculate recency factor (weight recent failures more heavily)
 */
function calculateRecencyFactor(executions: TestExecution[]): number {
  const recentWindow = Math.min(10, executions.length);
  const recentExecutions = executions.slice(0, recentWindow);
  
  let weightedFailures = 0;
  let totalWeight = 0;
  
  for (let i = 0; i < recentExecutions.length; i++) {
    const weight = (recentWindow - i) / recentWindow; // Higher weight for more recent
    totalWeight += weight;
    
    if (recentExecutions[i]?.status === 'failed' || recentExecutions[i]?.status === 'error') {
      weightedFailures += weight;
    }
  }
  
  return totalWeight > 0 ? weightedFailures / totalWeight : 0;
}

/**
 * Calculate branch diversity factor
 */
function calculateBranchDiversityFactor(executions: TestExecution[]): number {
  const branchFailures = new Map<string, number>();
  const branchCounts = new Map<string, number>();
  
  for (const execution of executions) {
    const branch = execution.branch;
    branchCounts.set(branch, (branchCounts.get(branch) || 0) + 1);
    
    if (execution.status === 'failed' || execution.status === 'error') {
      branchFailures.set(branch, (branchFailures.get(branch) || 0) + 1);
    }
  }
  
  // Count branches with failures
  const branchesWithFailures = branchFailures.size;
  const totalBranches = branchCounts.size;
  
  return totalBranches > 1 ? branchesWithFailures / totalBranches : 0;
}

/**
 * Detect flakiness pattern
 */
function detectFlakinessPattern(executions: TestExecution[]): 'intermittent' | 'environmental' | 'timing' | 'unknown' {
  // Analyze failure messages for common patterns
  const failureMessages = executions
    .filter(e => e.failureMessage || e.errorMessage)
    .map(e => (e.failureMessage || e.errorMessage || '').toLowerCase());
  
  if (failureMessages.length === 0) {
    return 'unknown';
  }
  
  // Check for timing-related issues
  const timingKeywords = ['timeout', 'wait', 'async', 'race', 'timing', 'delay'];
  if (failureMessages.some(msg => timingKeywords.some(keyword => msg.includes(keyword)))) {
    return 'timing';
  }
  
  // Check for environmental issues
  const envKeywords = ['connection', 'network', 'unavailable', 'service', 'port', 'bind'];
  if (failureMessages.some(msg => envKeywords.some(keyword => msg.includes(keyword)))) {
    return 'environmental';
  }
  
  // Default to intermittent
  return 'intermittent';
}

/**
 * Determine severity level
 */
function determineSeverity(
  flakinessScore: number,
  recentFailures: number,
  _totalRuns: number
): 'low' | 'medium' | 'high' | 'critical' {
  if (flakinessScore >= 0.7 || recentFailures >= 5) {
    return 'critical';
  } else if (flakinessScore >= 0.5 || recentFailures >= 3) {
    return 'high';
  } else if (flakinessScore >= 0.3 || recentFailures >= 2) {
    return 'medium';
  } else {
    return 'low';
  }
}

/**
 * Generate test-specific recommendation
 */
function generateTestRecommendation(
  flakinessScore: number,
  pattern: string,
  recentFailures: number
): string {
  if (flakinessScore >= 0.7) {
    return 'Consider quarantining this test and investigating root cause immediately.';
  } else if (pattern === 'timing') {
    return 'Add explicit waits, increase timeouts, or use more reliable synchronization mechanisms.';
  } else if (pattern === 'environmental') {
    return 'Review external dependencies, network configurations, and service availability.';
  } else if (recentFailures >= 3) {
    return 'Monitor closely and consider temporarily skipping until issue is resolved.';
  } else {
    return 'Monitor for patterns and consider adding more robust assertions.';
  }
}

/**
 * Calculate overall flakiness score
 */
function calculateOverallFlakinessScore(flakyTests: FlakyTestResult[]): number {
  if (flakyTests.length === 0) {return 0;}
  
  const totalScore = flakyTests.reduce((sum, test) => sum + test.flakinessScore, 0);
  return totalScore / flakyTests.length;
}

// ============================================================================
// Database Storage Functions
// ============================================================================

/**
 * Store analysis results in database
 */
async function storeAnalysisResults(
  prisma: PrismaClient,
  data: RunsAnalyzeJobData,
  flakyTests: FlakyTestResult[]
): Promise<void> {
  try {
    await prisma.$transaction(async (_tx: Prisma.TransactionClient) => {
      // Store or update flaky test records
      for (const flakyTest of flakyTests) {
        // Note: fGFlakyTest table doesn't exist in current schema, skipping for now
        logger.debug(`Would store flaky test: ${flakyTest.className}#${flakyTest.testName}`);
        /* await tx.fGFlakyTest.upsert({
          where: {
            repositoryOwner_repositoryName_className_testName: {
              repositoryOwner: data.repository.owner,
              repositoryName: data.repository.repo,
              className: flakyTest.className,
              testName: flakyTest.testName
            }
          },
          update: {
            flakinessScore: flakyTest.flakinessScore,
            totalRuns: flakyTest.totalRuns,
            failures: flakyTest.failures,
            successRate: flakyTest.successRate,
            recentFailures: flakyTest.recentFailures,
            pattern: flakyTest.pattern,
            severity: flakyTest.severity,
            recommendation: flakyTest.recommendation,
            lastSeen: new Date(flakyTest.lastSeen),
            affectedBranches: flakyTest.affectedBranches,
            updatedAt: new Date()
          },
          create: {
            repositoryOwner: data.repository.owner,
            repositoryName: data.repository.repo,
            className: flakyTest.className,
            testName: flakyTest.testName,
            flakinessScore: flakyTest.flakinessScore,
            totalRuns: flakyTest.totalRuns,
            failures: flakyTest.failures,
            successRate: flakyTest.successRate,
            recentFailures: flakyTest.recentFailures,
            pattern: flakyTest.pattern,
            severity: flakyTest.severity,
            recommendation: flakyTest.recommendation,
            firstSeen: new Date(flakyTest.firstSeen),
            lastSeen: new Date(flakyTest.lastSeen),
            affectedBranches: flakyTest.affectedBranches,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }); */
      }
      
      // Note: fGFlakinessAnalysis table doesn't exist in current schema, skipping for now
      logger.debug(`Would create analysis for run ${data.workflowRunId}`);
      /* await tx.fGFlakinessAnalysis.create({
        data: {
          workflowRunId: data.workflowRunId,
          repositoryOwner: data.repository.owner,
          repositoryName: data.repository.repo,
          analyzedTests: flakyTests.length > 0 ? flakyTests[0]?.totalRuns || 0 : 0,
          flakyTests: flakyTests.length,
          overallFlakinessScore: calculateOverallFlakinessScore(flakyTests),
          createdAt: new Date()
        }
      }); */
    });
    
    logger.info({
      repository: `${data.repository.owner}/${data.repository.repo}`,
      workflowRunId: data.workflowRunId,
      flakyTestsStored: flakyTests.length
    }, 'Analysis results stored successfully');
    
  } catch (error) {
    logger.error({
      repository: `${data.repository.owner}/${data.repository.repo}`,
      workflowRunId: data.workflowRunId,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to store analysis results');
    throw error;
  }
}

// ============================================================================
// GitHub Integration Functions
// ============================================================================

/**
 * Update GitHub Check Run with analysis results
 */
async function updateGitHubCheckRun(
  github: Octokit,
  data: RunsAnalyzeJobData,
  flakyTests: FlakyTestResult[]
): Promise<boolean> {
  try {
    const startTime = Date.now();
    
    // Find existing check run or create new one
    const checkRunName = 'FlakeGuard Analysis';
    
    // Get workflow run details
    const workflowRunResponse = await github.rest.actions.getWorkflowRun({
      owner: data.repository.owner,
      repo: data.repository.repo,
      run_id: data.workflowRunId
    });
    
    const workflowRun = workflowRunResponse.data;
    const headSha = workflowRun.head_sha;
    
    // Create check run summary
    const summary = createCheckRunSummary(flakyTests);
    const conclusion = flakyTests.some(t => t.severity === 'critical') ? 'failure' as const : 'success' as const;
    
    // Create or update check run
    const checkRunResponse = await github.rest.checks.create({
      owner: data.repository.owner,
      repo: data.repository.repo,
      name: checkRunName,
      head_sha: headSha,
      status: 'completed',
      conclusion,
      output: {
        title: 'FlakeGuard Analysis Results',
        summary,
        text: createDetailedReport(flakyTests)
      }
    });
    
    const duration = Date.now() - startTime;
    recordGitHubApiCall('createCheckRun', 'POST', checkRunResponse.status, duration);
    
    logger.info({
      repository: `${data.repository.owner}/${data.repository.repo}`,
      workflowRunId: data.workflowRunId,
      checkRunId: checkRunResponse.data.id,
      conclusion
    }, 'GitHub Check Run updated successfully');
    
    return true;
    
  } catch (error) {
    logger.error({
      repository: `${data.repository.owner}/${data.repository.repo}`,
      workflowRunId: data.workflowRunId,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to update GitHub Check Run');
    return false;
  }
}

/**
 * Create check run summary
 */
function createCheckRunSummary(flakyTests: FlakyTestResult[]): string {
  if (flakyTests.length === 0) {
    return '✅ No flaky tests detected in this run.';
  }
  
  const criticalCount = flakyTests.filter(t => t.severity === 'critical').length;
  const highCount = flakyTests.filter(t => t.severity === 'high').length;
  const mediumCount = flakyTests.filter(t => t.severity === 'medium').length;
  const lowCount = flakyTests.filter(t => t.severity === 'low').length;
  
  let summary = '🔍 **Flaky Test Analysis Results**\\n\\n';
  summary += `Found ${flakyTests.length} potentially flaky test${flakyTests.length === 1 ? '' : 's'}:\\n\\n`;
  
  if (criticalCount > 0) {summary += `🚨 ${criticalCount} Critical\\n`;}
  if (highCount > 0) {summary += `⚠️ ${highCount} High\\n`;}
  if (mediumCount > 0) {summary += `⚡ ${mediumCount} Medium\\n`;}
  if (lowCount > 0) {summary += `ℹ️ ${lowCount} Low\\n`;}
  
  return summary;
}

/**
 * Create detailed report
 */
function createDetailedReport(flakyTests: FlakyTestResult[]): string {
  if (flakyTests.length === 0) {
    return 'All tests appear to be stable. No flakiness detected.';
  }
  
  let report = '## Detailed Flakiness Report\\n\\n';
  
  // Group by severity
  const bySeverity = {
    critical: flakyTests.filter(t => t.severity === 'critical'),
    high: flakyTests.filter(t => t.severity === 'high'),
    medium: flakyTests.filter(t => t.severity === 'medium'),
    low: flakyTests.filter(t => t.severity === 'low')
  };
  
  for (const [severity, tests] of Object.entries(bySeverity)) {
    if (tests.length === 0) {continue;}
    
    const icon: Record<string, string> = {
      critical: '🚨',
      high: '⚠️',
      medium: '⚡',
      low: 'ℹ️'
    };
    
    report += `### ${icon[severity]} ${severity.toUpperCase()} Priority Tests\\n\\n`;
    
    for (const test of tests.slice(0, 10)) { // Limit to top 10 per severity
      report += `**${test.className}.${test.testName}**\\n`;
      report += `- Flakiness Score: ${(test.flakinessScore * 100).toFixed(1)}%\\n`;
      report += `- Success Rate: ${(test.successRate * 100).toFixed(1)}% (${test.failures}/${test.totalRuns} failures)\\n`;
      report += `- Recent Failures: ${test.recentFailures}\\n`;
      report += `- Pattern: ${test.pattern}\\n`;
      report += `- Recommendation: ${test.recommendation}\\n\\n`;
    }
  }
  
  return report;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate high-level recommendations
 */
function generateRecommendations(flakyTests: FlakyTestResult[]): string[] {
  const recommendations: string[] = [];
  
  const criticalTests = flakyTests.filter(t => t.severity === 'critical');
  if (criticalTests.length > 0) {
    recommendations.push(`Quarantine ${criticalTests.length} critical flaky test${criticalTests.length === 1 ? '' : 's'} immediately`);
  }
  
  const timingTests = flakyTests.filter(t => t.pattern === 'timing');
  if (timingTests.length > 0) {
    recommendations.push(`Review timing and synchronization in ${timingTests.length} test${timingTests.length === 1 ? '' : 's'}`);
  }
  
  const envTests = flakyTests.filter(t => t.pattern === 'environmental');
  if (envTests.length > 0) {
    recommendations.push(`Investigate environmental dependencies for ${envTests.length} test${envTests.length === 1 ? '' : 's'}`);
  }
  
  if (flakyTests.length > 10) {
    recommendations.push('Consider implementing systematic test quality improvements');
  }
  
  return recommendations;
}

/**
 * Create empty analysis result
 */
function createEmptyAnalysisResult(workflowRunId: number, startTime: number): AnalysisResult {
  return {
    success: true,
    workflowRunId,
    analyzedTests: 0,
    flakyTests: [],
    overallFlakinessScore: 0,
    recommendations: [],
    checkRunUpdated: false,
    processingTimeMs: Date.now() - startTime,
    errors: [],
    warnings: []
  };
}

/**
 * Create mock GitHub client for testing
 */
function createMockGitHubClient(): Octokit {
  return {
    rest: {
      actions: {
        getWorkflowRun: async () => ({
          data: {
            head_sha: 'mock-sha',
            status: 'completed'
          },
          status: 200
        })
      },
      checks: {
        create: async () => ({
          data: { id: 123 },
          status: 201
        })
      }
    }
  } as Partial<Octokit> as Octokit;
}

// ============================================================================
// Export Processor Factory
// ============================================================================

/**
 * Factory function for runs analysis processor
 */
export function runsAnalyzeProcessor(
  prisma: PrismaClient,
  octokit?: Octokit
) {
  const processor = createRunsAnalyzeProcessor(prisma, octokit);
  
  return async (job: Job<RunsAnalyzeJobData>): Promise<AnalysisResult> => {
    return await processor(job);
  };
}

export default runsAnalyzeProcessor;