/**
 * Policy-as-Code Engine for FlakeGuard
 * 
 * Loads .flakeguard.yml from repositories using GitHub Contents API,
 * validates configuration with Zod schemas, and provides policy evaluation
 * with fallback to environment variable defaults.
 */

import type {
  TestResult,
  FlakeScore,
  QuarantineRecommendation,
} from '@flakeguard/shared';
import { DEFAULT_QUARANTINE_POLICY } from '@flakeguard/shared';
import type { Octokit } from '@octokit/rest';
import { minimatch } from 'minimatch';
import yaml from 'yaml';
import { z } from 'zod';

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * FlakeGuard policy configuration schema
 * Supports comprehensive policy definition with validation
 */
export const policyConfigSchema = z.object({
  // Core thresholds (0.0-1.0)
  flaky_threshold: z.number().min(0).max(1).default(0.6),
  warn_threshold: z.number().min(0).max(1).default(0.3),
  
  // Minimum criteria for actions
  min_occurrences: z.number().int().min(1).default(5),
  min_recent_failures: z.number().int().min(1).default(2),
  
  // Time-based settings
  lookback_days: z.number().int().min(1).max(365).default(7),
  rolling_window_size: z.number().int().min(5).max(500).default(50),
  
  // Path exclusions (glob patterns)
  exclude_paths: z.array(z.string()).default([
    'node_modules/**',
    '**/test/**',
    '**/*.spec.ts',
    '**/*.test.ts',
    'examples/**',
    'docs/**',
  ]),
  
  // Required PR labels for auto-quarantine
  labels_required: z.array(z.string()).default([]),
  
  // Quarantine management
  quarantine_duration_days: z.number().int().min(1).max(365).default(30),
  auto_quarantine_enabled: z.boolean().default(false),
  
  // Team-specific configuration
  team_notifications: z.object({
    slack_channels: z.record(z.string(), z.string()).optional(),
    email_groups: z.record(z.string(), z.array(z.string())).optional(),
  }).default({}),
  
  // Confidence and quality thresholds
  confidence_threshold: z.number().min(0).max(1).default(0.7),
  
  // Advanced scoring weights
  scoring_weights: z.object({
    intermittency_weight: z.number().min(0).max(1).default(0.30),
    rerun_weight: z.number().min(0).max(1).default(0.25),
    clustering_weight: z.number().min(0).max(1).default(0.15),
    message_variance_weight: z.number().min(0).max(1).default(0.10),
    fail_ratio_weight: z.number().min(0).max(1).default(0.10),
    consecutive_failure_penalty: z.number().min(0).max(1).default(0.10),
  }).default({}),
  
  // Exemptions and overrides
  exempted_tests: z.array(z.string()).default([]),
  team_overrides: z.record(z.string(), z.object({
    flaky_threshold: z.number().min(0).max(1).optional(),
    warn_threshold: z.number().min(0).max(1).optional(),
    auto_quarantine_enabled: z.boolean().optional(),
  })).default({}),
});

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

/**
 * Policy evaluation result with detailed decision rationale
 */
export interface PolicyDecision {
  readonly action: 'none' | 'warn' | 'quarantine';
  readonly reason: string;
  readonly confidence: number;
  readonly priority: 'low' | 'medium' | 'high' | 'critical';
  readonly metadata: {
    readonly policyVersion: string;
    readonly evaluatedAt: Date;
    readonly testPath?: string;
    readonly teamOverride?: string;
    readonly exempted?: boolean;
  };
}

/**
 * Cached policy configuration with metadata
 */
interface CachedPolicy {
  readonly config: PolicyConfig;
  readonly source: 'file' | 'defaults' | 'env';
  readonly loadedAt: Date;
  readonly expiresAt: Date;
  readonly sha?: string; // GitHub file SHA for cache invalidation
}

/**
 * Policy engine with caching and GitHub Contents API integration
 */
export class PolicyEngine {
  private readonly cache = new Map<string, CachedPolicy>();
  private readonly defaultPolicy: PolicyConfig;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Build default policy from environment variables and constants
    this.defaultPolicy = this.buildDefaultPolicy();
    logger.info('PolicyEngine initialized with default policy', {
      warnThreshold: this.defaultPolicy.warn_threshold,
      quarantineThreshold: this.defaultPolicy.flaky_threshold,
      minOccurrences: this.defaultPolicy.min_occurrences,
    });
  }

  /**
   * Load policy configuration for a repository
   * Uses caching to avoid repeated GitHub API calls
   */
  async loadPolicy(
    octokit: Octokit,
    owner: string,
    repo: string,
    ref = 'HEAD'
  ): Promise<PolicyConfig> {
    const cacheKey = `${owner}/${repo}:${ref}`;
    const cached = this.cache.get(cacheKey);
    
    // Return cached policy if still valid
    if (cached && Date.now() < cached.expiresAt.getTime()) {
      logger.debug('Using cached policy configuration', { 
        owner, 
        repo, 
        source: cached.source,
        age: Math.floor((Date.now() - cached.loadedAt.getTime()) / 1000)
      });
      return cached.config;
    }

    try {
      logger.info('Loading policy configuration from repository', { owner, repo, ref });
      
      // Attempt to load .flakeguard.yml from repository
      const response = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: '.flakeguard.yml',
        ref,
      });

      if (Array.isArray(response.data) || response.data.type !== 'file') {
        throw new Error('Expected .flakeguard.yml to be a file');
      }

      if (!response.data.content) {
        throw new Error('.flakeguard.yml file has no content');
      }

      // Decode and parse YAML content
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      const rawConfig = yaml.parse(content);
      
      // Validate with Zod schema
      const config = policyConfigSchema.parse(rawConfig);
      
      // Cache the validated configuration
      const cachedPolicy: CachedPolicy = {
        config,
        source: 'file',
        loadedAt: new Date(),
        expiresAt: new Date(Date.now() + this.cacheTtlMs),
        sha: response.data.sha,
      };
      
      this.cache.set(cacheKey, cachedPolicy);
      
      logger.info('Successfully loaded and cached policy from .flakeguard.yml', {
        owner,
        repo,
        sha: response.data.sha?.substring(0, 7),
        warnThreshold: config.warn_threshold,
        quarantineThreshold: config.flaky_threshold,
      });
      
      return config;

    } catch (error: any) {
      logger.warn('Failed to load .flakeguard.yml, using defaults', {
        owner,
        repo,
        error: error.message,
        status: error.status,
      });

      // Cache default policy to avoid repeated failed API calls
      const cachedPolicy: CachedPolicy = {
        config: this.defaultPolicy,
        source: error.status === 404 ? 'defaults' : 'env',
        loadedAt: new Date(),
        expiresAt: new Date(Date.now() + this.cacheTtlMs),
      };
      
      this.cache.set(cacheKey, cachedPolicy);
      
      return this.defaultPolicy;
    }
  }

  /**
   * Evaluate policy for a set of test results
   */
  async evaluatePolicy(
    tests: readonly TestResult[],
    policy: PolicyConfig,
    repository: { owner: string; repo: string },
    options: {
      teamContext?: string;
      pullRequestLabels?: string[];
    } = {}
  ): Promise<readonly PolicyDecision[]> {
    const decisions: PolicyDecision[] = [];
    const evaluatedAt = new Date();
    
    logger.debug('Evaluating policy for tests', {
      testCount: tests.length,
      repository: `${repository.owner}/${repository.repo}`,
      teamContext: options.teamContext,
    });

    for (const test of tests) {
      const decision = this.evaluateTestPolicy(test, policy, repository, {
        ...options,
        evaluatedAt,
      });
      decisions.push(decision);
    }

    // Log summary of policy decisions
    const summary = this.summarizeDecisions(decisions);
    logger.info('Policy evaluation completed', {
      repository: `${repository.owner}/${repository.repo}`,
      ...summary,
    });

    return decisions;
  }

  /**
   * Evaluate policy for a single test result
   */
  private evaluateTestPolicy(
    test: TestResult,
    policy: PolicyConfig,
    repository: { owner: string; repo: string },
    context: {
      teamContext?: string;
      pullRequestLabels?: string[];
      evaluatedAt: Date;
    }
  ): PolicyDecision {
    const testPath = this.extractTestPath(test);
    
    // Check if test is exempted
    if (this.isTestExempted(test, policy)) {
      return {
        action: 'none',
        reason: 'Test is explicitly exempted in policy configuration',
        confidence: 1.0,
        priority: 'low',
        metadata: {
          policyVersion: '1.0',
          evaluatedAt: context.evaluatedAt,
          testPath,
          exempted: true,
        },
      };
    }

    // Check path exclusions
    if (this.isPathExcluded(testPath, policy.exclude_paths)) {
      return {
        action: 'none',
        reason: `Test path "${testPath}" matches exclusion pattern`,
        confidence: 1.0,
        priority: 'low',
        metadata: {
          policyVersion: '1.0',
          evaluatedAt: context.evaluatedAt,
          testPath,
        },
      };
    }

    // Get effective thresholds (including team overrides)
    const thresholds = this.getEffectiveThresholds(policy, context.teamContext);
    
    // Check if test has sufficient data for analysis
    const flakeAnalysis = test.flakeAnalysis;
    if (!flakeAnalysis) {
      return {
        action: 'none',
        reason: 'No flakiness analysis data available for test',
        confidence: 0.1,
        priority: 'low',
        metadata: {
          policyVersion: '1.0',
          evaluatedAt: context.evaluatedAt,
          testPath,
        },
      };
    }

    // Check minimum occurrences requirement
    if (flakeAnalysis.totalRuns < policy.min_occurrences) {
      return {
        action: 'none',
        reason: `Insufficient data: only ${flakeAnalysis.totalRuns} runs (minimum: ${policy.min_occurrences})`,
        confidence: 0.2,
        priority: 'low',
        metadata: {
          policyVersion: '1.0',
          evaluatedAt: context.evaluatedAt,
          testPath,
        },
      };
    }

    // Check recent failures requirement
    if (flakeAnalysis.historicalFailures < policy.min_recent_failures) {
      return {
        action: 'none',
        reason: `Too few recent failures: ${flakeAnalysis.historicalFailures} (minimum: ${policy.min_recent_failures})`,
        confidence: 0.3,
        priority: 'low',
        metadata: {
          policyVersion: '1.0',
          evaluatedAt: context.evaluatedAt,
          testPath,
        },
      };
    }

    // Check confidence threshold
    if (flakeAnalysis.confidence < policy.confidence_threshold) {
      return {
        action: 'none',
        reason: `Low confidence in flakiness analysis: ${flakeAnalysis.confidence.toFixed(3)} < ${policy.confidence_threshold}`,
        confidence: flakeAnalysis.confidence,
        priority: 'low',
        metadata: {
          policyVersion: '1.0',
          evaluatedAt: context.evaluatedAt,
          testPath,
        },
      };
    }

    // Determine action based on flakiness score and thresholds
    const score = flakeAnalysis.failureRate;
    const priority = this.determinePriority(score, flakeAnalysis);
    
    if (score >= thresholds.quarantineThreshold) {
      // Check if auto-quarantine is enabled and PR has required labels
      const canAutoQuarantine = this.canAutoQuarantine(policy, context.pullRequestLabels);
      
      return {
        action: 'quarantine',
        reason: `High flakiness score (${score.toFixed(3)}) exceeds quarantine threshold (${thresholds.quarantineThreshold})${
          canAutoQuarantine ? ' - auto-quarantine enabled' : ''
        }`,
        confidence: flakeAnalysis.confidence,
        priority,
        metadata: {
          policyVersion: '1.0',
          evaluatedAt: context.evaluatedAt,
          testPath,
          teamOverride: context.teamContext,
        },
      };
    }

    if (score >= thresholds.warnThreshold) {
      return {
        action: 'warn',
        reason: `Moderate flakiness score (${score.toFixed(3)}) exceeds warning threshold (${thresholds.warnThreshold})`,
        confidence: flakeAnalysis.confidence,
        priority: priority === 'critical' || priority === 'high' ? 'medium' : 'low',
        metadata: {
          policyVersion: '1.0',
          evaluatedAt: context.evaluatedAt,
          testPath,
          teamOverride: context.teamContext,
        },
      };
    }

    return {
      action: 'none',
      reason: `Low flakiness score (${score.toFixed(3)}) below warning threshold (${thresholds.warnThreshold})`,
      confidence: flakeAnalysis.confidence,
      priority: 'low',
      metadata: {
        policyVersion: '1.0',
        evaluatedAt: context.evaluatedAt,
        testPath,
      },
    };
  }

  /**
   * Check if test is explicitly exempted
   */
  private isTestExempted(test: TestResult, policy: PolicyConfig): boolean {
    const testFullName = test.name;
    return policy.exempted_tests.some(pattern => 
      minimatch(testFullName, pattern)
    );
  }

  /**
   * Check if test path matches any exclusion patterns
   */
  private isPathExcluded(testPath: string | undefined, excludePaths: string[]): boolean {
    if (!testPath) {return false;}
    
    return excludePaths.some(pattern => 
      minimatch(testPath, pattern, { matchBase: true, dot: true })
    );
  }

  /**
   * Get effective thresholds including team overrides
   */
  private getEffectiveThresholds(
    policy: PolicyConfig, 
    teamContext?: string
  ): { warnThreshold: number; quarantineThreshold: number } {
    const baseThresholds = {
      warnThreshold: policy.warn_threshold,
      quarantineThreshold: policy.flaky_threshold,
    };

    if (!teamContext || !policy.team_overrides[teamContext]) {
      return baseThresholds;
    }

    const override = policy.team_overrides[teamContext];
    return {
      warnThreshold: override.warn_threshold ?? baseThresholds.warnThreshold,
      quarantineThreshold: override.flaky_threshold ?? baseThresholds.quarantineThreshold,
    };
  }

  /**
   * Determine priority level based on flakiness metrics
   */
  private determinePriority(
    score: number, 
    analysis: NonNullable<TestResult['flakeAnalysis']>
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: very high flakiness with clear patterns
    if (score > 0.8 && analysis.confidence > 0.8) {
      return 'critical';
    }
    
    // High: high flakiness score with good confidence
    if (score > 0.7 || (score > 0.5 && analysis.confidence > 0.9)) {
      return 'high';
    }
    
    // Medium: moderate flakiness
    if (score > 0.4) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Check if auto-quarantine is allowed based on policy and PR labels
   */
  private canAutoQuarantine(
    policy: PolicyConfig, 
    pullRequestLabels?: string[]
  ): boolean {
    if (!policy.auto_quarantine_enabled) {
      return false;
    }

    if (policy.labels_required.length === 0) {
      return true;
    }

    if (!pullRequestLabels) {
      return false;
    }

    return policy.labels_required.every(required => 
      pullRequestLabels.includes(required)
    );
  }

  /**
   * Extract test file path from test result
   */
  private extractTestPath(test: TestResult): string | undefined {
    // Try to extract path from test name or stack trace
    // This is a heuristic and may need adjustment based on test frameworks
    if (test.stackTrace) {
      const pathMatch = test.stackTrace.match(/\s+at .+\((.+):\d+:\d+\)/);
      if (pathMatch) {
        return pathMatch[1];
      }
    }
    
    // Fallback to test name if it contains path-like information
    if (test.name.includes('/') || test.name.includes('\\')) {
      return test.name.split(' ')[0]; // Take first part which might be a path
    }
    
    return undefined;
  }

  /**
   * Summarize policy decisions for logging
   */
  private summarizeDecisions(decisions: readonly PolicyDecision[]): {
    total: number;
    none: number;
    warn: number;
    quarantine: number;
    highPriority: number;
    exempted: number;
  } {
    return {
      total: decisions.length,
      none: decisions.filter(d => d.action === 'none').length,
      warn: decisions.filter(d => d.action === 'warn').length,
      quarantine: decisions.filter(d => d.action === 'quarantine').length,
      highPriority: decisions.filter(d => d.priority === 'high' || d.priority === 'critical').length,
      exempted: decisions.filter(d => d.metadata.exempted).length,
    };
  }

  /**
   * Build default policy from environment variables and constants
   */
  private buildDefaultPolicy(): PolicyConfig {
    const envThresholds = this.loadEnvironmentThresholds();
    
    return policyConfigSchema.parse({
      flaky_threshold: envThresholds.quarantineThreshold,
      warn_threshold: envThresholds.warnThreshold,
      min_occurrences: DEFAULT_QUARANTINE_POLICY.minRunsForQuarantine,
      min_recent_failures: DEFAULT_QUARANTINE_POLICY.minRecentFailures,
      lookback_days: DEFAULT_QUARANTINE_POLICY.lookbackDays,
      rolling_window_size: DEFAULT_QUARANTINE_POLICY.rollingWindowSize,
    });
  }

  /**
   * Load threshold values from environment variables
   */
  private loadEnvironmentThresholds(): {
    warnThreshold: number;
    quarantineThreshold: number;
  } {
    const warnThreshold = process.env.FLAKE_WARN_THRESHOLD 
      ? parseFloat(process.env.FLAKE_WARN_THRESHOLD)
      : DEFAULT_QUARANTINE_POLICY.warnThreshold;
      
    const quarantineThreshold = process.env.FLAKE_QUARANTINE_THRESHOLD 
      ? parseFloat(process.env.FLAKE_QUARANTINE_THRESHOLD)
      : DEFAULT_QUARANTINE_POLICY.quarantineThreshold;

    return { warnThreshold, quarantineThreshold };
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): void {
    const now = Date.now();
    for (const [key, cached] of this.cache.entries()) {
      if (now >= cached.expiresAt.getTime()) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate cache for specific repository
   */
  invalidateCache(owner: string, repo: string): void {
    const prefix = `${owner}/${repo}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): {
    size: number;
    expired: number;
    hitsBySource: Record<string, number>;
  } {
    const now = Date.now();
    let expired = 0;
    const hitsBySource: Record<string, number> = {};
    
    for (const [key, cached] of this.cache.entries()) {
      if (now >= cached.expiresAt.getTime()) {
        expired++;
      }
      hitsBySource[cached.source] = (hitsBySource[cached.source] ?? 0) + 1;
    }

    return {
      size: this.cache.size,
      expired,
      hitsBySource,
    };
  }
}

/**
 * Create singleton policy engine instance
 */
let policyEngine: PolicyEngine | null = null;

export function getPolicyEngine(): PolicyEngine {
  if (!policyEngine) {
    policyEngine = new PolicyEngine();
  }
  return policyEngine;
}

/**
 * Validate policy configuration with detailed error reporting
 */
export function validatePolicyConfig(config: unknown): {
  success: boolean;
  data?: PolicyConfig;
  errors?: string[];
} {
  try {
    const validated = policyConfigSchema.parse(config);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      );
      return { success: false, errors };
    }
    return { success: false, errors: [String(error)] };
  }
}

/**
 * Create policy configuration from partial input with validation
 */
export function createPolicyConfig(
  input: Partial<PolicyConfig>
): PolicyConfig {
  return policyConfigSchema.parse(input);
}
