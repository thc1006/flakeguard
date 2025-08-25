#!/usr/bin/env tsx

/**
 * Performance-optimized FlakeGuard database seed script
 * Uses batch operations, transactions, and configurable parameters for fast seeding
 */

import { createHash } from 'crypto';

import { PrismaClient } from '@prisma/client';

// Configuration from environment variables
const SEED_CONFIG = {
  NUM_REPOS: parseInt(process.env.SEED_NUM_REPOS || '3'),
  NUM_RUNS_PER_REPO: parseInt(process.env.SEED_NUM_RUNS_PER_REPO || '50'),
  NUM_TEST_CASES_PER_REPO: parseInt(process.env.SEED_NUM_TEST_CASES_PER_REPO || '6'),
  BATCH_SIZE: parseInt(process.env.SEED_BATCH_SIZE || '100'),
  ENABLE_PROGRESS_LOGS: process.env.SEED_PROGRESS_LOGS !== 'false',
  CLEAN_EXISTING_DATA: process.env.SEED_CLEAN_EXISTING !== 'false',
} as const;

const prisma = new PrismaClient({
  log: ['warn', 'error'],
});

// Utility functions
function generateSignature(message: string): string {
  return createHash('md5').update(message).digest('hex');
}

function generateStackDigest(stackTrace: string): string {
  const normalized = stackTrace
    .replace(/:\d+:\d+/g, ':XX:XX')
    .replace(/\/[^\/\s]+\//g, '/PATH/');
  return createHash('md5').update(normalized).digest('hex');
}

function logProgress(message: string, force = false) {
  if (SEED_CONFIG.ENABLE_PROGRESS_LOGS || force) {
    console.log(message);
  }
}

// Sample data templates
const REPO_TEMPLATES = [
  { provider: 'github', owner: 'acme-corp', name: 'web-app' },
  { provider: 'github', owner: 'acme-corp', name: 'api-service' },
  { provider: 'github', owner: 'acme-corp', name: 'mobile-app' },
  { provider: 'github', owner: 'acme-corp', name: 'data-pipeline' },
  { provider: 'github', owner: 'acme-corp', name: 'ml-service' },
  { provider: 'github', owner: 'acme-corp', name: 'auth-service' },
];

const TEST_CASE_TEMPLATES = [
  { suite: 'unit/auth', className: 'AuthService', name: 'should_validate_jwt_token', file: 'src/auth/auth.service.test.ts', ownerTeam: 'platform', flakiness: 0.0 },
  { suite: 'unit/user', className: 'UserService', name: 'should_create_user', file: 'src/user/user.service.test.ts', ownerTeam: 'backend', flakiness: 0.05 },
  { suite: 'integration/api', className: 'ApiIntegration', name: 'should_handle_timeout', file: 'tests/integration/api.test.ts', ownerTeam: 'backend', flakiness: 0.25 },
  { suite: 'e2e/checkout', className: 'CheckoutFlow', name: 'should_complete_purchase', file: 'tests/e2e/checkout.test.ts', ownerTeam: 'frontend', flakiness: 0.35 },
  { suite: 'integration/database', className: 'DatabaseConnection', name: 'should_handle_concurrent_writes', file: 'tests/integration/db.test.ts', ownerTeam: 'platform', flakiness: 0.65 },
  { suite: 'e2e/search', className: 'SearchFlow', name: 'should_return_results_quickly', file: 'tests/e2e/search.test.ts', ownerTeam: 'frontend', flakiness: 0.75 },
  { suite: 'unit/validation', className: 'ValidationService', name: 'should_validate_input', file: 'src/validation/validation.service.test.ts', ownerTeam: 'backend', flakiness: 0.1 },
  { suite: 'integration/cache', className: 'CacheService', name: 'should_handle_cache_miss', file: 'tests/integration/cache.test.ts', ownerTeam: 'platform', flakiness: 0.4 },
];

const FAILURE_PATTERNS = {
  timeout: {
    message: 'Test timed out after 30000ms',
    stack: 'Error: Test timed out after 30000ms\n    at TestRunner.timeout (/src/test-runner.js:45:12)\n    at Object.<anonymous> (/tests/integration/api.test.ts:23:8)',
  },
  raceCondition: {
    message: 'Expected element to be visible but was not found',
    stack: 'AssertionError: Expected element to be visible but was not found\n    at Page.waitFor (/node_modules/playwright/lib/page.js:123:45)\n    at Object.<anonymous> (/tests/e2e/checkout.test.ts:67:12)',
  },
  networkError: {
    message: 'Network request failed: ECONNRESET',
    stack: 'Error: Network request failed: ECONNRESET\n    at ClientRequest.onError (/node_modules/axios/lib/core/adapter.js:14:23)\n    at Object.<anonymous> (/tests/integration/db.test.ts:89:5)',
  },
  randomFailure: {
    message: 'Assertion failed: expected 42 but got 41',
    stack: 'AssertionError: Assertion failed: expected 42 but got 41\n    at Object.<anonymous> (/tests/e2e/search.test.ts:156:7)',
  },
};

// Batch processing utility
async function processBatch<T>(items: T[], batchSize: number, processor: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processor(batch);
  }
}


async function seedData() {
  const startTime = Date.now();
  logProgress("🚀 Starting FlakeGuard database seed with optimized performance...", true);
  logProgress(`📊 Config: ${SEED_CONFIG.NUM_REPOS} repos, ${SEED_CONFIG.NUM_RUNS_PER_REPO} runs/repo, ${SEED_CONFIG.NUM_TEST_CASES_PER_REPO} tests/repo, batch size ${SEED_CONFIG.BATCH_SIZE}`, true);

  try {
    // Create or find default organization
    logProgress("🏢 Setting up organization...");
    const defaultOrg = await prisma.organization.upsert({
      where: { slug: "acme-corp" },
      update: {},
      create: {
        name: "ACME Corp",
        slug: "acme-corp",
        githubLogin: "acme-corp",
        plan: "pro",
        status: "active",
      },
    });

    // Clean existing data if requested
    if (SEED_CONFIG.CLEAN_EXISTING_DATA) {
      logProgress("🧹 Cleaning existing FlakeGuard data...");
      await prisma.$transaction(async (tx) => {
        await tx.fGOccurrence.deleteMany({ where: { orgId: defaultOrg.id } });
        await tx.fGJob.deleteMany();
        await tx.fGWorkflowRun.deleteMany({ where: { orgId: defaultOrg.id } });
        await tx.fGFlakeScore.deleteMany({ where: { orgId: defaultOrg.id } });
        await tx.fGQuarantineDecision.deleteMany({ where: { orgId: defaultOrg.id } });
        await tx.fGIssueLink.deleteMany();
        await tx.fGFailureCluster.deleteMany({ where: { orgId: defaultOrg.id } });
        await tx.fGTestCase.deleteMany({ where: { orgId: defaultOrg.id } });
        await tx.fGRepository.deleteMany({ where: { orgId: defaultOrg.id } });
      });
    }

    // Create repositories (batch insert)
    logProgress("📦 Creating repositories...");
    const repoData = REPO_TEMPLATES.slice(0, SEED_CONFIG.NUM_REPOS).map((repo, idx) => ({
      ...repo,
      orgId: defaultOrg.id,
      installationId: `install_${1000 + idx}`,
    }));
    
    const repos = await prisma.$transaction(async (tx) => {
      return await tx.fGRepository.createManyAndReturn({ data: repoData });
    });

    // Create test cases (batch insert per repo)
    logProgress("🧪 Creating test cases...");
    const allTestCases = [];
    const testCaseData = [];
    
    for (const repo of repos) {
      const repoTestCases = TEST_CASE_TEMPLATES.slice(0, SEED_CONFIG.NUM_TEST_CASES_PER_REPO).map(template => ({
        orgId: defaultOrg.id,
        repoId: repo.id,
        suite: template.suite,
        className: template.className,
        name: template.name,
        file: template.file,
        ownerTeam: template.ownerTeam,
      }));
      testCaseData.push(...repoTestCases);
      
      // Store flakiness for later use
      TEST_CASE_TEMPLATES.slice(0, SEED_CONFIG.NUM_TEST_CASES_PER_REPO).forEach((template, idx) => {
        allTestCases.push({
          repoId: repo.id,
          suite: template.suite,
          className: template.className,
          name: template.name,
          flakiness: template.flakiness,
        });
      });
    }

    const createdTestCases = await prisma.$transaction(async (tx) => {
      return await tx.fGTestCase.createManyAndReturn({ data: testCaseData });
    });

    // Map test cases with flakiness
    const testCasesWithFlakiness = createdTestCases.map((testCase, idx) => ({
      ...testCase,
      flakiness: allTestCases[idx]?.flakiness || 0,
    }));

    // Create workflow runs, jobs, and occurrences (batched)
    logProgress("🔄 Creating workflow runs and test data...");
    
    let totalWorkflowRuns = 0;
    let totalJobs = 0;
    let totalOccurrences = 0;

    for (const repo of repos) {
      logProgress(`  Processing repo: ${repo.owner}/${repo.name}`);
      
      // Generate workflow runs for this repo
      const workflowRunData = [];
      const occurrenceData = [];
      
      const repoTestCases = testCasesWithFlakiness.filter(tc => tc.repoId === repo.id);
      
      for (let i = 0; i < SEED_CONFIG.NUM_RUNS_PER_REPO; i++) {
        const createdAt = new Date(Date.now() - (SEED_CONFIG.NUM_RUNS_PER_REPO - i) * 86400000);
        const runId = `${repo.id}_run_${i + 1}`;
        
        const statuses = ["completed", "completed", "completed", "failed", "cancelled"];
        const conclusions = ["success", "success", "failure", "failure", "cancelled"];
        
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const conclusion = status === "completed" ? conclusions[Math.floor(Math.random() * conclusions.length)] : null;

        workflowRunData.push({
          orgId: defaultOrg.id,
          repoId: repo.id,
          runId,
          status,
          conclusion,
          createdAt,
          updatedAt: createdAt,
        });

        // Generate test occurrences for this run
        for (const testCase of repoTestCases) {
          const shouldFail = Math.random() < testCase.flakiness;
          const status = shouldFail ? "failed" : "passed";
          
          let failureMessage = null;
          let failureStackTrace = null;
          let failureMsgSignature = null;
          let failureStackDigest = null;

          if (shouldFail) {
            let pattern;
            if (testCase.name.includes("timeout")) {
              pattern = FAILURE_PATTERNS.timeout;
            } else if (testCase.name.includes("concurrent") || testCase.name.includes("race")) {
              pattern = FAILURE_PATTERNS.raceCondition;
            } else if (testCase.suite.includes("integration")) {
              pattern = FAILURE_PATTERNS.networkError;
            } else {
              pattern = FAILURE_PATTERNS.randomFailure;
            }

            failureMessage = pattern.message;
            failureStackTrace = pattern.stack;
            failureMsgSignature = generateSignature(pattern.message);
            failureStackDigest = generateStackDigest(pattern.stack);
          }

          occurrenceData.push({
            orgId: defaultOrg.id,
            testId: testCase.id,
            runId: "", // Will be filled after run creation
            status,
            durationMs: Math.floor(Math.random() * 5000) + 100,
            failureMessage,
            failureStackTrace,
            failureMsgSignature,
            failureStackDigest,
            attempt: shouldFail && Math.random() > 0.7 ? 2 : 1,
            createdAt,
          });
        }
      }

      // Insert in transaction with proper foreign key relations
      await prisma.$transaction(async (tx) => {
        // Create workflow runs
        const createdRuns = await tx.fGWorkflowRun.createManyAndReturn({ data: workflowRunData });
        
        // Create jobs (simplified - just test jobs)
        const jobData = createdRuns.map(run => ({
          runId: run.id,
          jobId: `${run.runId}_job_test`,
          name: "test",
          status: "completed",
          conclusion: Math.random() > 0.1 ? "success" : "failure",
          startedAt: run.createdAt,
          completedAt: new Date(run.createdAt.getTime() + Math.random() * 300000),
        }));
        
        if (jobData.length > 0) {
          await processBatch(jobData, SEED_CONFIG.BATCH_SIZE, async (batch) => {
            await tx.fGJob.createMany({ data: batch });
          });
        }

        // Update occurrence data with actual run IDs and create occurrences
        const occurrencesWithRunIds = [];
        let occIndex = 0;
        for (const run of createdRuns) {
          for (let testIdx = 0; testIdx < repoTestCases.length; testIdx++) {
            if (occIndex < occurrenceData.length) {
              occurrencesWithRunIds.push({
                ...occurrenceData[occIndex],
                runId: run.id,
              });
              occIndex++;
            }
          }
        }
        
        await processBatch(occurrencesWithRunIds, SEED_CONFIG.BATCH_SIZE, async (batch) => {
          await tx.fGOccurrence.createMany({ data: batch });
        });
        
        totalWorkflowRuns += createdRuns.length;
        totalJobs += jobData.length;
        totalOccurrences += occurrencesWithRunIds.length;
      });
      
      logProgress(`    ✓ Created ${SEED_CONFIG.NUM_RUNS_PER_REPO} runs, ${SEED_CONFIG.NUM_RUNS_PER_REPO} jobs, ${repoTestCases.length * SEED_CONFIG.NUM_RUNS_PER_REPO} occurrences`);
    }

    // Calculate flake scores efficiently using aggregation
    logProgress("📊 Calculating flake scores...");
    const flakeScoreData = [];
    
    // Use single query to get all occurrence counts
    const occurrenceStats = await prisma.fGOccurrence.groupBy({
      by: ["testId"],
      _count: {
        id: true,
      },
      where: {
        status: "failed",
        orgId: defaultOrg.id,
      },
    });

    const totalOccurrenceCounts = await prisma.fGOccurrence.groupBy({
      by: ["testId"],
      _count: {
        id: true,
      },
      where: {
        orgId: defaultOrg.id,
      },
    });

    const failureCountMap = new Map(occurrenceStats.map(stat => [stat.testId, stat._count.id]));
    const totalCountMap = new Map(totalOccurrenceCounts.map(stat => [stat.testId, stat._count.id]));

    for (const testCase of testCasesWithFlakiness) {
      const totalOccurrences = totalCountMap.get(testCase.id) || 0;
      const failedOccurrences = failureCountMap.get(testCase.id) || 0;
      const score = totalOccurrences > 0 ? failedOccurrences / totalOccurrences : 0;

      flakeScoreData.push({
        orgId: defaultOrg.id,
        testId: testCase.id,
        score,
        windowN: Math.min(totalOccurrences, 50),
      });
    }

    await processBatch(flakeScoreData, SEED_CONFIG.BATCH_SIZE, async (batch) => {
      await prisma.fGFlakeScore.createMany({ data: batch });
    });

    // Create failure clusters efficiently
    logProgress("🔗 Creating failure clusters...");
    const clusterStats = await prisma.fGOccurrence.groupBy({
      by: ["failureMsgSignature"],
      _count: {
        id: true,
      },
      where: {
        status: "failed",
        failureMsgSignature: { not: null },
        orgId: defaultOrg.id,
      },
      having: {
        id: {
          _count: {
            gt: 1,
          },
        },
      },
    });

    const clusterData = [];
    for (const clusterStat of clusterStats) {
      if (!clusterStat.failureMsgSignature) {continue;}
      
      // Get representative example for this cluster
      const example = await prisma.fGOccurrence.findFirst({
        where: {
          failureMsgSignature: clusterStat.failureMsgSignature,
          status: "failed",
          orgId: defaultOrg.id,
        },
        include: { testCase: true },
      });

      if (example) {
        // Get all test IDs in this cluster
        const clusterTests = await prisma.fGOccurrence.findMany({
          where: {
            failureMsgSignature: clusterStat.failureMsgSignature,
            status: "failed",
            orgId: defaultOrg.id,
          },
          select: { testId: true },
          distinct: ["testId"],
        });

        clusterData.push({
          orgId: defaultOrg.id,
          repoId: example.testCase.repoId,
          failureMsgSignature: clusterStat.failureMsgSignature,
          failureStackDigest: example.failureStackDigest,
          testIds: clusterTests.map(t => t.testId),
          exampleMessage: example.failureMessage,
          exampleStackTrace: example.failureStackTrace,
          occurrenceCount: clusterStat._count.id,
        });
      }
    }

    if (clusterData.length > 0) {
      await processBatch(clusterData, SEED_CONFIG.BATCH_SIZE, async (batch) => {
        await prisma.fGFailureCluster.createMany({ data: batch });
      });
    }

    // Create quarantine decisions for highly flaky tests
    logProgress("🚧 Creating quarantine decisions...");
    const flakyTests = await prisma.fGFlakeScore.findMany({
      where: { score: { gte: 0.6 }, orgId: defaultOrg.id },
      include: { testCase: true },
    });

    const quarantineData = flakyTests.map(flakyTest => {
      const states = ["PROPOSED", "ACTIVE", "DISMISSED"];
      const state = states[Math.floor(Math.random() * states.length)];
      
      return {
        orgId: defaultOrg.id,
        testId: flakyTest.testId,
        state: state as "PROPOSED" | "ACTIVE" | "DISMISSED",
        rationale: `Test shows ${(flakyTest.score * 100).toFixed(1)}% failure rate over ${flakyTest.windowN} runs. Automated quarantine recommendation.`,
        byUser: state === "DISMISSED" ? "human-reviewer" : "flakeguard-bot",
        until: state === "ACTIVE" ? new Date(Date.now() + 30 * 86400000) : null,
      };
    });

    if (quarantineData.length > 0) {
      await prisma.fGQuarantineDecision.createMany({ data: quarantineData });
    }

    // Create issue links for some quarantined tests
    logProgress("🔗 Creating issue links...");
    const activeQuarantines = quarantineData.filter(q => q.state === "ACTIVE").slice(0, 3);
    const issueLinkData = activeQuarantines.map((decision, i) => ({
      testId: decision.testId,
      provider: "github",
      url: `https://github.com/acme-corp/web-app/issues/${1000 + i}`,
    }));

    if (issueLinkData.length > 0) {
      await prisma.fGIssueLink.createMany({ data: issueLinkData });
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    logProgress("✅ FlakeGuard seed completed successfully!", true);
    
    // Print final statistics
    const stats = await prisma.$transaction(async (tx) => {
      const [repoCount, testCount, runCount, occurrenceCount, clusterCount, quarantineCount] = await Promise.all([
        tx.fGRepository.count({ where: { orgId: defaultOrg.id } }),
        tx.fGTestCase.count({ where: { orgId: defaultOrg.id } }),
        tx.fGWorkflowRun.count({ where: { orgId: defaultOrg.id } }),
        tx.fGOccurrence.count({ where: { orgId: defaultOrg.id } }),
        tx.fGFailureCluster.count({ where: { orgId: defaultOrg.id } }),
        tx.fGQuarantineDecision.count({ where: { orgId: defaultOrg.id } }),
      ]);
      
      return { repoCount, testCount, runCount, occurrenceCount, clusterCount, quarantineCount };
    });

    logProgress("\n📈 Database Summary:", true);
    logProgress(`  Repositories: ${stats.repoCount}`, true);
    logProgress(`  Test Cases: ${stats.testCount}`, true);
    logProgress(`  Workflow Runs: ${stats.runCount}`, true);
    logProgress(`  Test Occurrences: ${stats.occurrenceCount}`, true);
    logProgress(`  Failure Clusters: ${stats.clusterCount}`, true);
    logProgress(`  Quarantine Decisions: ${stats.quarantineCount}`, true);
    logProgress(`\n⚡ Performance: Completed in ${duration.toFixed(2)}s (${Math.round(stats.occurrenceCount / duration)} occurrences/sec)`, true);

  } catch (error) {
    logProgress(`❌ Seed failed: ${error}`, true);
    throw error;
  }
}

async function main() {
  try {
    await seedData();
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// ESM equivalent of 'if (require.main === module)'
if (import.meta.url === new URL(process.argv[1], "file://").href) {
  main().catch((error) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }).finally(async () => {
    await prisma.$disconnect();
  });
}

export { seedData };
