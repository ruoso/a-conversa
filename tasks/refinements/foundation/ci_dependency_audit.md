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
