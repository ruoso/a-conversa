import { defineConfig } from "@playwright/test";

// Decision-only smoke configuration. The real Playwright wiring — browser
// projects (Chromium/Firefox/WebKit), reporters, base URL pointing at the
// dev compose stack, video/trace artifacts, retries — is owned by
// `foundation.test_infra.playwright_setup`. Here we only prove the runner
// loads and executes a spec; no `page` fixture, no browser binary needed.
export default defineConfig({
  testDir: "tests/e2e",
  // No `projects` block: a project entry implies a browser, and listing
  // browsers triggers the runner's "browser not installed" check on first
  // use. The default project runs the spec in the Node worker, which is
  // all the decision-proof spec (`hello.spec.ts`) needs.
  reporter: [["list"]],
});
