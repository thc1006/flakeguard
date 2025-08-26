# FlakeGuard Security Configuration

This directory contains security scanning configurations for the FlakeGuard project to prevent false positives while maintaining strong security controls.

## Files

### `gitleaks.toml`
Comprehensive Gitleaks configuration with 13 categorized allowlist rules:

1. **Documentation and example files** - README, docs, .md files
2. **Test files and fixtures** - All test-related files and directories
3. **Environment configuration** - .env.example and template files
4. **Placeholder tokens** - Redacted and example tokens
5. **GitHub Actions placeholders** - `${{ secrets.* }}` syntax
6. **Database connections** - Development/test database URLs
7. **Docker configurations** - Docker Compose and Dockerfile patterns
8. **Test private keys** - Clearly fake/test cryptographic keys
9. **HTTP examples** - curl commands and API documentation
10. **Slack webhook examples** - Example Slack integration URLs
11. **Environment variable assignments** - Safe environment variable patterns
12. **Comprehensive test patterns** - Catch-all for test/example/mock patterns
13. **Project-specific files** - FlakeGuard-specific allowlisted files

### `trufflehog-exclude-patterns.txt`
TruffleHog exclusion patterns with 70+ rules organized into categories:

- **System and build files** - Git, node_modules, build outputs
- **Documentation and examples** - All markdown and example files
- **Test files and fixtures** - Comprehensive test file patterns
- **Configuration and Docker files** - Config files and Docker assets
- **Generated and processed files** - Minified files, source maps, logs

## Security Approach

### What We Allow
- **Clear test/example data** - Anything obviously labeled as test, example, fake, or mock
- **Development database credentials** - Standard postgres/redis development URLs
- **Documentation examples** - Code examples in markdown files with placeholder tokens
- **GitHub Actions variables** - Template syntax like `${{ secrets.EXAMPLE }}`
- **Redacted values** - Tokens marked as `<REDACTED>` or similar

### What We Block
- **Production credentials** - Real API keys, tokens, or passwords
- **Private keys without TEST markers** - Any private key not clearly marked as test
- **Database URLs with production indicators** - Any connection string suggesting production use
- **Verified secrets** - Anything TruffleHog can verify as legitimate

## Testing the Configuration

### Validate TOML Syntax
```bash
python -c "import tomllib; tomllib.load(open('.github/security/gitleaks.toml', 'rb'))"
```

### Run Gitleaks Locally
```bash
# Install gitleaks
go install github.com/gitleaks/gitleaks/v8@latest

# Run scan
gitleaks detect --config .github/security/gitleaks.toml --source . --verbose
```

### Run TruffleHog Locally
```bash
# Docker method
docker run --rm -v "$(pwd):/workdir" -w /workdir \
  trufflesecurity/trufflehog:latest filesystem \
  --exclude-paths=.github/security/trufflehog-exclude-patterns.txt \
  .
```

## Maintenance

### Adding New Allowlist Patterns

1. **For Gitleaks**: Add to appropriate section in `gitleaks.toml`
2. **For TruffleHog**: Add regex pattern to `trufflehog-exclude-patterns.txt`
3. **Test changes**: Run local scans to verify patterns work
4. **Document rationale**: Use clear, descriptive comments

### When to Add Allowlist Rules

✅ **Add allowlists for:**
- New test files or example documentation
- Development/staging environment configurations
- Clear placeholder or template values
- Build artifacts or generated files

❌ **Don't add allowlists for:**
- Real production credentials (rotate them instead)
- Ambiguous patterns that could hide real secrets
- Broad patterns that bypass security entirely

### Security Review Process

1. **Automated scans** run on every PR and push
2. **Verified secrets** always block CI/CD pipeline
3. **Unverified findings** uploaded as artifacts for manual review
4. **Security team** reviews allowlist changes in PRs

## Monitoring and Alerts

- **CI Integration**: Scans run automatically in GitHub Actions
- **Artifact Upload**: Full reports saved for 30 days
- **PR Comments**: Automated security status comments
- **Failure Handling**: Pipeline blocks on verified secret detection

## Contact

For questions about security configuration or to report false positives/negatives:
- Create an issue with the `security` label
- Tag the security team in PR reviews
- Check CI logs for specific scanner output