export const QueueNames = {
  EMAIL: 'email',
  TASK: 'task',
  REPORT: 'report',
  INGESTION: 'ingestion',
  SLACK: 'slack',
  // Enhanced Background Workers (P7)
  RUNS_INGEST: 'runs:ingest',
  RUNS_ANALYZE: 'runs:analyze',
  TESTS_RECOMPUTE: 'tests:recompute',
  POLLING: 'polling',
} as const;

export const JobPriorities = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  CRITICAL: 4,
} as const;

export const DEFAULT_PAGINATION = {
  LIMIT: 50,
  OFFSET: 0,
} as const;

export const API_ROUTES = {
  HEALTH: '/health',
  USERS: '/api/users',
  TASKS: '/api/tasks',
  INGESTION: '/api/ingestion',
} as const;

export const INGESTION_ROUTES = {
  PROCESS: '/api/ingestion/process',
  STATUS: '/api/ingestion/status',
  HISTORY: '/api/ingestion/history',
} as const;

export const ARTIFACT_FILTERS = {
  TEST_RESULTS: {
    namePatterns: ['test-results', 'junit', 'test-report', 'surefire-reports'],
    extensions: ['.xml', '.zip'],
    maxSizeBytes: 100 * 1024 * 1024, // 100MB
  },
  COVERAGE_REPORTS: {
    namePatterns: ['coverage', 'jacoco', 'cobertura', 'lcov'],
    extensions: ['.xml', '.json', '.zip'],
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
  },
} as const;

export const INGESTION_SETTINGS = {
  DEFAULT_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  DEFAULT_CONCURRENCY: 3,
  GITHUB_ARTIFACT_EXPIRY_MS: 60 * 1000, // 1 minute
} as const;

export const DEFAULT_QUARANTINE_POLICY = {
  warnThreshold: 0.3,
  quarantineThreshold: 0.6,
  minRunsForQuarantine: 5,
  minRecentFailures: 2,
  lookbackDays: 7,
  rollingWindowSize: 50,
} as const;

// Background Worker Configuration
export const WORKER_CONFIG = {
  DEFAULT_CONCURRENCY: 5,
  HIGH_PRIORITY_CONCURRENCY: 3,
  MEDIUM_PRIORITY_CONCURRENCY: 4,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 5000,
  MAX_RETRY_DELAY_MS: 30000,
  BACKOFF_MULTIPLIER: 2,
  STALLED_JOB_TIMEOUT_MS: 30000,
  MAX_EVENTS: 10000,
  REMOVE_ON_COMPLETE: 100,
  REMOVE_ON_FAIL: 50,
} as const;

// GitHub API Rate Limiting
export const GITHUB_RATE_LIMITS = {
  PRIMARY_RATE_LIMIT: 5000,  // per hour
  SECONDARY_RATE_LIMIT: 100, // per hour for search
  BACKOFF_BASE_MS: 1000,
  BACKOFF_MAX_MS: 60000,
  JITTER_FACTOR: 0.1,
} as const;

// Polling Configuration
export const POLLING_CONFIG = {
  INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  MAX_REPOSITORIES_PER_BATCH: 10,
  WORKFLOW_RUN_LOOKBACK_HOURS: 24,
  CURSOR_PAGINATION_LIMIT: 100,
} as const;

// Flakiness Analysis
export const FLAKINESS_CONFIG = {
  MIN_RUNS_FOR_ANALYSIS: 5,
  FLAKINESS_THRESHOLD: 0.1, // 10% flakiness rate
  HIGH_FLAKINESS_THRESHOLD: 0.3, // 30% flakiness rate
  ANALYSIS_WINDOW_DAYS: 30,
  SCORE_DECAY_FACTOR: 0.95,
} as const;

// Metrics and Monitoring
export const METRICS_CONFIG = {
  COLLECTION_INTERVAL_MS: 15000, // 15 seconds
  HISTOGRAM_BUCKETS: [0.1, 0.3, 0.5, 0.7, 1, 2, 5, 10, 30, 60],
  DEFAULT_LABELS: {
    service: 'flakeguard-worker',
    version: '1.0.0',
  },
} as const;

// Slack Integration Performance
export const SLACK_CONFIG = {
  MAX_MESSAGE_SIZE: 40000, // 40KB Slack limit
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  RATE_LIMIT_MAX_MESSAGES: 100, // per window
  CONNECTION_TIMEOUT_MS: 5000,
  DEFAULT_RETRY_ATTEMPTS: 3,
  TEMPLATE_CACHE_SIZE: 100,
  TEMPLATE_CACHE_TTL_MS: 300000, // 5 minutes
  BATCH_PROCESSING_DELAY_MS: 100,
} as const;
