/**
 * Database Performance Benchmarks
 */
import { PrismaClient } from "@prisma/client";

import { TestIngestionRepository } from "../../apps/api/src/ingestion/database.js";
import { OptimizedTestIngestionRepository } from "../../apps/api/src/performance/optimized-database.js";

import { PerformanceBenchmark } from "./benchmark-framework.js";


export async function runDatabaseBenchmarks(prisma: PrismaClient) {
  const benchmark = new PerformanceBenchmark();
  const originalRepo = new TestIngestionRepository(prisma);
  const optimizedRepo = new OptimizedTestIngestionRepository(prisma);
  
  // Generate test data
  const generateTestResults = (count: number) => 
    Array.from({ length: count }, (_, i) => ({
      name: `test_${i}`,
      suite: `suite_${Math.floor(i / 10)}`,
      class: `TestClass${Math.floor(i / 10)}`,
      testFullName: `suite_${Math.floor(i / 10)}.TestClass${Math.floor(i / 10)}.test_${i}`,
      status: Math.random() > 0.8 ? "failed" : "passed",
      time: Math.random() * 1000,
      repositoryId: "test-repo",
      runId: `run_${Math.floor(i / 100)}`,
    }));

  // Test batch upsert performance
  const testData = generateTestResults(1000);
  
  console.log("Running database performance benchmarks...");
  
  await benchmark.runBenchmark("Original Batch Upsert (1000 items)", async () => {
    await originalRepo.batchUpsertTestResults(testData, { batchSize: 100 });
  }, 1);
  
  await benchmark.runBenchmark("Optimized Batch Upsert (1000 items)", async () => {
    await optimizedRepo.batchUpsertTestResults(testData, { batchSize: 500 });
  }, 1);
  
  return benchmark.generateReport();
}
