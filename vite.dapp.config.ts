import { defineConfig } from 'vite';

export default defineConfig({
  root: 'examples/test-dapp',
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
