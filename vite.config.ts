import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'buffer': 'buffer',
    },
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/content-script.ts'),
        injected: resolve(__dirname, 'src/content/injected.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep original paths for background and content scripts
          if (chunkInfo.name === 'background') {
            return 'src/background/service-worker.js';
          }
          if (chunkInfo.name === 'content') {
            return 'src/content/content-script.js';
          }
          if (chunkInfo.name === 'injected') {
            return 'src/content/injected.js';
          }
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
      define: {
        global: 'globalThis',
      },
      supported: {
        bigint: true,
      },
    },
    include: [
      'buffer',
      '@solana/web3.js',
      'bip39',
      'ed25519-hd-key',
    ],
  },
});
