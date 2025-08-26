/**
 * Comprehensive Zod schemas for GitHub App integration
 * Provides runtime validation for webhooks, configuration, and API responses
 */

import { z } from 'zod';

import {
  CHECK_RUN_ACTIONS,
  CHECK_RUN_CONCLUSIONS,
  CHECK_RUN_STATUS,
  WORKFLOW_RUN_CONCLUSIONS,
  WORKFLOW_RUN_STATUS,
} from './types.js';

// =============================================================================
// GITHUB APP CONFIGURATION SCHEMAS
// =============================================================================

export const githubAppConfigSchema = z.object({
  appId: z.number().int().positive(),
  privateKey: z.string().min(1),
  webhookSecret: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  installationId: z.number().int().positive().optional(),
});

export const githubAppCredentialsSchema = z.object({
  appId: z.number().int().positive(),
  privateKey: z.string().min(1),
  installationId: z.number().int().positive(),
});

// =============================================================================
// ENVIRONMENT CONFIGURATION SCHEMAS
// =============================================================================

export const githubEnvSchema = z.object({
  GITHUB_APP_ID: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive()),
  GITHUB_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
}).refine(
  (data) => data.GITHUB_PRIVATE_KEY || data.GITHUB_PRIVATE_KEY_PATH,
  {
    message: "Either GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH must be provided",
    path: ["GITHUB_PRIVATE_KEY"],
  }
);

// =============================================================================
// WEBHOOK PAYLOAD SCHEMAS
// =============================================================================

const repositorySchema = z.object({
  id: z.number().int(),
  node_id: z.string(),
  name: z.string(),
  full_name: z.string(),
  owner: z.object({
    login: z.string(),
    id: z.number().int(),
    type: z.enum(['User', 'Organization']),
  }),
  private: z.boolean(),
  default_branch: z.string(),
  pushed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const senderSchema = z.object({
  login: z.string(),
  id: z.number().int(),
  type: z.enum(['User', 'Bot', 'Organization']),
});

const installationSchema = z.object({
  id: z.number().int(),
  account: z.object({
    login: z.string(),
    id: z.number().int(),
    type: z.enum(['User', 'Organization']),
  }),
});

// Check Run Webhook Schema
export const checkRunWebhookSchema = z.object({
  action: z.enum([
    'created',
    'completed',
    'rerequested',
    'requested_action',
  ]),
  check_run: z.object({
    id: z.number().int(),
    name: z.string(),
    head_sha: z.string(),
    status: z.enum(CHECK_RUN_STATUS),
    conclusion: z.enum(CHECK_RUN_CONCLUSIONS).nullable(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    output: z.object({
      title: z.string().nullable(),
      summary: z.string().nullable(),
      text: z.string().nullable(),
    }),
  }),
  requested_action: z.object({
    identifier: z.enum(CHECK_RUN_ACTIONS),
  }).optional(),
  repository: repositorySchema,
  installation: installationSchema,
  sender: senderSchema,
});

// Check Suite Webhook Schema
export const checkSuiteWebhookSchema = z.object({
  action: z.enum([
    'completed',
    'requested',
    'rerequested',
  ]),
  check_suite: z.object({
    id: z.number().int(),
    head_branch: z.string().nullable(),
    head_sha: z.string(),
    status: z.enum(['queued', 'in_progress', 'completed']),
    conclusion: z.enum([
      'success',
      'failure',
      'neutral',
      'cancelled',
      'skipped',
      'timed_out',
      'action_required',
      'stale',
    ]).nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  repository: repositorySchema,
  installation: installationSchema,
});

// Workflow Run Webhook Schema
export const workflowRunWebhookSchema = z.object({
  action: z.enum([
    'completed',
    'requested',
    'in_progress',
  ]),
  workflow_run: z.object({
    id: z.number().int(),
    name: z.string().nullable(),
    head_branch: z.string(),
    head_sha: z.string(),
    status: z.enum(WORKFLOW_RUN_STATUS),
    conclusion: z.enum(WORKFLOW_RUN_CONCLUSIONS).nullable(),
    workflow_id: z.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
    run_started_at: z.string().nullable(),
  }),
  workflow: z.object({
    id: z.number().int(),
    name: z.string(),
    path: z.string(),
  }),
  repository: repositorySchema,
  installation: installationSchema,
  sender: senderSchema,
});

// Workflow Job Webhook Schema
export const workflowJobWebhookSchema = z.object({
  action: z.enum([
    'queued',
    'in_progress',
    'completed',
    'waiting',
  ]),
  workflow_job: z.object({
    id: z.number().int(),
    run_id: z.number().int(),
    name: z.string(),
    status: z.enum(['queued', 'in_progress', 'completed', 'waiting']),
    conclusion: z.enum([
      'success',
      'failure',
      'cancelled',
      'skipped',
      'neutral',
      'timed_out',
    ]).nullable(),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    steps: z.array(z.object({
      name: z.string(),
      status: z.enum(['queued', 'in_progress', 'completed']),
      conclusion: z.enum([
        'success',
        'failure',
        'cancelled',
        'skipped',
        'neutral',
        'timed_out',
      ]).nullable(),
      number: z.number().int(),
      started_at: z.string().nullable(),
      completed_at: z.string().nullable(),
    })),
  }),
  repository: repositorySchema,
  installation: installationSchema,
});

// Pull Request Webhook Schema
export const pullRequestWebhookSchema = z.object({
  action: z.enum([
    'opened',
    'closed',
    'reopened',
    'synchronize',
    'edited',
    'ready_for_review',
    'converted_to_draft',
  ]),
  pull_request: z.object({
    id: z.number().int(),
    number: z.number().int(),
    title: z.string(),
    state: z.enum(['open', 'closed']),
    draft: z.boolean(),
    head: z.object({
      ref: z.string(),
      sha: z.string(),
      repo: repositorySchema.nullable(),
    }),
    base: z.object({
      ref: z.string(),
      sha: z.string(),
      repo: repositorySchema,
    }),
    merged: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  repository: repositorySchema,
  installation: installationSchema,
});

// Push Webhook Schema
export const pushWebhookSchema = z.object({
  ref: z.string(),
  before: z.string(),
  after: z.string(),
  created: z.boolean(),
  deleted: z.boolean(),
  forced: z.boolean(),
  commits: z.array(z.object({
    id: z.string(),
    message: z.string(),
    timestamp: z.string(),
    author: z.object({
      name: z.string(),
      email: z.string(),
    }),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    modified: z.array(z.string()),
  })),
  head_commit: z.object({
    id: z.string(),
    message: z.string(),
    timestamp: z.string(),
    author: z.object({
      name: z.string(),
      email: z.string(),
    }),
  }).nullable(),
  repository: repositorySchema,
  installation: installationSchema,
});

// Installation Webhook Schema
export const installationWebhookSchema = z.object({
  action: z.enum([
    'created',
    'deleted',
    'suspend',
    'unsuspend',
    'new_permissions_accepted',
  ]),
  installation: z.object({
    id: z.number().int(),
    account: z.object({
      login: z.string(),
      id: z.number().int(),
      type: z.enum(['User', 'Organization']),
    }),
    repository_selection: z.enum(['all', 'selected']),
    permissions: z.record(z.enum(['read', 'write', 'admin'])),
    events: z.array(z.string()),
    created_at: z.string(),
    updated_at: z.string(),
    suspended_at: z.string().nullable(),
  }),
  repositories: z.array(z.object({
    id: z.number().int(),
    name: z.string(),
    full_name: z.string(),
  })).optional(),
  sender: senderSchema,
});

// =============================================================================
// API RESPONSE SCHEMAS
// =============================================================================

export const apiResponseSchema = <T extends z.ZodType>(dataSchema: T) => z.object({
  success: z.boolean(),
  data: dataSchema.optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }).optional(),
  pagination: z.object({
    page: z.number().int().positive(),
    perPage: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).optional(),
});

export const paginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) => z.object({
  success: z.literal(true),
  data: z.array(itemSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    perPage: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

// =============================================================================
// CHECK RUN AND TEST RESULT SCHEMAS
// =============================================================================

export const flakeAnalysisSchema = z.object({
  isFlaky: z.boolean(),
  confidence: z.number().min(0).max(1),
  failurePattern: z.string().nullable(),
  historicalFailures: z.number().int().nonnegative(),
  totalRuns: z.number().int().positive(),
  failureRate: z.number().min(0).max(1),
  lastFailureAt: z.string().nullable(),
  suggestedAction: z.enum(CHECK_RUN_ACTIONS).nullable(),
});

export const testResultSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['passed', 'failed', 'skipped']),
  duration: z.number().nonnegative().optional(),
  errorMessage: z.string().optional(),
  stackTrace: z.string().optional(),
  flakeAnalysis: flakeAnalysisSchema.optional(),
});

export const flakeGuardCheckRunSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  headSha: z.string().min(1),
  status: z.enum(CHECK_RUN_STATUS),
  conclusion: z.enum(CHECK_RUN_CONCLUSIONS).nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  output: z.object({
    title: z.string(),
    summary: z.string(),
    text: z.string().optional(),
  }),
  actions: z.array(z.object({
    label: z.string().min(1),
    description: z.string().min(1),
    identifier: z.enum(CHECK_RUN_ACTIONS),
  })),
});

// =============================================================================
// ARTIFACT SCHEMAS
// =============================================================================

export const artifactMetadataSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  sizeInBytes: z.number().int().nonnegative(),
  url: z.string().url(),
  archiveDownloadUrl: z.string().url(),
  expired: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
  updatedAt: z.string(),
});

export const testArtifactSchema = artifactMetadataSchema.extend({
  type: z.enum(['test-results', 'coverage-report', 'logs', 'screenshots']),
  testResults: z.array(testResultSchema).optional(),
});

// =============================================================================
// REQUEST PARAMETER SCHEMAS
// =============================================================================

export const createCheckRunParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  name: z.string().min(1),
  headSha: z.string().min(1),
  status: z.enum(CHECK_RUN_STATUS).optional(),
  conclusion: z.enum(CHECK_RUN_CONCLUSIONS).optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  output: z.object({
    title: z.string(),
    summary: z.string(),
    text: z.string().optional(),
  }).optional(),
  actions: z.array(z.object({
    label: z.string().min(1),
    description: z.string().min(1),
    identifier: z.enum(CHECK_RUN_ACTIONS),
  })).optional(),
});

export const updateCheckRunParamsSchema = z.object({
  checkRunId: z.number().int().positive(),
  status: z.enum(CHECK_RUN_STATUS).optional(),
  conclusion: z.enum(CHECK_RUN_CONCLUSIONS).optional(),
  completedAt: z.string().optional(),
  output: z.object({
    title: z.string(),
    summary: z.string(),
    text: z.string().optional(),
  }).optional(),
  actions: z.array(z.object({
    label: z.string().min(1),
    description: z.string().min(1),
    identifier: z.enum(CHECK_RUN_ACTIONS),
  })).optional(),
});

export const repositoryParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export const workflowRunParamsSchema = repositoryParamsSchema.extend({
  runId: z.number().int().positive(),
});

export const checkRunListParamsSchema = repositoryParamsSchema.extend({
  ref: z.string().min(1),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(30),
});

// =============================================================================
// WEBHOOK SIGNATURE VALIDATION SCHEMA
// =============================================================================

export const webhookHeadersSchema = z.object({
  'x-github-event': z.string().min(1),
  'x-github-delivery': z.string().min(1),
  'x-hub-signature-256': z.string().min(1),
  'content-type': z.literal('application/json'),
});

// =============================================================================
// INSTALLATION TOKEN SCHEMA
// =============================================================================

export const installationTokenSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
  permissions: z.record(z.enum(['read', 'write', 'admin'])),
  repositorySelection: z.enum(['all', 'selected']),
  repositories: z.array(z.object({
    id: z.number().int(),
    name: z.string(),
    fullName: z.string(),
  })).optional(),
});

// =============================================================================
// DISCRIMINATED UNION SCHEMAS FOR WEBHOOK EVENTS
// =============================================================================

export const webhookEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('check_run'),
    payload: checkRunWebhookSchema,
  }),
  z.object({
    event: z.literal('check_suite'),
    payload: checkSuiteWebhookSchema,
  }),
  z.object({
    event: z.literal('workflow_run'),
    payload: workflowRunWebhookSchema,
  }),
  z.object({
    event: z.literal('workflow_job'),
    payload: workflowJobWebhookSchema,
  }),
  z.object({
    event: z.literal('pull_request'),
    payload: pullRequestWebhookSchema,
  }),
  z.object({
    event: z.literal('push'),
    payload: pushWebhookSchema,
  }),
  z.object({
    event: z.literal('installation'),
    payload: installationWebhookSchema,
  }),
]);

// =============================================================================
// ERROR RESPONSE SCHEMA
// =============================================================================

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    stack: z.string().optional(),
  }),
});

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Type-safe webhook payload validation
 */
export function validateWebhookPayload<T extends keyof typeof webhookValidators>(
  event: T,
  payload: unknown
): z.infer<typeof webhookValidators[T]> {
  const validator = webhookValidators[event];
  if (!validator) {
    throw new Error(`No validator found for event: ${event}`);
  }
  return validator.parse(payload);
}

/**
 * Webhook validators mapping
 */
export const webhookValidators = {
  'check_run': checkRunWebhookSchema,
  'check_suite': checkSuiteWebhookSchema,
  'workflow_run': workflowRunWebhookSchema,
  'workflow_job': workflowJobWebhookSchema,
  'pull_request': pullRequestWebhookSchema,
  'push': pushWebhookSchema,
  'installation': installationWebhookSchema,
} as const;

// =============================================================================
// TYPE EXPORTS FOR INFERRED TYPES
// =============================================================================

export type GitHubAppConfig = z.infer<typeof githubAppConfigSchema>;
export type GitHubAppCredentials = z.infer<typeof githubAppCredentialsSchema>;
export type GitHubEnv = z.infer<typeof githubEnvSchema>;
export type CheckRunWebhookPayload = z.infer<typeof checkRunWebhookSchema>;
export type CheckSuiteWebhookPayload = z.infer<typeof checkSuiteWebhookSchema>;
export type WorkflowRunWebhookPayload = z.infer<typeof workflowRunWebhookSchema>;
export type WorkflowJobWebhookPayload = z.infer<typeof workflowJobWebhookSchema>;
export type PullRequestWebhookPayload = z.infer<typeof pullRequestWebhookSchema>;
export type PushWebhookPayload = z.infer<typeof pushWebhookSchema>;
export type InstallationWebhookPayload = z.infer<typeof installationWebhookSchema>;
export type FlakeAnalysis = z.infer<typeof flakeAnalysisSchema>;
export type TestResult = z.infer<typeof testResultSchema>;
export type FlakeGuardCheckRun = z.infer<typeof flakeGuardCheckRunSchema>;
export type TestArtifact = z.infer<typeof testArtifactSchema>;
export type CreateCheckRunParams = z.infer<typeof createCheckRunParamsSchema>;
export type UpdateCheckRunParams = z.infer<typeof updateCheckRunParamsSchema>;
export type InstallationToken = z.infer<typeof installationTokenSchema>;
export type WebhookEvent = z.infer<typeof webhookEventSchema>;