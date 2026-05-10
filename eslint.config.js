// Flat ESLint config for a-conversa.
//
// Decision recorded in docs/adr/0011-linter-eslint-with-typescript-eslint.md.
// Baseline: typescript-eslint's `recommended` (non-type-checked) tier — the
// type-aware tier needs a tsconfig, which is owned by the downstream
// `foundation.repo_skeleton.typecheck_config` task. Once that lands, this
// config can swap `recommended` for `recommendedTypeChecked` and turn on
// `parserOptions.projectService`.

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
      'build/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'pnpm-lock.yaml',
      'package-lock.json',
    ],
  },
  // Lint TS / TSX in the workspace tree, root scripts, and root-level tests.
  {
    files: [
      'apps/**/*.{ts,tsx}',
      'packages/**/*.{ts,tsx}',
      'scripts/**/*.{ts,tsx}',
      'tests/**/*.ts',
    ],
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
