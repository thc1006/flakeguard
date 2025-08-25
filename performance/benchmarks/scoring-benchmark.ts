/**
 * Flakiness Scoring Performance Benchmarks
 */
import type { TestRun } from "@flakeguard/shared";

import { FlakinessScorer } from "../../apps/api/src/analytics/flakiness.js";
import { OptimizedFlakinessScorer } from "../../apps/api/src/performance/optimized-flakiness.js";

import { PerformanceBenchmark } from "./benchmark-framework.js";


export async function runScoringBenchmarks() {
  const benchmark = new PerformanceBenchmark();
  const originalScorer = new FlakinessScorer();
  const optimizedScorer = new OptimizedFlakinessScorer();
  
  // Generate test run data
  const generateTestRuns = (count: number): TestRun[] => 
    Array.from({ length: count }, (_, i) => ({
      testName: "flaky_test",
      testFullName: "com.example.FlakyTest.flaky_test",
      status: (Math.random() > 0.3 ? "passed" : "failed") as TestRun['status'],
      duration: Math.random() * 1000,
      message: Math.random() > 0.7 ? "Test failed intermittently" : undefined,
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      runId: `workflow_run_${Math.floor(i / 10)}`,
      attempt: Math.random() > 0.8 ? 2 : 1,
    }));

  const testRuns = generateTestRuns(100);
  const largeTestRuns = generateTestRuns(1000);
  
  console.log("Running flakiness scoring performance benchmarks...");
  
  // Single test scoring
  await benchmark.runBenchmark("Original Scorer - Single Test (100 runs)", async () => {
    await originalScorer.computeFlakeScore(testRuns);
  }, 10);
  
  await benchmark.runBenchmark("Optimized Scorer - Single Test (100 runs)", async () => {
    await optimizedScorer.computeFlakeScore(testRuns);
  }, 10);
  
  // Large dataset scoring
  await benchmark.runBenchmark("Original Scorer - Large Dataset (1000 runs)", async () => {
    await originalScorer.computeFlakeScore(largeTestRuns);
  }, 5);
  
  await benchmark.runBenchmark("Optimized Scorer - Large Dataset (1000 runs)", async () => {
    await optimizedScorer.computeFlakeScore(largeTestRuns);
  }, 5);
  
  // Batch scoring
  const testGroups = new Map<string, TestRun[]>();
  for (let i = 0; i < 50; i++) {
    testGroups.set(`test_${i}`, generateTestRuns(50));
  }
  
  await benchmark.runBenchmark("Optimized Scorer - Batch Processing (50 tests, 50 runs each)", async () => {
    await optimizedScorer.computeMultipleFlakeScores(testGroups, { maxConcurrency: 10 });
  }, 1);
  
  return benchmark.generateReport();
}
