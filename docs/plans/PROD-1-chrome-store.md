# PROD-1 — Production packaging and Chrome Web Store readiness

## Goal

Make Cinder Wallet installable as a real MV3 zip (not only Load unpacked): fix popup Send, surface real errors, stop storing the mnemonic in the unlocked session, wire cluster, add legal pages, and produce a store zip plus listing copy.

Chrome Web Store **account + submit** stay human-owned (Google login, $5). This plan produces the package and the text to paste.

## Context

Load unpacked on `dist/` works on devnet. Popup Confirm still fails. Session stores the BIP39 phrase in `chrome.storage.session`. Cluster is compile-time. CWS needs a privacy URL, permission justifications, and a zip with `manifest.json` at the root.

## Steps

1. Files: `src/background/transfers.ts`, `src/components/tokens/SendModal.tsx`, `src/lib/errors.ts`  
   HTTP send + confirm (no SW websocket). Toast the real worker error.  
   Verify: `just check`; Chrome Confirm a 0.001 SOL self-transfer on the current cluster.

2. Files: `src/background/keyring.ts`, `src/background/approvals.ts`, `src/lib/messages.ts`  
   Session stores BIP39 seed bytes, not the phrase. Read `cinder_*` with `lumen_*` fallback. Do not delete old keys.  
   Verify: `just check`; existing vault still unlocks; Show seed phrase still works.

3. Files: `src/config/constants.ts`, `src/store/slices/uiSlice.ts`, `src/components/settings/Settings.tsx`, `src/components/shell/AppShell.tsx`, `src/services/helius.ts`, `src/services/wallet.ts`  
   Persist `cluster` in settings; header pill and RPC follow it. Hide USD on devnet. Activity rows without transfers do not show `−0.0000 SOL`.  
   Verify: `just check`; Settings can switch Devnet / Mainnet.

4. Files: `manifest.json`, `package.json`, `justfile`, `public/legal/*`, `docs/legal/*`, `docs/store/listing.md`, `README.md`, `AGENTS.md`  
   `clipboardWrite`, homepage, 0.2.0, `just store` zip, privacy/terms, listing paste.  
   Verify: `just check`; `just store` writes `cinder-wallet-store.zip`.

## Out of scope

- Creating the CWS developer account or clicking Submit
- Hosting GitHub Pages (needs repo settings after the legal files are on `main`)
- Hardware wallets, NFT transfers, CI for Playwright

## Risks

- Session shape change: migrate `mnemonic` → `seedB64` on next unlock
- Dual storage keys: writes go to `cinder_*`; leftover `lumen_*` is unused, not deleted
- Store zip must not bake `VITE_HELIUS_API_KEY` or `VITE_NETWORK=devnet`

## Parking lot

- Dedicated RPC proxy
- Independent security audit before recommending mainnet funds
