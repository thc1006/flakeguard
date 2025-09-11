# CLAUDE.md — Working Agreement & Playbook for **FlakeGuard** (Flaky Test Quarantine System)

> A complete guide to build, operate, and extend FlakeGuard with **Claude Code (MAX)**.
> Includes: Why & what to build, exact prompts, repo layout, CI/CD, GitHub App wiring, quality gates, ops runbooks, and upgrade paths.

---

## 0) Project one-liner

**FlakeGuard** automatically detects intermittently failing (“flaky”) tests from CI signals, quarantines them safely (without masking true regressions), files repair tickets with context, and tracks “deflake” SLAs.

---

## 1) Goals, non-goals, and measurable success

**Goals**

* Cut **time-to-green** for PRs by auto-recognizing known flakes and gating on only deterministic failures.
* Reduce **false red builds** and rebuild churn by ≥30% within 30 days.
* Provide **actionable context**: failure clustering, recent pass/fail streaks, environment diffs, and code owners.
* Offer **safe quarantine**: mark as “flakes under remediation” with clear expirations + mandatory follow-ups (no permanent ignore).

**Non-goals (v1)**

* Full test observability platform; we focus on flake lifecycle (detect → quarantine → fix).
* Universal CI support; v1: **GitHub Actions** first. (Jenkins/GitLab optional adapters later.)

**Leading indicators**

* % of red pipelines auto-reclassified as “flake suspected”.
* Mean re-run count per PR (target ↓).
* Number of quarantined tests resolved per week.

**DORA alignment**

We report impact using the **four DORA metrics** (deployment frequency, lead time, change failure rate, MTTR). Improving flake handling typically reduces change failure rate and MTTR. ([Google Cloud][1])

---

## 2) System architecture (v1)

**Core pieces**

* **Ingestion**: Webhooks from GitHub **check\_suite**, **workflow\_job**, and **check\_run** + downloading job logs/artifacts for parsing.
* **Classifier**: Rules + heuristics + optional LLM summary to label failures (flake candidate vs deterministic).
* **Quarantine engine**: Opens/updates PR comments, sets **Check Run** with up to **three interactive buttons** (e.g., “Re-run”, “Quarantine 7d”, “Escalate”). Checks API restricts to **max 3 requested actions**. ([GitHub Docs][2])
* **Registry**: SQLite/Postgres storing test keys, flake counters, owners, last-seen env.
* **Integrations**

  * **GitHub App** (checks\:write, pull\_requests\:read, contents\:read minimally).
  * Optional Slack notifier for escalations (acknowledge within **3 seconds** rule). ([Slack API][3])
* **Observability**: OpenTelemetry for Node.js service + Fastify auto-instrumentation. ([OpenTelemetry][4], [npm][5])

**Event flow (GitHub Actions)**

1. Workflow finishes → GitHub sends webhook → Ingestion fetches job metadata and **short-lived artifact URLs** (download URL expires quickly; treat as ephemeral). ([GitHub Docs][6])
2. Parser derives **test-case keys** (suite::name::file::seed), error signatures, env hash (os, image, Node version).
3. Classifier consults registry (confidence threshold) → sets **Check Run** with status + buttons. (3 buttons max.) ([GitHub Docs][2])
4. If user clicks “Quarantine 7d” → bot opens/updates tracking issue, updates quarantine list config, posts CODEOWNERS-routed ping. (CODEOWNERS precedence matters.) ([GitHub Docs][7])
5. Dual-window **burn-rate alerts** for flake backlog (operational SLOs). ([Google SRE][8], [Datadog][9])

---

## 3) Repository layout (monorepo, pnpm)

```
flakeguard/
  apps/
    api/                # Fastify + Checks API + Slack (optional)
    github-app/         # App manifest, permissions, webhook router
    cli/                # Local tools (triage, migrations, backfills)
  packages/
    core/               # Test parser, signatures, quarantine rules
    adapters/gha/       # GitHub Actions parser & artifact readers
    adapters/junit/     # JUnit/XML readers
  infra/
    docker/             # Images & compose for local
    ops/                # Helm/chart or Terraform later
  .github/
    workflows/          # CI pipelines, release
    CODEOWNERS
  SECURITY.md
  CONTRIBUTING.md
```

---

## 4) Naming, repo description, topics

* **Repo name**: `flakeguard`
* **GitHub description**:
  *“Detect, quarantine, and fix flaky tests for GitHub Actions — safe by default, actionable by design.”*
* **Topics**: `flaky-tests`, `ci`, `github-actions`, `testing`, `devx`, `sre`, `observability`, `check-runs`, `sbom`, `security`

---

## 5) License & .gitignore

* **License**: choose **MIT** (permissive) or **Apache-2.0** (patent grant). See guidance. ([Choose a License][10], [GitHub][11])
* **.gitignore**: base on official **Node** & **macOS/Linux** templates from GitHub. ([conventionalcommits.org][12])

---

## 6) GitHub protections & quality gates

* Enable **required status checks** before merge (protect `main`), so FlakeGuard’s checks must pass to merge. ([GitHub Docs][13])
* Keep **GITHUB\_TOKEN** least-privilege using workflow/job-level `permissions:` overrides (org default: restricted). ([GitHub Docs][14])
* CODEOWNERS rules: note **last-matching pattern wins**. ([GitHub Docs][7])
* Security scans: **Gitleaks** (secrets), **Syft** (SBOM), **Grype** (vuln scan). ([GitHub][15])

---

## 7) Development environment

* Node.js 20 LTS, pnpm, TypeScript, Fastify, Zod, Vitest.
* OpenTelemetry SDK + `@opentelemetry/auto-instrumentations-node` (adds HTTP/Express/Fastify spans out-of-the-box). ([OpenTelemetry][4])

---

## 8) GitHub App — initial setup (admin)

1. Create **GitHub App** → set **permissions** minimal:

   * Repository: *Contents: Read*, *Pull requests: Read*, *Checks: Read & Write*, *Actions: Read*.
   * Webhooks: subscribe to **check\_suite**, **check\_run**, **pull\_request**, **workflow\_job**.
   * Rationale: enables Check Runs UI + reads CI outputs without broad write access (least-privilege). ([GitHub Docs][14])
2. Configure **webhook secret** + App private key; deploy Fastify receiver (ngrok or public URL).
3. Install App on target repo(s) with repository-level access.
4. In repo **Settings → Branches**: add rule: require FlakeGuard check + CI unit tests. ([GitHub Docs][16])

> **Note** (Checks UI): Keep interactive actions ≤ **3 buttons** (e.g., “Re-run failing jobs”, “Quarantine 7d”, “Escalate to owners”). ([GitHub Docs][2])

---

## 9) CI/CD (self-hosted)

**Workflows**

* `ci.yml`: install, build, unit tests, type-check.
* `e2e.yml`: matrix against Node versions & OS.
* `security.yml`: gitleaks → syft (SBOM) → grype (scan). ([GitHub][15])

**Permissions**

* Default repo **Workflow permissions**: *Read only*, then elevate per job (e.g., `checks: write` for release bot) — aligns with least-privilege guidance. ([GitHub Docs][17])

**Artifacts**

* When the API fetches job artifacts/logs, respect **ephemeral download URLs** (re-request if expired). ([GitHub Docs][6])

---

## 10) SLOs & alerting (operational)

* **Service SLO**: Webhook ingest p95 < 1.0s; decision latency p95 < 20s.
* **Flake backlog SLO**: Burn-rate monitor using **multi-window, multi-burn-rate**: e.g., (1h & 5m, BR 14.4) + (6h & 30m, BR 6). ([Google SRE][8], [SoundCloud 開發者][18])
* Rationale and patterns are defined by Google SRE **Workbook**; multi-window reduces noise and resolves fast after a fix. ([Google SRE][19])

---

## 11) Prompts — **Claude Code** (MAX) — reusable patterns

> Use these *verbatim* in Claude Code’s chat. Keep them small and iterative; ask Claude Code to open/modify specific files and to produce **diffs**.

### 11.1 Bootstrap repo

```
Role: Repository Bootstrapper
Goal: Initialize FlakeGuard monorepo with pnpm workspaces, TS strict, Fastify API, and packages/core.
Actions:
1) Create packages/core with tsconfig, jest/vitest config, and an exported parseFailure() placeholder.
2) Create apps/api (Fastify + health route /healthz, JSON logging).
3) Create apps/github-app with a Fastify plugin that handles POST /webhook and verifies X-Hub-Signature-256.
4) Add pnpm workspace root configs, eslint + prettier, and scripts: build, test, dev.
5) Generate .gitignore (Node + OS) and LICENSE (MIT). Keep diff small, compile & test.

Acceptance:
- `pnpm -w install && pnpm -w -r build` succeeds.
- `curl localhost:3000/healthz` returns 200 in dev.
- Show all file diffs and any new scripts.
```

### 11.2 Checks API integration (buttons ≤3)

```
Role: GitHub Checks Integrator
Goal: Implement create/update Check Runs with up to 3 "requested_action" buttons.
Constraints:
- Max 3 actions per check run (enforced by API).
- Include summary markdown with failure clusters and suspected flakes.

Tasks:
- Add github/rest client wrapper in apps/api/src/gh.ts.
- Implement POST /check-runs to create; PATCH /check-runs/:id to update status (queued, in_progress, completed).
- Wire webhook handlers for check_suite.completed and workflow_job.completed.
- Provide a pure function buildCheckRunPayload({status, conclusion, actions:[...]}) that never exceeds 3 actions.

Acceptance:
- Unit tests cover that supplying >3 actions is truncated with warning.
- Demo script creates a check on a fake SHA and prints the URL.
```

*(Checks API 3-action limit)* ([GitHub Docs][2])

### 11.3 Artifact & log ingestion (ephemeral URLs)

```
Role: GHA Artifact Ingestion Engineer
Goal: Given a run_id, fetch artifacts & logs, parse JUnit XML to normalized failures.
Constraints:
- Artifact download URLs are short-lived; always request fresh URL, handle expiry by refetch.
- Don’t assume public visibility.

Tasks:
- Implement getWorkflowArtifacts(runId) -> [{name, expiresAt, downloadUrl}]
- Add retry/backoff if HTTP 403/Expired.
- Write parser: packages/adapters/junit: parseJUnit(xml) -> { testKey, messageHash, stack, file, line }
- For logs, add simple regex to extract "FAILED" blocks when JUnit absent.

Acceptance:
- Unit tests with recorded fixtures (small samples).
- A CLI command `fg ingest --run <id>` prints top failure signatures.
```

*(Ephemeral artifact URLs)* ([GitHub Docs][6])

### 11.4 Classifier & quarantine flow

```
Role: Flake Classifier
Goal: Implement flake scoring and quarantine action with reversible config.
Inputs:
- Past N outcomes for testKey, env hash, messageHash similarity.

Tasks:
- packages/core: scoreFlake({passStreak, failStreak, variability, envEntropy}) -> 0..1
- Quarantine config file in repo: .flakeguard/quarantine.yml with entries {testKey, until, reason, owner}.
- “Quarantine 7d” button updates config via PR and posts comment tagging CODEOWNERS.

Acceptance:
- If score >= 0.8 AND test previously passed on re-run, status = "flake suspected".
- Creating PR modifies .flakeguard/quarantine.yml and adds a TODO with expiration date.
```

### 11.5 Slack escalation (optional)

```
Role: Slack Integrator
Goal: Notify #ci-flakes with a compact message when quarantine exceeds SLA.
Constraints:
- Respond/ack to interactive actions within 3 seconds.
- Support Socket Mode for local dev.

Acceptance:
- Post a block kit message with testKey, owner, days in quarantine, button "Create Jira".
```

*(3-second ack; Socket Mode basics)* ([Slack API][3])

### 11.6 Observability (OpenTelemetry)

```
Role: Telemetry Engineer
Goal: Enable OpenTelemetry auto-instrumentation for Fastify API with traces & metrics.
Tasks:
- Add @opentelemetry/sdk-node + auto-instrumentations-node, exporter OTLP/HTTP env-configurable.
- Create tracer provider bootstrap; span for webhook handlers; attributes: event_type, run_id.
- Add /metrics (prom-compatible) and latency histograms.

Acceptance:
- Local collector receives spans when POST /webhook invoked.
```

([OpenTelemetry][4])

### 11.7 Security gates in CI

```
Role: CI Security Engineer
Goal: Add "security.yml" workflow for Gitleaks → Syft SBOM → Grype vuln scan.
Acceptance:
- security job fails on secrets found or critical CVEs.
- Upload SBOM artifact and attach as build artifact.
```

([GitHub][15])

### 11.8 Branch protection, CODEOWNERS, Conventional Commits

```
Role: Repo Guardian
Goal: Enforce required checks and sane review rules.

Tasks:
- Add .github/CODEOWNERS with specific to general patterns (remember: last match wins).
- Turn on branch protection with "Require status checks" and FlakeGuard check required.
- Add commit lint for Conventional Commits and semver-calculated release notes.

Acceptance:
- PR cannot merge unless FlakeGuard + tests succeed and owners approve.
```

([GitHub Docs][7], [Semantic Versioning][20], [Keep a Changelog][21])

---

## 12) Manual admin steps (you do these once)

* **Create GitHub App** per §8. Save App ID, Client ID/secret, private key, webhook secret.
* **Install App** on target repos.
* **Set repo protections**: Require status checks (FlakeGuard; unit tests). ([GitHub Docs][13])
* **Set Actions → Workflow permissions**: default *Read*; raise per job in YAML. ([GitHub Docs][17])
* **Choose license** (MIT/Apache-2.0) and commit via `LICENSE` file. ([Choose a License][10])
* **Add .gitignore** from GitHub templates (Node + OS). ([conventionalcommits.org][12])

---

## 13) Contributor guidelines (short)

* **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`…) → enables auto-release & changelog. ([Semantic Versioning][20])
* **Versioning**: SemVer 2.0.0. Breaking change → **major**. ([Keep a Changelog][21])
* **CHANGELOG**: human-friendly per *Keep a Changelog*. ([Ghinda][22])

---

## 14) Pull Request checklist (copy into PR template)

* [ ] Unit tests added/updated for classifiers and adapters.
* [ ] Check Run shows ≤ 3 actions, labels + summary render correctly. ([GitHub Docs][2])
* [ ] No secrets in diff (Gitleaks green). ([GitHub][15])
* [ ] SBOM attached; no critical vulns (Grype). ([GitHub][23])
* [ ] Branch is green on required checks; reviewers per CODEOWNERS approved. ([GitHub Docs][13])

---

## 15) Runbooks

**Webhooks failing (Slack/HTTP)**

* Check 2xx within **3s** rule; add async queue; ack immediately, process later. ([Slack API][24])

**Artifacts download 403**

* Re-request signed URL; they can expire quickly. ([GitHub Docs][6])

**No check appears on PR**

* App permissions missing (*Checks: write*), or branch protection blocking unknown checks.

**Too many buttons in the Check**

* Trim to ≤3; the API rejects extras. ([GitHub Docs][2])

---

## 16) Roadmap (90 days)

* **Jenkins/GitLab adapters**.
* **Heuristics → ML**: cluster by stacktrace embeddings, env diffs.
* **Policy packs**: org-wide quarantine SLA policy, auto-escalation to owners.
* **UI**: historical flake dashboard with SLO **burn-rate** panels (multi-window). ([Google SRE][8])

---

## 17) Ready-to-paste **Claude Code** task list (first 10)

> Paste one task at a time; ask for diffs & tests each time.

1. **Workspace & API skeleton** — *as in §11.1*
2. **Checks API wrapper & webhook routes** — *§11.2*
3. **Artifact ingestion + JUnit parser + CLI** — *§11.3*
4. **Classifier & quarantine PR flow** — *§11.4*
5. **CODEOWNERS + protections + commitlint** — *§11.8*
6. **Security workflow (gitleaks/syft/grype)** — *§11.7*
7. **Telemetry (OTel)** — *§11.6*
8. **Seed sample repo & fixtures (E2E)**
9. **Slack escalation (opt-in)** — *§11.5*
10. **Docs: SECURITY.md, CONTRIBUTING.md, README diagrams** (include SLOs and burn-rate explainer). ([Google SRE][8])

---

## 18) Release & distribution

* **Release train**: weekly. `feat:` bumps **minor**, `fix:` bumps **patch** (SemVer). ([Keep a Changelog][21])
* Changelog generated from Conventional Commits → publish GH release. ([Ghinda][22])
* GitHub App listing: follow Marketplace guidelines if publishing broadly. ([Omi AI][25])

---

## 19) Appendix — reference snippets

**Minimal workflow permissions**

```yaml
# .github/workflows/ci.yml
permissions:
  contents: read
  checks: write   # only if this job updates checks
  actions: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm i && pnpm -r build && pnpm -r test
```

*(Principle of least privilege for GITHUB\_TOKEN)* ([GitHub Docs][14])

**CODEOWNERS precedence reminder**
*Last matching pattern wins; keep specific rules last.* ([GitHub Docs][7])

**Burn-rate pairs (starter)**
(1h & 5m, BR **14.4**) and (6h & 30m, BR **6**) — low noise + quick resolution. ([SoundCloud 開發者][18])

---

## 20) Project metadata (README badges & copy)

**README intro**

> FlakeGuard watches your CI, finds intermittent failures, and gives you buttons to **re-run**, **quarantine**, or **escalate** — without hiding real regressions. Integrates natively with GitHub Checks and your Slack.

**Badges**

* CI, Security Scan (gitleaks/grype), SBOM available, Coverage.


[1]: https://cloud.google.com/blog/products/devops-sre/dora-2022-accelerate-state-of-devops-report-now-out?utm_source=chatgpt.com "DORA 2022 Accelerate State of DevOps Report now out"
[2]: https://docs.github.com/en/rest/checks/runs?utm_source=chatgpt.com "REST API endpoints for check runs"
[3]: https://api.slack.com/interactivity/handling?utm_source=chatgpt.com "Handling user interaction in your Slack apps"
[4]: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/?utm_source=chatgpt.com "Node.js"
[5]: https://www.npmjs.com/package/%40opentelemetry/instrumentation-fastify?utm_source=chatgpt.com "opentelemetry/instrumentation-fastify"
[6]: https://docs.github.com/en/rest/actions/artifacts?utm_source=chatgpt.com "REST API endpoints for GitHub Actions artifacts"
[7]: https://docs.github.com/articles/about-code-owners?utm_source=chatgpt.com "About code owners"
[8]: https://sre.google/workbook/alerting-on-slos/?utm_source=chatgpt.com "Prometheus Alerting: Turn SLOs into Alerts - Google SRE"
[9]: https://www.datadoghq.com/blog/burn-rate-is-better-error-rate/?utm_source=chatgpt.com "Burn rate is a better error rate | Datadog"
[10]: https://choosealicense.com/licenses/?utm_source=chatgpt.com "Choose a License"
[11]: https://github.com/github/gitignore?utm_source=chatgpt.com "A collection of useful .gitignore templates"
[12]: https://www.conventionalcommits.org/en/v1.0.0/?utm_source=chatgpt.com "Conventional Commits"
[13]: https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches?utm_source=chatgpt.com "About protected branches"
[14]: https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token?utm_source=chatgpt.com "Use GITHUB_TOKEN for authentication in workflows"
[15]: https://github.com/gitleaks/gitleaks?utm_source=chatgpt.com "Find secrets with Gitleaks - GitHub"
[16]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule?utm_source=chatgpt.com "Managing a branch protection rule"
[17]: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository?utm_source=chatgpt.com "Managing GitHub Actions settings for a repository"
[18]: https://developers.soundcloud.com/blog/alerting-on-slos?utm_source=chatgpt.com "Alerting on SLOs like Pros | SoundCloud Backstage Blog"
[19]: https://sre.google/workbook/index/?utm_source=chatgpt.com "Site Reliability Engineering Book Index - Google SRE"
[20]: https://semver.org/?utm_source=chatgpt.com "Semantic Versioning 2.0.0 | Semantic Versioning"
[21]: https://keepachangelog.com/en/1.1.0/?utm_source=chatgpt.com "Keep a Changelog"
[22]: https://ghinda.com/blog/opensource/2020/open-source-licenses-apache-mit-bsd.html?utm_source=chatgpt.com "A developer's guide to the most common open-source ..."
[23]: https://github.com/anchore/syft/wiki?utm_source=chatgpt.com "Home · anchore/syft Wiki · GitHub"
[24]: https://api.slack.com/apis/events-api?utm_source=chatgpt.com "Events API"
[25]: https://www.omi.me/blogs/api-guides/how-to-use-github-marketplace-api-to-list-apps-in-node-js?srsltid=AfmBOooAfivYi_vYjyJNTQu3-PIiLXyQywBcFqRZBLx7nj5ern_Bn1QW&utm_source=chatgpt.com "How to Use GitHub Marketplace API to List Apps in Node.js"
