import { resolve } from 'path';
import { defineConfig } from 'vite';

/** Same output directory as the popup build; `just store` sets it to `dist-store`. */
const outDir = process.env.CINDER_OUT_DIR ?? 'dist';

export default defineConfig({
  build: {
    emptyOutDir: false,
    // The popup build already placed `public/`; copying it again here would put
    // back the .DS_Store that build filtered out.
    copyPublicDir: false,
    outDir,
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
