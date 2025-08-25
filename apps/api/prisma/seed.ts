#!/usr/bin/env tsx

/**
 * Comprehensive seed script for FlakeGuard database
 * Loads sample data demonstrating various flakiness patterns and quarantine scenarios
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

// Utility functions
function generateSignature(message: string): string {
  return createHash('md5').update(message).digest('hex');
}

function generateStackDigest(stackTrace: string): string {
  // Normalize stack trace by removing line numbers and specific paths
  const normalized = stackTrace
    .replace(/:\d+:\d+/g, ':XX:XX') // Replace line:col numbers
    .replace(/\/[^\/\s]+\//g, '/PATH/'); // Replace paths
  return createHash('md5').update(normalized).digest('hex');
}

// Sample data generators
const sampleRepos = [
  { provider: 'github', owner: 'acme-corp', name: 'web-app' },
  { provider: 'github', owner: 'acme-corp', name: 'api-service' },
  { provider: 'github', owner: 'acme-corp', name: 'mobile-app' },
];

const sampleTestCases = [
  // Stable tests
  {
    suite: 'unit/auth',
    className: 'AuthService',
    name: 'should_validate_jwt_token',
    file: 'src/auth/auth.service.test.ts',
    ownerTeam: 'platform',
    flakiness: 0.0,
  },
  {
    suite: 'unit/user',
    className: 'UserService',
    name: 'should_create_user',
    file: 'src/user/user.service.test.ts',
    ownerTeam: 'backend',
    flakiness: 0.05,
  },
  
  // Mildly flaky tests
  {
    suite: 'integration/api',
    className: 'ApiIntegration',
    name: 'should_handle_timeout',
    file: 'tests/integration/api.test.ts',
    ownerTeam: 'backend',
    flakiness: 0.25,
  },
  {
    suite: 'e2e/checkout',
    className: 'CheckoutFlow',
    name: 'should_complete_purchase',
    file: 'tests/e2e/checkout.test.ts',
    ownerTeam: 'frontend',
    flakiness: 0.35,
  },
  
  // Highly flaky tests
  {
    suite: 'integration/database',
    className: 'DatabaseConnection',
    name: 'should_handle_concurrent_writes',
    file: 'tests/integration/db.test.ts',
    ownerTeam: 'platform',
    flakiness: 0.65,
  },
  {
    suite: 'e2e/search',
    className: 'SearchFlow',
    name: 'should_return_results_quickly',
    file: 'tests/e2e/search.test.ts',
    ownerTeam: 'frontend',
    flakiness: 0.75,
  },
];

const failurePatterns = {
  timeout: {
    message: 'Test timed out after 30000ms',
    stack: `Error: Test timed out after 30000ms
    at TestRunner.timeout (/src/test-runner.js:45:12)
    at Object.<anonymous> (/tests/integration/api.test.ts:23:8)`,
  },
  raceCondition: {
    message: 'Expected element to be visible but was not found',
    stack: `AssertionError: Expected element to be visible but was not found
    at Page.waitFor (/node_modules/playwright/lib/page.js:123:45)
    at Object.<anonymous> (/tests/e2e/checkout.test.ts:67:12)`,
  },
  networkError: {
    message: 'Network request failed: ECONNRESET',
    stack: `Error: Network request failed: ECONNRESET
    at ClientRequest.onError (/node_modules/axios/lib/core/adapter.js:14:23)
    at Object.<anonymous> (/tests/integration/db.test.ts:89:5)`,
  },
  randomFailure: {
    message: 'Assertion failed: expected 42 but got 41',
    stack: `AssertionError: Assertion failed: expected 42 but got 41
    at Object.<anonymous> (/tests/e2e/search.test.ts:156:7)`,
  },
};

async function seedData() {
  console.log('🌱 Starting FlakeGuard database seed...');

  // Clean existing FlakeGuard data
  console.log('🧹 Cleaning existing FlakeGuard data...');
  await prisma.fGOccurrence.deleteMany();
  await prisma.fGJob.deleteMany();
  await prisma.fGWorkflowRun.deleteMany();
  await prisma.fGFlakeScore.deleteMany();
  await prisma.fGQuarantineDecision.deleteMany();
  await prisma.fGIssueLink.deleteMany();
  await prisma.fGFailureCluster.deleteMany();
  await prisma.fGTestCase.deleteMany();
  await prisma.fGRepository.deleteMany();

  // Create repositories
  console.log('📦 Creating repositories...');
  const repos = [];
  for (const repo of sampleRepos) {
    const created = await prisma.fGRepository.create({
      data: {
        ...repo,
        installationId: `install_${Math.floor(Math.random() * 1000)}`,
      },
    });
    repos.push(created);
    console.log(`  ✓ Created repo: ${repo.owner}/${repo.name}`);
  }

  // Create test cases for each repo
  console.log('🧪 Creating test cases...');
  const testCases = [];
  for (const repo of repos) {
    for (const testTemplate of sampleTestCases) {
      const testCase = await prisma.fGTestCase.create({
        data: {
          repoId: repo.id,
          suite: testTemplate.suite,
          className: testTemplate.className,
          name: testTemplate.name,
          file: testTemplate.file,
          ownerTeam: testTemplate.ownerTeam,
        },
      });
      testCases.push({ ...testCase, flakiness: testTemplate.flakiness });
      console.log(`  ✓ Created test: ${testTemplate.suite}/${testTemplate.name}`);
    }
  }

  // Create workflow runs and generate historical data
  console.log('🔄 Creating workflow runs and occurrences...');
  const numRuns = 100; // Create 100 historical runs per repo
  const workflowRuns = [];
  
  for (const repo of repos) {
    for (let i = 0; i < numRuns; i++) {
      const createdAt = new Date(Date.now() - (numRuns - i) * 86400000); // One day apart
      const statuses = ['completed', 'completed', 'completed', 'failed', 'cancelled'];
      const conclusions = ['success', 'success', 'failure', 'failure', 'cancelled'];
      
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const conclusion = status === 'completed' ? conclusions[Math.floor(Math.random() * conclusions.length)] : null;

      const workflowRun = await prisma.fGWorkflowRun.create({
        data: {
          repoId: repo.id,
          runId: `${repo.id}_run_${i + 1}`,
          status,
          conclusion,
          createdAt,
          updatedAt: createdAt,
        },
      });
      workflowRuns.push(workflowRun);

      // Create jobs for this run
      const jobNames = ['test', 'lint', 'build', 'deploy'];
      for (const jobName of jobNames) {
        if (jobName === 'test' || Math.random() > 0.3) { // Always create test job, 70% chance for others
          await prisma.fGJob.create({
            data: {
              runId: workflowRun.id,
              jobId: `${workflowRun.runId}_job_${jobName}`,
              name: jobName,
              status: 'completed',
              conclusion: Math.random() > 0.1 ? 'success' : 'failure', // 90% success rate
              startedAt: createdAt,
              completedAt: new Date(createdAt.getTime() + Math.random() * 300000), // 0-5 min duration
            },
          });
        }
      }

      // Create test occurrences based on flakiness patterns
      const repoTestCases = testCases.filter(tc => tc.repoId === repo.id);
      for (const testCase of repoTestCases) {
        const shouldFail = Math.random() < testCase.flakiness;
        const status = shouldFail ? 'failed' : 'passed';
        
        let failureMessage = null;
        let failureStackTrace = null;
        let failureMsgSignature = null;
        let failureStackDigest = null;

        if (shouldFail) {
          // Assign failure patterns based on test characteristics
          let pattern;
          if (testCase.name.includes('timeout')) {
            pattern = failurePatterns.timeout;
          } else if (testCase.name.includes('concurrent') || testCase.name.includes('race')) {
            pattern = failurePatterns.raceCondition;
          } else if (testCase.suite.includes('integration')) {
            pattern = failurePatterns.networkError;
          } else {
            pattern = failurePatterns.randomFailure;
          }

          failureMessage = pattern.message;
          failureStackTrace = pattern.stack;
          failureMsgSignature = generateSignature(pattern.message);
          failureStackDigest = generateStackDigest(pattern.stack);
        }

        await prisma.fGOccurrence.create({
          data: {
            testId: testCase.id,
            runId: workflowRun.id,
            status,
            durationMs: Math.floor(Math.random() * 5000) + 100, // 100ms to 5s
            failureMessage,
            failureStackTrace,
            failureMsgSignature,
            failureStackDigest,
            attempt: shouldFail && Math.random() > 0.7 ? 2 : 1, // 30% chance of retry on failure
            createdAt,
          },
        });
      }
    }
    console.log(`  ✓ Created ${numRuns} runs for ${repo.owner}/${repo.name}`);
  }

  // Calculate and create flake scores
  console.log('📊 Calculating flake scores...');
  for (const testCase of testCases) {
    const totalOccurrences = await prisma.fGOccurrence.count({
      where: { testId: testCase.id },
    });

    const failedOccurrences = await prisma.fGOccurrence.count({
      where: { 
        testId: testCase.id,
        status: 'failed',
      },
    });

    const score = totalOccurrences > 0 ? failedOccurrences / totalOccurrences : 0;

    await prisma.fGFlakeScore.create({
      data: {
        testId: testCase.id,
        score,
        windowN: Math.min(totalOccurrences, 50),
      },
    });
    console.log(`  ✓ Flake score for ${testCase.name}: ${score.toFixed(3)}`);
  }

  // Create failure clusters
  console.log('🔗 Creating failure clusters...');
  const clusterMap = new Map();
  
  // Group failures by signature
  const failures = await prisma.fGOccurrence.findMany({
    where: { 
      status: 'failed',
      failureMsgSignature: { not: null },
    },
    include: { testCase: true },
  });

  for (const failure of failures) {
    const key = `${failure.testCase.repoId}_${failure.failureMsgSignature}`;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, {
        repoId: failure.testCase.repoId,
        failureMsgSignature: failure.failureMsgSignature!,
        failureStackDigest: failure.failureStackDigest,
        testIds: new Set([failure.testId]),
        exampleMessage: failure.failureMessage,
        exampleStackTrace: failure.failureStackTrace,
        count: 1,
      });
    } else {
      const cluster = clusterMap.get(key)!;
      cluster.testIds.add(failure.testId);
      cluster.count++;
    }
  }

  for (const [key, clusterData] of clusterMap) {
    if (clusterData.count > 1) { // Only create clusters with multiple occurrences
      await prisma.fGFailureCluster.create({
        data: {
          repoId: clusterData.repoId,
          failureMsgSignature: clusterData.failureMsgSignature,
          failureStackDigest: clusterData.failureStackDigest,
          testIds: Array.from(clusterData.testIds),
          exampleMessage: clusterData.exampleMessage,
          exampleStackTrace: clusterData.exampleStackTrace,
          occurrenceCount: clusterData.count,
        },
      });
      console.log(`  ✓ Created cluster: ${clusterData.failureMsgSignature.slice(0, 8)} (${clusterData.count} occurrences)`);
    }
  }

  // Create quarantine decisions for highly flaky tests
  console.log('🚧 Creating quarantine decisions...');
  const flakyTests = await prisma.fGFlakeScore.findMany({
    where: { score: { gte: 0.6 } },
    include: { testCase: true },
  });

  for (const flakyTest of flakyTests) {
    const states = ['PROPOSED', 'ACTIVE', 'DISMISSED'];
    const state = states[Math.floor(Math.random() * states.length)];
    
    await prisma.fGQuarantineDecision.create({
      data: {
        testId: flakyTest.testId,
        state: state as any,
        rationale: `Test shows ${(flakyTest.score * 100).toFixed(1)}% failure rate over ${flakyTest.windowN} runs. Automated quarantine recommendation.`,
        byUser: state === 'DISMISSED' ? 'human-reviewer' : 'flakeguard-bot',
        until: state === 'ACTIVE' ? new Date(Date.now() + 30 * 86400000) : null, // 30 days if active
      },
    });
    console.log(`  ✓ Quarantine decision: ${flakyTest.testCase.name} (${state})`);
  }

  // Create issue links for some quarantined tests
  console.log('🔗 Creating issue links...');
  const quarantinedTests = await prisma.fGQuarantineDecision.findMany({
    where: { state: 'ACTIVE' },
    take: 3, // Link first 3
  });

  for (let i = 0; i < quarantinedTests.length; i++) {
    const decision = quarantinedTests[i];
    await prisma.fGIssueLink.create({
      data: {
        testId: decision.testId,
        provider: 'github',
        url: `https://github.com/acme-corp/web-app/issues/${1000 + i}`,
      },
    });
    console.log(`  ✓ Created issue link for quarantined test`);
  }

  console.log('✅ FlakeGuard seed completed successfully!');
  
  // Print summary statistics
  console.log('\n📈 Database Summary:');
  const repoCount = await prisma.fGRepository.count();
  const testCount = await prisma.fGTestCase.count();
  const runCount = await prisma.fGWorkflowRun.count();
  const occurrenceCount = await prisma.fGOccurrence.count();
  const clusterCount = await prisma.fGFailureCluster.count();
  const quarantineCount = await prisma.fGQuarantineDecision.count();
  
  console.log(`  Repositories: ${repoCount}`);
  console.log(`  Test Cases: ${testCount}`);
  console.log(`  Workflow Runs: ${runCount}`);
  console.log(`  Test Occurrences: ${occurrenceCount}`);
  console.log(`  Failure Clusters: ${clusterCount}`);
  console.log(`  Quarantine Decisions: ${quarantineCount}`);
}

async function main() {
  try {
    await seedData();
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

export { seedData };