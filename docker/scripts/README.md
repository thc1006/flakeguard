# Docker Scripts

This directory contains utility scripts for Docker Compose environments.

## generate-test-keys.js

A Node.js script that generates cryptographically secure test keys and secrets at runtime. This approach avoids storing hardcoded secrets in version control while ensuring test environments have proper cryptographic material.

### Usage

```bash
# Generate RSA private key (PEM format)
node generate-test-keys.js rsa-private

# Generate RSA public key (PEM format)  
node generate-test-keys.js rsa-public

# Generate random hex secret (default 32 bytes)
node generate-test-keys.js secret

# Generate random hex secret (custom length)
node generate-test-keys.js secret 16

# Generate JWT signing secret (32 bytes)
node generate-test-keys.js jwt
```

### Security Notes

- Keys are generated fresh on each container startup
- No secrets are stored in version control
- Uses Node.js crypto module with secure random generation
- RSA keys use 2048-bit modulus with PKCS#8 encoding
- Secrets use cryptographically secure random bytes

### Docker Integration

This script is mounted as a read-only volume in test containers and used in startup commands:

```yaml
volumes:
  - ./docker/scripts:/app/docker/scripts:ro

command: >
  sh -c "
    export GITHUB_PRIVATE_KEY=\"$(node /app/docker/scripts/generate-test-keys.js rsa-private)\" &&
    npm run dev
  "
```

This approach ensures:
- ✅ No hardcoded secrets in source code
- ✅ No Gitleaks or security scanner violations  
- ✅ Fresh cryptographic material per test run
- ✅ Consistent key formats across services
- ✅ Easy to audit and maintain