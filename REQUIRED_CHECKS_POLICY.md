# 📋 Required Checks Policy

## Overview

This document defines when a GitHub Actions check becomes required for branch protection and the process for managing check lifecycle.

## Check Classification

### ✅ Required Checks
Checks that **MUST** pass before code can be merged to protected branches:

- **Core Quality Gates**: Linting, type checking, formatting
- **Essential Tests**: Unit tests, integration tests covering critical paths
- **Security Scans**: Dependency audits, secret scanning, license checks
- **Build Verification**: Successful compilation and packaging

**Criteria for Required Status:**
- Runs on every PR without conditions
- Tests core functionality or quality standards
- Failure indicates genuine issues that should block merge
- Stable and reliable (< 2% flake rate over 30 days)

### 📝 Optional Checks
Checks that provide valuable feedback but **should NOT** block merges:

- **Performance Tests**: Benchmarks, load testing
- **E2E Tests**: Complex end-to-end scenarios (may be flaky)
- **Deployment Checks**: Staging deployments, smoke tests
- **Documentation**: README updates, changelog generation

### ⚠️ Conditional Checks
Checks that run only under specific conditions:

- **Path-based triggers**: Only run when relevant files change
- **Schedule-based**: Nightly builds, weekly security scans
- **Manual triggers**: workflow_dispatch events

### 🧪 Experimental Checks
New or unstable checks in development:

- **Beta Features**: New testing frameworks, tools
- **Research**: Proof-of-concept validations
- **Temporary**: One-off analysis or migration checks

## Lifecycle Management

### Promoting Checks to Required

A check can become required when it meets ALL criteria:

1. **Stability**: < 2% failure rate due to infrastructure issues over 30 days
2. **Relevance**: Directly impacts code quality, security, or functionality
3. **Coverage**: Runs on all relevant PRs (not path-conditional)
4. **Team Agreement**: Engineering team consensus on requirement
5. **Documentation**: Clear failure resolution guidelines

**Promotion Process:**
1. Track check stability for 30+ days
2. Document check purpose and failure resolution
3. Create team RFC for making check required
4. Update branch protection rules
5. Announce change with 1-week notice

### Deprecating Required Checks

A required check should be deprecated when:

- **Superseded**: Replaced by better tooling or process
- **Unstable**: Consistently flaky despite improvement efforts
- **Irrelevant**: No longer validates meaningful quality criteria
- **Redundant**: Overlaps with other required checks

**Deprecation Process:**
1. Create deprecation plan with timeline
2. Add deprecation notice to check output
3. Provide alternative validation method if needed
4. Remove from required checks after 2-week notice
5. Archive or remove workflow after 30 days

## Current Required Checks

Based on current workflow analysis:

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

## Monitoring and Review

- **Weekly**: Review failed required checks for patterns
- **Monthly**: Analyze check stability and performance
- **Quarterly**: Full policy review and check classification audit

## Emergency Procedures

**Temporarily Bypassing Required Checks:**
1. Repository admin can override (with justification)
2. Create immediate follow-up issue for proper fix
3. Restore protection within 24 hours

**Incident Response:**
1. If required check blocks critical fixes, temporarily remove requirement
2. Merge critical fix with admin override
3. Fix check issue and restore requirement
4. Document incident and improve check reliability

## Automated Auditing

The FlakeGuard Branch Protection Auditor automatically analyzes workflows and provides recommendations:

```bash
# Run analysis
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts analyze

# Generate updated configuration
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts config > BRANCH_PROTECTION.md

# Update this policy
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts policy > REQUIRED_CHECKS_POLICY.md
```

---

*This policy is automatically generated from workflow analysis. Last updated: 2025-09-11*