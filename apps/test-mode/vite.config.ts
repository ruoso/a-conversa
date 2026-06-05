// Vite config for the test-mode surface (library mode).
//
// Refinement: tasks/refinements/replay_test/test_mode_app.md
// ADRs:        0026 (micro-frontend pivot — surfaces ship as ESM library
//                    bundles loaded by the root host through
//                    `/_surfaces/manifest.json`),
//              0003 (React),
//              0024 (react-i18next — the i18n instance is host-supplied
//                    via `MountProps.i18n`; this surface does NOT
//                    bootstrap its own i18next at module load).
//
// Mirrors `apps/participant/vite.config.ts` line-for-line save for the
// surface name (`participant-` → `test-mode-`). The static-frontends
// plugin's `resolveDefaultSurfaces` entry pins its discovery patterns
// against these filenames; any divergence here forces a parallel
// registration shape and bisects the micro-frontend architecture.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  define: {
    // Some peer-dep CJS modules (e.g. `react-dom`) read this at
    // bundle time; the library build runs under Vite's production
    // mode but the define keeps the legacy modules happy regardless.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Single CSS sidecar — the static-frontends plugin's
    // `styleFilePatterns` regex matches exactly one file.
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.tsx',
      // ESM only — the root host dynamic-imports the module URL the
      // manifest advertises. ADR 0026 Decision 2.
      formats: ['es'],
      // Overridden by `entryFileNames` below; kept as a defensive
      // default for the lib-mode contract.
      fileName: () => 'test-mode.js',
    },
    rollupOptions: {
      output: {
        // Keep the bundle a single ESM module so the host's
        // `import(moduleUrl)` resolves a single URL.
        inlineDynamicImports: true,
        // Content-hash the entry bundle and the surface stylesheet so a
        // deploy that changes the test-mode code invalidates the
        // browser cache. The server's `static-frontends` plugin
        // discovers the actual hashed names at boot and reflects them
        // in the surface manifest (which is itself served `no-cache`,
        // so returning users pick up the new URLs on their next visit).
        entryFileNames: 'test-mode-[hash].js',
        assetFileNames: (assetInfo) =>
          assetInfo.name === 'style.css' ? 'test-mode-[hash].css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
