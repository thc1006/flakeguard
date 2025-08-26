# NPM Token Setup Guide

## Why is this needed?

GitHub Actions workflows are encountering a 403 Forbidden error when trying to fetch pnpm from the npm registry. This is because npm registry requires authentication for certain operations.

## Solution

I've updated all GitHub Actions workflows to support npm authentication. Here's how to set it up:

### Step 1: Create an NPM Access Token

1. Go to [npmjs.com](https://www.npmjs.com/) and sign in to your account
2. Click on your profile picture → **Access Tokens**
3. Click **Generate New Token** → **Classic Token**
4. Choose token type:
   - **Read Only** - Sufficient for installing packages (recommended)
   - **Automation** - If you plan to publish packages
5. Give it a name (e.g., "flakeguard-github-actions")
6. Copy the generated token (you won't be able to see it again!)

### Step 2: Add Token to GitHub Repository Secrets

1. Go to your GitHub repository: [github.com/thc1006/flakeguard](https://github.com/thc1006/flakeguard)
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `NPM_TOKEN`
5. Value: Paste the token you copied from npm
6. Click **Add secret**

### Step 3: Verify Setup

The workflows will now automatically use this token when running. You can verify it's working by:

1. Re-running any failed workflow
2. Checking that the "Authenticate to npm registry" step appears in the logs
3. Confirming that pnpm install succeeds without 403 errors

## Workflows Updated

All workflows have been updated to include npm authentication:

- ✅ `.github/workflows/ci.yml` - Main CI pipeline
- ✅ `.github/workflows/security.yml` - Security scanning
- ✅ `.github/workflows/database-monitoring.yml` - Database health checks
- ✅ `.github/workflows/release.yml` - Release and deployment

## Security Notes

- The NPM token is stored securely as a GitHub secret
- It's never exposed in logs or workflow runs
- The authentication step only runs if `NPM_TOKEN` secret exists
- Use read-only tokens unless you need to publish packages

## Alternative: Use Public Registry

If you don't want to set up authentication, you can alternatively:

1. Ensure all packages are public
2. Use `--registry https://registry.npmjs.org/` flag
3. Consider using GitHub Package Registry instead

## Troubleshooting

If you still encounter issues:

1. **Check token permissions**: Ensure the token has at least read access
2. **Verify secret name**: Must be exactly `NPM_TOKEN`
3. **Check token expiration**: NPM tokens can expire, generate a new one if needed
4. **Clear caches**: Sometimes clearing GitHub Actions caches helps

## References

- [npm Documentation on Access Tokens](https://docs.npmjs.com/about-access-tokens)
- [GitHub Actions Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)