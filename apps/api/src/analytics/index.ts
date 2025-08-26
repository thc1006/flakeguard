/**
 * Analytics module exports
 * Comprehensive flaky test detection and analysis
 */

// Main flakiness scorer
export { FlakinessScorer } from './flakiness.js';

// Clustering analysis
export { 
  FailureClusteringAnalyzer,
  type ClusterAnalysisResult,
  type ClusterPatterns,
  type ClusterMetrics,
} from './clustering.js';

// Unified detection engine
export {
  FlakeDetectionEngine,
  type ComprehensiveAnalysis,
  type PatternAnalysis,
  type PatternIndicator,
  type EnvironmentalAnalysis,
  type EnvironmentalFactor,
} from './detection-engine.js';

// Re-export shared types for convenience
export type {
  TestRun,
  FlakeScore,
  FlakeFeatures,
  QuarantinePolicy,
  QuarantineRecommendation,
  QuarantineCandidate,
  QuarantinePlan,
  MessageSignature,
  FailureCluster,
  TestStabilityMetrics,
} from '@flakeguard/shared';