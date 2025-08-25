# CLAUDE.md

> **Project**: **FlakeGuard**
> **Purpose**: Detect, score, and quarantine **flaky tests** for repositories using **GitHub Actions + JUnit XML**, with **one-click actions** (re-run failed jobs, open issue, quarantine), Slack triage, and a lightweight pipeline profiler.
> **How to use this file**: Paste this `CLAUDE.md` into the repo root. Open the repo in **Claude Code (MAX)**. Use the **prompts** and **checklists** below to drive end-to-end implementation.

---

## 0) TL;DR — What Claude Should Do

* Act as **tech lead + backend dev + DevOps** to ship an MVP in phases (**P0 → P10**).

* Keep stack consistent: **Node.js 20, TypeScript (strict, ESM), Fastify, Prisma (Postgres), BullMQ (Redis), Octokit, Bolt for JS (Slack)**.

* Implement the end-to-end loop:

  ```
  GitHub Actions run completes
      → webhook event (workflow_run)
      → list & download run artifacts
      → parse JUnit XML results
      → compute flakiness score (rolling window)
      → publish a rich Check Run (≤3 requested_actions)
      → optional: re-run failed jobs / open issue / quarantine
      → Slack triage companion
  ```

* Follow **security** & **permissions** baselines; keep secrets out of logs; verify all webhooks.

* Produce **docs, tests, CI**, and a **setup wizard** for contributors.

---

## 1) Scope (MVP) & Non-Goals

**In scope (MVP)**

* GitHub App (webhook + Checks + Actions APIs)
* Artifact ingestion (JUnit XML) + parsing + persistence
* Flakiness scoring (rule-based; rolling window)
* Check Run markdown + **≤3 requested\_actions**: `quarantine`, `rerun_failed`, `open_issue`
* Slack bot (triage companion with buttons → backend)
* Background workers (BullMQ), minimal metrics, Docker Compose dev stack

**Non-goals (phase 1)**

* Editing user source automatically (full code-mod quarantine).
* GitLab/Jenkins adapters (future).
* ML-based root-cause clustering (start simple, add later).

---

## 2) Architecture Overview

**Apps & packages**

```
apps/
  api/            # Fastify API + GitHub App webhook + Slack endpoints
  worker/         # BullMQ workers (ingestion, scoring, recompute)
  web/            # (optional MVP) read-only dashboard (later)
packages/
  shared/         # shared types, Octokit utils, parsers
infra/
  docker/         # compose files, local bootstrap
  prisma/         # schema, migrations, seed
```

**Key flows**

1. **Webhook intake** (`workflow_run`, `workflow_job`, `check_run.requested_action`) → enqueue job.
2. **Artifact service** → list artifacts for run → download (short-lived URL) → unzip → find JUnit XML files.
3. **JUnit parser** → normalize suites/cases/status/duration/failure message/stack.
4. **Scoring** → rolling window (e.g., last 50 runs); features: fail/pass ratio, **re-run pass rate**, message signature.
5. **Checks API** → publish summary + ≤3 requested actions.
6. **Actions** handlers → re-run failed jobs / open issue / quarantine record.
7. **Slack** → optional triage thread & buttons, calling backend actions.
8. **Workers** → polling, recompute, idempotency, retries, metrics.

---

## 3) Integrations & Permissions

**GitHub App**

* **Permissions** (minimum):

  * Checks: **Read/Write**
  * Actions: **Read/Write** (list artifacts, re-run failed jobs / job)
  * Contents: **Read** (optional; load `.flakeguard.yml`)
  * Metadata: **Read** (required)
  * Pull requests: **Read/Write** (for comments)
  * Issues: **Write** (for `open_issue`)
* **Webhooks**: `workflow_run`, `workflow_job`, `check_run`, `check_suite`, `pull_request`
* **Notes**:

  * **Requested actions limit: 3** per Check Run.
  * **Artifact download URLs are short-lived** → stream immediately or re-request on demand.

**Slack App (Bolt for JS)**

* Scopes (MVP): `commands`, `chat:write`, `chat:write.public`, `channels:history` (if needed), `groups:history` (if needed).
* Endpoints: `/slack/events` (signing secret verification), interactivity callback.
* Use **Block Kit** buttons to trigger backend actions.

**JUnit XML**

* Target common JUnit dialects (e.g., surefire-like): `<testsuite>`, `<testcase>`, `<failure>`, optional `<skipped>`.

---

## 4) Data Model (Prisma)

**Core tables (MVP)**

* `Repository(id, provider, owner, name, installationId)`
* `WorkflowRun(id, repoId, runId, status, conclusion, createdAt, updatedAt)`
* `Job(id, runId, jobId, name, status, conclusion, startedAt, completedAt)`
* `TestCase(id, repoId, suite, className, name, file, ownerTeam)`
* `Occurrence(id, testId, runId, status, durationMs, failureMsgSignature, failureStackDigest, attempt, createdAt)`
* `FlakeScore(testId, score, windowN, lastUpdatedAt)`
* `QuarantineDecision(id, testId, state, rationale, byUser, until, createdAt)`
* `IssueLink(id, testId, provider, url, createdAt)`

**Indexes**

* `(repoId, suite, className, name)`
* `(failureMsgSignature, repoId)`
* `(runId, testId)` unique

---

## 5) Tech Stack & Standards

* **Node.js 20**, **TypeScript** (strict, **ESM**), **pnpm** workspaces
* **Fastify** (HTTP), **Zod** (runtime validation), **Prisma** (Postgres), **BullMQ** (Redis)
* **Octokit** (GitHub), **Bolt for JS** (Slack)
* **Vitest**/**tsup**/**ESLint**/**Prettier**
* **Docker Compose** for Postgres/Redis/Apps

**Coding conventions**

* Absolute imports via TS path mapping; strict null checks; no `any`.
* Functional service modules, DI where needed.
* Errors carry `cause` and safe context; never log secrets.

---

## 6) Environment Variables (MVP)

Create `.env` (and commit `.env.example`):

```
# API
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# GitHub App
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_BASE64=   # base64 encoded PEM or file path via *_FILE
GITHUB_WEBHOOK_SECRET=
GITHUB_APP_INSTALLATION_ID=      # optional for single-tenant dev

# Slack
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=                 # if using socket mode (optional)

# DB/Cache
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/flakeguard
REDIS_URL=redis://redis:6379

# Policy defaults
FLAKE_WARN_THRESHOLD=0.3
FLAKE_QUARANTINE_THRESHOLD=0.6
```

---

## 7) Security & Privacy Baseline

* Verify **GitHub** & **Slack** signatures.
* Store **only** test metadata + outcomes; avoid storing source archives/artifacts.
* Mask secrets in logs; rotate tokens; prefer `*_FILE` pattern in containers.
* Principle of least privilege on GitHub App permissions.

---

## 8) Repo Conventions

* **License**: Apache-2.0 (or MIT)
* **.gitignore**: Node template + `dist/`, `coverage/`, `.env*`, `.DS_Store`, `*.log`, `tmp/`
* **Community Health**: `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`
* **Versioning**: **SemVer**, `CHANGELOG.md` (Keep a Changelog)
* **Branches**: `main`, feature branches `feat/<area>-<short>`
* **PR template**: Motivation, Changes, Risk/rollback, Tests, Observability

---

## 9) GitHub Repo Metadata

* **Name**: `flakeguard`
* **Description**:

  > FlakeGuard detects and manages flaky tests in GitHub Actions. It parses JUnit reports, clusters failures, shows actionable Check Runs (≤3 buttons), and offers a Slack triage companion.
* **Topics**:
  `flaky-tests`, `github-actions`, `checks-api`, `github-app`, `junit`, `devex`, `ci-observability`, `sre`, `typescript`, `fastify`, `prisma`, `bullmq`

---

## 10) Agents to Install & When to Use Them

> Clone/download from the three curated lists you shared. Use **just enough** agents; swap in/out per task.

**Core coordination (kickoff → planning → reviews)**

* `Tech Lead Orchestrator` — break down phases, allocate agents.
* `Project Analyst` — scan repo, suggest tools & gaps.
* `Team Configurator` — generate agent roster for this stack.

**Backend & API**

* `Backend Developer` / `backend-developer` — Fastify routes, services, DB access.
* `API Architect` / `api-designer` — OpenAPI contracts.

**TypeScript & DX**

* `typescript-pro` — strict types, generics, inference.
* `dx-optimizer` — pnpm scripts, VS Code tasks, onboarding.

**DevOps & SRE**

* `devops-engineer` / `deployment-engineer` — GitHub Actions, Docker, release.
* `sre-engineer` — SLOs, burn-rate alerts.

**Quality & Performance**

* `test-automator` / `qa-expert` — Vitest/integration/E2E.
* `performance-engineer` / `performance-optimizer` — profiling & tuning.
* `code-reviewer` — security/maintainability pass.
* `debugger` / `error-detective` — hard incident drilling.

---

## 11) Global Guardrails (Claude System Prompt)

> **Role**: Principal Engineer & Operator for FlakeGuard.
> **Non-negotiables**:
>
> * Use **Node 20 + TS strict + ESM** across all code.
> * Adhere to **Fastify + Prisma + BullMQ + Octokit + Bolt** stack.
> * In Check Runs, keep **≤3 requested\_actions** only.
> * Treat artifact download URLs as **short-lived**; stream & retry safely.
> * Never log secrets or raw webhook signatures; verify every webhook.
> * All features come with **tests**, **docs**, and **observable logs/metrics**.

---

## 12) Phase Prompts (P0 → P10)

> Paste one prompt at a time into Claude Code. After each phase, commit & run.

### **P0 — Monorepo Bootstrapping**

**Prompt**

```
You are a senior TS infra engineer. Create a pnpm monorepo named `flakeguard`:
- packages: apps/api (Fastify), apps/worker (BullMQ), packages/shared (types/utils)
- TS strict ESM, ESLint+Prettier, Vitest
- Prisma (Postgres), BullMQ (Redis)
- Docker Compose (postgres, redis, api, worker) with healthchecks
- .env.example, README quickstart, scripts: dev, build, test, migrate:dev, lint
Output: full file tree + file contents + exact commands to boot locally.
```

### **P1 — GitHub App Webhooks (verify & enqueue)**

**Prompt**

```
Implement POST /github/webhook in apps/api using Fastify:
- Verify HMAC with webhook secret
- Accept: workflow_run, workflow_job, check_run, check_suite, pull_request
- Enqueue minimal job payloads into BullMQ (QUEUE_GITHUB_EVENTS)
- Type-safe routing with Zod; return 202 immediately
Add unit tests for signature pass/fail.
```

### **P2 — Octokit Helpers (Actions & Artifacts)**

**Prompt**

```
In packages/shared/github.ts add:
- getOctokitForInstallation(installationId)
- listRunArtifacts({owner, repo, runId})
- downloadArtifactZip({owner, repo, artifactId}) → stream to /tmp and return path
- listJobsForRun({owner, repo, runId})
Handle short-lived URLs and basic rate limits. Include tests with Octokit stubs.
```

### **P3 — JUnit Parser + Persistence**

**Prompt**

```
Add a tolerant JUnit XML parser (common surefire-like dialects):
Extract suite, className, name, status, time, failure message/stack, file, attempt.
In apps/worker, implement processRunArtifacts job:
- discover JUnit files, parse, upsert TestCase/Occurrence
Add Prisma schema + migration + 3 fixtures (pass/fail/flaky) + tests.
```

### **P4 — Flakiness Scoring & Quarantine Policy**

**Prompt**

```
Create analytics/flakiness.ts:
- Score in [0..1] using a rolling window (e.g., 50 runs), weight "fail→rerun→pass" higher
- Thresholds: warn>=0.3, quarantine>=0.6
- POST /v1/quarantine/plan returns candidates + rationale
Add deterministic unit tests comparing stable vs flaky series.
```

### **P5 — Check Runs (≤3 actions)**

**Prompt**

```
Add renderCheckRunOutput(tests):
- Markdown summary with top-N flaky candidates, short table with Fail count, Rerun pass rate, Last failed run
- Actions: quarantine, rerun_failed, open_issue (<=3)
Create createOrUpdateCheckRun helper; ensure proper statuses.
Add snapshot tests for markdown and action count.
```

### **P6 — Action Handlers (requested\_action)**

**Prompt**

```
Handle check_run.requested_action:
- quarantine: record decision (DB) and comment a suggested quarantine PR text (no source edits in MVP)
- rerun_failed: call re-run failed jobs endpoint; update Check Run/PR comment
- open_issue: open repo issue with cluster evidence and links
Add error handling & tests for each branch.
```

### **P7 — Slack Triage (Bolt)**

**Prompt**

```
Add Bolt app in apps/api:
- /flakeguard slash command: status <owner/repo>, topflaky, help
- "Create Slack Triage Thread" action posts a Block Kit message with buttons: Quarantine, Open Issue (buttons call backend)
- Verify signing secret; include ngrok guidance
Add unit tests for handlers.
```

### **P8 — Workers & Idempotency**

**Prompt**

```
Implement worker queues: runs:ingest, runs:analyze, tests:recompute.
- Poll recent workflow runs (cursor) → enqueue ingestion when completed
- Idempotency: dedupe by {repo, runId}; backoff, DLQ
- Prometheus metrics; structured logs; graceful shutdown
Include integration tests with docker-compose up (postgres, redis).
```

### **P9 — Policy-as-Code & Repo Config**

**Prompt**

```
Add policy/engine.ts:
- Load .flakeguard.yml via Contents API; Zod schema
- Fields: flaky_threshold, min_occurrences, exclude_paths, labels_required
- Evaluate policy and return decisions & rationale
Add negative tests for invalid configs and fallback defaults.
```

### **P10 — Docs & DX**

**Prompt**

```
Author docs:
- README quickstart (Docker Compose, GitHub App setup, Slack)
- docs/: arch.md, data-model.md, scoring.md, slack.md, github-app.md
- Makefile or pnpm scripts for migrate/seed/lint/test/dev
Output finished README and commands.
```

---

## 13) “One-Shot Init” Prompt (Use Once)

```
You are Claude Code MAX. Bootstrap FlakeGuard MVP end-to-end:
- Create monorepo (pnpm, TS strict ESM) with apps/api, apps/worker, packages/shared
- Fastify webhook with verification; BullMQ queues; Prisma schema + migrations
- Octokit helpers for artifacts/jobs; JUnit parser; scoring; Check Runs (<=3 actions)
- Slack Bolt app; background workers; Docker Compose; tests and docs
Quality bar: `docker compose up` + `pnpm dev` runs locally; unit/integration tests pass.
Print the repo tree and next steps checklist.
```

---

## 14) Practical Agent-Level Prompts

* **Tech Lead Orchestrator**
  *“Use @tech-lead-orchestrator to expand P0→P10 into GitHub issues with acceptance criteria and estimates.”*

* **Project Analyst**
  *“Use @project-analyst to inspect our package.json/tsconfig and recommend missing devDependencies and scripts for Node 20 + TS strict + ESM.”*

* **Backend Developer**
  *“Use @backend-developer to implement a Fastify `POST /github/webhook` with signature verification and BullMQ enqueue, in TypeScript ESM.”*

* **API Architect / api-designer**
  *“Use @api-designer to produce an OpenAPI 3.1 spec for `/v1/quarantine/plan` and `/v1/tests/top-flaky` with JSON schemas.”*

* **typescript-pro**
  *“Use @typescript-pro to generically type Prisma service functions and eliminate all `any` from the parser and analytics modules.”*

* **devops-engineer**
  *“Use @devops-engineer to add a GitHub Actions workflow that runs lint/test, builds Docker images, and publishes artifacts on tags.”*

* **sre-engineer**
  *“Use @sre-engineer to define SLOs (ingestion latency, scoring freshness) and burn-rate alerts with 1h/6h windows.”*

* **test-automator / qa-expert**
  *“Use @test-automator to create Vitest integration tests simulating `workflow_run` webhook → artifact → parse → Check Run.”*

* **performance-engineer**
  *“Use @performance-engineer to profile worker throughput and propose batching/caching to minimize artifact IO and DB roundtrips.”*

* **code-reviewer**
  *“Use @code-reviewer to audit security: webhook verification, token handling, logging hygiene; output a prioritized fix list.”*

---

## 15) Definition of Done (DoD) — Milestone Checklists

**P0**

* [ ] Monorepo compiles (`pnpm -r build`), lints, tests pass
* [ ] Compose boots Postgres/Redis/API/Worker; `/healthz` green

**P1–P2**

* [ ] Webhook verifies signature; returns 202
* [ ] Octokit can list & download artifacts; handles short-lived URLs

**P3–P4**

* [ ] JUnit parser passes fixtures (pass/fail/flaky)
* [ ] Flake score stable across runs; deterministic tests

**P5–P6**

* [ ] Check Run renders markdown & **≤3 actions**
* [ ] Actions: quarantine recorded; re-run failed jobs triggered; issue opened

**P7–P8**

* [ ] Slack slash command works; buttons call backend
* [ ] Workers idempotent; metrics exposed; DLQ visible

**P9–P10**

* [ ] `.flakeguard.yml` policy loads; invalid configs handled
* [ ] README & docs complete; quickstart succeeds on a fresh machine

---

## 16) Risks & Mitigations

* **API rate limits / retries** → Central Octokit wrapper with backoff & jitter.
* **Artifact format variance** → tolerant parser; fixtures for popular dialects.
* **Over-quarantine** → human-in-the-loop (buttons), expiry (`until`), rationale logs.
* **Slack limits** → combine updates; avoid noisy threads; keep actions backend-driven.

---

## 17) Sample Policy File (`.flakeguard.yml`)

```yaml
flaky_threshold: 0.6
warn_threshold: 0.3
min_occurrences: 2
exclude_paths:
  - "examples/**"
labels_required:
  - "ci"
  - "tests"
```

---

## 18) Sample Check Run Markdown (MVP)

```
### FlakeGuard – Flaky Test Candidates

| Test | Fail Count | Rerun Pass Rate | Last Failed Run |
|---|---:|---:|---:|
| suite/ClassA#should_timeout | 3 | 66% | 12345 |
| suite/ClassB#random_order   | 2 | 50% | 12340 |

Actions: [Quarantine] [Re-run Failed Jobs] [Open Issue]
```

---

## 19) Local Runbook (Quickstart)

```
pnpm i
pnpm -r build
docker compose up -d        # postgres, redis
pnpm -r dev                 # start api + worker
# Use ngrok for GitHub/Slack webhooks in dev if needed
```

---

## 20) Roadmap (Post-MVP)

* **DebugDock**: CI→local `docker run` generator from job logs/services/env.
* **PipeProbe**: 24–48h TopN: longest jobs, longest runner wait, longest pipelines.
* **Auto-patch quarantine PR** (opt-in).
* **GitLab/Jenkins adapters**; **open-telemetry hooks**; **multi-tenant RBAC**.

---

### End of CLAUDE.md

> You can start now with **P0**. After each phase, commit, run tests, and proceed.
