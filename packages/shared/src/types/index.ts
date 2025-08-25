export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
  page?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SortParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterParams extends PaginationParams, SortParams {
  search?: string;
}

// Export GitHub-related types (avoiding conflicts)
export {
  CHECK_RUN_ACTIONS,
  CHECK_RUN_CONCLUSIONS,
  CHECK_RUN_STATUS,
  WORKFLOW_RUN_CONCLUSIONS,
  WORKFLOW_RUN_STATUS,
  GitHubAppConfig,
  FlakeAnalysis,
  FlakeGuardCheckRun,
  SupportedWebhookEvent,
  WebhookPayload,
  WebhookEventMap,
  ApiResponse as GitHubApiResponse,
  PaginatedResponse as GitHubPaginatedResponse,
  GitHubRepository,
  GitHubInstallationContext,
  FlakeDetectionResult,
  TestExecutionSummary,
  WebhookProcessingStatus,
  CheckRunOutput,
  CheckRunActionDef,
  RequestedAction,
  ActionResult,
  ActionHandler,
  TestInfo,
  RepositoryContext,
  GitHubCheckRunResponse,
  GitHubIssueResponse,
  GitHubWorkflowRunResponse,
  // Renamed to avoid conflicts
  TestResult as GitHubTestResult,
  RepositoryInfo as GitHubRepositoryInfo,
} from './github.js';

export * from './ingestion.js';
export * from './analytics.js';