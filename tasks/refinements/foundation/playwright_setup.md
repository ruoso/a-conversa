# Set up Playwright with browsers

**TaskJuggler entry**: [tasks/00-foundation.tji](../../00-foundation.tji) — task `foundation.test_infra.playwright_setup`
**Effort estimate**: 1d
**Inherited dependencies**: `foundation.stack_decisions.playwright_decision` (settled — confirmed Playwright)

## What this task is

Install Playwright, install browser binaries (Chromium, Firefox, WebKit), set up `playwright.config.ts`, and ensure `pnpm test:e2e` runs end-to-end browser tests across the frontend workspaces. Used by every `*_pw_*` test task.

## Why it needs to be done

Every browser-driven E2E test depends on Playwright being installed and working. Multi-context tests (driving moderator + two participant tablets in parallel browsers from one test) are a v1 requirement — `mod_pw_full_session_run` recreates the example walkthrough scenario this way.

## Inputs / context

- `@playwright/test` package.
- Browser binaries installed via `pnpm exec playwright install` (chromium, firefox, webkit).
- E2E tests live in each frontend workspace's `e2e/` or `tests/e2e/` directory.
- Test fixtures from `packages/test-fixtures/` loaded into a clean test DB per test (or per-suite, depending on speed).
- Authelia in dev compose; Playwright tests authenticate via the dev users.

## Decisions

- **`playwright.config.ts` at the repo root** with project entries for each frontend workspace's E2E tests.
- **Browser projects**: `chromium`, `firefox`, `webkit` configured; CI runs `chromium` only by default for speed; full cross-browser runs on tagged releases.
- **`webServer` in config** points at the dev compose stack — Playwright assumes the app is already running (started by CI via `make up` or by the local dev environment).
- **Trace and screenshot on failure** enabled — invaluable for debugging multi-context full-session-run failures.
- **Multi-context support** wired via Playwright's `browser.newContext()` — used by `mod_pw_full_session_run` and similar.
- **Shared helpers** at `packages/test-fixtures/playwright-helpers/` for common operations (login as dev user, create session, vote on facet, etc.).

## Acceptance criteria

- `@playwright/test` installed at root.
- Browsers installed via `pnpm exec playwright install` (CI step also runs this).
- `playwright.config.ts` at root with project entries.
- A "hello, Playwright" test loads the audience surface against the dev compose stack and asserts something simple.
- Multi-context test sketch: a single test launches three browser contexts (moderator + two participants), each authenticates as a different dev user, and asserts they see each other's votes.
- CI runs the Playwright step (extends `ci_config`).
