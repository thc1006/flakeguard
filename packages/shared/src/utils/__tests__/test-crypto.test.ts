import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestCrypto, generateTestSecrets } from '../test-crypto.js';

describe('TestCrypto', () => {
  beforeEach(() => {
    TestCrypto.clearCache();
  });

  describe('generateSecret', () => {
    it('should generate a hex secret of specified length', () => {
      const secret = TestCrypto.generateSecret(16);
      expect(secret).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(secret).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate different secrets on each call', () => {
      const secret1 = TestCrypto.generateSecret();
      const secret2 = TestCrypto.generateSecret();
      expect(secret1).not.toBe(secret2);
    });
  });

  describe('generateRsaKeyPair', () => {
    it('should generate a valid RSA key pair', () => {
      const { publicKey, privateKey } = TestCrypto.generateRsaKeyPair();
      
      expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(publicKey).toContain('-----END PUBLIC KEY-----');
      expect(privateKey).toContain('-----BEGIN PRIVATE KEY-----');
      expect(privateKey).toContain('-----END PRIVATE KEY-----');
    });

    it('should generate different key pairs on each call', () => {
      const keys1 = TestCrypto.generateRsaKeyPair();
      const keys2 = TestCrypto.generateRsaKeyPair();
      
      expect(keys1.privateKey).not.toBe(keys2.privateKey);
      expect(keys1.publicKey).not.toBe(keys2.publicKey);
    });
  });

  describe('token generators', () => {
    it('should generate GitHub tokens with correct format', () => {
      const token = TestCrypto.generateGitHubToken();
      expect(token).toMatch(/^ghs_[0-9a-f]{40}$/);
    });

    it('should generate Slack bot tokens with correct format', () => {
      const token = TestCrypto.generateBotToken();
      expect(token).toMatch(/^xoxb-test-[0-9a-f]{32}$/);
    });

    it('should generate different tokens each time', () => {
      const token1 = TestCrypto.generateGitHubToken();
      const token2 = TestCrypto.generateGitHubToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('caching', () => {
    it('should cache keys when requested', () => {
      const generator = () => 'test-key';
      
      const key1 = TestCrypto.getCachedKey('testKey', generator);
      const key2 = TestCrypto.getCachedKey('testKey', generator);
      
      expect(key1).toBe(key2);
      expect(key1).toBe('test-key');
    });

    it('should clear cache correctly', () => {
      const generator = vi.fn(() => 'test-key');
      
      TestCrypto.getCachedKey('testKey', generator);
      TestCrypto.clearCache();
      TestCrypto.getCachedKey('testKey', generator);
      
      expect(generator).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateTestSecrets', () => {
    it('should generate all required secrets', () => {
      const secrets = generateTestSecrets();
      
      expect(secrets).toHaveProperty('webhookSecret');
      expect(secrets).toHaveProperty('jwtSecret');
      expect(secrets).toHaveProperty('apiKey');
      expect(secrets).toHaveProperty('clientSecret');
      expect(secrets).toHaveProperty('botToken');
      expect(secrets).toHaveProperty('gitHubToken');
      expect(secrets).toHaveProperty('privateKey');
      expect(secrets).toHaveProperty('slackSigningSecret');
      
      // Verify formats
      expect(secrets.gitHubToken).toMatch(/^ghs_/);
      expect(secrets.botToken).toMatch(/^xoxb-test-/);
      expect(secrets.privateKey).toContain('BEGIN PRIVATE KEY');
    });
  });
});