/**
 * GitHub Checks API Integration Helpers
 * 
 * Provides comprehensive GitHub Checks API helpers with:
 * - Check run creation and updates with proper status transitions
 * - Rate limit handling with exponential backoff
 * - Retry logic for transient failures
 * - Status transitions: queued → in_progress → completed
 * - Proper error handling and logging
 */

import type { Octokit } from '@octokit/rest';

import { logger } from '../utils/logger.js';

import { ErrorCode } from './api-spec.js';
import { ERROR_MESSAGES } from './constants.js';
import type {
  CheckRunStatus,
  CheckRunConclusion,
  CheckRunAction,
  ApiResponse,
  FlakeGuardCheckRun,
} from './types.js';

/**
 * Check run output interface
 */
export interface CheckRunOutput {
  readonly title: string;
  readonly summary: string;
  readonly text?: string;
  readonly annotationsCount?: number;
  readonly annotationsUrl?: string;
}

/**
 * Check run action definition
 */
export interface CheckRunActionDef {
  readonly label: string;
  readonly description: string;
  readonly identifier: CheckRunAction;
}

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  readonly maxRetries: number;
  readonly baseDelay: number;
  readonly maxDelay: number;
  readonly backoffMultiplier: number;
}

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
};

/**
 * Create a new GitHub Check Run with proper error handling and retries
 * 
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param headSha - Git commit SHA
 * @param output - Check run output content
 * @param options - Additional options for check run creation
 */
export async function createCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  output: CheckRunOutput,
  options: {
    name?: string;
    status?: CheckRunStatus;
    conclusion?: CheckRunConclusion;
    actions?: readonly CheckRunActionDef[];
    detailsUrl?: string;
    externalId?: string;
  } = {}
): Promise<ApiResponse<FlakeGuardCheckRun>> {
  const {
    name = 'FlakeGuard Analysis',
    status = 'completed',
    conclusion,
    actions = [],
    detailsUrl,
    externalId,
  } = options;

  const startTime = new Date().toISOString();
  const completedTime = status === 'completed' ? startTime : undefined;

  logger.info('Creating GitHub check run', {
    owner,
    repo,
    name,
    headSha: headSha.substring(0, 7),
    status,
    conclusion,
    actionsCount: actions.length,
  });

  try {
    const result = await executeWithRetry(async () => {
      const { data } = await octokit.rest.checks.create({
        owner,
        repo,
        name,
        head_sha: headSha,
        status: status as any,
        conclusion: status === 'completed' ? (conclusion as any) : undefined,
        started_at: startTime,
        completed_at: completedTime,
        details_url: detailsUrl,
        external_id: externalId,
        output: {
          title: output.title,
          summary: output.summary,
          text: output.text,
        },
        actions: actions.slice(0, 3).map(action => ({
          label: action.label,
          description: action.description,
          identifier: action.identifier,
        })),
      });
      return data;
    });

    const checkRun: FlakeGuardCheckRun = {
      id: result.id,
      name: result.name,
      headSha: result.head_sha,
      status: result.status as CheckRunStatus,
      conclusion: result.conclusion as CheckRunConclusion | null,
      startedAt: result.started_at,
      completedAt: result.completed_at,
      output: {
        title: result.output?.title || output.title,
        summary: result.output?.summary || output.summary,
        text: result.output?.text || output.text,
      },
      actions: ((result as any).actions || []).map((action: any) => ({
        label: action.label,
        description: action.description,
        identifier: action.identifier as CheckRunAction,
      })),
    };

    logger.info('GitHub check run created successfully', {
      checkRunId: result.id,
      name: result.name,
      status: result.status,
      conclusion: result.conclusion,
    });

    return { success: true, data: checkRun };

  } catch (error: any) {
    logger.error('Failed to create GitHub check run', {
      owner,
      repo,
      name,
      headSha: headSha.substring(0, 7),
      error: error.message,
      status: error.status,
    });

    return {
      success: false,
      error: {
        code: mapGitHubErrorCode(error),
        message: error.message || ERROR_MESSAGES.GITHUB_API_ERROR,
        details: {
          status: error.status,
          response: error.response?.data,
        },
      },
    };
  }
}

/**
 * Update an existing GitHub Check Run with proper status transitions
 * 
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param checkRunId - ID of the check run to update
 * @param output - Updated output content
 * @param options - Additional options for check run update
 */
export async function updateCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRunId: number,
  output: CheckRunOutput,
  options: {
    status?: CheckRunStatus;
    conclusion?: CheckRunConclusion;
    actions?: readonly CheckRunActionDef[];
    detailsUrl?: string;
  } = {}
): Promise<ApiResponse<FlakeGuardCheckRun>> {
  const { status, conclusion, actions = [], detailsUrl } = options;

  const completedTime = status === 'completed' ? new Date().toISOString() : undefined;

  logger.info('Updating GitHub check run', {
    owner,
    repo,
    checkRunId,
    status,
    conclusion,
    actionsCount: actions.length,
  });

  try {
    const result = await executeWithRetry(async () => {
      const { data } = await octokit.rest.checks.update({
        owner,
        repo,
        check_run_id: checkRunId,
        status: status as any,
        conclusion: status === 'completed' ? (conclusion as any) : undefined,
        completed_at: completedTime,
        details_url: detailsUrl,
        output: {
          title: output.title,
          summary: output.summary,
          text: output.text,
        },
        actions: actions.slice(0, 3).map(action => ({
          label: action.label,
          description: action.description,
          identifier: action.identifier,
        })),
      });
      return data;
    });

    const checkRun: FlakeGuardCheckRun = {
      id: result.id,
      name: result.name,
      headSha: result.head_sha,
      status: result.status as CheckRunStatus,
      conclusion: result.conclusion as CheckRunConclusion | null,
      startedAt: result.started_at,
      completedAt: result.completed_at,
      output: {
        title: result.output?.title || output.title,
        summary: result.output?.summary || output.summary,
        text: result.output?.text || output.text,
      },
      actions: ((result as any).actions || []).map((action: any) => ({
        label: action.label,
        description: action.description,
        identifier: action.identifier as CheckRunAction,
      })),
    };

    logger.info('GitHub check run updated successfully', {
      checkRunId,
      status: result.status,
      conclusion: result.conclusion,
    });

    return { success: true, data: checkRun };

  } catch (error: any) {
    logger.error('Failed to update GitHub check run', {
      owner,
      repo,
      checkRunId,
      error: error.message,
      status: error.status,
    });

    return {
      success: false,
      error: {
        code: mapGitHubErrorCode(error),
        message: error.message || ERROR_MESSAGES.GITHUB_API_ERROR,
        details: {
          status: error.status,
          response: error.response?.data,
        },
      },
    };
  }
}

/**
 * Execute API call with exponential backoff retry logic for rate limits
 */
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on non-rate-limit errors on the last attempt
      if (attempt === config.maxRetries) {
        break;
      }

      // Only retry on rate limit errors (429) or server errors (5xx)
      if (error.status === 429 || (error.status >= 500 && error.status < 600)) {
        const delay = calculateBackoffDelay(attempt, config, error);
        
        logger.warn('GitHub API rate limited or server error, retrying', {
          attempt: attempt + 1,
          maxRetries: config.maxRetries,
          status: error.status,
          delay,
          resetTime: error.response?.headers?.['x-ratelimit-reset'],
        });

        await sleep(delay);
        continue;
      }
      
      // Don't retry on other errors (4xx client errors)
      break;
    }
  }
  
  throw lastError;
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  config: RateLimitConfig,
  error?: any
): number {
  // If we have rate limit reset time, use it
  if (error?.response?.headers?.['x-ratelimit-reset']) {
    const resetTime = parseInt(error.response.headers['x-ratelimit-reset'], 10) * 1000;
    const now = Date.now();
    const timeUntilReset = resetTime - now;
    
    if (timeUntilReset > 0 && timeUntilReset < config.maxDelay) {
      // Add small jitter to avoid thundering herd
      return timeUntilReset + Math.random() * 1000;
    }
  }

  // Standard exponential backoff with jitter
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
  const jitter = Math.random() * config.baseDelay;
  const delay = Math.min(exponentialDelay + jitter, config.maxDelay);
  
  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Map GitHub API errors to internal error codes
 */
function mapGitHubErrorCode(error: any): string {
  switch (error.status) {
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return error.message.includes('rate limit') 
        ? ErrorCode.GITHUB_RATE_LIMITED 
        : ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.RESOURCE_NOT_FOUND;
    case 422:
      return ErrorCode.VALIDATION_ERROR;
    case 429:
      return ErrorCode.GITHUB_RATE_LIMITED;
    case 502:
    case 503:
    case 504:
      return ErrorCode.GITHUB_SERVICE_UNAVAILABLE;
    default:
      if (error.status >= 500) {
        return ErrorCode.GITHUB_SERVICE_UNAVAILABLE;
      }
      return ErrorCode.GITHUB_API_ERROR;
  }
}

/**
 * Validate check run status transition
 */
export function validateStatusTransition(
  currentStatus: CheckRunStatus | null,
  newStatus: CheckRunStatus
): boolean {
  // Valid transitions:
  // null -> queued
  // null -> in_progress
  // null -> completed
  // queued -> in_progress
  // queued -> completed
  // in_progress -> completed
  
  if (!currentStatus) {
    return true; // Any initial status is valid
  }
  
  if (currentStatus === 'completed') {
    return false; // Cannot transition from completed
  }
  
  if (currentStatus === 'queued') {
    return newStatus === 'in_progress' || newStatus === 'completed';
  }
  
  if (currentStatus === 'in_progress') {
    return newStatus === 'completed';
  }
  
  return false;
}

/**
 * Create check run with status progression (queued -> in_progress -> completed)
 */
export async function createCheckRunWithProgression(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  name: string,
  finalOutput: CheckRunOutput,
  finalOptions: {
    conclusion?: CheckRunConclusion;
    actions?: readonly CheckRunActionDef[];
    detailsUrl?: string;
  } = {}
): Promise<ApiResponse<FlakeGuardCheckRun>> {
  logger.info('Creating check run with status progression', {
    owner,
    repo,
    name,
    headSha: headSha.substring(0, 7),
  });

  try {
    // Step 1: Create as queued
    const queuedResult = await createCheckRun(
      octokit,
      owner,
      repo,
      headSha,
      {
        title: 'Analysis Queued',
        summary: 'FlakeGuard analysis has been queued for processing.',
      },
      {
        name,
        status: 'queued',
      }
    );

    if (!queuedResult.success || !queuedResult.data) {
      return queuedResult;
    }

    const checkRunId = queuedResult.data.id;

    // Step 2: Update to in_progress
    await updateCheckRun(
      octokit,
      owner,
      repo,
      checkRunId,
      {
        title: 'Analysis In Progress',
        summary: 'FlakeGuard is analyzing test results and patterns.',
      },
      {
        status: 'in_progress',
      }
    );

    // Step 3: Complete with final results
    const finalResult = await updateCheckRun(
      octokit,
      owner,
      repo,
      checkRunId,
      finalOutput,
      {
        status: 'completed',
        conclusion: finalOptions.conclusion,
        actions: finalOptions.actions,
        detailsUrl: finalOptions.detailsUrl,
      }
    );

    logger.info('Check run progression completed successfully', {
      checkRunId,
      name,
    });

    return finalResult;

  } catch (error: any) {
    logger.error('Failed to create check run with progression', {
      owner,
      repo,
      name,
      error: error.message,
    });

    return {
      success: false,
      error: {
        code: mapGitHubErrorCode(error),
        message: error.message || ERROR_MESSAGES.GITHUB_API_ERROR,
      },
    };
  }
}
