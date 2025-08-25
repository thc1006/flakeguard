#!/usr/bin/env node
/**
 * Generate test keys for Docker Compose test environment
 * This script generates cryptographically secure test keys at runtime
 * to avoid storing hardcoded secrets in version control.
 */

const crypto = require('crypto');

function generateRSAKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    },
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    }
  });
  return { privateKey, publicKey };
}

function generateRandomSecret(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function main() {
  const keyType = process.argv[2];
  
  switch (keyType) {
    case 'rsa-private':
      console.log(generateRSAKeyPair().privateKey);
      break;
    case 'rsa-public':
      console.log(generateRSAKeyPair().publicKey);
      break;
    case 'secret':
      const length = parseInt(process.argv[3]) || 32;
      console.log(generateRandomSecret(length));
      break;
    case 'jwt':
      // Generate a 256-bit (32 byte) secret suitable for JWT signing
      console.log(generateRandomSecret(32));
      break;
    default:
      console.error('Usage: node generate-test-keys.js <key-type>');
      console.error('Key types: rsa-private, rsa-public, secret [length], jwt');
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generateRSAKeyPair,
  generateRandomSecret
};