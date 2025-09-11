# 🔍 Reviewer Validation Template

**Copy this template as a comment on the Draft PR for systematic validation:**

---

## 📋 FlakeGuard A1-A5, B1-B3 Validation Checklist

Hi team! Please help validate this comprehensive FlakeGuard implementation using the checklist below. This covers all components from Problem Matchers (A1) through Branch Protection Auditing (B1-B3).

### 🎯 A1: Problem Matcher Author
- [ ] **PR Annotations**: Check the **Files** tab - do you see inline annotations on test files showing failures?
- [ ] **Matcher Registration**: Verify workflows show `::add-matcher::` steps in logs
- [ ] **Pattern Testing**: Run a test that fails - does it create a PR annotation?

**Test Command**: 
```bash
# Look for annotations in Files tab after workflow runs
```

### 📊 A2: Job Summary Author  
- [ ] **Rich Summaries**: Check **Actions** tab → workflow run → view job summary
- [ ] **Tables & Metrics**: Confirm tables for flaky tests, quarantine status, environment analysis
- [ ] **Governance Section**: Verify governance section links to PR comments
- [ ] **Color Coding**: Check for green/yellow/red badges and urgency indicators

**Test Command**:
```bash
pnpm --filter @flakeguard/cli exec tsx src/summary.ts generate \
  --report .flakeguard/out/flaky-report.json \
  --quarantine .flakeguard/quarantine.yml
```

### 🔄 A3: Auto-Rerun Engineer
- [ ] **Flaky Detection**: Confirm 70% threshold logic works correctly
- [ ] **Loop Prevention**: Verify lock files prevent multiple reruns per SHA
- [ ] **Decision Logging**: Check clear reasoning in logs for rerun/no-rerun decisions
- [ ] **Dual Methods**: Confirm both REST API and gh CLI methods available

**Test Commands**:
```bash
# Demo different scenarios
node demo-auto-rerun.js

# Test dry-run mode
pnpm --filter @flakeguard/cli exec tsx src/auto-rerun.ts analyze \
  --report .flakeguard/out/flaky-report.json \
  --quarantine .flakeguard/quarantine.yml \
  --sha "test-sha-123" --run-id "99887766" --dry-run
```

**Expected**: 
- Flaky-dominant (≥70%) → triggers rerun
- Lock file exists → prevents rerun  
- Clear logging shows decision reasoning

### 🛡️ A4: Quarantine Governor & PR Notifier
- [ ] **Schema Validation**: Confirm quarantine.yml validates correctly
- [ ] **TTL Management**: Check expiration warnings for quarantines ≤7 days
- [ ] **CODEOWNERS Integration**: Verify file path → owner mapping works
- [ ] **PR Comments**: Confirm consolidated comments with @mentions

**Test Commands**:
```bash
# Validate quarantine config
pnpm --filter @flakeguard/cli exec tsx src/quarantine-governor.ts validate .flakeguard/quarantine.yml

# Generate governance report
pnpm --filter @flakeguard/cli exec tsx src/quarantine-governor.ts report \
  .flakeguard/out/flaky-report.json .flakeguard/quarantine.yml
```

**Expected**:
- ✅ Schema validation passes
- 🟡 2 quarantines expiring soon warnings
- 👥 Owner mentions for @frontend-team @backend-team @engineering

### 📦 A5: Artifact Retriever
- [ ] **URL Expiration**: Confirm retry logic handles 1-minute TTL correctly
- [ ] **Retry Strategy**: Verify exponential backoff with jitter
- [ ] **Error Classification**: Check retryable vs non-retryable error handling
- [ ] **Bulk Operations**: Test concurrent downloads with semaphore control

**Test Commands**:
```bash
# Test artifact listing
pnpm --filter @flakeguard/cli exec tsx src/fetch-artifact.ts list microsoft vscode

# Test download with authentication error (expected to fail gracefully)
pnpm --filter @flakeguard/cli exec tsx src/fetch-artifact.ts info microsoft vscode 3981505069
```

**Expected**:
- 📋 Successfully lists 30 artifacts from microsoft/vscode
- ❌ Gracefully handles "Access denied" without retries
- 🔄 Shows retry logic for network errors

### 🔒 B1: Branch Protection Auditor
- [ ] **Workflow Analysis**: Confirm analysis of all 10 workflows, 44 jobs
- [ ] **Check Classification**: Verify 14 required vs 30 optional/conditional checks
- [ ] **Configuration Output**: Check ready-to-use branch protection rules
- [ ] **Policy Generation**: Confirm comprehensive policy documentation

**Test Commands**:
```bash
# Run analysis
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts analyze

# Generate configuration
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts config
```

**Expected**:
- 📊 Analysis: 14 required, 9 optional, 16 conditional, 5 experimental checks
- ✅ Required checks include: CI linting, security scans, build verification
- ❌ Optional checks include: performance tests, deployment workflows

### 🔧 B2-B3: Enhanced Workflows & CLI Tools
- [ ] **Security Permissions**: Confirm least-privilege permissions in workflows
- [ ] **Integration**: Verify FlakeGuard steps integrate cleanly with existing CI
- [ ] **CLI Help**: Check all commands provide clear usage information
- [ ] **Error Handling**: Confirm graceful degradation when components fail

**Test Commands**:
```bash
# Test all CLI tools
pnpm --filter @flakeguard/cli exec tsx src/branch-protection-auditor.ts --help
pnpm --filter @flakeguard/cli exec tsx src/quarantine-governor.ts --help
pnpm --filter @flakeguard/cli exec tsx src/fetch-artifact.ts --help
```

## 🚨 Critical Validation Points

### Security & Permissions
- [ ] **No Secret Exposure**: Verify no tokens or keys in logs
- [ ] **Least Privilege**: Confirm workflows use minimal required permissions
- [ ] **Secret Scanning**: Check TruffleHog/Gitleaks integration works

### Performance & Reliability  
- [ ] **CI Runtime**: Ensure no significant impact on workflow duration
- [ ] **Error Resilience**: Verify workflows continue when FlakeGuard steps fail
- [ ] **Resource Usage**: Check reasonable memory/CPU usage during analysis

### Documentation & Usability
- [ ] **Demo Scripts**: All demo scripts (`demo-*.js`) run successfully
- [ ] **Documentation**: `BRANCH_PROTECTION.md` and `REQUIRED_CHECKS_POLICY.md` are complete
- [ ] **README**: Updated with Required Checks Policy section

## 🎯 Manual Testing Scenarios

### Scenario 1: Flaky Test Detection
1. Create a test that fails ~80% of the time
2. Run it multiple times via CI
3. Verify FlakeGuard detects it as flaky
4. Confirm auto-rerun triggers appropriately

### Scenario 2: Quarantine Management
1. Add a test to quarantine with 2-day TTL
2. Verify PR comment shows expiration warning
3. Confirm owner is mentioned correctly
4. Check governance section in job summary

### Scenario 3: Artifact Download
1. Trigger workflow that produces artifacts
2. Let FlakeGuard download them for analysis
3. Verify retry logic if network issues occur
4. Confirm proper error handling

## ✅ Final Validation

After testing all components:

- [ ] **All Demos Work**: `demo-auto-rerun.js`, `demo-quarantine-governor.js`, `demo-artifact-retrieval.js`
- [ ] **Workflows Complete**: CI, Security, FlakeGuard workflows all pass
- [ ] **PR Annotations**: Problem matchers create meaningful annotations
- [ ] **Job Summaries**: Rich reports appear in Actions UI
- [ ] **CLI Tools**: All commands work and provide helpful output
- [ ] **Documentation**: Complete and accurate policy/configuration docs

## 🚀 Sign-off

**Reviewer**: @{your-username}  
**Date**: {current-date}  
**Status**: ✅ APPROVED / ⚠️ NEEDS WORK / ❌ BLOCKED  

**Comments**: 
[Add any specific feedback, concerns, or suggestions]

---

**Ready to merge** when all checkboxes are ✅ and no blocking issues remain.