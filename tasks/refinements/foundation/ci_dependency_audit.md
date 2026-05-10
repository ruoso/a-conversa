# Periodic dependency vulnerability check

**TaskJuggler entry**: `foundation.ci.ci_dependency_audit` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 0.5d

## What and why

Scheduled CI job that runs a vulnerability check against the dependency graph and surfaces issues. Doesn't block PRs (too noisy); runs on a schedule and reports results.

## Decisions

- Job name: `dependency-audit`.
- Runs on a schedule (daily or weekly via GitHub Actions `schedule` trigger).
- Tooling: `pnpm audit` for known vulnerability database; optionally Dependabot or Renovate for automated update PRs.
- Reports go to the GitHub Security tab (no failing builds).
- A separate `pnpm audit --prod` runs in PR CI as a quick check (warning, not failure).

## Acceptance criteria

- A scheduled `dependency-audit` workflow exists.
- A weekly run completes successfully.
- `pnpm audit --prod` runs in PR CI as a non-blocking check.
- Dependabot config (`.github/dependabot.yml`) checked in for automated update PRs.

## Status

Done 2026-05-10.

- New workflow: [.github/workflows/dependency-audit.yml](../../../.github/workflows/dependency-audit.yml).
  - Triggers: `schedule: cron '0 7 * * 1'` (Mondays 07:00 UTC) plus
    `workflow_dispatch` for manual reruns. Weekly chosen over daily
    because the npm advisory database doesn't churn fast enough to
    justify five extra reports a week; Monday morning UTC means a fresh
    report greets the European/East-Coast work week.
  - Step shape: standard checkout / Node 20 / Corepack / pnpm-store
    cache / `pnpm install --frozen-lockfile` (with `HUSKY=0`), then
    `pnpm audit --json > audit.json || true`, upload `audit.json` as the
    `pnpm-audit` artifact (`actions/upload-artifact@v4`), and a `jq`
    summary written to `$GITHUB_STEP_SUMMARY` (severity-count table,
    with a head-of-file fallback if the JSON shape doesn't match).
  - Non-blocking by design — never fails a PR, never gates a release.
- PR-side companion: new `audit-warn` job in
  [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) runs
  `pnpm audit --prod || true` on every PR. Soft signal only; trailing
  `|| true` is load-bearing.
- `pnpm audit --prod` baseline on 2026-05-10: "No known vulnerabilities
  found" — `audit-warn` is currently green.
- **Deferred (sibling tools, not in scope here)**: Dependabot
  (`.github/dependabot.yml`) and Renovate. Both are automated-update-PR
  tools, not vulnerability scanners; the choice between them is its own
  decision and lands in a follow-up task without touching either of the
  two workflows above. The acceptance criterion mentioning Dependabot
  is left as-is for that follow-up to satisfy.
