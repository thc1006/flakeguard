# 🚀 Draft PR Creation Steps

## Option A: GitHub CLI (Automated)

### 1. Stage and Commit Changes
```bash
# Stage all FlakeGuard implementation files
git add .github/workflows/flakeguard.yml
git add .github/workflows/pr-notifications.yml
git add .github/workflows/quarantine-pr.yml
git add .github/matchers/
git add packages/cli/src/
git add scripts/
git add .flakeguard/
git add BRANCH_PROTECTION.md
git add REQUIRED_CHECKS_POLICY.md
git add AUTO-RERUN-DOCUMENTATION.md
git add README.md
git add packages/cli/package.json
git add pnpm-lock.yaml

# Create comprehensive commit
git commit -m "feat(flakeguard): implement A1-A5, B1-B3 action-only pipeline with soft gating

- A1: Problem Matcher Author - GitHub Actions problem matchers
- A2: Job Summary Author - Rich Markdown reports to GITHUB_STEP_SUMMARY  
- A3: Auto-Rerun Engineer - Intelligent rerun with loop prevention
- A4: Quarantine Governor & PR Notifier - TTL validation and owner notification
- A5: Artifact Retriever - Robust downloads with URL expiration handling
- B1: Branch Protection Auditor - Automated workflow analysis
- B2: Enhanced Workflows - Integrated FlakeGuard analysis with security
- B3: Comprehensive CLI Tools - Full command-line interface

Implements complete FlakeGuard MVP with:
- 🔄 Auto-rerun for flaky-dominant failures (≥70% threshold)
- 🛡️ SHA-based lock files preventing infinite loops
- 📊 Rich GitHub Step Summaries with governance reporting
- 🔒 Quarantine management with TTL and CODEOWNERS integration
- 📦 Robust artifact retrieval with 1-minute URL TTL handling
- 🎯 Branch protection auditing for 14 required vs 30 optional checks

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"
```

### 2. Push to Remote Branch
```bash
# Push the feature branch
git push origin feature/flakeguard-mvp
```

### 3. Create Draft PR
```bash
# Create Draft PR with comprehensive body
gh pr create --fill --draft \
  --title "feat(flakeguard): A1–A5, B1–B3 action-only pipeline with soft gating" \
  --body-file PR_DRAFT.md
```

## Option B: GitHub UI (Manual)

### 1. Complete Git Steps (Same as Option A)
- Stage and commit all changes using the commands above
- Push to `feature/flakeguard-mvp` branch

### 2. Navigate to GitHub Repository
1. Go to `https://github.com/{your-username}/flakeguard`
2. Click **"Compare & pull request"** button (appears after push)
3. Or click **"Pull requests"** → **"New pull request"**

### 3. Configure Pull Request
1. **Base branch**: `main`
2. **Compare branch**: `feature/flakeguard-mvp`
3. **Title**: `feat(flakeguard): A1–A5, B1–B3 action-only pipeline with soft gating`
4. **Description**: Copy content from `PR_DRAFT.md`
5. **⚠️ IMPORTANT**: Click **"Create draft pull request"** dropdown
6. Select **"Create draft pull request"** (not regular PR)

### 4. Verify Draft Status
- PR should show **"Draft"** label
- Checks will run but won't block merge (since it's draft)
- Can be marked **"Ready for review"** later

## Option C: Troubleshooting GitHub CLI

If GitHub CLI fails, check:

### Authentication
```bash
# Check GitHub CLI authentication
gh auth status

# Re-authenticate if needed
gh auth login
```

### Repository Configuration
```bash
# Check remote configuration
git remote -v

# Ensure upstream is set correctly
git push --set-upstream origin feature/flakeguard-mvp
```

### Manual Token Setup
```bash
# If auth issues persist, use personal access token
gh auth login --with-token < token.txt
```

## 🎯 Expected Results

After creating the Draft PR:

1. **Workflows Trigger**: CI, FlakeGuard, Security workflows run
2. **Problem Matchers**: Annotations appear on PR files
3. **Job Summaries**: Rich Markdown reports in Actions UI
4. **Draft Status**: PR marked as draft, won't auto-merge
5. **Check Status**: All checks run and report status

## 📋 Next Steps After PR Creation

1. **Wait for Workflows**: Let all checks complete (~5-10 minutes)
2. **Verify Annotations**: Check PR Files tab for problem matcher annotations
3. **Review Summaries**: Check Actions tab for job summary reports
4. **Test Auto-Rerun**: Trigger with flaky test scenarios
5. **Validate Tools**: Run CLI commands as reviewer

## 🚨 If PR Creation Fails

### Common Issues:
- **No commits**: Ensure changes are staged and committed
- **Branch not pushed**: Run `git push origin feature/flakeguard-mvp`
- **Auth issues**: Run `gh auth login` and retry
- **No differences**: Ensure you're on `feature/flakeguard-mvp` branch

### Fallback:
If all else fails, create via GitHub UI using Option B steps above.