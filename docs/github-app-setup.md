# GitHub App Setup Guide

This comprehensive guide walks you through setting up the FlakeGuard GitHub App to integrate with your repositories and workflows.

## Overview

FlakeGuard uses GitHub App authentication to securely access your repositories, process workflow events, and create check runs. This provides fine-grained permissions and better security than personal access tokens.

## Prerequisites

- GitHub organization or repository admin access
- FlakeGuard instance deployed and accessible via HTTPS
- Valid SSL certificate for your FlakeGuard domain

## Step-by-Step Setup

### 1. Create the GitHub App

1. **Navigate to GitHub Settings**
   - Go to your GitHub organization settings
   - Or personal account settings if installing on personal repositories
   - Select **Developer settings** > **GitHub Apps**

2. **Create New GitHub App**
   - Click **"New GitHub App"**
   - Fill in the required information:

#### Basic Information

```yaml
App name: FlakeGuard-YourOrgName
Description: Automated flaky test detection and management
Homepage URL: https://your-flakeguard-domain.com
User authorization callback URL: https://your-flakeguard-domain.com/auth/github/callback
```

#### Webhook Configuration

```yaml
Webhook URL: https://your-flakeguard-domain.com/api/github/webhook
Webhook secret: [Generate a secure random string - see below]
```

**Generate Webhook Secret:**
```bash
# Generate a secure webhook secret
openssl rand -base64 32
```

### 2. Configure Permissions

FlakeGuard requires specific permissions to function properly:

#### Repository Permissions

| Permission | Access Level | Purpose |
|------------|--------------|---------|
| **Actions** | Read | Download workflow artifacts and read run data |
| **Checks** | Write | Create and update check runs with flake reports |
| **Contents** | Read | Access repository files and structure |
| **Issues** | Write | Create issues for flaky test reports |
| **Metadata** | Read | Required for all GitHub Apps |
| **Pull requests** | Write | Comment on PRs with flake analysis |

#### Account Permissions

No account permissions are required.

### 3. Subscribe to Events

Enable the following webhook events:

#### Required Events

- ✅ **Check run** - Monitor check run lifecycle
- ✅ **Check suite** - Detect check suite completion
- ✅ **Pull request** - Analyze PR-related test runs
- ✅ **Push** - Process commits and branches
- ✅ **Workflow job** - Track individual job status
- ✅ **Workflow run** - Monitor complete workflow execution

#### Optional Events

- **Installation** - Track app installations (recommended)
- **Installation repositories** - Monitor repository access changes

### 4. Generate Private Key

1. **In GitHub App Settings**
   - Scroll down to **"Private keys"** section
   - Click **"Generate a private key"**
   - Download the `.pem` file

2. **Store the Private Key**
   ```bash
   # Move to secure location
   mv ~/Downloads/your-app-name.2024-01-15.private-key.pem /path/to/secure/location/
   
   # Set proper permissions
   chmod 600 /path/to/secure/location/github-app-private-key.pem
   ```

### 5. Configure Environment Variables

Add the GitHub App configuration to your FlakeGuard environment:

```bash
# .env file
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="YOUR_GITHUB_APP_PRIVATE_KEY_HERE"
GITHUB_WEBHOOK_SECRET=your-generated-webhook-secret
GITHUB_APP_NAME=FlakeGuard-YourOrgName
```

**For Docker/Production:**
```yaml
# docker-compose.yml or environment
environment:
  - GITHUB_APP_ID=123456
  - GITHUB_APP_PRIVATE_KEY_PATH=/app/secrets/github-app-private-key.pem
  - GITHUB_WEBHOOK_SECRET=your-generated-webhook-secret
```

### 6. Install the App

#### Organization Installation

1. **Navigate to App Installation**
   - Go to your GitHub App settings
   - Click **"Install App"** in the left sidebar
   - Select your organization

2. **Choose Repository Access**
   ```
   ○ All repositories
   ● Selected repositories
     ✅ my-important-repo
     ✅ another-critical-project
   ```

3. **Review Permissions**
   - Verify the permissions listed match what you configured
   - Click **"Install"**

#### Repository-Specific Installation

```bash
# Direct installation URL
https://github.com/apps/your-flakeguard-app-name/installations/new
```

### 7. Verify Installation

#### Check Installation Status

```bash
# Test webhook endpoint
curl -X POST https://your-flakeguard-domain.com/api/github/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-GitHub-Delivery: 12345678-1234-1234-1234-123456789012" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"zen":"Design for failure.","hook_id":123456}'
```

#### Verify API Access

```typescript
// Test GitHub API access
import { App } from '@octokit/app';

const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
});

// Get installation access token
const { data: installations } = await app.octokit.rest.apps.listInstallations();
console.log('Installations:', installations.length);
```

## Configuration Examples

### Basic Configuration

```typescript
// config/github.ts
export interface GitHubConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  baseUrl?: string;
}

export const githubConfig: GitHubConfig = {
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
  baseUrl: process.env.GITHUB_ENTERPRISE_URL, // For GitHub Enterprise
};
```

### Advanced Configuration

```typescript
// config/github-advanced.ts
export interface AdvancedGitHubConfig extends GitHubConfig {
  requestTimeout: number;
  retryOptions: {
    retries: number;
    retryCondition: (error: any) => boolean;
  };
  rateLimit: {
    enabled: boolean;
    maxRequests: number;
    perMs: number;
  };
}

export const advancedGitHubConfig: AdvancedGitHubConfig = {
  ...githubConfig,
  requestTimeout: 30000,
  retryOptions: {
    retries: 3,
    retryCondition: (error) => error.status >= 500 || error.status === 429,
  },
  rateLimit: {
    enabled: true,
    maxRequests: 100,
    perMs: 60000,
  },
};
```

## Repository Setup

### Add FlakeGuard to Your Workflow

Create or update your GitHub Actions workflow:

```yaml
# .github/workflows/test-with-flakeguard.yml
name: Tests with FlakeGuard

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests with JUnit output
        run: |
          npm test -- --reporter=junit --outputFile=test-results.xml
        continue-on-error: true
        
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: test-results.xml
          retention-days: 30
          
      # FlakeGuard automatically processes the artifacts via webhook
```

### Multi-Framework Setup

For projects with multiple test frameworks:

```yaml
# .github/workflows/comprehensive-testing.yml
name: Comprehensive Testing

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Jest tests
        run: npm test -- --reporter=junit --outputFile=junit-unit.xml
      - uses: actions/upload-artifact@v4
        with:
          name: unit-test-results
          path: junit-unit.xml
          
  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run integration tests
        run: npm run test:integration -- --reporter=junit --outputFile=junit-integration.xml
      - uses: actions/upload-artifact@v4
        with:
          name: integration-test-results
          path: junit-integration.xml
          
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run E2E tests
        run: npm run test:e2e -- --reporter=junit --outputFile=junit-e2e.xml
      - uses: actions/upload-artifact@v4
        with:
          name: e2e-test-results
          path: junit-e2e.xml
```

## Security Configuration

### Webhook Security

```typescript
// Webhook signature validation
import crypto from 'crypto';

function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  const expectedSignature = `sha256=${hmac.digest('hex')}`;
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### IP Allowlist (Optional)

If you need to restrict webhook sources:

```typescript
// GitHub webhook IP ranges (as of 2024)
const GITHUB_WEBHOOK_IPS = [
  '140.82.112.0/20',
  '143.55.64.0/20',
  '185.199.108.0/22',
  '192.30.252.0/22',
  '2606:50c0:8000::/40',
  '2606:50c0:8001::/40',
  '2606:50c0:8002::/40',
  '2606:50c0:8003::/40',
];

function isValidGitHubIP(ip: string): boolean {
  // Implement IP range validation logic
  return GITHUB_WEBHOOK_IPS.some(range => isIPInRange(ip, range));
}
```

## Troubleshooting

### Common Issues

#### 1. Webhook Delivery Failures

**Symptoms:**
- Webhooks not being received
- GitHub shows failed deliveries

**Solutions:**
```bash
# Check webhook endpoint
curl -I https://your-domain.com/api/github/webhook

# Verify SSL certificate
curl -sS https://your-domain.com/api/github/webhook | head -n 1

# Test with GitHub's webhook debugger
# GitHub App settings > Advanced > Recent Deliveries
```

#### 2. Authentication Errors

**Symptoms:**
- 401 Unauthorized responses
- "Invalid credentials" errors

**Solutions:**
```typescript
// Verify JWT generation
import jwt from 'jsonwebtoken';

const payload = {
  iat: Math.floor(Date.now() / 1000) - 60,
  exp: Math.floor(Date.now() / 1000) + (10 * 60),
  iss: process.env.GITHUB_APP_ID
};

const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
console.log('Generated JWT:', token);
```

#### 3. Permission Issues

**Symptoms:**
- 403 Forbidden responses
- "Resource not accessible" errors

**Solutions:**
1. Review GitHub App permissions
2. Verify installation scope
3. Check repository access

```bash
# List installations
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/app/installations

# Get installation token
curl -X POST \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     https://api.github.com/app/installations/INSTALLATION_ID/access_tokens
```

### Debug Mode

Enable debug logging for GitHub integration:

```bash
# Environment variables
DEBUG=true
LOG_LEVEL=debug
GITHUB_API_DEBUG=true
```

```typescript
// Debug logging
import { App } from '@octokit/app';

const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  log: {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  },
});
```

## Enterprise Configuration

### GitHub Enterprise Server

```typescript
// Enterprise configuration
const enterpriseConfig = {
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  baseUrl: 'https://github.your-company.com/api/v3',
  webhookProxyUrl: 'https://your-company.com/webhook-proxy',
};
```

### Firewall Configuration

Required outbound connections:
- GitHub API: `api.github.com:443`
- GitHub Enterprise: `your-github-enterprise.com:443`
- Webhook deliveries: Your FlakeGuard domain

## Monitoring and Maintenance

### Health Checks

```typescript
// GitHub API health check
export async function checkGitHubConnectivity(): Promise<boolean> {
  try {
    const app = new App({ appId, privateKey });
    await app.octokit.rest.apps.getAuthenticated();
    return true;
  } catch (error) {
    console.error('GitHub connectivity check failed:', error);
    return false;
  }
}
```

### Metrics to Monitor

- Webhook delivery success rate
- API rate limit usage
- Installation count and health
- Check run creation/update success

### Maintenance Tasks

1. **Rotate Private Keys** (annually)
2. **Update Webhook Secrets** (quarterly)
3. **Review Permissions** (after GitHub updates)
4. **Monitor API Usage** (monthly)

This comprehensive guide ensures your FlakeGuard GitHub App is properly configured and secure, enabling seamless integration with your development workflow.