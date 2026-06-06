import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Resolve a path relative to THIS config file (apps/root/).
const fromHere = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

// Dev-only "load surfaces from source" mode (`make dev`).
//
// In production the root shell fetches each surface as an independently
// built bundle via `/_surfaces/manifest.json` + a dynamic `import()` of the
// hashed URL (ADR 0026); that path is what `make up` / `make dev-app`
// exercise. Under the dev server we instead alias each surface (and the
// shared UI packages) to its TypeScript source, so the single root Vite dev
// server transpiles + HMRs the whole tree — edit the root shell, any
// surface, or graph-view and see it live at :5174 with no rebuild.
//
// `SurfaceHost` switches to the source loader when
// `import.meta.env.VITE_SURFACE_SOURCE` is set — defined below for `serve`
// only, so the production build leaves it undefined and tree-shakes the
// source loader (and its surface imports) away.
//
// `dedupe` is load-bearing: the surfaces mount as nested React roots inside
// the shell, so React / React-DOM / Router / i18n must each resolve to a
// SINGLE module instance across the whole graph, or hooks + context break.
export default defineConfig(({ command }) => {
  const serveOnly =
    command === 'serve'
      ? {
          define: {
            'import.meta.env.VITE_SURFACE_SOURCE': JSON.stringify('1'),
          },
          resolve: {
            alias: {
              '@a-conversa/moderator': fromHere('../moderator/src/main.tsx'),
              '@a-conversa/participant': fromHere('../participant/src/main.tsx'),
              '@a-conversa/audience': fromHere('../audience/src/main.tsx'),
              '@a-conversa/test-mode': fromHere('../test-mode/src/main.tsx'),
              '@a-conversa/graph-view': fromHere('../../packages/graph-view/src/index.ts'),
              '@a-conversa/shell': fromHere('../../packages/shell/src/index.ts'),
              '@a-conversa/i18n-catalogs': fromHere('../../packages/i18n-catalogs/src/index.ts'),
            },
            dedupe: ['react', 'react-dom', 'react-router-dom', 'react-i18next', 'i18next'],
          },
        }
      : {};

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/_surfaces': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:3000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    ...serveOnly,
  };
});
