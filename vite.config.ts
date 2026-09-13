/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { cpSync } from 'fs';
import { basename, resolve } from 'path';
import { defineConfig } from 'vite';

/**
 * Where the build lands. `just store` points this at `dist-store/` so the
 * mainnet zip does not overwrite the devnet `dist/` that is loaded unpacked.
 * `||`, not `??`: `CINDER_OUT_DIR=` set but empty would otherwise resolve to the
 * repo root, and this build empties its output directory.
 */
const outDir = process.env.CINDER_OUT_DIR || 'dist';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      // Vite's own publicDir copy is verbatim, so the .DS_Store macOS leaves in
      // `public/` and `public/media/` ends up in the zip. `copyPublicDir` is off
      // below and this does the copy with a filter instead.
      name: 'extension-copy-public',
      closeBundle() {
        cpSync(resolve(__dirname, 'public'), resolve(__dirname, outDir), {
          recursive: true,
          filter: (src) => basename(src) !== '.DS_Store',
        });
      },
    },
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
        // Name the vendor groups instead of letting Rollup name a 500 KB chunk
        // after whichever module happened to be first (it was `encryption-simple`).
        // `buffer` is deliberately absent: the polyfill has to stay the first thing
        // the worker evaluates, so it is not pulled into a shared vendor chunk.
        manualChunks(id) {
          // Rollup's CommonJS interop helpers are virtual modules outside
          // node_modules. Left unassigned they land in whichever vendor chunk
          // claims them first, and every other vendor chunk then imports that
          // one — which is how React ended up pulling in the BIP39 wordlist.
          if (id.includes('commonjsHelpers') || id.includes('commonjs-dynamic-modules')) {
            return 'vendor-cjs';
          }
          // The Buffer polyfill gets a chunk of its own so it is a chunk-level
          // import of every entry that needs it. Left inside an entry chunk it
          // runs in that chunk's body — after the vendor chunks the entry
          // imports, one of which calls `Buffer.from` while it evaluates.
          if (
            id.includes('/src/lib/buffer-global') ||
            id.includes('/src/background/buffer-polyfill') ||
            /\/node_modules\/(buffer|base64-js|ieee754)\//.test(id)
          ) {
            return 'polyfill-buffer';
          }
          if (!id.includes('node_modules')) return;
          if (id.includes('/bip39/')) return 'vendor-bip39';
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (id.includes('/@solana/') || id.includes('/@noble/') || id.includes('/jayson/')) {
            return 'vendor-solana';
          }
        },
      },
    },
    outDir,
    copyPublicDir: false,
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
    // `node` is the default; a component test opts into a DOM with its own
    // `// @vitest-environment jsdom` docblock rather than paying for jsdom in
    // all 600-odd worker and library tests.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      /**
       * The code with real logic behind it: the service worker, the page-world
       * provider, and the shared libraries. Components are covered by their own
       * tests and by the Playwright suite, which drives the real extension —
       * counting their lines here would measure rendering, not behaviour.
       */
      include: ['src/background/**', 'src/content/**', 'src/lib/**'],
      thresholds: {
        /**
         * A ratchet, not an aspiration. The suite measures 94.73 percent of
         * lines over the directories above today (`background` 95.47,
         * `content` 72.25, `lib` 97.77); the gate sits just under that, so a
         * real drop fails and nobody has to argue about a round number that
         * was never met. Raise it when the figure rises, never lower it to go
         * green. Collected only by `pnpm exec vitest run --coverage`: a
         * narrow `just test <file>` must not be failed by the whole suite's
         * threshold.
         */
        lines: 94,
      },
    },
  },
});
