import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Workspace packages publish two export conditions in their package.json:
  // `source` → the TS source under src/, `default` → the compiled JS under dist/.
  // Production Node resolves to `default` (dist); the runtime image only ever
  // ships built artifacts. Vitest needs to resolve to the source so tests run
  // against TS without requiring an upstream `pnpm run build` step — the
  // pre-commit hook does run `tsc -b` (which builds dist as a side effect of
  // typechecking), but a fresh CI checkout does not, and tying tests to a
  // build is brittle. Adding `source` to the resolve conditions makes Vite's
  // resolver match the source export first.
  resolve: {
    conditions: ['source'],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    // Unit tests must not touch the network. happy-dom's defaults auto-fetch
    // resources referenced from the DOM (e.g. a `<link rel="stylesheet">`
    // appended to document.head triggers an HTTP GET against the document's
    // base URL — http://localhost:3000 by default — and produces ECONNREFUSED
    // noise whose async failure can bleed across test boundaries).
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableIframePageLoading: true,
        },
      },
    },
    // Restrict the default test corpus to the three unit-test roots so a
    // bare `vitest run` matches `pnpm run test:smoke` (Vitest's default
    // include walks the whole repo and pulls in Playwright specs under
    // `tests/e2e/` and Cucumber features under `tests/behavior/`, which
    // are not Vitest tests). The default pattern is the standard
    // `**/*.{test,spec}.?(c|m)[jt]s?(x)` rooted under each entry.
    include: [
      'tests/smoke/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'packages/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'apps/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    // Skip sibling git worktrees under .claude/worktrees/ — they hold
    // in-flight agent work without node_modules and break Vite's loader.
    // Standard exclusions (node_modules / dist) plus the worktree dir.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.idea/**',
      '**/.git/**',
      '**/.cache/**',
      '.claude/worktrees/**',
    ],
    coverage: {
      provider: 'v8',
    },
  },
});
