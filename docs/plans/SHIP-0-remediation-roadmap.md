# SHIP-0 — Remediation roadmap: Chrome Web Store submission

## Goal

Take the 2026-09-10 audit plus one critical bridge vulnerability found during roadmap review to zero blockers, in nine code phases each small enough for one implementation pass and one review. Two gates:

- **Gate A — store submission.** The `just store` zip loads a mainnet balance, sends, and connects to a dApp without lying about failures, and no page can drive the worker without an approval. SHIP-0 through SHIP-7 plus SHIP-9 steps 1–4.
- **Gate B — a wallet worth handing to a stranger.** The parts that have to hold under scrutiny: origin trust, Wallet Standard correctness, a typed protocol, tests that would actually fail, and a README that does not overclaim. All phases.

## Context

Verified facts driving the ordering:

- **Critical, live in 0.2.0:** the content script built the worker message by spreading the page's payload over the outer `type`, so the allow-list check and the message that reached the worker could disagree. A page could reach handlers that were never meant to be page-reachable. Fixed in SHIP-1: `src/lib/bridge.ts` now copies only the fields each dApp message type accepts, field by field, and never spreads.
- `api.mainnet-beta.solana.com` returns 403 to any request carrying an `Origin` header, so the store build has no working mainnet endpoint. `solana-rpc.publicnode.com` accepts browser origins but blocks `getTokenAccountsByOwner` and has no DAS. Keyless mainnet can only show and send SOL; tokens and NFTs need a user-supplied RPC or Helius key. Bundling a key is out (extractable from the zip). Public devnet serves DAS, so devnet NFTs can work keyless.
- Four shipped correctness bugs: `signAndSendTransaction` returns garbage signature bytes; SPL/System discriminators in the preview are inverted; Send → Max produces amounts the integer parser rejects; RPC or CoinGecko failure renders `0.0000 SOL`.
- No connected-origins model, no approval lifecycle (window close never rejects; approvals outlive the dApp timeout), `GET_ACCOUNTS` leaks addresses to any page while unlocked.
- Tests cover only `src/lib` helpers. `service-worker.ts` exports nothing and registers listeners at import, so worker routing cannot be unit-tested until it is split.

## Working agreement

1. One plan file per phase (`docs/plans/SHIP-N-<slug>.md`, from `TEMPLATE.md`, every step names 2–5 files and its own verification). Human approves the plan before any code.
2. One implementation agent per phase at **high** effort, on branch `freyja-934/ship-N-<slug>` in its own worktree, following `/build` semantics: one step at a time, `just check` green after each, stop after two failed attempts on a step. `just e2e` at the end of any phase that touches the popup, worker, or content scripts.
3. The agent does not commit unless the human has authorized commits on that phase branch (recommended: authorize per phase so the branch is reviewable and resumable).
4. Before review: rebase onto `main`, re-run `just check` and `just e2e`, then review the rebased diff with the `/review-pr` checklist plus an adversarial pass. A rebase that touches a shared file re-enters review. Blockers go back to the same agent with its context intact.
5. Human runs `/pr`. A phase starts from `main` only after its dependencies merged.
6. "Ask first" items are settled at plan approval, not mid-implementation. Anything that rewrites `pnpm-lock.yaml` or `.github/workflows/` is an owner action in SHIP-0.

## Dependency graph

```
SHIP-0 owner actions (parallel with everything)

SHIP-1 security hotfix + headline correctness
   |
SHIP-2 foundations (router, typed protocol, chrome stub, settings hook)
   |------------------------------+
SHIP-3 RPC config               SHIP-5 approvals + origins
   |                                |
SHIP-4 data layer + honest UI    SHIP-6 Wallet Standard + preview   (needs 3 and 5)
   |                                |
   +------------+-------------------+
                |
        SHIP-7a send path        SHIP-7b keyring + session + accounts (needs 6)
                |                        |
                +----------+-------------+
                           |
                 SHIP-8a protocol completion + architecture cleanup
                           |
                 SHIP-8b tests, focus management, changelog
                           |
                 SHIP-9 packaging, listing, docs
```

Parallel pairs: SHIP-3 with SHIP-5 (after SHIP-2); SHIP-4 with SHIP-5; SHIP-7a with SHIP-7b (after SHIP-4, 5, 6). The second of a parallel pair to merge rebases on the first; shared touch points are `src/lib/protocol.ts` (additive variants) and `src/background/router.ts` (different `case` arms).

Minimal path to Gate A if time is short: SHIP-0, 1, 2, 3, 4, 5, 7a, 7b, then SHIP-9 steps 1–4. SHIP-6 and SHIP-8 are what make Gate B credible, and SHIP-6 is also what makes devnet dApps on wallet-adapter able to send.

---

## SHIP-0 — Owner actions (no code)

Outside the repo or off limits to agents.

**Still open as of 2026-09-14:** 4 (developer account), 6 (the `@types/qrcode` move),
7, and 10 (ongoing). Everything else below is struck through and dated. 0.4.0 was cut
and tagged on 2026-09-14.

1. ~~**Rotate the Helius key** that early history exposed.~~ — **done 2026-09-14.** Rotated and swapped in `.env`; the old string is dead, and it is absent from the tracked tree so gitleaks stays green. Public history was deliberately not rewritten.
2. ~~**Fix GitHub billing** so Actions runs (every run fails with "account is locked due to a billing issue").~~ — **done 2026-09-13.** Runs execute. Three further faults had to be fixed in the workflow itself before it went green, in PR #18: `pnpm/action-setup` was given a `version` that `packageManager` already pins, Node 20 could not load jsdom's undici so the component tests never started while the summary still printed green, and the e2e job was failing on devnet rate limits. See item 9.
3. ~~**Enable GitHub Pages** (Settings → Pages → branch `main`, folder `/docs`).~~ — **done 2026-09-13.** `https://freyja-934.github.io/wallet-browser-extension/legal/privacy.html` and the terms page both answer 200. That is the URL to paste into the listing.
4. **Chrome Web Store developer account**: $5 registration, 2-Step Verification, trader/non-trader declaration, verified contact email. Do not submit until Gate A.
6. ~~**Before SHIP-8b starts**, on `main`: `pnpm add -D jsdom @testing-library/react @testing-library/jest-dom @vitest/coverage-v8@1`~~ — **done 2026-09-13**: authorised for SHIP-10, which installed the four and landed the component tests and the coverage gate SHIP-8b had deferred. Still open: `pnpm remove @types/qrcode && pnpm add -D @types/qrcode` (it is a dependency, not a devDependency).
7. **After SHIP-3 merges**, update the comment block in `.env.example` (agents cannot read `.env*`) to describe the Settings `rpcUrl` / `heliusApiKey` fields and DAS-on-any-URL.
8. ~~**After SHIP-4 merges**, retake store screenshots on a mainnet profile.~~ — **done 2026-09-13**, twice. The first set had a Devnet capture of 0 SOL sitting under a caption promising live prices; it was rebuilt in PR #18 from two runs, each shot taken on whichever cluster makes its own caption true, from a keyless build that matches `just store`. Provenance and the verification rule are in `docs/store/screenshots/README.md`. Still worth an owner pass: the approval shots show `localhost:5174` as the requesting origin, which is honest for a local test dApp but could be made prettier by hosting the demo dApp on the Pages site.
10. **Keep the devnet fixture funded.** `HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk` had 0 lamports on 2026-09-12, so every `signAndSend` e2e fails with `AccountNotFound` (fee payer). The RPC `requestAirdrop` is rate-limited; use https://faucet.solana.com (GitHub login) for 1–2 devnet SOL before running `just e2e`. Each full run spends 10000 lamports: one 0-lamport dApp self-transfer and one 0.001 SOL popup self-transfer, both paying only the fee; nothing leaves the fixture.
9. ~~**After SHIP-9**, owner edits `.github/workflows/check.yml`: add a `store` job and a Playwright job.~~ — **done 2026-09-13**, owner waived the off-limits rule once for this. `store` runs on every PR and push and uploads the zip. The Playwright job landed but is **opt-in** (`workflow_dispatch`): public devnet rate-limits GitHub-hosted runners hard enough that it failed seven specs on HTTP 429, and a gate that cannot tell throttling apart from a real break is worse than none. `just e2e` stays the strict local gate.

---

## SHIP-1 — Security hotfix and headline correctness

**Why first.** One live vulnerability and four one-file bugs in the features the README leads with. Ship as its own PR the same day.

**Findings.** New: `content-script-payload-type-override` (critical). Audit: `signandsend-signature-garbage`, `preview-token-discriminators-inverted`, `tx-preview-token-discriminators-wrong`, `wallet-standard-version-field`, `injected-icon-invalid-hex`, `approval-preview-hard-fails-on-rpc-error`, and the two vacuous tests from `test-coverage-gaps-and-vacuous-tests`.

**Steps (outline).**

1. Files: new `src/lib/bridge.ts` + `bridge.test.ts`, `src/content/content-script.ts`
   `buildRuntimeMessage(type, payload, origin)` copies only the fields each dApp type accepts (`transaction`, `message`, later `chain`, `options`, `silent`) and sets `type` and `origin` last. Test: a payload `{ type: 'EXPORT_SEED' }` cannot change the outer type; unknown fields are dropped.
2. Files: `src/background/service-worker.ts`, `src/content/injected.ts`, `e2e/dapp.spec.ts`
   `fulfillApproval` returns `signature: [...bs58.decode(sig)]` (64 bytes). e2e asserts `out.signature.length === 64` and that `bs58.encode(out.signature)` reaches `confirmed` via `getSignatureStatuses` on devnet.
3. Files: `src/lib/tx-preview.ts`, `src/lib/tx-preview.test.ts`
   System index is `data.readUInt32LE(0)`: `1` Assign, `2` Transfer, `3` CreateWithSeed, `10` AssignWithSeed. Token/Token-2022 index is `data[0]`: `3` Transfer, `4` Approve, `5` Revoke, `6` SetAuthority, `7` MintTo, `8` Burn, `9` CloseAccount, `10` FreezeAccount, `12` TransferChecked, `13` ApproveChecked, `14` MintToChecked, `15` BurnChecked. Warnings on Approve, ApproveChecked, SetAuthority, Assign, AssignWithSeed, CloseAccount, FreezeAccount. Tests build each instruction with the `@solana/spl-token` and `SystemProgram` builders and assert label and warning; the vacuous "builds a legacy transaction" test is replaced. Decode of a v0 message whose instruction index exceeds `staticAccountKeys` returns `label: 'Unreadable instruction'` with a danger warning instead of throwing (ALT resolution arrives in SHIP-6).
4. Files: `src/content/injected.ts`, new `src/config/brand.ts` + test
   `version: '1.0.0'` (drop the cast). `CINDER_ICON_DATA_URI` is a `data:image/svg+xml;base64,` string of a 32×32 Cinder mark authored in `brand.ts` (no React imports; the injected IIFE has no JSX runtime). Test decodes it and checks well-formed SVG and valid hex colours.
5. Files: `src/background/service-worker.ts`, `src/components/transactions/ApprovalScreen.tsx`
   Move `getConnection()` inside the preview `try` so an RPC failure returns the decode-only preview with `error: 'No RPC endpoint'`; the screen tracks `previewSettled` and keeps Approve disabled for transaction requests until it is true (the e2e already waits on the button being enabled).

**Verify.** `just check`; `just e2e` (dApp spec); manual: from the test dApp console, post `{ channel: 'cinder-wallet', id: 1, type: 'WALLET_CONNECT', payload: { type: 'GET_STATE' } }` and confirm the reply is the connect flow, not wallet state.
**Ask first.** None.
**Size.** One day.

---

## SHIP-2 — Foundations: router, typed protocol, chrome stub, settings hook

**Why.** Every later phase adds worker message arms, unit tests against `chrome.*`, and popup reads of settings. Landing the three seams once avoids each phase inventing its own and SHIP-8 rewriting them.

**Findings.** `untyped-message-protocol` (skeleton), `sw-no-sender-privilege-check` (guard location), `bridge-untested` (first tests), `ui-slice-duplicates-worker-settings` (hook only; Redux mirror removed in SHIP-8a).

**Design.**

- `src/background/router.ts` exports `handleMessage(request, sender)`, `fulfillApproval`, `previewTransaction`; `service-worker.ts` keeps only imports, listener registration (synchronous, at module top), and the polyfill. Listeners for `chrome.windows.onRemoved` and `chrome.tabs.onRemoved` are registered here now (no-op bodies until SHIP-5) so they exist at worker start.
- `src/lib/protocol.ts`: a discriminated union `WalletRequest` with one member per existing message type and a `WalletResponse<T>` map; `parseRequest(unknown): WalletRequest` hand-written validators (no new dependency) that reject unknown types and malformed payloads; `extensionClient` typed from the union. `handleMessage` switches on the parsed union. The sender allow-list lives next to `parseRequest`: requests from tab senders (`sender.tab` set) may only carry `DAP_MESSAGE_TYPES` plus `POLL_APPROVAL`; every other type requires `sender.url` to start with `chrome.runtime.getURL('')`. Origin comes from `sender.origin`; the `origin` field in the payload is ignored.
- `src/test/chrome-stub.ts`: `installChromeStub()` returns an in-memory `chrome` with `storage.local` / `storage.session` (with `onChanged`), `alarms`, `windows.create` / `onRemoved`, `tabs.sendMessage` / `onRemoved`, `runtime.getURL` / `onMessage` / `sendMessage`. Tests import and install it explicitly; no `vite.config.ts` change.
- `src/hooks/useSettings.ts`: `useSettings()` (React Query, key `['settings']`) and `useUpdateSettings()` (mutation that invalidates the key). Popup screens that need `cluster` read it from here; the Redux mirror stays for now so SHIP-3/4/5 do not need to touch every consumer.

**Steps (outline).**

1. Files: new `src/background/router.ts`, `src/background/service-worker.ts`, `src/lib/messages.ts`
2. Files: new `src/lib/protocol.ts` + `protocol.test.ts`, `src/messaging/client.ts`, `src/background/router.ts` (switch on the union, sender guard)
3. Files: new `src/test/chrome-stub.ts`, new `src/background/router.test.ts` (sender guard, locked paths, unknown type, origin from sender)
4. Files: new `src/hooks/useSettings.ts`, `src/components/settings/Settings.tsx`, `src/components/shell/AppShell.tsx`

**Verify.** `just check`; `just e2e`; `router.test.ts` proves a tab sender cannot call `EXPORT_SEED`.
**Ask first.** Message API: the sender allow-list is a behaviour change for any page that relied on privileged types (none legitimately do).
**Size.** One and a half days.

---

## SHIP-3 — RPC configuration and endpoints

**Why.** The store zip cannot reach mainnet. Make the endpoint list settings-driven, ship a browser-permissive default, and let a user paste their own RPC URL or Helius key.

**Findings.** `mainnet-rpc-403`, `remediation-3-publicnode-default`, `remediation-1-user-supplied-rpc-in-settings`, `remediation-4-bundled-helius-key-rejected` (guardrail), `das-on-public-rpc`, `rpc-rotation-semantics-inconsistent`, `rpc-rotate-cooldown-on-application-errors`, `web3js-429-retry-console-error-and-latency`, `stale-module-load-connections-dead-code`, `helius-host-permissions-unused-in-store-build`, `testnet-host-unused`, `top-2-make-the-store-build-work-on-mainnet-with-honest-error-states` (endpoint half).

**Design.**

- `WalletSettings` gains `rpcUrl?: string` and `heliusApiKey?: string` (chrome.storage.local, user-owned, plaintext, stated in the UI). Build-time `VITE_HELIUS_API_KEY` remains a dev convenience that seeds the default.
- `rpcUrlsFor(cluster, settings)` is a pure function: `[custom?, helius?, ...publicDefaults]`. Mainnet defaults: `https://solana-rpc.publicnode.com`, then `https://api.mainnet-beta.solana.com`. Devnet: `https://api.devnet.solana.com`. `runtimeRpcUrls()` reads settings.
- `rpcJson`: HTTP 401/403 and JSON-RPC `-32601` skip to the next URL **for this call only** without marking the host unhealthy; 408/429/5xx and transport errors mark unhealthy (30 s). DAS is tried on every URL in order. The plan step records the exact status and error code publicnode returns for `getTokenAccountsByOwner` and `getAssetsByOwner` before writing `shouldRotate`, and pins a unit test to it.
- `getTokenBalances` issues `getBalance` and the token-account call as two independent rotated calls, so a blocked token method never discards the SOL balance (the UI states for a blocked token list arrive in SHIP-4; this phase returns `{ lamports, tokens, tokensError? }`).
- Connections are created with `disableRetryOnRateLimit: true`; React Query owns retries. Delete the module-load `Connection` singletons in `HeliusService` and `WalletService` and the dead methods that use them.
- Custom URL: https only. A host outside `host_permissions` is fetched as a plain CORS request (works for providers that send `Access-Control-Allow-Origin`, fails for CORS-less hosts), so the manifest adds `optional_host_permissions: ["https://*/*"]` as the ceiling and the Settings save click handler calls `chrome.permissions.request({ origins: [new URL(rpcUrl).origin + '/*'] })` synchronously (before any `await`), then probes `getHealth` from the popup; on probe failure it calls `permissions.remove` and does not save. Header pill shows the configured primary host on hover.
- `just store` fails if `grep -rEq 'api-key=[0-9a-f]{8}-[0-9a-f]{4}-' dist/` matches (a real key literal; the bare `api-key=` template is always present) or if `dist/manifest.json` lacks the publicnode host.

**Steps (outline).**

1. Files: `src/lib/protocol.ts` (settings fields), `src/config/constants.ts`, `src/lib/runtime-rpc.ts`, `src/lib/rpc-rotate.ts`, `src/lib/rpc-rotate.test.ts`
2. Files: `src/background/keyring.ts` (settings validation), `src/background/transfers.ts`, `src/services/helius.ts`, `src/services/wallet.ts`
3. Files: `src/components/settings/Settings.tsx`, `src/components/shell/AppShell.tsx`, `src/hooks/useSettings.ts`, `manifest.json`
4. Files: `justfile`, `README.md`, `docs/store/listing.md` (permission justifications, RPC recipients)

**Verify.** `just check`; `just store` then load the zip on mainnet in a fresh profile: SOL balance loads with no key; paste a Helius key and tokens plus NFTs load; `just store` with a key exported in the shell fails the guardrail.
**Ask first.** `manifest.json` host list (add publicnode, drop testnet, add `optional_host_permissions`). `justfile` guardrail. Storing a user-supplied key in `chrome.storage.local`.
**Size.** Two days.

---

## SHIP-4 — Data layer and honest UI states

**Why.** With a working endpoint, the wallet must stop rendering failure as zero, stop refetching on every tab switch, and show tokens by name where it can.

**Findings.** `false-zero-balance-on-rpc-failure`, `no-rpc-error-states-zero-balance-on-failure`, `coingecko-failure-zeroes-sol-balance`, `coingecko-failure-and-rate-limit-sleep-block-balances`, `history-and-nfts-swallow-errors-as-empty`, `react-query-no-stale-time-refetch-storm`, `token-metadata-missing`, `token-2022-unsupported` (balances half), `console-error-coingecko`, `dead-network-and-rpc-code`, `top-2` (UI half).

**Design.**

- Balances query returns `{ lamports: string, tokens, tokensError? }`; prices are a separate query with their own error state. USD shows `—` when prices fail; SOL never shows 0 on error. `enforceRateLimit` sleep removed; CoinGecko errors return `undefined` prices with no `console.error`.
- Token accounts are queried for both `TOKEN_PROGRAM_ID` and `TOKEN_2022_PROGRAM_ID`; each token carries its `programId`.
- `src/lib/token-metadata.ts`: DAS `getAssetsByOwner` first (any URL that serves it); fallback for Token-2022 mints via `getTokenMetadata` from `@solana/spl-token`; fallback for classic mints via on-chain Metaplex metadata: PDA `findProgramAddressSync(['metadata', METADATA_PROGRAM_ID, mint], METADATA_PROGRAM_ID)` with program `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`, fetched in `getMultipleAccountsInfo` batches of 100, decoded as: key u8, skip 64 bytes (update authority, mint), then three u32-LE-length-prefixed strings (name, symbol, uri) with trailing `\0` trimmed; do not assert total length. Final fallback shows the short mint with a copy button, never "Unknown / ??".
- Token list surfaces a typed `TokenListUnavailable` error when the token-account call fails with HTTP 403 or JSON-RPC `-32601`/`-32600` on every URL (or the list has no custom or Helius URL); the screen renders "Add an RPC endpoint in Settings to see tokens and NFTs". Any other failure renders the generic error card with Retry. History and NFT services throw; hooks expose `isError`.
- `staleTime` 30 s balances, 60 s NFTs and history; no placeholder data across key changes (a different account, cluster, or endpoint renders the loading state, never the previous scope's figures); query keys include `settings.cluster` and the configured primary URL (`rpcUrlsFor(...)[0]`, not the host that answered); `useInvalidateWalletData` scopes by address; history becomes `useInfiniteQuery` keyed on `before` with a Load more row.

**Steps (outline).**

1. Files: new `src/lib/token-metadata.ts` + test, `src/services/helius.ts`, `src/services/wallet.ts`, `src/services/coingecko.ts`
2. Files: `src/hooks/useWalletQueries.ts`, `src/popup/main.tsx`, `src/lib/parse-history.ts`, `src/store/slices/walletSlice.ts` (types only)
3. Files: `src/components/wallet/BalanceCard.tsx`, `src/components/tokens/TokenList.tsx`, `src/components/ui/EmptyState.tsx`
4. Files: `src/components/nfts/NFTGallery.tsx`, `src/components/transactions/TransactionHistory.tsx`, `e2e/dashboard.spec.ts`

**Verify.** `just check`; block the RPC host in DevTools and confirm the error card, not zeros; on publicnode confirm the "Add an RPC endpoint" state; `just e2e` (dashboard spec).
**Ask first.** None expected.
**Size.** Three days. Runs in parallel with SHIP-5.

---

## SHIP-5 — Approval lifecycle, origin trust, and worker hardening

**Why.** Which sites can see or sign for the account, and what happens when an approval window closes.

**Findings.** `get-accounts-leak`, `no-origin-trust`, `top-5-connected-sites-and-origin-binding`, `request-origin-trust`, `approval-timeout-desync`, `approval-lifecycle-leaks`, `approval-window-lifecycle-gaps`, `approval-store-rmw-race`, `approval-results-never-pruned`, `sign-while-locked-dead-end`, `connect-when-locked-throws`, `no-change-events-on-lock`, `keepalive-port`, `lumen-remnants`, `session-plaintext-fallback` (approvals half).

**Design.**

- **Connected origins**: `cinder_connected` in `chrome.storage.local` holds `{ [origin]: { connectedAt, accountIndexes } }` only. A delivery registry in `chrome.storage.session` maps `${tabId}:${frameId}` to origin, populated from `sender` on every dApp message and pruned on `chrome.tabs.onRemoved`. `WALLET_CONNECT` from a connected origin while unlocked returns accounts without a prompt; `{ silent: true }` from an unconnected origin returns an empty account list. `WALLET_DISCONNECT` removes the origin. `GET_ACCOUNTS` and all `SIGN_*` require a connected origin. One pending approval per origin; further requests are rejected with "A request is already pending". `clearWallet()` removes `cinder_connected` and sends a disconnect event.
- **Approval lifecycle**: `PendingApproval` records `windowId` (from `chrome.windows.create`'s return value). The `windows.onRemoved` handler looks up the id in pending and rejects with "Approval window closed" only if still pending (Approve calls `window.close()` after resolving). Approvals expire after 5 minutes as a worker-side backstop; the page timeout of 120 s is the binding limit and the content script sends `REJECT_REQUEST` when it fires, so a late Approve cannot broadcast. `lock()` and `clearWallet()` reject and clear all pending; results are deleted when delivered; storage read-modify-write goes through a per-key promise queue. `approvals.ts` and `keyring.ts` share `src/background/session-store.ts`, which throws when `chrome.storage.session` is absent (no local fallback).
- **Locked flow**: connect or sign while locked opens `approve.html`, which renders an `UnlockForm({ onUnlocked })` (presentational; calls `extensionClient.unlock` directly, no Redux) and then continues to the request. `UnlockScreen` in the popup uses the same form and calls `initializeWallet()` on success.
- **Events**: on lock, auto-lock, disconnect, account switch, cluster change, and clear, the worker sends `WALLET_EVENT` (`{ event, origin, accounts, cluster }`) via `chrome.tabs.sendMessage` to the registry's tab ids (`lastError` swallowed). The content script drops events whose `origin` differs from `window.location.origin`, then posts `{ channel, event, accounts, cluster }` (no `id`, no `type`, so it passes the injected filters); the injected wallet emits `change`. The popup receives `{ event: 'locked' }` via `chrome.runtime.sendMessage` and routes to Unlock (never via `storage.session.onChanged`, whose `oldValue` would hand the popup the seed). The `lumen-keepalive` port and reconnect loop are removed.
- Hooks for SHIP-7b: `touchActivity()` called in the listener (re-arms the existing alarm) and `onLocked()` in `keyring.lock()`; both minimal here.
- **Settings → Connected sites** panel with last-connected time and Revoke.
- Rename `lumen_*` storage keys and `lumen-*` alarm names behind a one-time migration.

**Steps (outline).**

1. Files: `src/lib/protocol.ts` (`silent`, `WALLET_EVENT`, `GET_CONNECTED_SITES`, `REVOKE_SITE`), new `src/background/origins.ts` + test, `src/background/router.ts` (connect, disconnect, gating)
2. Files: new `src/background/session-store.ts`, `src/background/approvals.ts` + test, `src/background/keyring.ts` (lock hooks, migration)
3. Files: `src/background/service-worker.ts` (window/tab listeners), `src/content/content-script.ts`, `src/content/injected.ts`, `src/lib/bridge.ts`
4. Files: new `src/components/wallet/UnlockForm.tsx`, `src/components/wallet/UnlockScreen.tsx`, `src/components/transactions/ApprovalScreen.tsx`, `src/popup/App.tsx`
5. Files: `src/messaging/client.ts`, new `src/components/settings/ConnectedSites.tsx`, `src/components/settings/Settings.tsx`, `e2e/dapp.spec.ts` (window close, silent connect, revoke, locked sign)

**Verify.** `just check`; `just e2e`; manual: close the approval window and confirm the dApp gets a rejection within a second; lock the wallet and confirm the dApp's account list empties; a second tab on an unconnected origin receives nothing.
**Ask first.** Auth/session shape (connected-origins store, approval TTL, shared session store with no local fallback). Message API additions.
**Size.** Three days. Runs in parallel with SHIP-3 and SHIP-4.

---

## SHIP-6 — Wallet Standard surface and transaction preview

**Why.** wallet-adapter throws when the account's `chains` lack the endpoint chain, so devnet dApps cannot send today; the preview has no amounts. This is the phase that decides whether the dApp surface is credible.

**Findings.** `chains-mainnet-only`, `signandsend-options-ignored`, `sign-all-serializes-n-approval-windows`, `sign-message-signs-transactions`, `sign-message-no-transaction-guard`, `preview-no-balance-changes`, `top-8-approval-screen-as-a-trust-surface`, `preview-versioned-alt-and-blockhash`, `non-signer-tx-error-and-dead-fallback`, `injected-script-tag-async-race`, `provider-injection-via-script-tag`, `wallet-standard-surface-nits`.

**Design.**

- Wallet `chains: [SOLANA_MAINNET_CHAIN, SOLANA_DEVNET_CHAIN]`; each account's `chains` reflects the active cluster returned by `WALLET_CONNECT` and is re-stamped on the cluster-change event. Sign requests carry `chain` when the dApp supplies one; an absent chain defaults to the active cluster; a mismatch is rejected with "Cinder is on Devnet; switch networks in Settings". Localnet is intentionally unsupported (wallet-adapter maps localhost endpoints to `solana:localnet`); documented under Known limitations.
- `signAndSendTransaction` forwards `skipPreflight`, `preflightCommitment`, `maxRetries`, `minContextSlot` to `sendRawTransaction`; when `options.commitment` is present the worker polls `getSignatureStatuses` to that level (bounded) before returning.
- One approval per call for all three features: `signTransaction`, `signAndSendTransaction`, and `signMessage` with N inputs become one approval carrying N payloads; the screen previews each; output order preserved.
- `signMessage` guard: reject if the bytes deserialize as a legacy or v0 transaction message. Display UTF-8 when valid text, otherwise hex with a byte count.
- Preview always deserializes with `VersionedTransaction.deserialize` (it accepts legacy wire bytes); the `Transaction.from` branches are deleted. Account keys: `message.version === 'legacy'` → `message.getAccountKeys()`; v0 → fetch each `addressTableLookups` table with `getAddressLookupTable` and call `getAccountKeys({ addressLookupTableAccounts })`. Fail early with a clear message when the active account is not a required signer.
- Balance diff: collect writable keys → `getMultipleAccountsInfo(keys)` (pre) → `simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, innerInstructions: true, accounts: { encoding: 'base64', addresses } })` (post; RPC rejects `sigVerify: true` together with `replaceRecentBlockhash`) → fetch mints for touched token accounts → pure `balanceDiff(pre, post, owner, decimalsByMint)` returning `{ sol: { pre, post }, tokens: [{ mint, pre, post, decimals }] }` using `AccountLayout.decode` for accounts owned by either token program. Rendered above the instruction list; Approve stays gated on the preview settling.
- Provider injection: second `content_scripts` entry with `"world": "MAIN"` for `injected.js`; drop the `<script>` tag and `injected.js` from `web_accessible_resources`; `minimum_chrome_version: "111"`. Replace the hand-rolled base58 decoder with `bs58`.

**Steps (outline).**

1. Files: `src/content/injected.ts`, `src/lib/protocol.ts`, `src/lib/bridge.ts`, `src/background/router.ts` (chain check, options, batch)
2. Files: `src/lib/tx-preview.ts` + test, new `src/lib/balance-diff.ts` + test (fixtures for SOL-only, SPL, Token-2022)
3. Files: `src/background/router.ts` (preview pipeline), `src/components/transactions/ApprovalScreen.tsx`, new `src/components/transactions/BalanceDiff.tsx`
4. Files: `manifest.json`, `src/content/content-script.ts`, `vite.injected.config.ts`
5. Files: `examples/test-dapp/main.js`, `examples/test-dapp/index.html`, `e2e/dapp.spec.ts` (batch sign, wrong-chain rejection, message guard, diff visible)

**Verify.** `just check`; `just e2e`; manual against a wallet-adapter dApp on devnet: send succeeds and the diff shows the transfer; switch cluster in Settings and confirm the dApp sees the new chain without reconnecting.
**Ask first.** Wallet Standard surface changes (chains, batch semantics, message guard). `manifest.json` (MAIN world, minimum Chrome 111). `vite.injected.config.ts`.
**Size.** Four days. Needs SHIP-3 and SHIP-5.

---

## SHIP-7a — Send path on integer units

**Findings.** `max-button-float-string-rejected`, `send-max-float-math-rejects-own-amount`, `top-7-send-path-integer-math-and-safety`, `spl-send-ata-idempotency-and-recipient-checks`, `send-confirmation-polling-ignores-blockhash-expiry`, `hardcoded-fee`, `token-2022-unsupported` (send half), `send-flow-stale-zero-balance-and-raw-rpc-toast`.

**Design.**

- `SendAsset` carries `balanceSmallest: string`, `decimals`, `programId?`; Max computes `balance − fee` in lamports; validation uses `toSmallestUnit` only. Continue is disabled while the balance query is loading or errored; RPC errors toast a friendly message with the raw text behind Details.
- Review calls `ESTIMATE_FEE` (worker: `getFeeForMessage`, fallback 5000) and shows the rent-exempt minimum when the SOL recipient does not exist. Sender's remaining lamports must be 0 or at least `getMinimumBalanceForRentExemption(0)` ("Leave at least 0.00089 SOL or send Max").
- SPL: detect the program from the mint owner; pass `programId` to `getAssociatedTokenAddressSync` (with `allowOwnerOffCurve: true`), `createAssociatedTokenAccountIdempotentInstruction`, and `createTransferCheckedInstruction` (decimals from `getMint(connection, mint, 'confirmed', programId)`); warn when `PublicKey.isOnCurve(to)` is false or the recipient is already a token account.
- Confirmation polls `getSignatureStatuses` until confirmed or `getBlockHeight() > lastValidBlockHeight`, then reports "expired, safe to retry".

**Steps (outline).**

1. Files: `src/lib/units.ts` + test, `src/store/slices/uiSlice.ts` (`SendAsset` shape), `src/lib/protocol.ts` (`ESTIMATE_FEE`, `RECIPIENT_INFO`)
2. Files: `src/background/transfers.ts` + new test (mocked `Connection`), `src/background/router.ts`, `src/messaging/client.ts`
3. Files: `src/components/tokens/SendModal.tsx`, `src/components/tokens/AmountInput.tsx`, `src/components/tokens/TokenList.tsx`, `e2e/send.spec.ts`

**Verify.** `just check`; `just e2e`; manual on devnet: Max then Confirm succeeds; SPL send to a fresh recipient creates the ATA once; a Token-2022 mint sends.
**Ask first.** New message types.
**Size.** Two days. Needs SHIP-4, 5, 6. Runs in parallel with SHIP-7b.

---

## SHIP-7b — Keyring, session, and accounts

**Findings.** `seed-session-falls-back-to-local`, `session-storage-falls-back-to-local`, `session-seed-falls-back-to-local-storage`, `vault-format-unversioned`, `pbkdf2-100k`, `change-password-weaker-policy`, `change-password-leaves-legacy-vault`, `autolock-absolute-not-idle`, `seed-import-paste-not-normalized`, `seed-attestation-checkbox-fake`, `secrets-through-redux-and-keypair-remnants`, `popup-holds-mnemonic-claim`, `single-account-ui`, `top-9-multi-account-token-2022-and-metadata`, `keyring-zero-unit-tests`.

**Design.**

- Vault v2 `{ version: 2, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 }, salt, nonce, ciphertext }` (OWASP figure; about 0.15 s on a laptop, up to 1 s on low-end hardware, stated in the ADR). v1 vaults re-encrypt on the next successful unlock; `lumen_vault` removed after migration. `decryptVault` runs once per operation via a private `unlockWithPayload()` so export and change-password derive the key exactly once. `changePassword` enforces `validatePasswordStrength`. `unlock` preserves `activeAccountIndex`. `minimum_chrome_version` stays at 111 from SHIP-6.
- Idle auto-lock: `touchActivity()` re-arms the alarm on every popup or approval message; the popup routes to Unlock on the `locked` event from SHIP-5.
- Onboarding: paste import normalizes whitespace and case; the "I stored this phrase" checkbox is a real controlled input required to continue. Create, import, unlock, change-password, and export call `extensionClient` directly; `walletSlice` keeps only public-state reducers and the secret-carrying thunks are deleted; `store.ts` drops the `payload.keypair` ignore list. Unit test: no dispatched action contains a password or mnemonic.
- Accounts: `cinder_accounts` (public data) is the source of truth for count; `ADD_ACCOUNT` derives the next index; `RENAME_ACCOUNT`; header account switcher; export private key uses the selected index.

**Steps (outline).**

1. Files: `src/lib/encryption-simple.ts` + test, `src/background/keyring.ts` + new test (stub from SHIP-2), new `docs/adr/0002-vault-v2.md`
2. Files: `src/background/keyring.ts` (idle lock, accounts), `src/background/router.ts`, `src/lib/protocol.ts`
3. Files: `src/components/wallet/SeedPhraseImport.tsx`, `src/components/wallet/SeedPhraseDisplay.tsx`, `src/components/wallet/WalletCreationFlow.tsx`
4. Files: `src/components/settings/Settings.tsx`, `src/store/slices/walletSlice.ts` + test, `src/store/store.ts`
5. Files: new `src/components/wallet/AccountSwitcher.tsx`, `src/components/shell/AppShell.tsx`, `src/messaging/client.ts`, `e2e/settings.spec.ts`

**Verify.** `just check`; `just e2e`; manual: unlock a wallet created before this phase and confirm it opens and is now v2; leave the popup idle past the timeout and confirm it locks; add a second account and export its key.
**Ask first.** Keyring/session shape (vault v2, iteration count). New message types. `AGENTS.md` wording for the popup/mnemonic rule (proposed: "the popup shows the mnemonic only during create, import, and password-gated export; it never holds a Keypair or the seed").
**Size.** Three days. Needs SHIP-6.

---

## SHIP-8a — Protocol completion and architecture cleanup

**Findings.** `top-3-typed-message-protocol-and-ts-rigor`, `ui-slice-duplicates-worker-settings`, `top-4-respect-the-redux-vs-react-query-boundary`, `derived-state-in-effects`, `dead-code-and-vestigial-exports`, `dead-crypto-helpers-and-stale-constants`, `version-maintained-in-three-places` (constants half).

**Design.**

- Exhaustive switch over the full `WalletRequest` union; remove every remaining `String()` / `as` coercion. Turn `@typescript-eslint/no-explicit-any` on only in the step after the last `any` site is gone (`helius.ts`, `coingecko.ts`, `injected.ts`).
- Redux mirror removed in two steps so `tsc` stays green: (a) switch `useWalletQueries.ts`, `TokenList.tsx`, `TransactionHistory.tsx`, `BalanceCard.tsx` to `useSettings`; (b) switch `App.tsx`, `Settings.tsx`, `AppShell.tsx`, delete `cluster` / `hideSmallBalances` / `theme` and the eight dead reducers from `uiSlice`.
- Derived-state effects replaced with computed values (recipient validation, selected token, seed reveal).
- Delete unused exports across `constants.ts`, `encryption-simple.ts`, `wallet.ts`, `coingecko.ts`, `helius.ts`. `WALLET_VERSION` becomes `import pkg from '../../package.json'` (`resolveJsonModule` is already on).

**Steps (outline).**

1. Files: `src/background/router.ts`, `src/lib/protocol.ts`, `src/messaging/client.ts`
2. Files: `src/hooks/useWalletQueries.ts`, `src/components/tokens/TokenList.tsx`, `src/components/transactions/TransactionHistory.tsx`, `src/components/wallet/BalanceCard.tsx`
3. Files: `src/store/slices/uiSlice.ts`, `src/popup/App.tsx`, `src/components/settings/Settings.tsx`, `src/components/shell/AppShell.tsx`
4. Files: `src/components/tokens/SendModal.tsx`, `src/components/wallet/SeedPhraseDisplay.tsx`, `src/components/wallet/PasswordCreate.tsx`
5. Files: `src/config/constants.ts`, `src/lib/encryption-simple.ts`, `src/lib/wallet.ts`, `src/services/coingecko.ts`, `src/services/helius.ts`
6. Files: `.eslintrc.cjs`, `src/content/injected.ts` (enable `no-explicit-any`)

**Verify.** `just check` with the rule on; `just e2e`.
**Ask first.** `.eslintrc.cjs`.
**Size.** Two days. Needs SHIP-7a and SHIP-7b.

---

## SHIP-8b — Tests, focus management, changelog

**Findings.** `bridge-untested`, `test-coverage-gaps-and-vacuous-tests`, `top-6-tests-that-exercise-the-wallet-not-just-helpers`, `modal-no-focus-management`, `no-release-process` (CHANGELOG half).

**Design.**

- Extend the existing tests from SHIP-2/5/7: `keyring.test.ts` (migration, tamper, salt and nonce freshness), `approvals.test.ts` (expiry, window close, per-origin cap), `transfers.test.ts` (fee, expiry), `router.test.ts` (every arm's locked path). New: `src/content/injected.test.ts` under `// @vitest-environment jsdom` (connect, silent connect, batch, signature bytes, event handling), `BalanceCard.test.tsx` (error state), `SendModal.test.tsx` (Max, validation).
- `vite.config.ts`: `test.include` widened to `src/**/*.test.{ts,tsx}`; `coverage.include` set to `src/background/**`, `src/content/**`, `src/lib/**` with an 80 percent lines threshold.
- e2e: approval timeout, locked-sign flow through `approve.html`.
- Modal focus management: focus first control on open, restore on close, trap Tab.
- `CHANGELOG.md` started at 0.3.0.

**Steps (outline).**

1. Files: `vite.config.ts`, `src/test/chrome-stub.ts`, `src/background/keyring.test.ts`, `src/background/approvals.test.ts`
2. Files: `src/background/router.test.ts`, `src/background/transfers.test.ts`, new `src/content/injected.test.ts`
3. Files: new `src/components/wallet/BalanceCard.test.tsx`, new `src/components/tokens/SendModal.test.tsx`, `src/components/ui/Modal.tsx`
4. Files: `e2e/dapp.spec.ts`, `e2e/wallet.spec.ts`, new `CHANGELOG.md`

**Verify.** `just check`; `pnpm exec vitest run --coverage` lists the two `.tsx` files and meets the threshold; `just e2e`.
**Ask first.** `vite.config.ts`. (Dependencies were installed by the owner in SHIP-0 step 6.)
**Size.** Two days.

---

## SHIP-9 — Packaging, performance, listing, and repo presentation

**Findings.** `media-bloat`, `popup-720p-video-decode-on-every-open`, `popup-loads-full-crypto-chunk-at-startup`, `accidental-chunk-layout`, `buffer-polyfill-ordering-in-worker`, `version-maintained-in-three-places`, `build-pipeline-redundancies`, `store-recipe-leaves-mainnet-dist`, `war-assets-exposed`, `clipboardwrite-permission-unneeded`, `csp-default-only`, `screenshots-devnet` (owner), `icon-generic`, `listing-assets-promo-crop-icon-padding`, `listing-doc-account-prereqs-and-category`, `privacy-policy-omits-explorer-and-remote-media`, `pages-404`, `readme-and-rules-claims-diverge-from-code`, `commit-hygiene-and-ai-scaffolding-front-and-center`, `top-10-repo-presentation-and-honesty`, `no-release-process`.

**Design.**

- Media: re-encode `bg-video.mp4` to a 380×600 crop at about 600 kbps (under 1 MB) or replace with the still; move `nft-img.png`, `nft-video.mp4`, `token-img.png` to `scripts/assets/` and update `scripts/mint-cinder.mjs` line 10. Target zip under 2 MB.
- Build: `manualChunks` for vendor; `React.lazy` for `WalletCreationFlow` (from `App.tsx`) and `Settings` (from `Dashboard.tsx`) so `bip39` leaves the popup entry; polyfill ordering fixed by a side-effect entry in `rollupOptions.input`; all three Vite configs and the copy scripts read `CINDER_OUT_DIR` (default `dist`), `just store` exports `dist-store`, `.gitignore` adds it; `scripts/sync-version.mjs` writes the `dist/manifest.json` version from `package.json`; `copy:icons` removed (Vite `publicDir` already copies).
- Manifest: drop `assets/*` from `web_accessible_resources`; drop `clipboardWrite` if the copy buttons still work inside user gestures; CSP adds `img-src 'self' https: data:; media-src 'self'`.
- Listing: icon regenerated with 10 percent padding and the Cinder mark from `brand.ts`; `listing.md` updated for current categories, account prerequisites, and the Pages privacy URL; privacy policy names solana.fm and third-party image hosts. Screenshots come from SHIP-0 step 8.
- Repo: README rewritten to what the store build does keyless versus with a key, a Known limitations section (localnet, keyless tokens), updated architecture block; AGENTS.md aligned per the SHIP-7b decision; plans moved or kept per SHIP-0 step 5; `v0.3.0` tag and GitHub Release once Gate A passes. Owner YAML for CI written into the plan.

**Steps (outline).**

1. Files: `public/media/*`, `scripts/assets/*`, `scripts/mint-cinder.mjs`, `src/components/ui/Atmosphere.tsx`
2. Files: `vite.config.ts`, `src/popup/App.tsx`, `src/components/Dashboard.tsx`
3. Files: `vite.config.ts`, `vite.content.config.ts`, `vite.injected.config.ts`, `src/background/service-worker.ts` (polyfill entry)
4. Files: new `scripts/sync-version.mjs`, `package.json`, `justfile`, `.gitignore`
5. Files: `manifest.json`, `docs/store/listing.md`, `docs/legal/privacy.md`, `public/legal/privacy.html`
6. Files: `scripts/generate-icons.mjs`, `public/icons/*`, `src/config/brand.ts`
7. Files: `README.md`, `docs/README.md`, `CHANGELOG.md`
8. Files: `AGENTS.md`, `.github/pull_request_template.md`, `docs/plans/*` (move or keep)

**Verify.** `just check`; `just store` zip under 2 MB (`ls -l`) and loads on a fresh profile; popup entry JS under 300 KB gzipped from the Vite build summary; `grep -L bip39 dist/popup.js` confirms the wordlist left the popup entry.
**Ask first.** Deleting or moving media files. `package.json`, `justfile`, `vite*.config.ts`, `manifest.json`, `.gitignore` edits. `AGENTS.md` and PR template edits. Any history rewrite (recommendation: none).
**Size.** Two days.

---

## Out of scope

- Hardware wallets, NFT transfers, swaps, staking, token approvals UI.
- Running a hosted RPC proxy (Cloudflare Worker with the Helius key). Documented as an option; it changes the privacy policy and adds operations.
- `solana:signIn` (SIWS). Needs `@solana/wallet-standard-util`; parked until SHIP-6 is stable.
- Localnet support through wallet-adapter.
- Independent security audit before recommending mainnet funds.
- Rewriting public git history.

## Risks

- **RPC defaults are third-party goodwill.** publicnode terms are AS IS with unpublished limits; rotation and a user-supplied endpoint are the mitigation. Say so in the README.
- **Vault v2 migration** touches every existing user's data. Migration runs only after a successful decrypt and writes the new blob before removing the old one; a unit test covers v1 → v2 and a re-unlock.
- **Parallel phases** share `protocol.ts` and `router.ts`. Rebase before review; the exhaustive switch in SHIP-8a captures the final shape once.
- **MAIN-world injection** raises `minimum_chrome_version` to 111 (March 2023). Acceptable for a demo; noted in the listing.
- **e2e stays on devnet.** Mainnet behaviour is verified manually with the store zip on a fresh profile at the end of SHIP-3, SHIP-7a, and SHIP-9.
- **PBKDF2 at 600k** makes unlock noticeably slower on low-end hardware; the ADR states the expected latency and the UI shows a spinner.

## Parking lot

- Priority fees and compute-budget instructions on popup sends.
- Address book and recent recipients.
- Ledger support via `@ledgerhq/hw-transport-webhid`.
- Light theme (settings field exists, nothing reads it).
- Solana Pay QR on the Receive screen.

## Appendix — finding to phase map

| Phase | Findings |
|---|---|
| SHIP-0 | leaked-helius-key, ci-red, pages-404, listing-doc-account-prereqs-and-category (account half), screenshots-devnet, listing-assets-promo-crop-icon-padding (promo half) |
| SHIP-1 | content-script-payload-type-override (new, critical), signandsend-signature-garbage, signandsend-returns-garbage-signature, preview-token-discriminators-inverted, tx-preview-token-discriminators-wrong, top-1-fix-shipped-bugs-in-headline-features, wallet-standard-version-field, injected-icon-invalid-hex, approval-preview-hard-fails-on-rpc-error |
| SHIP-2 | untyped-message-protocol (skeleton), sw-no-sender-privilege-check, bridge-untested (first tests) |
| SHIP-3 | mainnet-rpc-403, top-2 (endpoint half), remediation-3-publicnode-default, remediation-1-user-supplied-rpc-in-settings, remediation-2-cloudflare-worker-proxy (documented option), remediation-4-bundled-helius-key-rejected (guardrail), das-on-public-rpc, rpc-rotation-semantics-inconsistent, rpc-rotate-cooldown-on-application-errors, web3js-429-retry-console-error-and-latency, stale-module-load-connections-dead-code, helius-host-permissions-unused-in-store-build, testnet-host-unused |
| SHIP-4 | false-zero-balance-on-rpc-failure, no-rpc-error-states-zero-balance-on-failure, top-2 (UI half), coingecko-failure-zeroes-sol-balance, coingecko-failure-and-rate-limit-sleep-block-balances, history-and-nfts-swallow-errors-as-empty, react-query-no-stale-time-refetch-storm, token-metadata-missing, token-2022-unsupported (balances), console-error-coingecko, dead-network-and-rpc-code |
| SHIP-5 | get-accounts-leak, no-origin-trust, top-5-connected-sites-and-origin-binding, request-origin-trust, approval-timeout-desync, approval-lifecycle-leaks, approval-window-lifecycle-gaps, approval-store-rmw-race, approval-results-never-pruned, sign-while-locked-dead-end, connect-when-locked-throws, no-change-events-on-lock, keepalive-port, lumen-remnants, session-plaintext-fallback (approvals half), page-forgeable-replies (refuted; no action) |
| SHIP-6 | chains-mainnet-only, signandsend-options-ignored, sign-all-serializes-n-approval-windows, sign-message-signs-transactions, sign-message-no-transaction-guard, preview-no-balance-changes, top-8-approval-screen-as-a-trust-surface, preview-versioned-alt-and-blockhash, non-signer-tx-error-and-dead-fallback, injected-script-tag-async-race, provider-injection-via-script-tag, wallet-standard-surface-nits, localhost-content-script-in-store-build (refuted; keep for `just dapp`) |
| SHIP-7a | max-button-float-string-rejected, send-max-float-math-rejects-own-amount, top-7-send-path-integer-math-and-safety, spl-send-ata-idempotency-and-recipient-checks, send-confirmation-polling-ignores-blockhash-expiry, hardcoded-fee, token-2022-unsupported (send), send-flow-stale-zero-balance-and-raw-rpc-toast |
| SHIP-7b | seed-session-falls-back-to-local, session-storage-falls-back-to-local, session-seed-falls-back-to-local-storage, vault-format-unversioned, pbkdf2-100k, change-password-weaker-policy, change-password-leaves-legacy-vault, autolock-absolute-not-idle, seed-import-paste-not-normalized, seed-attestation-checkbox-fake, secrets-through-redux-and-keypair-remnants, popup-holds-mnemonic-claim, single-account-ui, top-9-multi-account-token-2022-and-metadata, keyring-zero-unit-tests |
| SHIP-8a | top-3-typed-message-protocol-and-ts-rigor, ui-slice-duplicates-worker-settings, top-4-respect-the-redux-vs-react-query-boundary, derived-state-in-effects, dead-code-and-vestigial-exports, dead-crypto-helpers-and-stale-constants, version-maintained-in-three-places (constants half) |
| SHIP-8b | bridge-untested, test-coverage-gaps-and-vacuous-tests, top-6-tests-that-exercise-the-wallet-not-just-helpers, modal-no-focus-management, no-release-process (changelog half) |
| SHIP-9 | media-bloat, popup-720p-video-decode-on-every-open, popup-loads-full-crypto-chunk-at-startup, accidental-chunk-layout, buffer-polyfill-ordering-in-worker, version-maintained-in-three-places (manifest half), build-pipeline-redundancies, store-recipe-leaves-mainnet-dist, war-assets-exposed, clipboardwrite-permission-unneeded, csp-default-only, icon-generic, listing-assets-promo-crop-icon-padding (icon half), listing-doc-account-prereqs-and-category, privacy-policy-omits-explorer-and-remote-media, privacy-practices-tab-financial-data (refuted; no action), readme-and-rules-claims-diverge-from-code, commit-hygiene-and-ai-scaffolding-front-and-center, top-10-repo-presentation-and-honesty, no-release-process |
| No action | just-check-green, localhost-matches-in-store-manifest |
