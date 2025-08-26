/**
 * Optimized Flakiness Scorer with Caching
 */
import type { TestRun, FlakeScore } from "@flakeguard/shared";

import { FlakinessScorer } from "../analytics/flakiness.js";
import { FlakeScoreCache as _FlakeScoreCache } from "../performance/cache-layer.js";

export class OptimizedFlakinessScorer extends FlakinessScorer {
  // private cache = new FlakeScoreCache(); // Unused for now

  computeFlakeScore(runs: readonly TestRun[]): FlakeScore {
    if (runs.length === 0) {
      throw new Error("Cannot compute flake score with no test runs");
    }

    // For sync operation, we'll compute directly
    // TODO: Implement async caching in a separate method
    const score = super.computeFlakeScore(runs);

    return score;
  }

  // Batch scoring with optimizations
  computeMultipleFlakeScores(
    testRunGroups: Map<string, TestRun[]>
  ): Map<string, FlakeScore> {
    const results = new Map<string, FlakeScore>();
    
    // Process synchronously for now
    testRunGroups.forEach((runs, testName) => {
      try {
        const score = this.computeFlakeScore(runs);
        results.set(testName, score);
      } catch (error) {
        console.error(`Failed to compute score for ${testName}:`, error);
        // Continue processing other tests
      }
    });
    
    return results;
  }
}
