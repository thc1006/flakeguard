import { randomBytes, generateKeyPairSync } from 'node:crypto';

/**
 * Utilities for generating cryptographic keys and secrets for testing.
 * This ensures that test files don't contain hardcoded secrets or private keys.
 */
export class TestCrypto {
  /**
   * Generates a random secret of specified length in bytes.
   */
  static generateSecret(bytes: number = 32): string {
    return randomBytes(bytes).toString('hex');
  }

  /**
   * Generates a random webhook secret suitable for HMAC signatures.
   */
  static generateWebhookSecret(): string {
    return this.generateSecret(32);
  }

  /**
   * Generates a random JWT secret of minimum required length (32 characters).
   */
  static generateJwtSecret(): string {
    return this.generateSecret(16); // 32 hex characters
  }

  /**
   * Generates a random API key.
   */
  static generateApiKey(): string {
    return this.generateSecret(16); // 32 hex characters
  }

  /**
   * Generates a random client secret for OAuth.
   */
  static generateClientSecret(): string {
    return this.generateSecret(24); // 48 hex characters
  }

  /**
   * Generates a random bot token (simulates Slack bot token format).
   */
  static generateBotToken(): string {
    const prefix = 'xoxb-test-';
    const suffix = this.generateSecret(16);
    return `${prefix}${suffix}`;
  }

  /**
   * Generates a random GitHub token (simulates GitHub token format).
   */
  static generateGitHubToken(): string {
    const prefix = 'ghs_';
    const suffix = this.generateSecret(20);
    return `${prefix}${suffix}`;
  }

  /**
   * Generates an RSA key pair suitable for GitHub App authentication.
   * Returns the private key in PEM format.
   */
  static generateRsaKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return { publicKey, privateKey };
  }

  /**
   * Generates a GitHub App private key in the format expected by tests.
   * This creates a real RSA private key at runtime instead of using hardcoded values.
   */
  static generateGitHubAppPrivateKey(): string {
    const { privateKey } = this.generateRsaKeyPair();
    return privateKey;
  }

  /**
   * Generates a base64-encoded private key (useful for environment variables).
   */
  static generateBase64PrivateKey(): string {
    const privateKey = this.generateGitHubAppPrivateKey();
    return Buffer.from(privateKey).toString('base64');
  }

  /**
   * Generates a signing secret for Slack webhook verification.
   */
  static generateSlackSigningSecret(): string {
    return this.generateSecret(32);
  }

  /**
   * Generates a CSRF token.
   */
  static generateCsrfToken(): string {
    return this.generateSecret(32);
  }

  /**
   * Cache for keys to avoid regenerating during test suites
   * This is reset between test runs to ensure fresh keys per suite
   */
  private static keyCache = new Map<string, string>();

  /**
   * Gets a cached key or generates a new one if not exists.
   * Useful for maintaining consistent keys within a single test suite.
   */
  static getCachedKey(keyType: string, generator: () => string): string {
    if (!this.keyCache.has(keyType)) {
      this.keyCache.set(keyType, generator());
    }
    const cachedKey = this.keyCache.get(keyType);
    if (!cachedKey) {
      throw new Error(`Key not found in cache: ${keyType}`);
    }
    return cachedKey;
  }

  /**
   * Clears the key cache. Should be called in test cleanup.
   */
  static clearCache(): void {
    this.keyCache.clear();
  }
}

/**
 * Convenience functions for common test crypto operations
 */
export const generateTestSecrets = () => ({
  webhookSecret: TestCrypto.generateWebhookSecret(),
  jwtSecret: TestCrypto.generateJwtSecret(),
  apiKey: TestCrypto.generateApiKey(),
  clientSecret: TestCrypto.generateClientSecret(),
  botToken: TestCrypto.generateBotToken(),
  gitHubToken: TestCrypto.generateGitHubToken(),
  privateKey: TestCrypto.generateGitHubAppPrivateKey(),
  slackSigningSecret: TestCrypto.generateSlackSigningSecret(),
});

/**
 * Type for the secrets object
 */
export type TestSecrets = ReturnType<typeof generateTestSecrets>;