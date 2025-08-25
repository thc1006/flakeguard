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
  apiKey: 'FAKE_API_KEY_FOR_TESTS_ONLY_123',
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
    privateKey: '-----BEGIN FAKE PRIVATE KEY FOR TESTS ONLY-----\nTHIS_IS_A_FAKE_KEY_FOR_TESTING_PURPOSES_ONLY\nDO_NOT_USE_IN_PRODUCTION_ENVIRONMENTS\n-----END FAKE PRIVATE KEY FOR TESTS ONLY-----',
    webhookSecret: 'test-webhook-secret',
    clientId: 'test-github-client-id',
    clientSecret: 'test-github-client-secret',
  },

  slack: null,
} as const;

export type TestConfig = typeof testConfig;