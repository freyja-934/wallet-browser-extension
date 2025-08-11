# 🚀 Quick Setup Guide

## Prerequisites
- Node.js 18+ and pnpm
- Chrome browser for testing
- Helius API key (get from https://helius.dev)
- Optional: CoinGecko API key for higher rate limits

## Initial Setup Steps

### 1. Environment Configuration
Create a `.env` file in the project root:

```env
# API Keys
VITE_HELIUS_API_KEY=your_helius_api_key_here
VITE_COINGECKO_API_KEY=optional_coingecko_key
VITE_HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key

# Network Configuration
VITE_SOLANA_NETWORK=mainnet-beta
VITE_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Development
VITE_DEV_MODE=true
```

### 2. Install Dependencies
```bash
cd /Users/caseycharlesworth/GitHub/solana-wallet-browser-extension
pnpm install

# Additional dependencies we'll need
pnpm add helius-sdk @solana/spl-token @solana/spl-token-registry
pnpm add argon2-browser idb date-fns
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs
pnpm add react-hot-toast framer-motion
```

### 3. Update Manifest for Development
Update the manifest.json for proper development setup:

```json
{
  "manifest_version": 3,
  "name": "Solana Wallet (Dev)",
  "version": "0.1.0",
  "description": "Multi-chain wallet with Solana focus",
  
  "action": {
    "default_popup": "index.html",
    "default_icon": {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png"
    }
  },
  
  "background": {
    "service_worker": "src/background/serviceWorker.ts",
    "type": "module"
  },
  
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/contentScript.ts"],
      "run_at": "document_start",
      "all_frames": true
    }
  ],
  
  "permissions": [
    "storage",
    "activeTab",
    "tabs"
  ],
  
  "host_permissions": [
    "https://*.helius-rpc.com/*",
    "https://api.coingecko.com/*"
  ],
  
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },
  
  "web_accessible_resources": [
    {
      "resources": ["src/content/injected.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

### 4. Create Development Scripts
Add to package.json:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "build:extension": "pnpm build && pnpm copy:manifest",
    "copy:manifest": "cp manifest.json dist/",
    "preview": "vite preview",
    "test": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
  }
}
```

### 5. Vite Configuration for Extension
Update vite.config.ts:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/serviceWorker.ts'),
        content: resolve(__dirname, 'src/content/contentScript.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV === 'development',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
```

### 6. TypeScript Configuration
Update tsconfig.json for better type support:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "types": ["chrome", "vite/client"],
    
    "paths": {
      "@/*": ["./src/*"]
    },
    
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 7. Create Basic File Structure
```bash
# Create necessary directories
mkdir -p src/content
mkdir -p src/services
mkdir -p src/components/nft
mkdir -p src/components/tokens
mkdir -p src/components/settings
mkdir -p public/icons

# Create base files
touch src/content/contentScript.ts
touch src/content/injected.ts
touch src/services/helius.ts
touch src/services/coingecko.ts
touch src/services/storage.ts
```

### 8. Load Extension in Chrome
1. Run `pnpm build:extension`
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `dist` directory

### 9. Development Workflow
```bash
# Terminal 1: Run vite dev server
pnpm dev

# Terminal 2: Watch and rebuild
pnpm build:extension --watch

# After changes, refresh extension in Chrome
```

## Next Steps

1. **Start with Phase 1.1**: Implement seed phrase generation
   - Update `src/wallet/wallet.ts` with BIP39/BIP44 support
   - Create seed phrase UI components
   - Add secure storage for encrypted seed

2. **Set up testing early**:
   ```bash
   pnpm add -D vitest @testing-library/react @testing-library/jest-dom
   pnpm add -D @playwright/test
   ```

3. **Configure state management**:
   - Set up Redux store with persistence
   - Create wallet slice with all necessary actions
   - Add middleware for Chrome storage sync

4. **Implement content script**:
   - Create provider injection
   - Set up message passing
   - Test with a simple dApp

## Debugging Tips

1. **Background Script**: 
   - View logs in Chrome Extensions page > Service Worker link

2. **Content Script**:
   - Use regular Chrome DevTools on any page

3. **Popup**:
   - Right-click extension icon > Inspect popup

4. **Storage**:
   - Chrome DevTools > Application > Storage

## Security Reminders

- Never log sensitive data (keys, seeds, passwords)
- Always use encryption for storage
- Validate all inputs from content scripts
- Use CSP headers to prevent XSS
- Regular security audits before release

Ready to start building! 🚀
