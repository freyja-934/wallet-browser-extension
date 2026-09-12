# SHIP-2 — Foundations: router, typed protocol, chrome stub, settings hook

## Goal

Land the three seams every later phase needs once: a worker router that can be imported by tests, a typed request/response protocol validated at the worker boundary with the sender gate next to it, an in-memory `chrome` stub for unit tests, and a React Query settings hook for the popup.

## Context

- `src/background/service-worker.ts` registers listeners at import and exports nothing, so `handleMessage` cannot be unit-tested. `handleMessage(type, request, origin)` coerces every field with `String()` / `Number()` / `as number[]`.
- `src/messaging/client.ts` is `send(type, payload)` returning an index-signature `Envelope` with a cast per method.
- The sender gate landed in SHIP-1 as `src/lib/sender-gate.ts` and is applied in the listener; it stays the security boundary and moves to the router entry.
- The popup reads `cluster` / `hideSmallBalances` from Redux, hydrated in `App.tsx` and `Settings.tsx` after `extensionClient.getSettings()`. SHIP-3 needs `rpcUrl` / `heliusApiKey` in React without adding them to Redux (`.claude/rules/popup-ui.md`).
- `vite.config.ts` test environment is `node`; there is no `src/test/` and no `chrome` global in tests. Do not edit `vite.config.ts`; tests install the stub explicitly.

## Steps

1. Files: new `src/background/router.ts`, `src/background/service-worker.ts`, `src/lib/sender-gate.ts`
   Move `handleMessage`, `fulfillApproval`, `signTransactionBytes`, and `previewTransaction` verbatim into `router.ts`, exported as `handleMessage(raw: unknown, sender: SenderLike, extensionBase: string): Promise<Record<string, unknown>>` which applies `isRequestAllowed` first (throw `'Not allowed from a page'`), derives `origin` from `sender.origin || sender.url || ''`, then dispatches. `service-worker.ts` keeps the polyfill import, `registerAutoLock()`, the `onConnect` keepalive (removed in SHIP-5), and an `onMessage` listener that only calls the router and maps the promise to `sendResponse`. Register `chrome.windows.onRemoved` and `chrome.tabs.onRemoved` listeners synchronously at module top with empty bodies and a comment pointing at SHIP-5.
   Verify: `just check`; `just e2e e2e/dapp.spec.ts`.

2. Files: new `src/lib/protocol.ts`, new `src/lib/protocol.test.ts`, `src/messaging/client.ts`, `src/background/router.ts`
   `protocol.ts`: a discriminated union `WalletRequest` with one member per `EXTENSION_MESSAGE_TYPES` entry carrying exactly the fields the worker reads today (`UNLOCK { password }`, `CREATE_WALLET { password, seedPhrase? }`, `SWITCH_ACCOUNT { index }`, `CHANGE_PASSWORD { currentPassword, newPassword }`, `EXPORT_SEED { password }`, `EXPORT_PRIVATE_KEY { password, accountIndex? }`, `UPDATE_SETTINGS { settings }`, `SIGN_TRANSACTION | SIGN_AND_SEND_TRANSACTION | PREVIEW_TRANSACTION { transaction }`, `SIGN_MESSAGE { message }`, `GET_PENDING_REQUEST | POLL_APPROVAL | APPROVE_REQUEST { id }`, `REJECT_REQUEST { id, reason? }`, `SEND_TRANSFER { to, amountSmallest, mint? }`, the rest payload-less); a `WalletResponses` map from type to response shape; `parseRequest(input: unknown): WalletRequest` with hand-written validators (no dependency) that throw `'Unknown message type'` or `'Invalid <field>'`; byte arrays reuse the validator from `bridge.ts` (export it). `router.ts` calls `parseRequest` after the gate and switches on the union with an exhaustive `never` default; drop every `String()` / `Number()` / `as` coercion. `client.ts` types each method through `WalletResponses`.
   Verify: `just check`; `protocol.test.ts` covers one valid and one malformed payload per type, plus unknown type.

3. Files: new `src/test/chrome-stub.ts`, new `src/background/router.test.ts`
   `installChromeStub()` returns and installs an in-memory `chrome` with `storage.local` / `storage.session` (`get`/`set`/`remove`/`clear`, `onChanged` listeners), `alarms` (`create`/`clear`/`onAlarm`), `windows` (`create` resolving `{ id }`, `onRemoved`), `tabs` (`sendMessage`, `onRemoved`), and `runtime` (`id`, `getURL`, `onMessage`, `onConnect`, `sendMessage`, `lastError`); a `reset()` helper. `router.test.ts` (node environment, installs the stub in `beforeEach`): tab sender + `EXPORT_SEED` rejects `'Not allowed from a page'`; extension sender + `GET_STATE` returns `hasVault: false`; `CREATE_WALLET` then `GET_STATE` shows an unlocked account with the fixture address from `docs/test-wallet.md`; `SIGN_MESSAGE` from a page while locked queues an approval, opens `approve.html`, and `APPROVE_REQUEST` on it throws `'Wallet is locked'` (only `WALLET_CONNECT` short-circuits to the unlock window); `WALLET_CONNECT` records the approval with `origin` equal to `sender.origin` even when the payload carries `origin`; malformed `transaction` rejects `'Invalid transaction'`.
   Verify: `just test src/background/router.test.ts`; `just check`.

4. Files: new `src/hooks/useSettings.ts`, `src/components/settings/Settings.tsx`, `src/components/shell/AppShell.tsx`, `src/popup/App.tsx`
   `useSettings()` is `useQuery({ queryKey: ['settings'], queryFn: extensionClient.getSettings, staleTime: Infinity })`; `useUpdateSettings()` is a mutation calling `extensionClient.updateSettings` that writes the result with `setQueryData` and mirrors `cluster` / `hideSmallBalances` into Redux for the consumers that still read it. `Settings.tsx` reads auto-lock, cluster, and hide-small from the hook and updates through the mutation. `AppShell.tsx` pill reads `cluster` from the hook (fallback to Redux while loading). `App.tsx` keeps hydrating Redux on init.
   Verify: `just check`; `just e2e e2e/settings.spec.ts e2e/dashboard.spec.ts`.

## Out of scope

- Turning on `no-explicit-any` and deleting the Redux settings mirror (SHIP-8a).
- Connected origins, approval lifecycle, events (SHIP-5).
- New message types; this phase types what exists.

## Risks

- Relocating the handlers must not change behaviour; the dApp and settings e2e are the gate.
- `parseRequest` must accept exactly what the popup sends today (numbers for `index` / `accountIndex` / `autoLockTimeout`, partial settings objects); the client tests catch drift.
- `router.ts` imports `keyring.ts`, `approvals.ts`, `transfers.ts`, which touch `chrome.*` at call time only, so the stub is enough; if any touches `chrome` at import, hoist behind a function.

## Parking lot

- Zod-style schema derivation once a dependency is allowed.
- Locked-sign flow (route a locked `SIGN_*` request to the unlock window instead of an approval that cannot be fulfilled) is SHIP-5 scope.
