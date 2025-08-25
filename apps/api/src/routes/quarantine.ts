import type {
  QuarantinePlanResponse,
  QuarantinePlan,
  QuarantineCandidate,
  TestRun,
} from '@flakeguard/shared';
import { DEFAULT_QUARANTINE_POLICY } from '@flakeguard/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { FlakinessScorer } from '../analytics/flakiness.js';

const quarantinePlanRequestSchema = z.object({
  repositoryId: z.string(),
  policy: z.object({
    warnThreshold: z.number().min(0).max(1).optional(),
    quarantineThreshold: z.number().min(0).max(1).optional(),
    minRunsForQuarantine: z.number().int().min(1).optional(),
    minRecentFailures: z.number().int().min(1).optional(),
    lookbackDays: z.number().int().min(1).optional(),
    rollingWindowSize: z.number().int().min(10).optional(),
  }).optional(),
  lookbackDays: z.number().int().min(1).max(90).optional(),
  includeAnnotations: z.boolean().optional().default(true),
});

const quarantineCandidateSchema = z.object({
  testName: z.string(),
  testFullName: z.string(),
  flakeScore: z.object({
    testName: z.string(),
    testFullName: z.string(),
    score: z.number(),
    confidence: z.number(),
    features: z.object({
      failSuccessRatio: z.number(),
      rerunPassRate: z.number(),
      failureClustering: z.number(),
      intermittencyScore: z.number(),
      messageSignatureVariance: z.number(),
      totalRuns: z.number(),
      recentFailures: z.number(),
      consecutiveFailures: z.number(),
      maxConsecutiveFailures: z.number(),
      daysSinceFirstSeen: z.number(),
      avgTimeBetweenFailures: z.number(),
    }),
    recommendation: z.object({
      action: z.enum(['none', 'warn', 'quarantine']),
      reason: z.string(),
      confidence: z.number(),
      priority: z.enum(['low', 'medium', 'high', 'critical']),
    }),
    lastUpdated: z.date(),
  }),
  rationale: z.string(),
  suggestedAnnotation: z.string(),
  repositoryId: z.string(),
  lastFailures: z.array(z.object({
    testName: z.string(),
    testFullName: z.string(),
    status: z.enum(['passed', 'failed', 'skipped', 'error']),
    message: z.string().optional(),
    stack: z.string().optional(),
    duration: z.number(),
    attempt: z.number(),
    runId: z.string(),
    createdAt: z.date(),
  })),
});

const quarantinePlanResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    repositoryId: z.string(),
    candidates: z.array(quarantineCandidateSchema),
    summary: z.object({
      totalCandidates: z.number(),
      highPriority: z.number(),
      mediumPriority: z.number(),
      lowPriority: z.number(),
    }),
    generatedAt: z.date(),
  }).optional(),
  error: z.string().optional(),
  processedAt: z.date(),
  metricsCount: z.number(),
});

export async function quarantineRoutes(fastify: FastifyInstance) {
  // POST /v1/quarantine/plan - Generate quarantine plan for repository
  fastify.post('/plan', {
    schema: {
      description: 'Generate quarantine plan for flaky tests in a repository',
      tags: ['Quarantine'],
      body: quarantinePlanRequestSchema,
      response: {
        200: quarantinePlanResponseSchema,
        400: z.object({
          statusCode: z.number(),
          error: z.string(),
          message: z.string(),
        }),
        404: z.object({
          statusCode: z.number(),
          error: z.string(),
          message: z.string(),
        }),
      },
    },
  }, async (request: any, reply: any) => {
    const startTime = Date.now();
    
    try {
      const requestData = quarantinePlanRequestSchema.parse(request.body);
      const { repositoryId, policy, lookbackDays, includeAnnotations } = requestData;

      // Verify repository exists
      const repository = await fastify.prisma.repository.findUnique({
        where: { id: repositoryId },
        select: { id: true, fullName: true },
      });

      if (!repository) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Repository with ID ${repositoryId} not found`,
        });
      }

      // Initialize flakiness scorer with policy
      const scorer = new FlakinessScorer(policy || {});

      // Query test results for analysis
      const testResults = await fetchTestResultsForAnalysis(
        fastify,
        repositoryId,
        lookbackDays || DEFAULT_QUARANTINE_POLICY.lookbackDays
      );

      // Group test results by test name
      const testGroups = groupTestResultsByName(testResults);

      // Generate quarantine candidates
      const candidates: QuarantineCandidate[] = [];
      
      for (const [testFullName, runs] of testGroups) {
        try {
          const flakeScore = scorer.computeFlakeScore(runs);
          
          if (flakeScore.recommendation.action === 'warn' || flakeScore.recommendation.action === 'quarantine') {
            const candidate = await buildQuarantineCandidate(
              testFullName,
              runs,
              flakeScore,
              repositoryId,
              repository.fullName,
              includeAnnotations
            );
            candidates.push(candidate);
          }
        } catch (error) {
          fastify.log.warn({ error, testFullName }, 'Failed to compute flake score for test');
        }
      }

      // Sort candidates by priority and score
      candidates.sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const aPriority = priorityOrder[a.flakeScore.recommendation.priority];
        const bPriority = priorityOrder[b.flakeScore.recommendation.priority];
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }
        
        return b.flakeScore.score - a.flakeScore.score;
      });

      // Generate summary
      const summary = {
        totalCandidates: candidates.length,
        highPriority: candidates.filter(c => c.flakeScore.recommendation.priority === 'high' || c.flakeScore.recommendation.priority === 'critical').length,
        mediumPriority: candidates.filter(c => c.flakeScore.recommendation.priority === 'medium').length,
        lowPriority: candidates.filter(c => c.flakeScore.recommendation.priority === 'low').length,
      };

      const plan: QuarantinePlan = {
        repositoryId,
        candidates,
        summary,
        generatedAt: new Date(),
      };

      const response: QuarantinePlanResponse = {
        success: true,
        data: plan,
        processedAt: new Date(),
        metricsCount: testGroups.size,
      };

      const duration = Date.now() - startTime;
      fastify.log.info({ 
        repositoryId, 
        candidatesCount: candidates.length, 
        metricsCount: testGroups.size,
        duration,
      }, 'Generated quarantine plan');

      return reply.send(response);

    } catch (error) {
      const duration = Date.now() - startTime;
      fastify.log.error({ error, duration }, 'Failed to generate quarantine plan');

      const response: QuarantinePlanResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        processedAt: new Date(),
        metricsCount: 0,
      };

      return reply.status(400).send(response);
    }
  });

  // GET /v1/quarantine/policy - Get default quarantine policy
  fastify.get('/policy', {
    schema: {
      description: 'Get default quarantine policy configuration',
      tags: ['Quarantine'],
      response: {
        200: z.object({
          warnThreshold: z.number(),
          quarantineThreshold: z.number(),
          minRunsForQuarantine: z.number(),
          minRecentFailures: z.number(),
          lookbackDays: z.number(),
          rollingWindowSize: z.number(),
        }),
      },
    },
  }, async (request: any, reply: any) => {
    return reply.send(DEFAULT_QUARANTINE_POLICY);
  });
}

/**
 * Fetch test results for flakiness analysis
 */
async function fetchTestResultsForAnalysis(
  fastify: FastifyInstance,
  repositoryId: string,
  lookbackDays: number
): Promise<TestRun[]> {
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const results = await fastify.prisma.testResult.findMany({
    where: {
      repositoryId,
      createdAt: {
        gte: cutoffDate,
      },
    },
    select: {
      testFullName: true,
      name: true,
      status: true,
      message: true,
      stack: true,
      time: true,
      attempt: true,
      runId: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return results.map(result => ({
    testName: result.name,
    testFullName: result.testFullName,
    status: result.status as TestRun['status'],
    message: result.message || undefined,
    stack: result.stack || undefined,
    duration: result.time,
    attempt: result.attempt,
    runId: result.runId,
    createdAt: result.createdAt,
  }));
}

/**
 * Group test results by test name
 */
function groupTestResultsByName(results: TestRun[]): Map<string, TestRun[]> {
  const groups = new Map<string, TestRun[]>();
  
  for (const result of results) {
    const key = result.testFullName;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(result);
  }
  
  return groups;
}

/**
 * Build a quarantine candidate with rationale and annotations
 */
async function buildQuarantineCandidate(
  testFullName: string,
  runs: TestRun[],
  flakeScore: any,
  repositoryId: string,
  repositoryFullName: string,
  includeAnnotations: boolean
): Promise<QuarantineCandidate> {
  const testName = runs[0].testName;
  
  // Get the most recent failures for context
  const recentFailures = runs
    .filter(run => run.status === 'failed' || run.status === 'error')
    .slice(0, 5); // Last 5 failures

  // Generate rationale
  const rationale = generateRationale(flakeScore, runs.length, recentFailures.length);

  // Generate suggested PR annotation
  const suggestedAnnotation = includeAnnotations ? 
    generatePRAnnotation(testName, testFullName, flakeScore, repositoryFullName) : '';

  return {
    testName,
    testFullName,
    flakeScore,
    rationale,
    suggestedAnnotation,
    repositoryId,
    lastFailures: recentFailures,
  };
}

/**
 * Generate human-readable rationale for quarantine recommendation
 */
function generateRationale(flakeScore: any, totalRuns: number, recentFailures: number): string {
  const { score, features, recommendation } = flakeScore;
  const { failSuccessRatio, rerunPassRate, intermittencyScore } = features;
  
  const parts: string[] = [];
  
  // Main score and action
  parts.push(`Flakiness score: ${(score * 100).toFixed(1)}% (${recommendation.action})`);
  
  // Key evidence
  if (rerunPassRate > 0.3) {
    parts.push(`${(rerunPassRate * 100).toFixed(1)}% of retries pass (indicating flaky behavior)`);
  }
  
  if (intermittencyScore > 0.4) {
    parts.push(`${(intermittencyScore * 100).toFixed(1)}% state transitions (pass/fail alternating)`);
  }
  
  if (failSuccessRatio > 0.2) {
    parts.push(`${(failSuccessRatio * 100).toFixed(1)}% failure rate over ${totalRuns} runs`);
  }
  
  parts.push(`${recentFailures} recent failures requiring attention`);
  
  return parts.join('. ');
}

/**
 * Generate PR annotation markdown for quarantine suggestions
 */
function generatePRAnnotation(
  testName: string,
  testFullName: string,
  flakeScore: any,
  repositoryFullName: string
): string {
  const { score, recommendation, features } = flakeScore;
  const action = recommendation.action === 'quarantine' ? '🚫 QUARANTINE' : '⚠️ WARNING';
  const priority = recommendation.priority.toUpperCase();
  
  const annotation = `## ${action} - Flaky Test Detected (${priority} Priority)

**Test:** \`${testName}\`  
**Full Name:** \`${testFullName}\`  
**Repository:** ${repositoryFullName}

### 📊 Flakiness Analysis
- **Score:** ${(score * 100).toFixed(1)}% flaky
- **Confidence:** ${(recommendation.confidence * 100).toFixed(1)}%
- **Recommendation:** ${recommendation.action.toUpperCase()}

### 🔍 Evidence
- **Failure Rate:** ${(features.failSuccessRatio * 100).toFixed(1)}% of ${features.totalRuns} recent runs
- **Retry Success:** ${(features.rerunPassRate * 100).toFixed(1)}% of retries pass
- **Intermittency:** ${(features.intermittencyScore * 100).toFixed(1)}% pass/fail transitions
- **Recent Failures:** ${features.recentFailures} in last ${DEFAULT_QUARANTINE_POLICY.lookbackDays} days

### 📝 Recommended Actions
${recommendation.action === 'quarantine' ? 
  '1. **Quarantine this test** to prevent CI/CD disruption\n2. Investigate root cause of flaky behavior\n3. Fix or refactor the test\n4. Remove quarantine once stabilized' :
  '1. **Monitor this test** for continued flaky behavior\n2. Consider investigating if failures increase\n3. Review test design for timing or dependency issues'
}

### 🤖 Analysis Details
**Reason:** ${recommendation.reason}

---
*This analysis was generated by FlakeGuard. [Learn more about flaky test detection](https://github.com/flakeguard/docs).*`;

  return annotation;
}