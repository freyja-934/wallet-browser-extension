import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'examples/test-dapp',
  envDir: repoRoot,
  server: {
    port: 5174,
    strictPort: true,
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/index.js',
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
});
