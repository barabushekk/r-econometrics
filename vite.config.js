import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, open: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200, target: 'es2020' },
});
