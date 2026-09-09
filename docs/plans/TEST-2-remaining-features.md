# TEST-2 — Cover the remaining popup and dApp surfaces

## Goal

Finish automated coverage of the features TEST-1 left out, on **devnet**, without sending mainnet funds and without putting secrets in git or CI.

`just check` stays unit-only. `just e2e` grows.

Build-time env (Vite inlines these into `dist/` on `just ext` / `just e2e`; `justfile` has `dotenv-load`):

- `VITE_NETWORK=devnet` — RPC + header pill + test dApp `Connection`. Today `getRpcUrl()` always returns mainnet (Helius mainnet if a key is set). The Settings “Devnet” `<Select>` is decorative and is **not** wired in this plan.
- `VITE_HELIUS_API_KEY` — optional. On devnet use `https://devnet.helius-rpc.com/?api-key=…`. Helius REST (`api.helius.xyz/v0/addresses/…`) is mainnet-oriented; `helius.ts` already falls back to JSON-RPC when that fails, which is what we want on devnet.

Adding `.env` does nothing until you rebuild. Never commit `.env`.

Ask-first item in this plan: new env `VITE_NETWORK` (AGENTS.md: CI / env handling).

## Context

TEST-1 is green: import, lock/unlock, Wallet Standard connect / sign-message / sign-v0, Receive toast.

Still untested, mapped to what the code actually does:

| Surface | Code | How we test it |
|---|---|---|
| Dashboard balances / NFTs / activity | `useWalletQueries` → `helius.ts` (devnet RPC; Helius REST may 404 and fall back) | After import, tabs render. Assert a settled SOL figure or `—`, NFT grid **or** “No NFTs in your wallet”, activity rows **or** “No transactions yet”. Do **not** assert a specific balance. |
| Tx simulation preview | `ApprovalScreen` + `PREVIEW_TRANSACTION` | Same dApp sign-tx; with Helius RPC, wait for `approval-preview` when it appears. Still soft if the RPC call hangs. |
| Create-new + 3-word quiz | `WalletCreationFlow` → `SeedPhraseDisplay` → `SeedPhraseVerification` | Reveal, read words from the DOM, Continue. Verification already accepts a **full-phrase paste** and fills the random slots. Then `TestWallet1!` → dashboard. |
| Popup Send | `SendModal` → `SEND_TRANSFER` | Playwright: invalid address, then Review. **Do not click Send in e2e** (airdrop is flaky). Manual Chrome on the same `dist/`: faucet → Send a tiny amount on **devnet only**. |
| Settings / password / export seed | `Settings.tsx` | Auto-lock toast, Show Seed Phrase with `TestWallet1!` equals the test mnemonic, Change Password, lock, unlock with the new password. Fresh Playwright profile per test so this does not leak. |
| Locked dApp connect | `WALLET_CONNECT` → `openUnlockWindow()` (`index.html`) | Lock, Connect, expect the unlock window, unlock, Connect again, approve. |
| `solana:signAndSendTransaction` | `injected.ts` + `fulfillApproval` | Test dApp button opens `approve.html`; **Reject**. Do not approve a send. |
| Receive real clipboard | `ReceiveCard` `navigator.clipboard.writeText` | Playwright cannot `grantPermissions` on `chrome-extension://` (opaque origin). Keep the toast stub. Prove the real clipboard in branded Chrome by hand. |
| NFT Send, Forgot password, Contact support, Network dropdown | Toast / `href="#"` / uncontrolled `<Select>` | Not features. Do not write e2e that pretends they work. |

## Steps

0. Files: `src/config/constants.ts`, `src/vite-env.d.ts`, `src/components/shell/AppShell.tsx`, `examples/test-dapp/main.js`, `.env.example`  
   `VITE_NETWORK` defaults to `mainnet-beta`. When `devnet`: `getRpcUrl()` is Helius `devnet.helius-rpc.com` if a key is set, else `PUBLIC_DEVNET_RPC`. Header pill shows `Devnet` (it is hardcoded “Mainnet” today). Test dApp `Connection` + `chain` follow the same env. `.env.example` documents `VITE_NETWORK=devnet`. Do not wire the Settings network dropdown.  
   Verify: `just check`; `just ext` with `VITE_NETWORK=devnet` in `.env`; load `dist/` and confirm the pill says Devnet.

1. Files: `src/components/shell/AppShell.tsx`, `src/components/wallet/BalanceCard.tsx`, `src/components/Dashboard.tsx`, `e2e/dashboard.spec.ts`  
   `data-testid`s: `nav-home`, `nav-nfts`, `nav-activity`, `open-settings`, `open-send`, `sol-balance`. After `importAndUnlock`, wait until `sol-balance` is not `—` **or** still `—` after load (empty + failed price is ok). NFTs tab: gallery or “No NFTs in your wallet”. Activity: a row **or** “No transactions yet”. Rebuild so the Helius key is in `dist/` (`just e2e` already runs `just ext`).  
   Verify: `just e2e e2e/dashboard.spec.ts`

2. Files: `src/components/wallet/SeedPhraseDisplay.tsx`, `src/components/wallet/SeedPhraseVerification.tsx`, `e2e/create.spec.ts`  
   Testids: `reveal-seed`, `seed-word` (or per-index), `seed-continue`, `seed-verify-input`, `seed-verify-submit`. Click Create New → Reveal → scrape twelve words → Continue → paste the phrase into the first verify field (existing `onPaste`) → Verify & Continue → password → `open-receive`.  
   Verify: `just e2e e2e/create.spec.ts`

3. Files: `src/components/tokens/SendModal.tsx`, `src/components/settings/Settings.tsx`, `e2e/send.spec.ts`, `e2e/settings.spec.ts`  
   Send: `open-send` → junk recipient → “Invalid Solana address” → a valid unused pubkey + `0.001` + ack → Continue → Review copy visible. **Stop.** Settings: gear → Auto-lock 5 minutes → “Auto-lock timeout updated” → Show Seed Phrase → password → exact test mnemonic → Change Password to `TestWallet2!` → lock → unlock with the new password.  
   Verify: `just e2e e2e/send.spec.ts e2e/settings.spec.ts`

4. Files: `examples/test-dapp/index.html`, `examples/test-dapp/main.js`, `e2e/dapp.spec.ts`  
   Add `#signAndSend` that builds the same 0-lamport v0 tx and calls `solana:signAndSendTransaction`. E2E: open that approval, click `approval-reject`, expect the dApp log to show the reject/error (not a signature). Extend the existing connect test (or a sibling): after import, `LOCK`, Connect → wait for `index.html` unlock → `unlock-password` / `unlock-submit` → Connect again → approve. Harden sign-tx: if `approval-preview` appears within ~8s, expect `/Simulation|failed|succeeded/i`.  
   Verify: `just e2e e2e/dapp.spec.ts`

5. Files: `README.md`, `AGENTS.md`  
   Document: rebuild after changing `.env`; `VITE_NETWORK=devnet` for local/e2e; Helius key is optional and local-only; `just e2e` now includes dashboard / create / send-review / settings / locked-connect / signAndSend-reject. Manual Load-unpacked checklist (branded Chrome, same `dist/`): Receive Copy writes the clipboard; optional faucet + tiny Send on devnet.  
   Verify: `just check` still green; `just e2e` green locally.

## Out of scope

- Approving a send or `signAndSend` (mainnet)
- Funding any test mnemonic
- NFT transfer (“coming soon”), Forgot password toast, `href="#"` links, decorative Network `<Select>`
- Putting Playwright in `just check` or CI (CI must not receive `VITE_HELIUS_API_KEY`)
- UI-1 visual overhaul
- Branded Chrome 152 as the runner

## Risks

- Helius key missing from the **built** `dist/` (forgot rebuild) looks like “dashboard still 403”. `just e2e` rebuilds; a stale `dist/` from `just ext` without `.env` does not.
- Well-known `abandon…about` address may have SOL / NFTs / history. Assertions are “UI settled”, not “zero”.
- Create-new quiz is random; rely on full-phrase paste, not guessing three indices.
- `chrome.windows.create` unlock vs approve: wait on URL (`index.html` vs `approve.html`), same helper pattern as TEST-1.
- Preview can still time out; do not fail the suite on simulation alone.

## Parking lot

- Wire or remove dead settings/onboarding controls (UI-1).
- Devnet faucet + a **dedicated** throwaway mnemonic if we ever want a real send e2e (ask first; different network story than today’s mainnet-only RPC).
- Headed Playwright only as a debug switch (`just e2e --headed`), not as the default.
