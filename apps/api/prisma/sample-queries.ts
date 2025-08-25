#!/usr/bin/env tsx

/**
 * Sample queries demonstrating FlakeGuard data model capabilities
 * These queries show how to efficiently find flaky tests, analyze patterns,
 * and perform quarantine operations using the comprehensive indexes
 */

import { PrismaClient } from '@prisma/client';
import type { FGRepository, FGTestCase } from '@prisma/client';

const prisma = new PrismaClient();

// Utility types for query results
interface FlakiestTest {
  testCase: FGTestCase & { repository: FGRepository };
  flakeScore: { score: number; windowN: number; lastUpdatedAt: Date };
  recentFailures: number;
  totalRuns: number;
  lastFailureAt: Date | null;
}

interface TestHistory {
  testId: string;
  testName: string;
  occurrences: Array<{
    runId: string;
    status: string;
    durationMs: number | null;
    createdAt: Date;
    failureMessage: string | null;
  }>;
}

interface FailureCluster {
  id: string;
  failureMsgSignature: string;
  exampleMessage: string | null;
  occurrenceCount: number;
  affectedTestCount: number;
  testCases: Array<{
    id: string;
    name: string;
    suite: string;
    flakeScore: number;
  }>;
}

interface TestCaseWithScore {
  id: string;
  name: string;
  suite: string;
  flakeScore: {
    score: number;
  } | null;
}

interface FailureClusterWithTestCases {
  id: string;
  failureMsgSignature: string;
  exampleMessage: string | null;
  occurrenceCount: number;
  testIds: string[];
  testCases: TestCaseWithScore[];
}

class FlakeGuardQueries {
  
  /**
   * Find the flakiest tests in a repository
   * Uses critical indexes: (repoId, suite, className, name) and (score)
   */
  async findFlakiestTests(
    repoId: string, 
    limit: number = 10,
    minScore: number = 0.1
  ): Promise<FlakiestTest[]> {
    // Finding flakiest tests in repository
    
    const results = await prisma.fGTestCase.findMany({
      where: {
        repoId,
        flakeScore: {
          score: { gte: minScore }
        }
      },
      include: {
        repository: true,
        flakeScore: true,
        occurrences: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          where: { status: 'failed' }
        },
        _count: {
          select: {
            occurrences: true,
          }
        }
      },
      orderBy: {
        flakeScore: {
          score: 'desc'
        }
      },
      take: limit,
    });

    return results.map(test => ({
      testCase: { ...test, repository: test.repository },
      flakeScore: test.flakeScore || { score: 0, windowN: 0, lastUpdatedAt: new Date() },
      recentFailures: test.occurrences.length,
      totalRuns: test._count.occurrences,
      lastFailureAt: test.occurrences[0]?.createdAt || null,
    }));
  }

  /**
   * Get comprehensive test history and failure patterns
   * Uses index: (testId, createdAt) for efficient time-series queries
   */
  async getTestHistory(
    testId: string, 
    days: number = 30
  ): Promise<TestHistory> {
    // Getting test history
    
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const testCase = await prisma.fGTestCase.findUniqueOrThrow({
      where: { id: testId },
      select: { id: true, name: true, suite: true, className: true }
    });

    const occurrences = await prisma.fGOccurrence.findMany({
      where: {
        testId,
        createdAt: { gte: since }
      },
      select: {
        runId: true,
        status: true,
        durationMs: true,
        createdAt: true,
        failureMessage: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    return {
      testId,
      testName: `${testCase.suite}/${testCase.className || ''}/${testCase.name}`.replace('//', '/'),
      occurrences,
    };
  }

  /**
   * Check quarantine status and get decision history
   * Uses indexes: (testId) and (state)
   */
  async getQuarantineStatus(testId: string) {
    // Checking quarantine status
    
    const decisions = await prisma.fGQuarantineDecision.findMany({
      where: { testId },
      orderBy: { createdAt: 'desc' },
      include: {
        testCase: {
          select: {
            name: true,
            suite: true,
            className: true,
            repository: { select: { owner: true, name: true } }
          }
        }
      }
    });

    const currentDecision = decisions[0];
    const isQuarantined = currentDecision?.state === 'ACTIVE';
    const isExpired = currentDecision?.until && currentDecision.until < new Date();
    
    return {
      isQuarantined: isQuarantined && !isExpired,
      currentState: currentDecision?.state || 'NONE',
      expiresAt: currentDecision?.until,
      rationale: currentDecision?.rationale,
      decidedBy: currentDecision?.byUser,
      history: decisions,
    };
  }

  /**
   * Find tests with similar failure patterns using clustering
   * Uses critical index: (failureMsgSignature, repoId)
   */
  async findSimilarFailures(
    repoId: string,
    failureMsgSignature: string
  ): Promise<FailureCluster> {
    // Finding similar failures for signature
    
    const cluster = await prisma.fGFailureCluster.findUniqueOrThrow({
      where: {
        repoId_failureMsgSignature: {
          repoId,
          failureMsgSignature
        }
      },
      include: {
        testCases: {
          select: {
            id: true,
            name: true,
            suite: true,
            flakeScore: {
              select: { score: true }
            }
          }
        }
      }
    }) as FailureClusterWithTestCases;

    return {
      id: cluster.id,
      failureMsgSignature: cluster.failureMsgSignature,
      exampleMessage: cluster.exampleMessage,
      occurrenceCount: cluster.occurrenceCount,
      affectedTestCount: cluster.testIds.length,
      testCases: cluster.testCases.map((tc) => ({
        id: tc.id,
        name: tc.name,
        suite: tc.suite,
        flakeScore: tc.flakeScore?.score || 0,
      })),
    };
  }

  /**
   * Get repository dashboard data with performance metrics
   * Uses multiple indexes for efficient aggregation
   */
  async getRepositoryDashboard(repoId: string) {
    // Getting repository dashboard data
    
    const [
      repo,
      testCount,
      flakyTestCount,
      quarantinedTestCount,
      recentRunCount,
      failureClusterCount
    ] = await Promise.all([
      // Repository info
      prisma.fGRepository.findUniqueOrThrow({
        where: { id: repoId },
        select: { owner: true, name: true, provider: true }
      }),
      
      // Total test count
      prisma.fGTestCase.count({
        where: { repoId }
      }),
      
      // Flaky test count (score > 0.3)
      prisma.fGFlakeScore.count({
        where: {
          testCase: { repoId },
          score: { gt: 0.3 }
        }
      }),
      
      // Currently quarantined tests
      prisma.fGQuarantineDecision.count({
        where: {
          testCase: { repoId },
          state: 'ACTIVE',
          OR: [
            { until: null },
            { until: { gt: new Date() } }
          ]
        }
      }),
      
      // Recent runs (last 7 days)
      prisma.fGWorkflowRun.count({
        where: {
          repoId,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      }),
      
      // Failure cluster count
      prisma.fGFailureCluster.count({
        where: { repoId }
      })
    ]);

    return {
      repository: repo,
      metrics: {
        totalTests: testCount,
        flakyTests: flakyTestCount,
        quarantinedTests: quarantinedTestCount,
        recentRuns: recentRunCount,
        failureClusters: failureClusterCount,
        flakinessTrend: ((flakyTestCount / Math.max(testCount, 1)) * 100).toFixed(1) + '%',
      }
    };
  }

  /**
   * Performance-optimized query for test run analysis
   * Uses compound indexes for efficient filtering and sorting
   */
  async analyzeTestRunPerformance(repoId: string, days: number = 7) {
    // Analyzing test run performance
    
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    // Use raw SQL for complex aggregation with proper index utilization
    const results = await prisma.$queryRaw<Array<{
      testId: string;
      testName: string;
      suite: string;
      totalRuns: bigint;
      failures: bigint;
      avgDurationMs: number;
      maxDurationMs: number;
      flakeScore: number;
    }>>`
      SELECT 
        tc.id as "testId",
        tc.name as "testName", 
        tc.suite,
        COUNT(o.id) as "totalRuns",
        COUNT(CASE WHEN o.status = 'failed' THEN 1 END) as "failures",
        AVG(o."durationMs") as "avgDurationMs",
        MAX(o."durationMs") as "maxDurationMs",
        COALESCE(fs.score, 0) as "flakeScore"
      FROM "FGTestCase" tc
      LEFT JOIN "FGOccurrence" o ON tc.id = o."testId" 
        AND o."createdAt" >= ${since}
      LEFT JOIN "FGFlakeScore" fs ON tc.id = fs."testId"
      WHERE tc."repoId" = ${repoId}
      GROUP BY tc.id, tc.name, tc.suite, fs.score
      HAVING COUNT(o.id) > 0
      ORDER BY "flakeScore" DESC, "totalRuns" DESC
      LIMIT 50;
    `;

    return results.map(row => ({
      ...row,
      totalRuns: Number(row.totalRuns),
      failures: Number(row.failures),
      failureRate: Number(row.failures) / Number(row.totalRuns),
      avgDurationMs: Math.round(row.avgDurationMs),
    }));
  }

  /**
   * Identify tests that need quarantine action
   * Combines flakiness scoring with recent failure patterns
   */
  async getQuarantineCandidates(
    repoId: string,
    scoreThreshold: number = 0.6,
    minRuns: number = 10
  ) {
    // Finding quarantine candidates
    
    const candidates = await prisma.fGTestCase.findMany({
      where: {
        repoId,
        flakeScore: {
          score: { gte: scoreThreshold },
          windowN: { gte: minRuns }
        },
        // Not already quarantined
        quarantineDecisions: {
          none: {
            state: 'ACTIVE',
            OR: [
              { until: null },
              { until: { gt: new Date() } }
            ]
          }
        }
      },
      include: {
        flakeScore: true,
        repository: { select: { owner: true, name: true } },
        occurrences: {
          where: {
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            status: 'failed'
          },
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
            failureMessage: true,
            runId: true
          }
        },
        _count: {
          select: {
            occurrences: {
              where: {
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
              }
            }
          }
        }
      },
      orderBy: {
        flakeScore: { score: 'desc' }
      }
    });

    return candidates.map(test => ({
      testId: test.id,
      testName: `${test.suite}/${test.className || ''}/${test.name}`.replace('//', '/'),
      repository: `${test.repository.owner}/${test.repository.name}`,
      flakeScore: test.flakeScore?.score || 0,
      windowSize: test.flakeScore?.windowN || 0,
      recentRuns: test._count.occurrences,
      recentFailures: test.occurrences,
      recommendation: (test.flakeScore?.score || 0) > 0.8 ? 'IMMEDIATE' : 'REVIEW',
      rationale: `Test shows ${((test.flakeScore?.score || 0) * 100).toFixed(1)}% failure rate over ${test.flakeScore?.windowN || 0} runs. ${test.occurrences.length} recent failures in the last 7 days.`
    }));
  }
}

// Example usage and demonstration
/* eslint-disable no-console */
async function runExampleQueries() {
  const queries = new FlakeGuardQueries();
  
  try {
    console.log('🚀 Running FlakeGuard sample queries...\n');

    // Get all repositories first
    const repos = await prisma.fGRepository.findMany({
      select: { id: true, owner: true, name: true }
    });

    if (repos.length === 0) {
      console.log('No repositories found. Please run the seed script first.');
      return;
    }

    const firstRepo = repos[0];
    console.log(`Using repository: ${firstRepo.owner}/${firstRepo.name}\n`);

    // 1. Find flakiest tests
    console.log('=== FLAKIEST TESTS ===');
    const flakyTests = await queries.findFlakiestTests(firstRepo.id, 5);
    flakyTests.forEach((test, i) => {
      console.log(`${i + 1}. ${test.testCase.name}`);
      console.log(`   Suite: ${test.testCase.suite}`);
      console.log(`   Flake Score: ${(test.flakeScore.score * 100).toFixed(1)}%`);
      console.log(`   Total Runs: ${test.totalRuns}`);
      console.log(`   Last Failure: ${test.lastFailureAt?.toISOString().split('T')[0] || 'Never'}`);
      console.log('');
    });

    // 2. Get repository dashboard
    console.log('=== REPOSITORY DASHBOARD ===');
    const dashboard = await queries.getRepositoryDashboard(firstRepo.id);
    console.log(`Repository: ${dashboard.repository.owner}/${dashboard.repository.name}`);
    console.log(`Total Tests: ${dashboard.metrics.totalTests}`);
    console.log(`Flaky Tests: ${dashboard.metrics.flakyTests}`);
    console.log(`Quarantined Tests: ${dashboard.metrics.quarantinedTests}`);
    console.log(`Recent Runs (7d): ${dashboard.metrics.recentRuns}`);
    console.log(`Failure Clusters: ${dashboard.metrics.failureClusters}`);
    console.log(`Flakiness Trend: ${dashboard.metrics.flakinessTrend}\n`);

    // 3. Get quarantine candidates
    console.log('=== QUARANTINE CANDIDATES ===');
    const candidates = await queries.getQuarantineCandidates(firstRepo.id, 0.5, 5);
    if (candidates.length > 0) {
      candidates.forEach((candidate, i) => {
        console.log(`${i + 1}. ${candidate.testName}`);
        console.log(`   Score: ${(candidate.flakeScore * 100).toFixed(1)}% (${candidate.windowSize} runs)`);
        console.log(`   Recommendation: ${candidate.recommendation}`);
        console.log(`   Recent Activity: ${candidate.recentRuns} runs, ${candidate.recentFailures.length} failures`);
        console.log('');
      });
    } else {
      console.log('No quarantine candidates found.\n');
    }

    // 4. Analyze performance
    console.log('=== PERFORMANCE ANALYSIS ===');
    const performance = await queries.analyzeTestRunPerformance(firstRepo.id, 7);
    console.log(`Top ${Math.min(5, performance.length)} tests by activity:`);
    performance.slice(0, 5).forEach((test, i) => {
      console.log(`${i + 1}. ${test.testName}`);
      console.log(`   Runs: ${test.totalRuns}, Failures: ${test.failures} (${(test.failureRate * 100).toFixed(1)}%)`);
      console.log(`   Avg Duration: ${test.avgDurationMs}ms, Max: ${test.maxDurationMs}ms`);
      console.log(`   Flake Score: ${(test.flakeScore * 100).toFixed(1)}%`);
      console.log('');
    });

    console.log('✅ Sample queries completed successfully!');

  } catch (error) {
    console.error('❌ Query execution failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  void runExampleQueries();
}

export { FlakeGuardQueries, runExampleQueries };