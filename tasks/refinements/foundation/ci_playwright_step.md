# CI step running Playwright E2E tests

**TaskJuggler entry**: `foundation.test_infra.ci_playwright_step` — [tasks/00-foundation.tji](../../00-foundation.tji)
**Effort estimate**: 0.5d

## What and why

CI job running Playwright E2E tests in a browser against the running application.

## Decisions

- Job name: `e2e`.
- Runs `pnpm test:e2e`.
- Spins up Postgres, Authelia, and the application via Compose for the test run.
- Chromium only in regular PR CI (faster); cross-browser (firefox, webkit) only on tagged releases.
- Traces and videos uploaded as artifacts on failure.

## Acceptance criteria

- An `e2e` job in CI.
- Compose stack brought up for the test.
- Trace artifacts uploaded on failure.
- Failing tests fail the job.
