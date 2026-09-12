# SHIP-3 — RPC configuration and endpoints

## Goal

Make the endpoint list settings-driven, ship a browser-permissive mainnet default so the store zip loads a SOL balance with no key, let a user paste their own RPC URL or Helius key, and fix the rotation semantics that currently cool down the good endpoint.

## Context

- `api.mainnet-beta.solana.com` returns 403 to any request with an `Origin` header; the store build's only mainnet URL is that host (`src/config/constants.ts` `PUBLIC_SOLANA_RPC`, `rpcUrlsFor()`). `https://solana-rpc.publicnode.com` accepts browser origins (200, `access-control-allow-origin: *`, preflight allows `content-type,solana-client`) but has no DAS and refuses `getTokenAccountsByOwner`. Public devnet serves DAS.
- `src/lib/rpc-rotate.ts` `rpcJson` throws immediately on 403 and marks a host unhealthy for 30 s on any JSON-RPC error, including `-32601`; `das: true` filters to Helius URLs only. `withRotatedConnection` / `readyConnection` derive URLs from the compile-time list.
- `src/services/helius.ts` `getTokenBalances` runs `getBalance` and `getParsedTokenAccountsByOwner` in one `Promise.all` inside the rotation loop, so a blocked token call discards the SOL balance. `HeliusService` and `WalletService` build a `Connection` at module load from the compile-time URL and carry dead methods.
- Settings live in `chrome.storage.local` via `keyring.ts` (`WalletSettings` in `src/lib/messages.ts`, validated by `parseRequest` since SHIP-2); the popup reads them through `useSettings` (SHIP-2).
- Custom RPC hosts outside `host_permissions` are fetched as plain CORS requests; providers that send `Access-Control-Allow-Origin` work, CORS-less hosts do not. `optional_host_permissions` plus `chrome.permissions.request` in the click handler covers the rest.

## Steps

1. Files: `src/lib/messages.ts`, `src/lib/protocol.ts`, `src/config/constants.ts`, `src/lib/rpc-rotate.ts`, `src/lib/rpc-rotate.test.ts`
   `WalletSettings` gains `rpcUrl?: string` and `heliusApiKey?: string`; `parseRequest` for `UPDATE_SETTINGS` accepts them (https URL or empty; key up to 64 chars or empty). `constants.ts`: `PUBLIC_MAINNET_RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com']`, `PUBLIC_DEVNET_RPCS = ['https://api.devnet.solana.com']`, `heliusRpcUrlFor(cluster, key)`, and pure `rpcUrlsFor(cluster, settings)` returning `[custom?, helius?, ...public]` with duplicates removed; keep `getCluster()` for the build default; delete `NETWORKS`, `HELIUS_RPC_URL`, `getRpcUrl`, `rpcUrlFor`, `getHeliusApiKey` (build-time key becomes the default for `heliusApiKey` when settings have none). `rpc-rotate.ts` functions take `urls: string[]` instead of a cluster; `rpcJson`: HTTP 401/403 and JSON-RPC `-32601` skip to the next URL for this call without `markRpcUnhealthy`; 408/429/5xx and transport errors mark unhealthy; `das` option removed (DAS is just a method); `Connection` instances use `{ commitment: 'confirmed', disableRetryOnRateLimit: true }`. Before writing `shouldRotate`, probe `https://solana-rpc.publicnode.com` with `curl` for `getTokenAccountsByOwner` (jsonParsed, owner = fixture address) and `getAssetsByOwner`, record the exact HTTP status and JSON-RPC code in the test file as fixtures, and rotate on those codes as well. Tests: URL ordering for every settings combination; `-32601` on URL A leaves A healthy for the next call; 403 skips without cooldown; 429 cools down.
   Verify: `just test src/lib/rpc-rotate.test.ts`; `just check`.

2. Files: `src/lib/runtime-rpc.ts`, `src/background/keyring.ts`, `src/background/transfers.ts`, `src/services/helius.ts`, `src/services/wallet.ts`
   `runtime-rpc.ts`: `runtimeSettings()` and `runtimeRpcUrls()` = `rpcUrlsFor(settings.cluster, settings)` (popup side, via `extensionClient`). `keyring.ts` `updateSettings` normalises (`trim`, empty string → `undefined`) and rejects non-https URLs. `transfers.ts` `getConnection()` = `readyConnection(rpcUrlsFor(settings.cluster, settings))` using the worker-side `getSettings()`. `helius.ts`: delete the constructor `Connection`, `apiKey` field, `getAssetProof`, `getConnection`, `getCurrentSlot`, `getRecentBlockhash`, `sendTransaction`, `simulateTransaction`; `getTokenBalances` issues `getBalance` and the token-account call as two independent `withRotatedConnection` calls and returns `{ nativeBalance, lamports: string, tokens, tokensError?: string }` (a failed token call never discards the SOL balance); DAS calls go through `rpcJson(urls, 'getAssetsByOwner', ...)` on every URL and a `-32601`/blocked response on all of them resolves to no metadata rather than an error; the enhanced-history path uses `settings.heliusApiKey` at call time. `wallet.ts`: delete the `Connection` field and `getConnection`; pass `lamports` and `tokensError` through.
   Verify: `just check`; `just e2e e2e/dashboard.spec.ts e2e/dapp.spec.ts`.

3. Files: `src/components/settings/Settings.tsx`, `src/components/shell/AppShell.tsx`, `src/hooks/useSettings.ts`, `manifest.json`
   Settings gains an "RPC" card: custom RPC URL field, Helius API key field (masked, "stored on this device only"), Save and Clear. Save handler (a click, so a user gesture): call `chrome.permissions.request({ origins: [new URL(url).origin + '/*'] })` synchronously before any `await`; then probe `getHealth` with `fetch` from the popup; on failure call `chrome.permissions.remove` for that origin, toast the error, and do not save; on success `useUpdateSettings`. Invalidate wallet queries after save. `AppShell` pill gets `title={primary host}`. `manifest.json`: `host_permissions` adds `https://solana-rpc.publicnode.com/*` and drops `https://api.testnet.solana.com/*`; add `optional_host_permissions: ["https://*/*"]`; add `"permissions": [..., "storage", "alarms", "clipboardWrite"]` unchanged.
   Verify: `just check`; `just e2e e2e/settings.spec.ts` (extend it: enter an invalid URL and see the error; enter `https://api.devnet.solana.com` and see it saved).

4. Files: `justfile`, `README.md`, `docs/store/listing.md`, `e2e/rpc.spec.ts` (new)
   `store` recipe fails before zipping if `grep -rEq 'api-key=[0-9a-f]{8}-[0-9a-f]{4}-' dist/` matches (a real key literal; the bare template string is always present) or if `dist/manifest.json` lacks `solana-rpc.publicnode.com`. README "RPC" paragraph rewritten: keyless mainnet shows and sends SOL via publicnode; tokens and NFTs need a custom RPC or Helius key entered in Settings; rotation rules; publicnode terms are AS IS. `listing.md` permission justifications updated for publicnode and the optional host permission. `e2e/rpc.spec.ts`: from the popup page, `fetch` `getHealth` against `https://solana-rpc.publicnode.com` and assert HTTP 200 (proves the extension origin can reach the default mainnet endpoint), and assert `rpcUrlsFor`-driven ordering via a `GET_SETTINGS` round-trip.
   Verify: `just check`; `just store` (with `VITE_HELIUS_API_KEY=deadbeef-dead-beef` exported in the shell the recipe must fail; without it, succeed); `just e2e`.

## Out of scope

- Error and empty states in the UI, token metadata fallback, Token-2022 (SHIP-4).
- A hosted proxy.

## Risks

- publicnode terms are AS IS with unpublished limits; `api.mainnet-beta` stays as a fallback and the user can add their own endpoint.
- The `permissions.request` call must be the first statement in the click handler; an `await` before it makes Chrome reject the request for lack of a user gesture.
- The rotation codes are taken from web3.js's `SolanaJSONRPCErrorCode` plus a message heuristic because publicnode was unreachable from the implementation network (ISP filter); verification against publicnode from another network is pending (`E2E_LIVE_MAINNET=1 just e2e e2e/rpc.spec.ts`).
- Query keys still use `cluster` only until SHIP-4; switching RPC while cached data exists shows stale data until refetch, so Save invalidates the wallet queries.

## Parking lot

- Per-endpoint health indicator in Settings.
