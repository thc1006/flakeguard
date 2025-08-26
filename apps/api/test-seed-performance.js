import { performance } from 'perf_hooks';

// Simple performance test for the optimized seed script
async function testSeedPerformance() {
  console.log('Testing seed script performance...');
  
  // Test with small dataset
  process.env.SEED_NUM_REPOS = '2';
  process.env.SEED_NUM_RUNS_PER_REPO = '10';
  process.env.SEED_NUM_TEST_CASES_PER_REPO = '3';
  process.env.SEED_BATCH_SIZE = '50';
  process.env.SEED_PROGRESS_LOGS = 'false';
  
  const start = performance.now();
  
  try {
    const { seedData } = await import('./prisma/seed.ts');
    await seedData();
    
    const end = performance.now();
    const duration = (end - start) / 1000;
    
    console.log(`Seed completed in ${duration.toFixed(2)}s`);
    console.log('Performance targets:');
    console.log('- Target: < 30s for full dataset');
    console.log('- Target: > 100 occurrences/sec');
    console.log(`- Actual: ${duration.toFixed(2)}s for small dataset`);
    
    if (duration < 5) {
      console.log('✅ Performance test PASSED');
    } else {
      console.log('⚠️  Performance test WARNING - slower than expected');
    }
    
  } catch (error) {
    console.error('❌ Performance test FAILED:', error.message);
  }
}

testSeedPerformance().catch(console.error);
