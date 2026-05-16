// Vite config for the moderator app.
//
// Decision history: ADR 0003 (React), ADR 0024 (react-i18next), refinement
// tasks/refinements/moderator-ui/mod_app_skeleton.md (this file's task).
//
// The dev server proxies `/api` and `/ws` to the backend on
// `http://localhost:3000` per the refinement's "Dev server" decision. The
// concrete backend port is the Fastify default; revisit when the dev-stack
// compose decision lands a different port.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
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
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.tsx',
      formats: ['es'],
      // `entryFileNames` below overrides this. Kept as a defensive
      // default for the lib-mode contract.
      fileName: () => 'moderator.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        // Content-hash the entry bundle and the surface stylesheet so a
        // deploy that changes the moderator code invalidates the
        // browser cache. The server's `static-frontends` plugin
        // discovers the actual hashed names at boot and reflects them
        // in the surface manifest (which is itself served `no-cache`,
        // so returning users pick up the new URLs on their next visit).
        entryFileNames: 'moderator-[hash].js',
        assetFileNames: (assetInfo) =>
          assetInfo.name === 'style.css' ? 'moderator-[hash].css' : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
