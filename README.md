# Lumen

A Solana Chrome extension (Manifest V3) with an encrypted keyring in the service worker, [Wallet Standard](https://github.com/wallet-standard/wallet-standard) injection, versioned-transaction signing, and simulation-based transaction preview.

This is a portfolio implementation — not Phantom, and it does not impersonate Phantom.

## Architecture

```
Page (Wallet Standard) → content script (allowlisted) → service worker keyring
Popup / approval window → chrome.runtime.sendMessage → same keyring
Vault: PBKDF2 + AES-GCM in chrome.storage.local
Session: chrome.storage.session (cleared when the browser closes)
```

The popup never holds a `Keypair`. Approvals open `approve.html` via `chrome.windows.create`.

## Load unpacked

```bash
pnpm install
just ext    # or: pnpm build:extension
```

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked → select `dist/`
4. Run `just dapp` and open http://localhost:5174 (file:// will not inject the provider)
5. Connect → Sign message → Sign v0 transfer (approval window + simulation preview)

Optional: set `VITE_HELIUS_API_KEY` in a local `.env` for richer NFT/history APIs. Public Solana RPC is the default. Never commit an API key.

## What this demonstrates

- MV3 service worker lifecycle and auto-lock (`chrome.alarms`)
- BIP39 → BIP44 `m/44'/501'/n'/0'` derivation (`mnemonicToSeed`, not `Buffer.from(mnemonic)`)
- Wallet Standard: `standard:connect`, `solana:signTransaction`, `solana:signAndSendTransaction`, `solana:signMessage`
- Legacy + v0 transactions
- Simulation preview (program names, `setAuthority` / approve warnings, unknown programs)
- TanStack React Query for balances / NFTs / history

## Commands

```bash
just setup      # pnpm install
just check      # tsc + lint + vitest run
just ext        # build loadable extension
just dapp       # http://localhost:5174 test dApp
just e2e        # Playwright: import, unlock, dApp, receive toast
```

## Extension e2e

- `just e2e` loads Lumen into Playwright's bundled Chromium (`channel: 'chromium'`), not branded Google Chrome 152 (which removed `--load-extension`).
- First time: `pnpm exec playwright install chromium`
- Manual Load unpacked in Chrome remains a fallback.

## Chrome click-through (after Load unpacked)

1. Create a wallet, close the popup, reopen — you should see Unlock, not Create
2. Unlock, then `just dapp` → http://localhost:5174
3. Connect (approval window) → Sign message → Sign v0 transfer (simulation preview)
4. In the popup, Receive → Copy should toast “Address copied”

## Security notes

- Do not use this with mainnet funds you cannot lose
- Rotate any previously committed RPC keys
- The old `window.phantom` / `isPhantom` provider has been removed
