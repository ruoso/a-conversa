// Flat ESLint config for a-conversa.
//
// Decision recorded in docs/adr/0011-linter-eslint-with-typescript-eslint.md
// (with 2026-05-10 amendment) and docs/adr/0013-typecheck-tsconfig-strict-with-project-references.md.
//
// Baseline upgraded to typescript-eslint's `recommendedTypeChecked` tier on
// 2026-05-10 once `tsconfig.base.json` landed via
// `foundation.repo_skeleton.typecheck_config` (ADR 0013). Files in
// `apps/**` and `packages/**` are covered by their per-workspace
// `tsconfig.json`; root-level `scripts/**` and `tests/**` are covered by
// `tsconfig.tools.json` (whitelisted via `allowDefaultProject` since the
// projectService default discovery only matches files named
// `tsconfig.json`).

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Project-wide ignores. A flat-config entry with only `ignores`
    // applies as a global ignore list (replaces the old .eslintignore).
    ignores: [
      'node_modules/',
      'dist/',
      '**/dist/',
      'build/',
      '**/build/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'pnpm-lock.yaml',
      'package-lock.json',
    ],
  },
  // Lint TS / TSX in the workspace tree and root-level tests with the
  // type-aware rule set. `projectService` auto-discovers each file's
  // tsconfig: the per-workspace ones for apps/ and packages/, and a
  // dedicated tests/tsconfig.json that picks up @types/node, vitest, etc.
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'tests/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Underscore prefix on a variable / argument / destructured binding
      // signals "intentionally unused" — common when omitting a field via
      // destructuring rest in tests.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Root-level `scripts/` are throwaway smoke tests that exercise the
  // dependency stack via `tsx`. They are covered by `tsconfig.tools.json`
  // for the `pnpm typecheck:tools` step, but they're left on the
  // non-type-checked lint tier — they're temporary and the type-aware
  // rules misfire on Node globals when projectService's default-project
  // fallback can't see ambient @types/node. ADR 0013 documents this carve-out.
  {
    files: ['scripts/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  // Root-level CommonJS config files (e.g., cucumber.cjs) run in Node CJS.
  {
    files: ['*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  // Disable ESLint rules that conflict with Prettier's formatting.
  // Must be last so it overrides any conflicting stylistic rules from the
  // recommended sets above. See docs/adr/0012-formatter-prettier.md.
  prettier,
);
