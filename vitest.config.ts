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
    coverage: {
      provider: 'v8',
    },
  },
});
