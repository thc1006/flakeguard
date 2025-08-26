import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_CLUSTER_ENABLED: z.string().transform((val) => val === 'true').default('false'),
  REDIS_CLUSTER_NODES: z.string().optional(),
  WORKER_CONCURRENCY: z.string().transform(Number).default('5'),
  WORKER_NAME: z.string().default('flakeguard-worker'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  // GitHub Configuration
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_API_BASE_URL: z.string().default('https://api.github.com'),
  // Polling Configuration
  POLLING_ENABLED: z.string().transform((val) => val === 'true').default('true'),
  POLLING_INTERVAL_MINUTES: z.string().transform(Number).default('5'),
  POLLING_BATCH_SIZE: z.string().transform(Number).default('10'),
  // Metrics Configuration
  METRICS_PORT: z.string().transform(Number).default('9090'),
  METRICS_ENABLED: z.string().transform((val) => val === 'true').default('true'),
  // Health Check Configuration
  HEALTH_CHECK_PORT: z.string().transform(Number).default('8080'),
});

const env = envSchema.parse(process.env);

export const config = {
  env: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  redisClusterEnabled: env.REDIS_CLUSTER_ENABLED,
  redisClusterNodes: env.REDIS_CLUSTER_NODES,
  workerConcurrency: env.WORKER_CONCURRENCY,
  workerName: env.WORKER_NAME,
  logLevel: env.LOG_LEVEL,
  // GitHub Configuration
  github: {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    apiBaseUrl: env.GITHUB_API_BASE_URL,
  },
  // Polling Configuration
  polling: {
    enabled: env.POLLING_ENABLED,
    intervalMinutes: env.POLLING_INTERVAL_MINUTES,
    batchSize: env.POLLING_BATCH_SIZE,
  },
  // Metrics Configuration
  metrics: {
    port: env.METRICS_PORT,
    enabled: env.METRICS_ENABLED,
  },
  // Health Check Configuration
  healthCheck: {
    port: env.HEALTH_CHECK_PORT,
  },
} as const;