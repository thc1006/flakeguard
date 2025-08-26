# GitHub Actions NPM Authentication Setup

## Current Configuration

The security workflow in `.github/workflows/security.yml` is configured to work **without requiring NPM authentication** for public packages.

## Key Changes Made

1. **Optional NPM Token**: The workflow checks if `NPM_TOKEN` secret exists but continues without it
2. **Public Registry Configuration**: Explicitly sets the npm registry to the public URL
3. **Ignore Scripts Flag**: Added `--ignore-scripts` to prevent potential issues during installation
4. **No Authentication Required**: All dependencies in this repository are public packages

## If You Need Private Package Access

If you later need to access private npm packages:

1. **Generate an NPM Token**:
   - Go to https://www.npmjs.com/
   - Sign in to your account
   - Go to Account Settings > Access Tokens
   - Generate a new token with "Read" permissions

2. **Add to GitHub Secrets**:
   - Go to your repository Settings
   - Navigate to Secrets and variables > Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Your npm token (starts with `npm_`)

3. **The workflow will automatically detect and use the token when available**

## Troubleshooting

If you encounter authentication errors:

1. Check that all your dependencies are public:
   ```bash
   npm view <package-name> --json | grep private
   ```

2. For workspace packages (like `@flakeguard/*`), no authentication is needed as they're local

3. If using a custom registry, update the registry URL in the workflow:
   ```yaml
   pnpm config set registry https://your-registry-url/
   ```

## Security Notes

- Never commit tokens directly to the repository
- Use GitHub Secrets for all sensitive values
- The `--ignore-scripts` flag prevents potentially malicious postinstall scripts from running