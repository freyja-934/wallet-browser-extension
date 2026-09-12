# Cinder Wallet

[![check](https://github.com/freyja-934/wallet-browser-extension/actions/workflows/check.yml/badge.svg)](https://github.com/freyja-934/wallet-browser-extension/actions/workflows/check.yml)

Self-custodial Solana wallet for Chrome (Manifest V3). The encrypted keyring lives in the service worker — the popup never holds a `Keypair`. Sites talk [Wallet Standard](https://github.com/wallet-standard/wallet-standard), not a fake `window.solana`.

This is a portfolio implementation. It does not impersonate Phantom. Do not put mainnet funds on it that you cannot lose.

<p align="center">
  <img src="docs/store/screenshots/02-home-1280x800.png" width="72%" alt="Cinder Wallet home — portfolio and assets" />
</p>
<p align="center">
  <img src="docs/store/screenshots/01-unlock-1280x800.png" width="32%" alt="Unlock" />
  <img src="docs/store/screenshots/03-nfts-1280x800.png" width="32%" alt="NFTs" />
  <img src="docs/store/screenshots/04-activity-1280x800.png" width="32%" alt="Activity" />
</p>

## Architecture

```
Page (Wallet Standard) → content script (allowlisted) → service worker keyring
Popup / approval window → chrome.runtime.sendMessage → same keyring
Vault: PBKDF2 + AES-GCM in chrome.storage.local
Session: chrome.storage.session (cleared when the browser closes)
```

The toolbar popup is **380×600** (Chrome caps action popups at 600px). Approvals open `approve.html` via `chrome.windows.create`, never `chrome.action.openPopup()`.

RPC: the endpoint list comes from Settings, not the build. With no key, Mainnet shows and sends SOL through `https://solana-rpc.publicnode.com` (the Solana Foundation host refuses browser origins; it stays as a fallback), and Devnet uses `https://api.devnet.solana.com`. Tokens and NFTs on Mainnet need either a custom RPC URL or a Helius API key entered in Settings → RPC; both are stored in `chrome.storage.local` on this device only, and a custom host outside the manifest is granted through `optional_host_permissions` when you click Save. The order tried is custom URL, then Helius, then the public defaults. A local `VITE_HELIUS_API_KEY` only seeds the Helius field until you store your own. Rotation: HTTP 401/403 and a refused method (JSON-RPC `-32601`, `-32010`, `-32011`, or a message saying the method is unsupported or key-gated) skip to the next endpoint for that call only; 408/429/5xx, network errors, and node-health codes (`-32004`, `-32005`, `-32007`, `-32009`, `-32014`, `-32016`) rest the endpoint for 30 s; any other JSON-RPC error (invalid params, preflight failure) is returned at once, since every endpoint would say the same. Save probes a custom URL with `getHealth` and `getGenesisHash` and only uses it on the cluster it answered for. DAS (`getAssetsByOwner`) is tried on every endpoint in order; when none serves it, tokens show without names and the NFT list is empty. publicnode is a third-party service provided AS IS with unpublished limits.

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

Optional: copy `.env.example` to `.env` and set `VITE_HELIUS_API_KEY` for richer NFT/history APIs. Never commit an API key. Rebuild after changing `.env`.

## What this demonstrates

- MV3 service worker lifecycle and auto-lock (`chrome.alarms`)
- BIP39 → BIP44 `m/44'/501'/n'/0'` derivation (`mnemonicToSeed`, not `Buffer.from(mnemonic)`)
- Wallet Standard: `standard:connect`, `solana:signTransaction`, `solana:signAndSendTransaction`, `solana:signMessage`
- Legacy + v0 transactions
- Simulation preview (program names, `setAuthority` / approve warnings, unknown programs)
- Settings-driven RPC: custom URL, optional Helius key, keyless public defaults, with per-endpoint rotation
- TanStack React Query for balances / NFTs / history

## Commands

```bash
just setup      # pnpm install
just check      # tsc + lint + vitest run
just ext        # build loadable extension
just dapp       # http://localhost:5174 test dApp
just e2e        # Playwright: import, unlock, dashboard, create, send review, settings, dApp
just store      # mainnet zip for Chrome Web Store (does not submit)
```

Local/e2e use `VITE_NETWORK=devnet`. `just store` forces mainnet and unsets the Helius key so the zip is not a personal-key build.

Privacy and terms: `docs/legal/` (also shipped as `legal/privacy.html` / `legal/terms.html`). Chrome Web Store paste: `docs/store/listing.md`. Docs map: `docs/README.md`.

## Extension e2e

- `just e2e` loads Cinder Wallet into Playwright's bundled Chromium (`channel: 'chromium'`), not branded Google Chrome 152 (which removed `--load-extension`).
- First time: `pnpm exec playwright install chromium`
- Coverage: import / unlock, dashboard tabs, create-new + seed quiz, Send → Review (does not click Confirm), settings auto-lock / export seed / change password, Receive toast stub, dApp connect / sign-message / sign-v0, locked Connect → Unlock, `signAndSend` reject, 0-lamport `signAndSend` approve.

## Chrome click-through (after Load unpacked)

1. Create a wallet, close the popup, reopen — you should see Unlock, not Create
2. Unlock, then `just dapp` → http://localhost:5174
3. Connect (approval window) → Sign message → Sign v0 transfer (simulation preview)
4. In the popup, Receive → Copy should toast “Address copied” and write the real clipboard
5. Optional on **devnet only**: faucet if needed, then Send a tiny amount of SOL or an SPL token. Activity should show the amount, not “On-chain”.

## Security notes

- Do not use this with mainnet funds you cannot lose
- Rotate any previously committed RPC keys
- The old `window.phantom` / `isPhantom` provider has been removed

## License

MIT. See [LICENSE](LICENSE).
