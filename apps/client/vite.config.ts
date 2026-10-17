import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    fs: { allow: [resolve(__dirname, '../..')] },
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8443', ws: true },
      '/api': { target: 'http://127.0.0.1:8080', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true },
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@tactical/shared/bot-api': resolve(__dirname, '../../packages/shared/src/bot-api.ts'),
      '@tactical/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@tactical/bots': resolve(__dirname, '../../packages/bots/src/index.ts'),
    },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1800 },
});
