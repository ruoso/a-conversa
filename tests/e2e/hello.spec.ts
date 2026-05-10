import { test, expect } from '@playwright/test';

// Decision-proof smoke for the Playwright E2E framework choice (ADR 0008).
// This spec deliberately does NOT use the `page` fixture — no browser is
// launched, no network is touched. It proves only that the Playwright
// runner discovers and executes a TypeScript spec via `@playwright/test`.
//
// Real browser-driving E2E specs (with `page`, against the dev compose
// stack) land under `foundation.test_infra.playwright_setup` and the
// per-surface `*_pw_*` test tasks.
test('playwright runner loads and executes a spec', () => {
  expect(1 + 1).toBe(2);
});
