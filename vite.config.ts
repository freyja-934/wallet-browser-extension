/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'extension-strip-cors-hints',
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          return html
            .replace(/<link[^>]+rel="(?:module)?preload"[^>]*>\s*/gi, '')
            .replace(/\s+crossorigin(?:="[^"]*")?/gi, '');
        },
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'buffer': 'buffer',
    },
  },
  build: {
    // chrome-extension:// preloads (and Vite modulepreload + crossorigin)
    // log as unused "cross-origin extension resource mismatch" errors.
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        approve: resolve(__dirname, 'approve.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'src/background/service-worker.js';
          return '[name].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV === 'development',
    minify: process.env.NODE_ENV === 'production',
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      define: { global: 'globalThis' },
      supported: { bigint: true },
    },
    include: [
      'buffer',
      '@solana/web3.js',
      'bip39',
      'ed25519-hd-key',
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
