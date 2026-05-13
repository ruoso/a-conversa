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

export default defineConfig({
  plugins: [react()],
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
  },
});
