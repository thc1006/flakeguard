/**
 * GitHub API Helpers
 *
 * Comprehensive helper functions for GitHub API operations including:
 * - Check run helper functions with up to 3 requested actions
 * - Workflow re-run functionality for failed jobs and complete workflows
 * - Artifact listing and one-shot download URL generation
 * - Authentication and client management
 * - Rate limiting and retry logic
 * - Error handling and logging
 */
import { GitHubAuthManager } from './auth.js';
import type { CheckRunAction, FlakeAnalysis, CreateCheckRunParams, UpdateCheckRunParams, FlakeGuardCheckRun, TestArtifact, ApiResponse } from './types.js';
/**
 * Flake issue creation parameters
 */
export interface FlakeIssueParams {
    readonly testName: string;
    readonly confidence: number;
    readonly failureRate: number;
    readonly failurePattern: string | null;
    readonly checkRunUrl: string;
}
/**
 * Flake summary for repository
 */
export interface FlakeSummary {
    readonly totalFlaky: number;
    readonly totalQuarantined: number;
    readonly recentlyDetected: number;
    readonly topFlaky: ReadonlyArray<{
        readonly testName: string;
        readonly confidence: number;
        readonly failureRate: number;
        readonly lastFailureAt: string | null;
    }>;
}
/**
 * GitHub API Helpers class
 */
export declare class GitHubHelpers {
    private readonly authManager;
    constructor(authManager: GitHubAuthManager);
    /**
     * Create a check run with FlakeGuard branding and actions
     */
    createCheckRun(owner: string, repo: string, params: Omit<CreateCheckRunParams, 'owner' | 'repo'>, installationId: number): Promise<ApiResponse<FlakeGuardCheckRun>>;
    /**
     * Update a check run with new status, conclusion, and actions
     */
    updateCheckRun(owner: string, repo: string, checkRunId: number, installationId: number, updates: Omit<UpdateCheckRunParams, 'checkRunId'>): Promise<ApiResponse<FlakeGuardCheckRun>>;
    /**
     * Update check run with flake actions
     */
    updateCheckRunWithFlakeActions(owner: string, repo: string, checkRunId: number, installationId: number): Promise<void>;
    /**
     * Update check run with flake detection results
     */
    updateCheckRunWithFlakeDetection(owner: string, repo: string, checkRunId: number, installationId: number, analysis: FlakeAnalysis, suggestedActions: readonly CheckRunAction[]): Promise<void>;
    /**
     * Create FlakeGuard check run for detected flaky test
     */
    createFlakeGuardCheckRun(owner: string, repo: string, headSha: string, installationId: number, params: {
        testName: string;
        isFlaky: boolean;
        confidence: number;
        failurePattern: string | null;
        suggestedActions: readonly CheckRunAction[];
    }): Promise<void>;
    /**
     * Create FlakeGuard summary check run
     */
    createFlakeGuardSummaryCheckRun(owner: string, repo: string, headSha: string, installationId: number, summary: FlakeSummary, hasFailures: boolean): Promise<void>;
    /**
     * Rerun entire workflow
     */
    rerunWorkflow(owner: string, repo: string, runId: number, installationId: number, options?: {
        enableDebugLogging?: boolean;
    }): Promise<{
        success: true;
        message: string;
        runId: number;
    }>;
    /**
     * Rerun only failed jobs in a workflow
     */
    rerunFailedJobs(owner: string, repo: string, runId: number, installationId: number, options?: {
        enableDebugLogging?: boolean;
    }): Promise<{
        success: true;
        message: string;
        runId: number;
    }>;
    /**
     * Cancel workflow run
     */
    cancelWorkflow(owner: string, repo: string, runId: number, installationId: number): Promise<{
        success: true;
        message: string;
    }>;
    /**
     * Get workflow jobs
     */
    getWorkflowJobs(owner: string, repo: string, runId: number, installationId: number): Promise<any[]>;
    /**
     * List artifacts for a workflow run
     */
    listArtifacts(owner: string, repo: string, runId: number, installationId: number, options?: {
        page?: number;
        perPage?: number;
        name?: string;
    }): Promise<TestArtifact[]>;
    /**
     * Generate download URL for artifact
     */
    generateArtifactDownloadUrl(owner: string, repo: string, artifactId: number, installationId: number): Promise<{
        downloadUrl: string;
        expiresAt: string;
        sizeInBytes: number;
    }>;
    /**
     * Create GitHub issue for flaky test
     */
    createFlakeIssue(owner: string, repo: string, installationId: number, params: FlakeIssueParams): Promise<void>;
    private generateFlakeDetectionSummary;
    private getConfidenceLabel;
    private inferArtifactType;
    private mapGitHubErrorCode;
}
/**
 * Create GitHub helpers instance
 */
export declare function createGitHubHelpers(authManager: GitHubAuthManager): GitHubHelpers;
//# sourceMappingURL=helpers.d.ts.map