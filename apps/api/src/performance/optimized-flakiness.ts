/**
 * Optimized Flakiness Scorer with Caching
 */
import type { TestRun, FlakeScore } from "@flakeguard/shared";

import { FlakeScoreCache } from "../performance/cache-layer.js";

import { FlakinessScorer } from "./flakiness.js";

export class OptimizedFlakinessScorer extends FlakinessScorer {
  private cache = new FlakeScoreCache();

  async computeFlakeScore(runs: readonly TestRun[]): Promise<FlakeScore> {
    if (runs.length === 0) {
      throw new Error("Cannot compute flake score with no test runs");
    }

    const testFullName = runs[0].testFullName;
    const repositoryId = runs[0].repositoryId || "unknown";
    
    // Create cache key based on latest run timestamp
    const latestRun = runs.reduce((latest, run) => 
      run.createdAt > latest.createdAt ? run : latest
    );
    const cacheKey = `${repositoryId}:${testFullName}:${latestRun.createdAt.getTime()}`;
    
    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached as FlakeScore;
    }

    // Compute score using parent implementation
    const score = super.computeFlakeScore(runs);

    // Cache result for 5 minutes
    await this.cache.set(cacheKey, score, 300);

    return score;
  }

  // Batch scoring with optimizations
  async computeMultipleFlakeScores(
    testRunGroups: Map<string, TestRun[]>,
    options: { maxConcurrency?: number } = {}
  ): Promise<Map<string, FlakeScore>> {
    const { maxConcurrency = 10 } = options;
    const results = new Map<string, FlakeScore>();
    
    // Process in batches to control memory usage
    const testNames = Array.from(testRunGroups.keys());
    
    for (let i = 0; i < testNames.length; i += maxConcurrency) {
      const batch = testNames.slice(i, i + maxConcurrency);
      
      const promises = batch.map(async (testName) => {
        const runs = testRunGroups.get(testName)!;
        try {
          const score = await this.computeFlakeScore(runs);
          return [testName, score] as [string, FlakeScore];
        } catch (error) {
          console.error(`Failed to compute score for ${testName}:`, error);
          return null;
        }
      });
      
      const batchResults = await Promise.all(promises);
      
      batchResults.forEach(result => {
        if (result) {
          results.set(result[0], result[1]);
        }
      });
    }
    
    return results;
  }
}
