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
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'cytoscape',
        'i18next',
        'react-i18next',
        '@a-conversa/i18n-catalogs',
        '@a-conversa/shared-types',
        '@a-conversa/shell',
      ],
    },
  },
});
