/**
 * FlakeGuard Analysis Service
 * 
 * Comprehensive service for flakiness detection, scoring, and quarantine management.
 * Demonstrates proper usage of the FlakeGuard data model with efficient queries.
 */

import { createHash } from 'crypto';

import { PrismaClient } from '@prisma/client';
import type { 
  FGTestCase,
  FGQuarantineDecision,
  FGFailureCluster
} from '@prisma/client';

export interface FlakeAnalysisConfig {
  windowSize: number; // Number of recent runs to analyze
  warnThreshold: number; // Score threshold for warnings (0.3)
  quarantineThreshold: number; // Score threshold for quarantine (0.6)
  minOccurrences: number; // Minimum runs required for analysis
  retryWeightMultiplier: number; // Extra weight for tests that fail then pass on retry
}

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
  recommendation: 'STABLE' | 'MONITOR' | 'QUARANTINE';
}

export interface QuarantineProposal {
  testId: string;
  testName: string;
  score: number;
  rationale: string;
  suggestedUntil: Date | null;
  impactAssessment: {
    affectedJobs: string[];
    ownerTeam: string | null;
    relatedIssues: string[];
  };
}

export class FlakeAnalysisService {
  private readonly prisma: PrismaClient;
  private readonly config: FlakeAnalysisConfig;

  constructor(
    prisma: PrismaClient,
    config: Partial<FlakeAnalysisConfig> = {}
  ) {
    this.prisma = prisma;
    this.config = {
      windowSize: 50,
      warnThreshold: 0.3,
      quarantineThreshold: 0.6,
      minOccurrences: 10,
      retryWeightMultiplier: 1.5,
      ...config,
    };
  }

  /**
   * Analyze flakiness for a specific test using rolling window approach
   * This is the core algorithm that powers FlakeGuard's scoring system
   */
  async analyzeTestFlakiness(testId: string): Promise<TestFlakiness | null> {
    // Get test case details
    const testCase = await this.prisma.fGTestCase.findUnique({
      where: { id: testId },
    });

    if (!testCase) {
      return null;
    }

    // Get recent occurrences in window (most recent first)
    const occurrences = await this.prisma.fGOccurrence.findMany({
      where: { testId },
      orderBy: { createdAt: 'desc' },
      take: this.config.windowSize,
    });

    if (occurrences.length < this.config.minOccurrences) {
      return {
        testId,
        testCase,
        score: 0,
        totalRuns: occurrences.length,
        failures: 0,
        retrySuccesses: 0,
        averageDurationMs: 0,
        lastFailureAt: null,
        failurePatterns: [],
        recommendation: 'STABLE',
      };
    }

    // Calculate flakiness metrics
    const failures = occurrences.filter(o => o.status === 'failed');
    const retrySuccesses = occurrences.filter(o => 
      o.status === 'passed' && o.attempt > 1
    );
    
    // Basic failure rate
    const failureRate = failures.length / occurrences.length;
    
    // Retry success rate (tests that fail then pass on retry get higher flake score)
    const retrySuccessRate = retrySuccesses.length / occurrences.length;
    const retryWeight = retrySuccessRate * this.config.retryWeightMultiplier;
    
    // Final score combines failure rate with retry pattern weighting
    const score = Math.min(1.0, failureRate + retryWeight);
    
    // Extract failure patterns
    const failurePatterns = Array.from(
      new Set(failures.map(f => f.failureMsgSignature).filter((sig): sig is string => Boolean(sig)))
    );

    // Calculate average duration
    const validDurations = occurrences
      .map(o => o.durationMs)
      .filter((d): d is number => d !== null);
    const averageDurationMs = validDurations.length > 0
      ? validDurations.reduce((sum, d) => sum + d, 0) / validDurations.length
      : 0;

    // Determine recommendation
    let recommendation: 'STABLE' | 'MONITOR' | 'QUARANTINE';
    if (score >= this.config.quarantineThreshold) {
      recommendation = 'QUARANTINE';
    } else if (score >= this.config.warnThreshold) {
      recommendation = 'MONITOR';
    } else {
      recommendation = 'STABLE';
    }

    return {
      testId,
      testCase,
      score,
      totalRuns: occurrences.length,
      failures: failures.length,
      retrySuccesses: retrySuccesses.length,
      averageDurationMs: Math.round(averageDurationMs),
      lastFailureAt: failures[0]?.createdAt || null,
      failurePatterns,
      recommendation,
    };
  }

  /**
   * Batch update flake scores for all tests in a repository
   * Optimized for performance using bulk operations
   */
  async recomputeRepositoryFlakeScores(repoId: string): Promise<number> {
    console.log(`Recomputing flake scores for repository: ${repoId}`);
    
    // Get all test cases in the repository
    const testCases = await this.prisma.fGTestCase.findMany({
      where: { repoId },
      select: { id: true, repository: { select: { orgId: true } } },
    });

    let updatedCount = 0;

    // Process in batches to avoid memory issues with large repos
    const batchSize = 50;
    for (let i = 0; i < testCases.length; i += batchSize) {
      const batch = testCases.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (testCase) => {
          const analysis = await this.analyzeTestFlakiness(testCase.id);
          if (analysis) {
            // Upsert the flake score
            await this.prisma.fGFlakeScore.upsert({
              where: { testId: testCase.id },
              update: {
                score: analysis.score,
                windowN: analysis.totalRuns,
                orgId: testCase.repository.orgId,
              },
              create: {
                testId: testCase.id,
                score: analysis.score,
                windowN: analysis.totalRuns,
                orgId: testCase.repository.orgId,
              },
            });
            updatedCount++;
          }
        })
      );
    }

    console.log(`Updated ${updatedCount} flake scores`);
    return updatedCount;
  }

  /**
   * Generate quarantine proposals for tests exceeding threshold
   */
  async generateQuarantineProposals(repoId: string): Promise<QuarantineProposal[]> {
    console.log(`Generating quarantine proposals for repository: ${repoId}`);

    const candidates = await this.prisma.fGTestCase.findMany({
      where: {
        repoId,
        flakeScore: {
          score: { gte: this.config.quarantineThreshold },
        },
        // Exclude tests already quarantined
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
        issueLinks: {
          select: { url: true },
        },
        occurrences: {
          where: {
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          },
          select: {
            job: { select: { name: true } },
            status: true,
          }
        }
      },
    });

    const proposals: QuarantineProposal[] = [];

    for (const candidate of candidates) {
      const score = candidate.flakeScore!.score;
      
      // Calculate impact assessment
      const affectedJobs = Array.from(
        new Set(
          candidate.occurrences
            .map(o => o.job?.name).filter((name): name is string => Boolean(name))
        )
      );
      
      const relatedIssues = candidate.issueLinks.map(link => link.url);

      // Generate rationale based on failure patterns
      const recentFailures = candidate.occurrences.filter(o => o.status === 'failed').length;
      const totalRecentRuns = candidate.occurrences.length;
      
      const rationale = [
        `Test shows ${(score * 100).toFixed(1)}% flakiness score over ${candidate.flakeScore!.windowN} runs.`,
        `${recentFailures} failures in last 7 days out of ${totalRecentRuns} runs.`,
        `Affects ${affectedJobs.length} job(s): ${affectedJobs.join(', ')}.`,
        score > 0.8 ? 'HIGH PRIORITY: Immediate quarantine recommended.' : 'Regular quarantine recommended.',
      ].join(' ');

      // Suggest quarantine duration based on severity
      const suggestedUntil = score > 0.8 
        ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days for highly flaky
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days for moderately flaky

      proposals.push({
        testId: candidate.id,
        testName: `${candidate.suite}/${candidate.className || ''}/${candidate.name}`.replace('//', '/'),
        score,
        rationale,
        suggestedUntil,
        impactAssessment: {
          affectedJobs,
          ownerTeam: candidate.ownerTeam,
          relatedIssues,
        },
      });
    }

    // Sort by score descending (most flaky first)
    proposals.sort((a, b) => b.score - a.score);
    
    console.log(`Generated ${proposals.length} quarantine proposals`);
    return proposals;
  }

  /**
   * Execute quarantine decision
   */
  async quarantineTest(
    testId: string,
    rationale: string,
    byUser: string,
    until?: Date
  ): Promise<FGQuarantineDecision> {
    console.log(`Quarantining test: ${testId}`);

    // Get test case to obtain orgId
    const testCase = await this.prisma.fGTestCase.findUnique({
      where: { id: testId },
      select: { repository: { select: { orgId: true } } }
    });

    if (!testCase) {
      throw new Error(`Test case not found: ${testId}`);
    }

    // Check if test is already quarantined
    const existingDecision = await this.prisma.fGQuarantineDecision.findFirst({
      where: {
        testId,
        state: 'ACTIVE',
        OR: [
          { until: null },
          { until: { gt: new Date() } }
        ]
      }
    });

    if (existingDecision) {
      throw new Error('Test is already quarantined');
    }

    // Create quarantine decision
    const decision = await this.prisma.fGQuarantineDecision.create({
      data: {
        testId,
        state: 'ACTIVE',
        rationale,
        byUser,
        until,
        orgId: testCase.repository.orgId,
      },
    });

    console.log(`Successfully quarantined test ${testId}`);
    return decision;
  }

  /**
   * Find and cluster similar failures across tests
   * This helps identify systemic issues vs isolated flaky tests
   */
  async clusterFailures(repoId: string): Promise<FGFailureCluster[]> {
    console.log(`Clustering failures for repository: ${repoId}`);

    // Get repository to get orgId
    const repository = await this.prisma.fGRepository.findUnique({
      where: { id: repoId },
      select: { orgId: true }
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repoId}`);
    }

    // Get all recent failures with signatures
    const failures = await this.prisma.fGOccurrence.findMany({
      where: {
        testCase: { repoId },
        status: 'failed',
        failureMsgSignature: { not: null },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
      },
      include: {
        testCase: { select: { id: true, name: true, suite: true } }
      },
    });

    // Group failures by signature
    const clusterMap = new Map<string, {
      signature: string;
      stackDigest: string | null;
      testIds: Set<string>;
      exampleMessage: string;
      exampleStack: string | null;
      count: number;
    }>();

    for (const failure of failures) {
      const signature = failure.failureMsgSignature!;
      
      if (!clusterMap.has(signature)) {
        clusterMap.set(signature, {
          signature,
          stackDigest: failure.failureStackDigest,
          testIds: new Set([failure.testId]),
          exampleMessage: failure.failureMessage || '',
          exampleStack: failure.failureStackTrace,
          count: 1,
        });
      } else {
        const cluster = clusterMap.get(signature)!;
        cluster.testIds.add(failure.testId);
        cluster.count++;
      }
    }

    // Create or update failure clusters
    const clusters: FGFailureCluster[] = [];
    
    for (const [signature, clusterData] of clusterMap) {
      if (clusterData.count >= 2) { // Only create clusters with multiple occurrences
        const cluster = await this.prisma.fGFailureCluster.upsert({
          where: {
            orgId_repoId_failureMsgSignature: { 
              orgId: repository.orgId, 
              repoId, 
              failureMsgSignature: signature 
            }
          },
          update: {
            testIds: Array.from(clusterData.testIds),
            occurrenceCount: clusterData.count,
          },
          create: {
            orgId: repository.orgId,
            repoId,
            failureMsgSignature: signature,
            failureStackDigest: clusterData.stackDigest,
            testIds: Array.from(clusterData.testIds),
            exampleMessage: clusterData.exampleMessage,
            exampleStackTrace: clusterData.exampleStack,
            occurrenceCount: clusterData.count,
          },
        });
        clusters.push(cluster);
      }
    }

    console.log(`Created/updated ${clusters.length} failure clusters`);
    return clusters;
  }

  /**
   * Generate comprehensive repository flakiness report
   */
  async generateFlakinesReport(repoId: string) {
    console.log(`Generating flakiness report for repository: ${repoId}`);

    const [
      repository,
      totalTests,
      flakyTests,
      quarantinedTests,
      recentRuns,
      failureClusters,
      topFlaky
    ] = await Promise.all([
      this.prisma.fGRepository.findUniqueOrThrow({
        where: { id: repoId }
      }),
      
      this.prisma.fGTestCase.count({
        where: { repoId }
      }),
      
      this.prisma.fGFlakeScore.count({
        where: {
          testCase: { repoId },
          score: { gte: this.config.warnThreshold }
        }
      }),
      
      this.prisma.fGQuarantineDecision.count({
        where: {
          testCase: { repoId },
          state: 'ACTIVE'
        }
      }),
      
      this.prisma.fGWorkflowRun.count({
        where: {
          repoId,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      }),
      
      this.prisma.fGFailureCluster.count({
        where: { repoId }
      }),
      
      this.prisma.fGTestCase.findMany({
        where: {
          repoId,
          flakeScore: { score: { gte: this.config.warnThreshold } }
        },
        include: { flakeScore: true },
        orderBy: { flakeScore: { score: 'desc' } },
        take: 10
      })
    ]);

    const flakinessTrend = totalTests > 0 ? (flakyTests / totalTests * 100).toFixed(1) : '0.0';

    return {
      repository: {
        name: `${repository.owner}/${repository.name}`,
        provider: repository.provider,
      },
      summary: {
        totalTests,
        flakyTests,
        quarantinedTests,
        recentRuns,
        failureClusters,
        flakinessTrend: `${flakinessTrend}%`,
      },
      topFlakyTests: topFlaky.map(test => ({
        name: `${test.suite}/${test.className || ''}/${test.name}`.replace('//', '/'),
        score: test.flakeScore!.score,
        windowSize: test.flakeScore!.windowN,
        recommendation: test.flakeScore!.score >= this.config.quarantineThreshold ? 'QUARANTINE' : 'MONITOR',
      })),
      thresholds: {
        warn: this.config.warnThreshold,
        quarantine: this.config.quarantineThreshold,
        minRuns: this.config.minOccurrences,
      },
      generatedAt: new Date(),
    };
  }
}

// Utility function to create failure signature
export function createFailureSignature(message: string): string {
  // Normalize failure message by removing dynamic content
  const normalized = message
    .replace(/\d+/g, 'NUM') // Replace numbers
    .replace(/\/[^\/\s]+\//g, '/PATH/') // Replace paths
    .replace(/at \d+:\d+/g, 'at LINE:COL') // Replace line:column
    .toLowerCase()
    .trim();
  
  return createHash('md5').update(normalized).digest('hex');
}

