import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: 'dist',
    sourcemap: false,
    minify: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/injected.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'src/content/injected.js',
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
});
