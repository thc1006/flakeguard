## P8 — Data Model（Prisma）

**Goal**: 支撐測試、運行、失敗叢集、隔離紀錄。

**Prompt**:

> Extend Prisma schema with:
>
> * `Repository`, `WorkflowRun`, `Job`, `TestCase`, `FailureCluster`, `QuarantineDecision`, `IssueLink`.
> * Critical indexes: `(repoId, testFullName)`, `(failureSignature, repoId)`.
> * Seed script to load sample runs/tests.
>   Emit migrations and sample queries.

---

## P9 — Policy-as-Code（風險/門檻可配置）

**Goal**: 讓使用者用 YAML 設定門檻與白名單。

**Prompt**:

> Implement `apps/api/src/policy/engine.ts`:
>
> * Load `.flakeguard.yml` from repo via Contents API; schema via Zod.
> * Fields: `flaky_threshold`, `min_occurrences`, `exclude_paths`, `labels_required`.
> * Policy evaluation returns decision + rationale messages.
>   Add tests with invalid configs and defaults.

---

## P10 — Web Dashboard（只讀版 MVP）

**Goal**: 小型前端（可用 Next.js 或純 Vite + React），展示核心指標。

**Prompt**:

> Create `apps/web` showing:
>
> * Repo list, Top flaky tests, Failure clusters, Recent actions.
> * Deep-link to GitHub PR/check page and Slack thread.
> * Minimal auth (GitHub OAuth) and .env examples.
>   Provide full code + Dockerfile.

---

## P11 — Observability & SLOs

**Goal**: 內建基本 SLO 與 burn rate 告警範本。

**Prompt**:

> Add `/metrics` endpoint; define counters/histograms for ingestion latency, parse failures, API errors.
> Provide alert examples for **multi-window burn-rate** (e.g., 1h & 6h) for “ingestion error ratio” and “API 5xx rate”.
> Add docs: how to wire rules to Prometheus/Alertmanager.

（多窗口/多 burn-rate 告警。([dora.dev][13])）

---

## P12 — Security & Secrets

**Goal**: 安全地處理 GitHub App 私鑰、Webhook Secrets、Slack Secrets。

**Prompt**:

> Document secret handling: use Docker secrets or mounted files for PEM; never log tokens.
> Add HMAC verification for GitHub webhooks; Slack request signature verification.
> Rate-limit endpoints; add CSRF for dashboard.
> Provide a table of env vars and rotations.

（Webhook/權限最佳實踐。([GitHub Docs][18])）

---

## P13 — Test Suite（Vitest/Playwright）

**Goal**: 單元、整合與端對端測試。

**Prompt**:

> * Unit: policy engine, parser, scoring.
> * Integration: mock GitHub API responses for artifacts/list/rerun, verify state changes.
> * E2E: spawn docker-compose (Postgres/Redis), seed runs, simulate webhook payloads, assert dashboard & check runs.
> * Include GitHub event fixtures (`workflow_run`, `check_run.requested_action`).

---

## P14 — Sample Repo & “Known Flaky” Scenario

**Goal**: 建立一個示範目錄，穩定重現「間歇性失敗」。

**Prompt**:

> Scaffold `examples/js-multi-project` with a few Jest tests including one flaky test (random timeout or external call).
> Provide a GitHub Actions workflow that uploads JUnit reports as artifact.
> Add instructions to install the GitHub App on this repo and watch FlakeGuard behaviors.

---

## P15 — Packaging & CI/CD

**Goal**: 針對專案本身的 CI（lint/test/build/e2e），並產出 docker images。

**Prompt**:

> Provide GitHub Actions workflows for `lint+test` and `release` with SemVer tags and Docker image publishing.
> Add CHANGELOG scaffolding with **Keep a Changelog** format; integrate release notes generation.
> Output full YAML.

（Keep a Changelog 與 SemVer 的通用指引。([keepachangelog.com][19], [Baeldung on Kotlin][20])）

---

## P16 — Setup Wizard（安裝嚮導 CLI）

**Goal**: 提供 `pnpm flakeguard:init` 互動式 CLI。

**Prompt**:

> Build a Node CLI that:
>
> * Validates env, checks DB connectivity, seeds admin user.
> * Guides creating GitHub App credentials, Slack app secrets.
> * Writes `.env` securely and prints next steps.
>   Include dry-run mode and transcript log.

---

## P17 — Governance（開源社群健康檔）

**Goal**: 自動生成 CODE\_OF\_CONDUCT、CONTRIBUTING、SECURITY.md。

**Prompt**:

> Generate community health files with short, actionable content; link to issue templates and discussions.
> Provide npm script `pnpm scaffold:community`.

（屬 GitHub 最佳實踐範疇；搭配 choosealicense 與 topics 建議。([Choose a License][21])）

---

## P18 — Rate Limit & Resilience

**Goal**: Octokit 中央化攔截器，監控 X-RateLimit、Retry-After、二次退避。

**Prompt**:

> Implement an Octokit wrapper:
>
> * Add request hooks logging `x-ratelimit-remaining`/`reset`.
> * Auto retry on 403 secondary rate limits with jittered backoff.
> * Circuit-breaker for repeated failures; emit metrics.

---

## P19 — Multi-tenant & Org-Scale Readiness（可選）

**Goal**: 一個 App 安裝於多個 repos/orgs；隔離租戶資料。

**Prompt**:

> Add `installation_id`/`org` scoping across tables; enforce row-level tenancy checks in API routes.
> Provide an org-wide sync job to discover repos with Actions enabled and register them for polling.

---

## P20 — Docs Site（開發者文檔）

**Goal**: 產出 docs 站（Docusaurus/VitePress）。

**Prompt**:

> Include architecture diagrams, sequence diagrams for webhook flows, troubleshooting (“why my requested\_action didn’t fire?”).
> Add “Security model” and “SLOs & DORA mapping” sections.

（DORA 指標仍是主流度量語言；可在文檔中映射 MTTR/Change failure rate 等。([Stack Overflow][12])）

---

# 四、專案命名、描述、標籤（GitHub）

* **Repository name**：`flakeguard`

* **Description（英文）**：

  > FlakeGuard detects and manages flaky tests in GitHub Actions. It parses JUnit reports, clusters failures, shows actionable Check Runs with one-click requested actions (quarantine, re-run failed jobs, open issue), and offers a Slack triage companion.

* **Topics（建議 8–12 個）**：
  `flaky-tests`, `github-actions`, `checks-api`, `github-app`, `junit`, `devex`, `ci-observability`, `sre`, `typescript`, `fastify`, `prisma`, `bullmq`
  （可於 repo Settings → Topics 新增。([GitHub Docs][22])）

---

# 五、.gitignore（Add .gitignore）

建議採用 **官方 Node.gitignore** 模板（另加上 `apps/**/.env*`、`/coverage`、`/dist` 等專案特定條目）。來源：**github/gitignore** 專案內之 Node 模板。([GitHub Docs][16])

---

# 六、授權（Add license）

* **首選**：**Apache-2.0**（含專利授權，適合企業採用；與雲原生生態相容性高）。([Choose a License][23], [apache.org][24])
* **次選**：MIT（極度寬鬆）。([Choose a License][15])
  在 GitHub 初始化時可直接選擇上述模板（choosealicense 亦提供對照）。([Choose a License][21])

---

# 七、Connect GitHub Apps（如何連接）

1. 於 **GitHub → Settings → Developer settings → GitHub Apps** 建立 App，設定 Webhook（/api/github/webhooks）、權限（Checks: read/write、Actions: read/write、Contents: read、Pull requests: read/write、Issues: write）。
2. 安裝到目標 org/repo，取得 **Installation ID**；後端以 `@octokit/app` 交換 **installation access token** 後執行 API。
3. 記得為 `check_run.requested_action` 確保 **Checks: write**，否則按鈕事件不會送達。([GitHub Docs][25])

---

# 八、為何這一版提示詞更穩健？

* **緊扣平台限制**：顧及 Checks 最多三個 actions 的硬限制與 re-run 粒度選擇。([GitHub Docs][3])
* **對 artifacts 的時效防禦**：1 分鐘短效 URL → 以串流與重試處理。([GitHub Docs][1])
* **權限明確**：特別標注 Checks: write 與必要 webhook 事件。([GitHub Docs][6])
* **與 SRE/DORA 對齊**：內建多窗口 burn-rate 告警樣板與 DORA 對映，避免只報數字不驅動行動。([dora.dev][13], [Stack Overflow][12])

---

# 九、接下來怎麼做？

1. 從 **P0–P2** 開始（專案骨架 → App 骨架 → 解析 artifacts），跑通最短閉環：
   ① Workflow 產生 JUnit artifact → ② Webhook 觸發 → ③ 下載/解析/入庫 → ④ Check Run 輸出。
2. 再加上 **P4–P5**（Check Run actions + handlers），完成「一鍵隔離／重跑」的第一版價值閉環。
3. 最後補 **P6–P8**（Slack、Worker、資料模型強化）與 **P11**（SLO/告警），即可進入 dogfooding。


[1]: https://docs.github.com/en/rest/actions/artifacts "REST API endpoints for GitHub Actions artifacts - GitHub Docs"
[2]: https://docs.github.com/en/rest/actions/workflow-runs "REST API endpoints for workflow runs - GitHub Docs"
[3]: https://docs.github.com/en/rest/checks/runs?utm_source=chatgpt.com "REST API endpoints for check runs"
[4]: https://github.com/github/gitignore?utm_source=chatgpt.com "A collection of useful .gitignore templates"
[5]: https://gist.github.com/ericelliott/a9c8e7810d94fdd90993e30552674244?utm_source=chatgpt.com "Sample Node project .gitignore"
[6]: https://docs.github.com/en/webhooks/webhook-events-and-payloads?utm_source=chatgpt.com "Webhook events and payloads"
[7]: https://api.slack.com/reference/block-kit/block-elements?utm_source=chatgpt.com "Reference: block elements & interactive components"
[8]: https://docs.slack.dev/tools/bolt-js/concepts/publishing-views?utm_source=chatgpt.com "Publishing views to App Home - Slack Developer Docs"
[9]: https://docs.github.com/rest/checks/runs?utm_source=chatgpt.com "REST API endpoints for check runs"
[10]: https://docs.slack.dev/tools/bolt-js/concepts/actions?utm_source=chatgpt.com "Listening & responding to actions - Slack Developer Docs"
[11]: https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq?utm_source=chatgpt.com "Rate limit changes for non-Marketplace apps"
[12]: https://stackoverflow.com/questions/3362304/where-can-i-find-the-dtd-or-xml-schema-of-surefire-generated-xml-test-testname?utm_source=chatgpt.com "Where can i find the DTD or XML Schema of surefire ..."
[13]: https://dora.dev/guides/dora-metrics-four-keys/?utm_source=chatgpt.com "DORA's software delivery metrics: the four keys"
[14]: https://services.google.com/fh/files/misc/2024_final_dora_report.pdf?utm_source=chatgpt.com "Accelerate State of DevOps"
[15]: https://choosealicense.com/licenses/mit/?utm_source=chatgpt.com "MIT License"
[16]: https://docs.github.com/en/rest/actions/workflow-runs?utm_source=chatgpt.com "REST API endpoints for workflow runs"
[17]: https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks?utm_source=chatgpt.com "Using the REST API to interact with checks"
[18]: https://docs.github.com/en/webhooks?utm_source=chatgpt.com "Webhooks documentation"
[19]: https://keepachangelog.com/en/0.3.0/?utm_source=chatgpt.com "Don't let your friends dump git logs into changelogs."
[20]: https://www.baeldung.com/cs/semantic-versioning?utm_source=chatgpt.com "A Guide to Semantic Versioning"
[21]: https://choosealicense.com/?utm_source=chatgpt.com "Choose an open source license | Choose a License"
[22]: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs?utm_source=chatgpt.com "Re-running workflows and jobs"
[23]: https://choosealicense.com/licenses/apache-2.0/?utm_source=chatgpt.com "Apache License 2.0"
[24]: https://www.apache.org/licenses/LICENSE-2.0?utm_source=chatgpt.com "Apache License, Version 2.0"
[25]: https://docs.github.com/en/rest/actions "REST API endpoints for GitHub Actions - GitHub Docs"
