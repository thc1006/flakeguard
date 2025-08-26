import type { FailureCluster, TestRun } from '@flakeguard/shared';

/**
 * Advanced clustering algorithms for failure analysis
 * Provides complementary clustering analysis to the main flakiness scorer
 */
export class FailureClusteringAnalyzer {
  /**
   * Analyze temporal clustering patterns in test failures
   * Uses multiple algorithms to identify different failure patterns
   */
  public analyzeClusters(runs: readonly TestRun[]): ClusterAnalysisResult {
    const failedRuns = runs.filter(run => run.status === 'failed' || run.status === 'error');
    
    if (failedRuns.length < 2) {
      return {
        clusters: [],
        patterns: {
          burstiness: 0,
          periodicity: 0,
          randomness: 1,
        },
        metrics: {
          totalClusters: 0,
          avgClusterSize: 0,
          clusterDensityVariance: 0,
          temporalSpread: 0,
        },
      };
    }

    const clusters = this.identifyTemporalClusters(failedRuns);
    const patterns = this.analyzePatterns(clusters, runs);
    const metrics = this.calculateClusterMetrics(clusters, failedRuns);

    return {
      clusters,
      patterns,
      metrics,
    };
  }

  /**
   * Identify temporal clusters using adaptive thresholding
   */
  private identifyTemporalClusters(failedRuns: readonly TestRun[]): FailureCluster[] {
    const sortedRuns = [...failedRuns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    
    if (sortedRuns.length < 2) {
      return [];
    }

    // Calculate adaptive threshold based on typical gap between runs
    const gaps = this.calculateTimeGaps(sortedRuns);
    const adaptiveThreshold = this.calculateAdaptiveThreshold(gaps);

    return this.buildClusters(sortedRuns, adaptiveThreshold);
  }

  /**
   * Calculate time gaps between consecutive failed runs
   */
  private calculateTimeGaps(sortedRuns: readonly TestRun[]): number[] {
    const gaps: number[] = [];
    
    for (let i = 1; i < sortedRuns.length; i++) {
      const current = sortedRuns[i];
      const previous = sortedRuns[i - 1];
      
      if (current && previous) {
        gaps.push(current.createdAt.getTime() - previous.createdAt.getTime());
      }
    }
    
    return gaps;
  }

  /**
   * Calculate adaptive threshold using statistical methods
   */
  private calculateAdaptiveThreshold(gaps: number[]): number {
    if (gaps.length === 0) {
      return 2 * 60 * 60 * 1000; // Default 2 hours
    }

    // Use median + IQR method for robust threshold
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const q1 = sortedGaps[Math.floor(sortedGaps.length * 0.25)] ?? 0;
    const q3 = sortedGaps[Math.floor(sortedGaps.length * 0.75)] ?? 0;
    const iqr = q3 - q1;
    
    // Adaptive threshold: Q3 + 1.5 * IQR (outlier detection)
    return Math.max(30 * 60 * 1000, q3 + 1.5 * iqr); // Min 30 minutes
  }

  /**
   * Build clusters using the adaptive threshold
   */
  private buildClusters(sortedRuns: readonly TestRun[], threshold: number): FailureCluster[] {
    const clusters: FailureCluster[] = [];
    const firstRun = sortedRuns[0];
    if (!firstRun) {
      return clusters;
    }
    let currentCluster: TestRun[] = [firstRun];

    for (let i = 1; i < sortedRuns.length; i++) {
      const current = sortedRuns[i];
      const previous = sortedRuns[i - 1];
      
      if (!current || !previous) {
        continue;
      }
      
      const gap = current.createdAt.getTime() - previous.createdAt.getTime();
      
      if (gap <= threshold) {
        currentCluster.push(current);
      } else {
        // End current cluster and start new one
        if (currentCluster.length > 1) {
          clusters.push(this.createCluster(currentCluster));
        }
        currentCluster = [current];
      }
    }
    
    // Add final cluster if it has multiple runs
    if (currentCluster.length > 1) {
      clusters.push(this.createCluster(currentCluster));
    }
    
    return clusters;
  }

  /**
   * Create a cluster object from runs
   */
  private createCluster(runs: TestRun[]): FailureCluster {
    const sortedRuns = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const firstRun = sortedRuns[0];
    const lastRun = sortedRuns[sortedRuns.length - 1];
    
    if (!firstRun || !lastRun) {
      throw new Error('Cannot create cluster from empty runs');
    }
    
    const start = firstRun.createdAt;
    const end = lastRun.createdAt;
    const duration = end.getTime() - start.getTime();
    
    // Calculate density (failures per minute)
    const density = runs.length / Math.max(1, duration / (60 * 1000));
    
    // Calculate average gap between failures in cluster
    let totalGap = 0;
    for (let i = 1; i < sortedRuns.length; i++) {
      const current = sortedRuns[i];
      const previous = sortedRuns[i - 1];
      
      if (current && previous) {
        totalGap += current.createdAt.getTime() - previous.createdAt.getTime();
      }
    }
    const avgGap = runs.length > 1 ? totalGap / (runs.length - 1) / 1000 : 0; // in seconds
    
    return {
      timeWindow: { start, end },
      runs: sortedRuns,
      density,
      avgGap,
    };
  }

  /**
   * Analyze failure patterns from clusters
   */
  private analyzePatterns(clusters: readonly FailureCluster[], allRuns: readonly TestRun[]): ClusterPatterns {
    if (clusters.length === 0) {
      return {
        burstiness: 0,
        periodicity: 0,
        randomness: 1,
      };
    }

    const burstiness = this.calculateBurstiness(clusters);
    const periodicity = this.calculatePeriodicity(clusters, allRuns);
    const randomness = this.calculateRandomness(clusters, allRuns);

    return {
      burstiness,
      periodicity,
      randomness,
    };
  }

  /**
   * Calculate burstiness score (tendency for failures to occur in bursts)
   */
  private calculateBurstiness(clusters: readonly FailureCluster[]): number {
    if (clusters.length === 0) {
      return 0;
    }

    // Burstiness is measured by cluster density variance
    const densities = clusters.map(c => c.density);
    const avgDensity = densities.reduce((sum, d) => sum + d, 0) / densities.length;
    
    const variance = densities.reduce((sum, d) => sum + Math.pow(d - avgDensity, 2), 0) / densities.length;
    const coefficient = avgDensity > 0 ? Math.sqrt(variance) / avgDensity : 0;
    
    // Normalize to 0-1 scale
    return Math.min(1, coefficient);
  }

  /**
   * Calculate periodicity score (tendency for failures to occur at regular intervals)
   */
  private calculatePeriodicity(clusters: readonly FailureCluster[], _allRuns: readonly TestRun[]): number {
    if (clusters.length < 3) {
      return 0; // Need at least 3 clusters to detect periodicity
    }

    // Calculate intervals between cluster centers
    const clusterCenters = clusters.map(cluster => {
      const start = cluster.timeWindow.start.getTime();
      const end = cluster.timeWindow.end.getTime();
      return (start + end) / 2;
    }).sort((a, b) => a - b);

    const intervals: number[] = [];
    for (let i = 1; i < clusterCenters.length; i++) {
      const current = clusterCenters[i];
      const previous = clusterCenters[i - 1];
      
      if (current !== undefined && previous !== undefined) {
        intervals.push(current - previous);
      }
    }

    // Check for regularity in intervals
    if (intervals.length === 0) {
      return 0;
    }

    const avgInterval = intervals.reduce((sum, i) => sum + i, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const coefficient = avgInterval > 0 ? Math.sqrt(variance) / avgInterval : 1;

    // Lower coefficient means more periodic (regular intervals)
    return Math.max(0, 1 - coefficient);
  }

  /**
   * Calculate randomness score (how random the failure distribution is)
   */
  private calculateRandomness(clusters: readonly FailureCluster[], allRuns: readonly TestRun[]): number {
    const totalTime = this.getTotalTimeSpan(allRuns);
    if (totalTime === 0) {
      return 1;
    }

    // Compare actual cluster distribution to expected random distribution
    const clusterSizes = clusters.map(c => c.runs.length);
    const totalFailures = clusterSizes.reduce((sum, size) => sum + size, 0);
    
    if (totalFailures === 0) {
      return 1;
    }

    // Expected cluster size for random distribution
    const expectedClusterSize = totalFailures / Math.max(1, clusters.length);
    
    // Calculate variance from expected
    const variance = clusterSizes.reduce((sum, size) => 
      sum + Math.pow(size - expectedClusterSize, 2), 0) / clusters.length;
    
    const coefficient = expectedClusterSize > 0 ? Math.sqrt(variance) / expectedClusterSize : 0;
    
    // Higher coefficient means less random (more structured)
    return Math.max(0, 1 - Math.min(1, coefficient));
  }

  /**
   * Calculate comprehensive cluster metrics
   */
  private calculateClusterMetrics(clusters: readonly FailureCluster[], _allFailedRuns: readonly TestRun[]): ClusterMetrics {
    if (clusters.length === 0) {
      return {
        totalClusters: 0,
        avgClusterSize: 0,
        clusterDensityVariance: 0,
        temporalSpread: 0,
      };
    }

    const clusterSizes = clusters.map(c => c.runs.length);
    const avgClusterSize = clusterSizes.reduce((sum, size) => sum + size, 0) / clusters.length;

    const densities = clusters.map(c => c.density);
    const avgDensity = densities.reduce((sum, d) => sum + d, 0) / densities.length;
    const clusterDensityVariance = densities.reduce((sum, d) => sum + Math.pow(d - avgDensity, 2), 0) / densities.length;

    const temporalSpread = this.calculateTemporalSpread(clusters);

    return {
      totalClusters: clusters.length,
      avgClusterSize,
      clusterDensityVariance,
      temporalSpread,
    };
  }

  /**
   * Calculate temporal spread of clusters
   */
  private calculateTemporalSpread(clusters: readonly FailureCluster[]): number {
    if (clusters.length === 0) {
      return 0;
    }

    const allTimes = clusters.flatMap(cluster => [
      cluster.timeWindow.start.getTime(),
      cluster.timeWindow.end.getTime(),
    ]);

    const minTime = Math.min(...allTimes);
    const maxTime = Math.max(...allTimes);

    return maxTime - minTime;
  }

  /**
   * Get total time span of all runs
   */
  private getTotalTimeSpan(runs: readonly TestRun[]): number {
    if (runs.length === 0) {
      return 0;
    }

    const times = runs.map(r => r.createdAt.getTime());
    return Math.max(...times) - Math.min(...times);
  }
}

// Type definitions
export interface ClusterAnalysisResult {
  readonly clusters: readonly FailureCluster[];
  readonly patterns: ClusterPatterns;
  readonly metrics: ClusterMetrics;
}

export interface ClusterPatterns {
  readonly burstiness: number;      // 0-1, tendency for failures to occur in bursts
  readonly periodicity: number;     // 0-1, tendency for regular failure intervals
  readonly randomness: number;      // 0-1, how random the distribution is
}

export interface ClusterMetrics {
  readonly totalClusters: number;
  readonly avgClusterSize: number;
  readonly clusterDensityVariance: number;
  readonly temporalSpread: number; // milliseconds
}