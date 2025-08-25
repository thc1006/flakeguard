/**
 * Test Configuration
 * Provides minimal, safe configuration for unit tests
 */

export const testConfig = {
  env: 'test' as const,
  port: 3001,
  host: '0.0.0.0',
  databaseUrl: 'postgresql://test:test@localhost:5432/flakeguard_test',
  redisUrl: 'redis://localhost:6379',
  jwtSecret: 'test-jwt-secret-32-chars-minimum-length-for-security',
  apiKey: 'test-api-key-16-chars-minimum',
  rateLimitMax: 100,
  rateLimitWindow: 60000,
  logLevel: 'error' as const,
  corsOrigin: 'http://localhost:3000',
  
  policy: {
    warnThreshold: 0.3,
    quarantineThreshold: 0.6,
  },
  
  features: {
    slackApp: false,
    githubWebhooks: true,
    quarantineActions: true,
  },
  
  github: {
    appId: 12345,
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA4f5wg5l2hKsTeNem/V41fGnJm6gOdrj8ym3rFkEjWT2JjSBP\n-----END RSA PRIVATE KEY-----',
    webhookSecret: 'test-webhook-secret',
    clientId: 'test-github-client-id',
    clientSecret: 'test-github-client-secret',
  },

  slack: null,
} as const;

export type TestConfig = typeof testConfig;