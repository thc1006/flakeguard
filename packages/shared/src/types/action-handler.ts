/**
 * Action Handler Types for FlakeGuard
 * These types define the interface for handling GitHub Check Run actions
 */

export interface TestInfo {
  readonly name: string;
  readonly confidence: number;
  readonly failureRate: number;
  readonly failurePattern: string | null;
  readonly lastFailureAt: string | null;
  readonly totalRuns: number;
  readonly historicalFailures: number;
}

export interface RepositoryContext {
  readonly owner: string;
  readonly repo: string;
  readonly fullName: string;
  readonly installationId: number;
  readonly defaultBranch: string;
}

export interface ActionResult {
  readonly success: boolean;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
}

export type ActionHandler = (
  octokit: any,
  test: TestInfo,
  repository: RepositoryContext,
  metadata?: Record<string, unknown>
) => Promise<ActionResult>;