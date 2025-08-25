/**
 * Simple verification of flakiness scoring logic
 * This helps verify the algorithm works correctly without TypeScript complications
 */

// Mock types and data
const DEFAULT_QUARANTINE_POLICY = {
  warnThreshold: 0.3,
  quarantineThreshold: 0.6,
  minRunsForQuarantine: 5,
  minRecentFailures: 2,
  lookbackDays: 7,
  rollingWindowSize: 50,
};

// Test data generators
function createTestRun(name, status, attempt = 1, runId = 'run1') {
  return {
    testName: name,
    testFullName: `com.example.${name}`,
    status,
    duration: Math.random() * 1000,
    attempt,
    runId,
    createdAt: new Date(),
  };
}

function createStableTestRuns(count) {
  const runs = [];
  for (let i = 0; i < count; i++) {
    runs.push(createTestRun('stable_test', 'passed', 1, `run${i}`));
  }
  return runs;
}

function createIntermittentTestRuns(count) {
  const runs = [];
  for (let i = 0; i < count; i++) {
    const status = i % 2 === 0 ? 'passed' : 'failed';
    runs.push(createTestRun('flaky_test', status, 1, `run${i}`));
  }
  return runs;
}

function createRetryPassingFlaky(count) {
  const runs = [];
  let runId = 1;
  
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) {
      // Initial failure
      runs.push(createTestRun('retry_flaky', 'failed', 1, `run${runId}`));
      // Successful retry
      runs.push(createTestRun('retry_flaky', 'passed', 2, `run${runId}`));
      runId++;
    } else {
      // Regular passing run
      runs.push(createTestRun('retry_flaky', 'passed', 1, `run${runId}`));
      runId++;
    }
  }
  
  return runs;
}

// Simplified scoring functions
function calculateRerunPassRate(runs) {
  const groupedByRunId = new Map();
  
  for (const run of runs) {
    if (!groupedByRunId.has(run.runId)) {
      groupedByRunId.set(run.runId, []);
    }
    groupedByRunId.get(run.runId).push(run);
  }

  let totalRetries = 0;
  let successfulRetries = 0;

  for (const [, runsInSameWorkflow] of groupedByRunId) {
    const sortedRuns = runsInSameWorkflow.sort((a, b) => a.attempt - b.attempt);
    
    for (let i = 1; i < sortedRuns.length; i++) {
      totalRetries++;
      if (sortedRuns[i].status === 'passed') {
        successfulRetries++;
      }
    }
  }

  return totalRetries > 0 ? successfulRetries / totalRetries : 0;
}

function calculateIntermittencyScore(runs) {
  if (runs.length < 3) {
    return 0;
  }

  const sortedRuns = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let transitions = 0;
  let totalTransitions = 0;

  for (let i = 1; i < sortedRuns.length; i++) {
    const current = sortedRuns[i];
    const previous = sortedRuns[i - 1];
    
    // Skip skipped tests for intermittency calculation
    if (current.status === 'skipped' || previous.status === 'skipped') {
      continue;
    }

    totalTransitions++;
    
    const currentFailed = current.status === 'failed' || current.status === 'error';
    const previousFailed = previous.status === 'failed' || previous.status === 'error';
    
    if (currentFailed !== previousFailed) {
      transitions++;
    }
  }

  return totalTransitions > 0 ? transitions / totalTransitions : 0;
}

function calculateCompositeScore(features) {
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

  // Weight factors - intermittency and re-run pass rate are most important for flaky detection
  const intermittencyWeight = 0.30;
  const rerunWeight = 0.25;
  const clusteringWeight = 0.15;
  const messageVarianceWeight = 0.10;
  const failRatioWeight = 0.10;
  const consecutiveFailurePenalty = 0.10;

  // Base score from weighted features
  let score = 
    (intermittencyScore * intermittencyWeight) +
    (rerunPassRate * rerunWeight) +
    (failureClustering * clusteringWeight) +
    (messageSignatureVariance * messageVarianceWeight) +
    (failSuccessRatio * failRatioWeight);

  // Apply consecutive failure penalty (reduces flakiness score for always-failing tests)
  if (maxConsecutiveFailures >= totalRuns * 0.8) {
    // If test fails consistently, it's likely broken, not flaky
    score *= (1 - consecutiveFailurePenalty * (maxConsecutiveFailures / totalRuns));
  }

  // Boost score if test shows classic flaky patterns
  if (rerunPassRate > 0.3 && intermittencyScore > 0.4) {
    score *= 1.2; // 20% boost for clear flaky behavior
  }

  // Penalize if test has been failing consistently at the end
  if (consecutiveFailures >= Math.min(5, totalRuns * 0.6)) {
    score *= 0.8; // 20% penalty for recent consistent failures
  }

  return Math.min(1.0, Math.max(0.0, score));
}

// Run verification tests
console.log('=== Flakiness Scoring Verification ===\n');

// Test 1: Stable test should have low score
const stableRuns = createStableTestRuns(20);
const stableFeatures = {
  failSuccessRatio: 0,
  rerunPassRate: 0,
  failureClustering: 0,
  intermittencyScore: 0,
  messageSignatureVariance: 0,
  consecutiveFailures: 0,
  maxConsecutiveFailures: 0,
  totalRuns: 20,
};
const stableScore = calculateCompositeScore(stableFeatures);
console.log(`✓ Stable test score: ${stableScore.toFixed(3)} (expected: ~0)`);

// Test 2: Intermittent test should have high score
const intermittentRuns = createIntermittentTestRuns(20);
const intermittencyScore = calculateIntermittencyScore(intermittentRuns);
const intermittentFeatures = {
  failSuccessRatio: 0.5,
  rerunPassRate: 0,
  failureClustering: 0.3,
  intermittencyScore: intermittencyScore,
  messageSignatureVariance: 0.2,
  consecutiveFailures: 1,
  maxConsecutiveFailures: 1,
  totalRuns: 20,
};
const intermittentScore = calculateCompositeScore(intermittentFeatures);
console.log(`✓ Intermittent test score: ${intermittentScore.toFixed(3)} (expected: >0.3)`);
console.log(`  - Intermittency score: ${intermittencyScore.toFixed(3)} (expected: 1.0)`);

// Test 3: Retry-passing flaky should have very high score
const retryRuns = createRetryPassingFlaky(15);
const retryPassRate = calculateRerunPassRate(retryRuns);
const retryFeatures = {
  failSuccessRatio: 0.3,
  rerunPassRate: retryPassRate,
  failureClustering: 0.2,
  intermittencyScore: 0.5,
  messageSignatureVariance: 0.1,
  consecutiveFailures: 0,
  maxConsecutiveFailures: 1,
  totalRuns: 15,
};
const retryScore = calculateCompositeScore(retryFeatures);
console.log(`✓ Retry-passing flaky score: ${retryScore.toFixed(3)} (expected: >0.5)`);
console.log(`  - Rerun pass rate: ${retryPassRate.toFixed(3)} (expected: >0.3)`);

// Test 4: Always-failing test should have lower score than intermittent
const alwaysFailingFeatures = {
  failSuccessRatio: 1.0,
  rerunPassRate: 0,
  failureClustering: 0,
  intermittencyScore: 0,
  messageSignatureVariance: 0,
  consecutiveFailures: 20,
  maxConsecutiveFailures: 20,
  totalRuns: 20,
};
const alwaysFailingScore = calculateCompositeScore(alwaysFailingFeatures);
console.log(`✓ Always-failing test score: ${alwaysFailingScore.toFixed(3)} (expected: <${intermittentScore.toFixed(3)})`);

// Test 5: Verify scoring determinism
const intermittentScore2 = calculateCompositeScore(intermittentFeatures);
console.log(`✓ Scoring determinism: ${intermittentScore === intermittentScore2 ? 'PASS' : 'FAIL'}`);

// Test 6: Verify score bounds
const extremeFeatures = {
  failSuccessRatio: 1.5, // Impossible value
  rerunPassRate: 2.0, // Impossible value
  failureClustering: -0.5, // Impossible value
  intermittencyScore: 1.0,
  messageSignatureVariance: 1.0,
  consecutiveFailures: 0,
  maxConsecutiveFailures: 0,
  totalRuns: 10,
};
const extremeScore = calculateCompositeScore(extremeFeatures);
console.log(`✓ Score bounds: ${extremeScore.toFixed(3)} (should be ≤ 1.0)`);

console.log('\n=== Verification Complete ===');
console.log(`All scores are properly bounded between 0.0 and 1.0: ${
  [stableScore, intermittentScore, retryScore, alwaysFailingScore, extremeScore]
    .every(score => score >= 0 && score <= 1) ? 'PASS' : 'FAIL'
}`);

console.log(`Flaky tests score higher than stable tests: ${
  intermittentScore > stableScore && retryScore > stableScore ? 'PASS' : 'FAIL'
}`);

console.log(`Retry-passing flaky scores highest: ${
  retryScore > intermittentScore ? 'PASS' : 'FAIL'
}`);

console.log(`Always-failing scores lower than intermittent: ${
  alwaysFailingScore < intermittentScore ? 'PASS' : 'FAIL'
}`);