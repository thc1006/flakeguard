export interface WizardOptions {
  dryRun: boolean;
  transcriptFile?: string;
  language: 'en' | 'zh-TW';
  configTemplate?: string;
  skipValidation: boolean;
  verbose: boolean;
}

export interface SetupState {
  currentStage: SetupStage;
  completed: SetupStage[];
  config: Record<string, unknown>;
  validations: Record<string, ValidationResult>;
}

export type SetupStage = 
  | 'welcome'
  | 'validation'
  | 'environment'
  | 'database'
  | 'github'
  | 'slack'
  | 'configuration'
  | 'healthcheck'
  | 'completion';

export interface ValidationResult {
  valid: boolean;
  message: string;
  critical?: boolean;
  suggestions?: string[];
  details?: unknown;
}

export interface DatabaseConfig {
  DATABASE_URL: string;
  REDIS_URL: string;
}

export interface GitHubConfig {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY?: string;
  GITHUB_PRIVATE_KEY_PATH?: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

export interface SlackConfig {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_APP_TOKEN: string;
  SLACK_PORT: number;
  ENABLE_SLACK_APP: boolean;
}

export interface EnvironmentConfig {
  NODE_ENV: string;
  PORT: number;
  HOST: string;
  CORS_ORIGIN: string;
  JWT_SECRET: string;
  API_KEY: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
  details?: string;
  responseTime?: number;
}

export interface ConfigTemplate {
  name: string;
  description: string;
  environment: 'development' | 'production' | 'staging' | 'test';
  config: Record<string, unknown>;
}

export interface TranscriptEntry {
  timestamp: string;
  level: 'info' | 'error' | 'warn' | 'debug';
  stage: string;
  message: string;
  data?: unknown;
}

export interface I18nMessages {
  [key: string]: string | I18nMessages;
}

export interface SystemRequirements {
  node: string;
  pnpm?: string;
  docker?: boolean;
  postgres?: boolean;
  redis?: boolean;
}

export interface PortCheck {
  port: number;
  available: boolean;
  service?: string;
}

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheckResult[];
  uptime?: number;
  version?: string;
}