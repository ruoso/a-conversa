// Library-mode Vite config for `@a-conversa/shell`.
//
// Refinement: tasks/refinements/shell-package/shell_pkg_skeleton.md
// ADR:        docs/adr/0026-micro-frontend-root-app.md (lines 37-57 — every
//             surface bundle plus the shell builds in library mode so the
//             root app can `import()` them dynamically with a uniform
//             ESM-bundle shape).
//
// The shell ships React components downstream (auth context, screen-name
// form, login/logout button) but does not bundle React itself; the
// consumer (root app or individual surface app) supplies the React
// instance via the rollup external list below. The `peerDependencies`
// entry in package.json signals the same constraint at install time;
// the `external` list here enforces it at build time.
//
// TypeScript declarations are emitted by a separate `tsc
// --emitDeclarationOnly` pass in the package.json `build` script —
// Vite does not produce `.d.ts` in library mode by default.

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    },
  },
});
