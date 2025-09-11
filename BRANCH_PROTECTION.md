# 🔒 Branch Protection Configuration Guide

## Required Status Checks

Configure these checks as **required** in your branch protection rules. PRs cannot be merged until these pass:

```yaml
required_status_checks:
  strict: true  # Require branches to be up to date before merging
  contexts:
    - "CI - Lint, Test & Build / Build & Docker Images"
    - "CI - Lint, Test & Build / E2E Tests"
    - "CI - Lint, Test & Build / Lint & Format Check"
    - "CI - Lint, Test & Build / Security & Dependency Scan"
    - "Database Monitoring & Health Checks / Database Health Check Tests"
    - "Database Monitoring & Health Checks / Database Performance Tests"
    - "Database Monitoring & Health Checks / Validate Database Schema"
    - "Database Monitoring & Health Checks / Validate Monitoring Configuration"
    - "Docker Build & Publish / build-and-push"
    - "FlakeGuard Test Ingestion / flakeguard-ingest"
    - "OSV Security Scanner / OSV Vulnerability Scanning"
    - "Secret Scanning / Gitleaks Secret Scan"
    - "Security Scanning & Dependency Updates / Dependency Vulnerability Scan"
    - "Security Scanning & Dependency Updates / Secret Scanning"
```

### ⚙️ GitHub UI Configuration

In your repository settings under **Branches** → **Branch protection rules**:

1. ✅ **Require status checks to pass before merging**
2. ✅ **Require branches to be up to date before merging**
3. Add each required check name exactly as shown above

**Required Check Names to Add:**
- `CI - Lint, Test & Build / Build & Docker Images`
- `CI - Lint, Test & Build / E2E Tests`
- `CI - Lint, Test & Build / Lint & Format Check`
- `CI - Lint, Test & Build / Security & Dependency Scan`
- `Database Monitoring & Health Checks / Database Health Check Tests`
- `Database Monitoring & Health Checks / Database Performance Tests`
- `Database Monitoring & Health Checks / Validate Database Schema`
- `Database Monitoring & Health Checks / Validate Monitoring Configuration`
- `Docker Build & Publish / build-and-push`
- `FlakeGuard Test Ingestion / flakeguard-ingest`
- `OSV Security Scanner / OSV Vulnerability Scanning`
- `Secret Scanning / Gitleaks Secret Scan`
- `Security Scanning & Dependency Updates / Dependency Vulnerability Scan`
- `Security Scanning & Dependency Updates / Secret Scanning`

## Optional Checks

These checks provide valuable feedback but **should NOT** be required (they may block PRs unnecessarily):

- 📝 `CI - Lint, Test & Build / Test (Node ${{ matrix.node-version }})`
- 📝 `FlakeGuard PR Notifications / auto-approve-quarantine-only`
- 📝 `FlakeGuard PR Notifications / notify-quarantine-changes`
- 📝 `FlakeGuard PR Notifications / post-merge-notifications`
- 📝 `Secret Scanning / TruffleHog Secret Scan`
- 📝 `Security Scanning & Dependency Updates / CodeQL Analysis`
- 📝 `Security Scanning & Dependency Updates / Docker Security Scan`
- 📝 `Security Scanning & Dependency Updates / Generate SBOM`
- 📝 `Security Scanning & Dependency Updates / License Compliance`

**Conditional Checks** (run only in specific circumstances):
- ⚠️ `Docker Build & Publish / security-scan`
- ⚠️ `Quarantine PR Integration / handle-quarantine-request`
- ⚠️ `Quarantine PR Integration / handle-remove-quarantine`
- ⚠️ `Quarantine PR Integration / quarantine-expiration-check`
- ⚠️ `Release & Deploy / Build Release Images`
- ⚠️ `Release & Deploy / Create GitHub Release`
- ⚠️ `Release & Deploy / Deploy to Production`
- ⚠️ `Release & Deploy / Deploy to Staging`
- ⚠️ `Release & Deploy / Generate Changelog`
- ⚠️ `Release & Deploy / Post-Release Tasks`
- ⚠️ `Release & Deploy / Pre-Release Tests`
- ⚠️ `Release & Deploy / Security Scan Release Images`
- ⚠️ `Release & Deploy / Validate Release`
- ⚠️ `Secret Scanning / Handle Scan Results`
- ⚠️ `Security Scanning & Dependency Updates / Automated Dependency Updates`
- ⚠️ `Security Scanning & Dependency Updates / Security Summary`

**Experimental Checks** (not production-ready):
- 🧪 `CI - Lint, Test & Build / Cleanup & Summary`
- 🧪 `CI - Lint, Test & Build / Deployment Readiness`
- 🧪 `CI - Lint, Test & Build / Performance Tests`
- 🧪 `Docker Build & Publish / deploy-production`
- 🧪 `Docker Build & Publish / deploy-staging`

## Quick Setup Commands

```bash
# Generate current configuration
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts config

# Generate policy documentation  
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts policy

# Analyze workflow changes
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts analyze
```