# FlakeGuard
FlakeGuard: real-time flaky test detection, quarantine, and root-cause insights. Pairs with optional modules for one-click CI-to-local debugging and pipeline performance profiling. Built for GitHub Actions/JUnit, Slack, and PagerDuty.

> Real-time flaky test detection, quarantine, and insights.  
> Optional modules: DebugDock (CI→local), PipeProbe (pipeline profiling).

## Features
- Flaky test detection (commit-consistent rule)
- One-click quarantine & team assignment (Slack / PR checks)
- JUnit XML normalization; GH Actions integration
- Optional: CI→local `docker run` generator; pipeline TopN profiling

## Quickstart
1) Install / Configure (GitHub Webhook, Slack App scopes)
2) Upload/attach JUnit XML artifacts in CI
3) Open the Dashboard / Slack thread and quarantine flakes

## Integrations
- GitHub Actions (webhook, Checks, rerun jobs)
- Slack (Block Kit `block_actions`)
- PagerDuty (optional signal correlation)

## Docs
- /docs/arch.md
- /docs/junit-schema.md
- /docs/slack-scopes.md

## Contributing / Security / License
(links to CONTRIBUTING.md / SECURITY.md / LICENSE)
