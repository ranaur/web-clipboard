import { defineConfig } from 'vite';

const API_TARGET = 'http://localhost:3000';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/bip-0039': API_TARGET,
      '/api': API_TARGET,
    },
  },
});
