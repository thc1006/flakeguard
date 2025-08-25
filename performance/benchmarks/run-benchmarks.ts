/**
 * FlakeGuard Performance Benchmark Suite Runner
 */
import { PrismaClient } from "@prisma/client";

import { runDatabaseBenchmarks } from "./database-benchmark.js";
import { runParserBenchmarks } from "./parser-benchmark.js";
import { runScoringBenchmarks } from "./scoring-benchmark.js";

async function main() {
  console.log("🚀 FlakeGuard Performance Benchmark Suite");
  console.log("==========================================\n");
  
  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    console.log("✅ Connected to database\n");
    
    // Run database benchmarks
    console.log("📊 Database Performance Benchmarks");
    console.log("-----------------------------------");
    const dbResults = await runDatabaseBenchmarks(prisma);
    console.log(dbResults);
    console.log("\n");
    
    // Run parser benchmarks
    console.log("🔍 JUnit Parser Performance Benchmarks");
    console.log("---------------------------------------");
    const parserResults = await runParserBenchmarks();
    console.log(parserResults);
    console.log("\n");
    
    // Run scoring benchmarks
    console.log("📈 Flakiness Scoring Performance Benchmarks");
    console.log("--------------------------------------------");
    const scoringResults = await runScoringBenchmarks();
    console.log(scoringResults);
    console.log("\n");
    
    console.log("✅ All benchmarks completed successfully!");
    
  } catch (error) {
    console.error("❌ Benchmark suite failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Add performance monitoring
function logMemoryUsage() {
  const usage = process.memoryUsage();
  console.log("Memory Usage:", {
    rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
    external: `${Math.round(usage.external / 1024 / 1024)}MB`,
  });
}

// Log memory usage every 10 seconds during benchmarks
setInterval(logMemoryUsage, 10000);

if (require.main === module) {
  main().catch(console.error);
}

export { main as runAllBenchmarks };
