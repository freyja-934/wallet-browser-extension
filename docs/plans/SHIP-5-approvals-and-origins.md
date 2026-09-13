# SHIP-5 — Approval lifecycle, origin trust, and worker hardening

## Goal

Give the wallet a connected-origins model (sites must connect before they can see or sign for the account, and can be revoked), a real approval lifecycle (window close rejects, requests expire, lock clears them, one pending request per site), a locked-approval flow that unlocks inline, and a push channel so dApps learn about lock, disconnect, account and cluster changes. Remove the always-on keep-alive port and the last `lumen` names.

## Context

- `GET_ACCOUNTS` returns addresses to any page while unlocked; every `WALLET_CONNECT` prompts; `connect({ silent })` is ignored; signing requests from never-connected origins open approval windows.
- `approvals.ts` discards the `windows.create` result, never expires requests, persists results forever, does unlocked read-modify-write on session maps, and falls back to `chrome.storage.local` when `storage.session` is missing. Closing the approval window leaves the dApp polling for 120 s; approving after the dApp timed out still signs and broadcasts.
- Connect or sign while locked opens `index.html` and throws "Unlock and try again".
- `standard:events` never fires for lock, disconnect, account or cluster change; the only worker-to-page channel today is the keep-alive port that every https tab reconnects every second.
- Since SHIP-2 the worker dispatches through `src/background/router.ts` with `parseRequest` from `src/lib/protocol.ts`, the page allow-list in `src/lib/sender-gate.ts`, and unit tests on `src/test/chrome-stub.ts`. `chrome.windows.onRemoved` and `chrome.tabs.onRemoved` listeners exist with empty bodies.
- `chrome.tabs.sendMessage` needs no permission; tab ids are per-session, so the delivery registry lives in `chrome.storage.session`.

## Steps

1. Files: `src/lib/protocol.ts`, new `src/background/origins.ts`, new `src/background/origins.test.ts`, `src/background/router.ts`, `src/test/chrome-stub.ts`
   Protocol: `WALLET_CONNECT { silent?: boolean }`, new page-allowed `CANCEL_APPROVAL { id }`, new popup-only `GET_CONNECTED_SITES` and `REVOKE_SITE { origin }`; `SenderLike` gains `tab?: { id?: number }` and `frameId?`. `origins.ts`: `cinder_connected` in `chrome.storage.local` `{ [origin]: { connectedAt, accountIndexes } }` with `connect`, `isConnected`, `disconnect`, `list`, `clear`; a delivery registry `cinder_tabs` in `chrome.storage.session` mapping `${tabId}:${frameId}` to origin with `remember(sender, origin)`, `tabsFor(origin)`, `forget(tabId)`. Router: every dApp message from a tab calls `remember`; `WALLET_CONNECT` from a connected origin while unlocked returns `{ accounts }` with no window; `silent: true` from an unconnected origin returns `{ accounts: [] }`; `WALLET_DISCONNECT` calls `disconnect`; `GET_ACCOUNTS` and every `SIGN_*` throw `'Not connected'` unless the origin is connected; `fulfillApproval` for `connect` records the origin. Stub gains `tabs.sendMessage` recording and `windows.create` ids.
   Verify: `just test src/background/origins.test.ts src/background/router.test.ts`; `just check`.

2. Files: new `src/background/session-store.ts`, `src/background/approvals.ts`, new `src/background/approvals.test.ts`, `src/background/keyring.ts`
   `session-store.ts`: `sessionArea()` returns `chrome.storage.session` or throws `'Session storage unavailable'`; a per-key promise queue `withLock(key, fn)`. `approvals.ts` uses both: `PendingApproval` gains `windowId`; `enqueueApproval` rejects with `'A request is already pending for this site'` when the origin has one; `onWindowRemoved(windowId)` rejects only if still pending; `expirePending(now)` rejects requests older than 5 minutes; `getApprovalResult` deletes a result once delivered; `rejectAll(reason)` for lock and clear. `keyring.ts`: `sessionStore()` becomes `sessionArea()` (no local fallback); `lock()` calls `rejectAll('Wallet locked')` and an `onLocked` hook; `clearWallet()` also calls `origins.clear()`; `touchActivity()` re-arms the auto-lock alarm (called by the router on every extension-page message; idle semantics finished in SHIP-7b); rename `lumen_*` keys and `lumen-*` alarm names behind a one-time read-old-write-new migration.
   Verify: `just test src/background/approvals.test.ts`; `just check`; `just e2e e2e/dapp.spec.ts`.

3. Files: `src/background/service-worker.ts`, `src/background/router.ts`, `src/content/content-script.ts`, `src/content/injected.ts`, `src/lib/bridge.ts`
   Worker: `windows.onRemoved` → `onWindowRemoved`; `tabs.onRemoved` → `forget`; a 1-minute `chrome.alarms` sweep → `expirePending`; `sendWalletEvent(event, origin?)` sends `{ type: 'WALLET_EVENT', event, origin, accounts, cluster }` via `chrome.tabs.sendMessage` to the registry's tabs (all origins for lock and clear; one origin for disconnect and revoke) with `lastError` swallowed, and `chrome.runtime.sendMessage({ type: 'WALLET_EVENT', event: 'locked' })` for the popup. Emitted on lock, auto-lock, clear, `WALLET_DISCONNECT`, `REVOKE_SITE`, `SWITCH_ACCOUNT`, and `UPDATE_SETTINGS` that changes `cluster`. Remove the `lumen-keepalive` `onConnect` listener. Content script: remove `keepAlive()`; add `chrome.runtime.onMessage` that forwards `WALLET_EVENT` only when `msg.origin === window.location.origin`, posting `{ channel, event, accounts, cluster }` (no `id`, no `type`); `awaitApproval` sends `CANCEL_APPROVAL` on timeout. `bridge.ts`: `WALLET_CONNECT` accepts `silent: boolean`. Injected: `connect(input)` forwards `silent`; handle the event message by rebuilding `accounts` and emitting `change`; keep the existing reply filters intact.
   Verify: `just check`; `just e2e e2e/dapp.spec.ts`; manual: lock the wallet and confirm the test dApp's log shows an empty account list.

4. Files: new `src/components/wallet/UnlockForm.tsx`, `src/components/wallet/UnlockScreen.tsx`, `src/components/transactions/ApprovalScreen.tsx`, `src/popup/App.tsx`
   `UnlockForm({ onUnlocked })` is presentational, calls `extensionClient.unlock` directly, keeps the `unlock-password` / `unlock-submit` test ids. `UnlockScreen` renders it and calls `initializeWallet()` on success. `ApprovalScreen` fetches `GET_STATE`; while `isLocked` it renders `UnlockForm` above the request summary and continues to the normal approval view after unlock (the preview runs then). The router no longer opens `index.html` for locked connect or sign; it enqueues the approval so `approve.html` opens. `App.tsx` listens for the `locked` event via `chrome.runtime.onMessage` and re-runs `initializeWallet()`.
   Verify: `just check`; `just e2e e2e/dapp.spec.ts e2e/wallet.spec.ts` (update the locked-connect test to unlock inside `approve.html`).

5. Files: `src/messaging/client.ts`, new `src/components/settings/ConnectedSites.tsx`, `src/components/settings/Settings.tsx`, `e2e/dapp.spec.ts`, `examples/test-dapp/main.js`
   Client: `getConnectedSites`, `revokeSite`, `cancelApproval`. Settings gains a "Connected sites" card listing origin, connected time, and Revoke. Test dApp subscribes to `standard:events` `change` and logs the account list. e2e adds: closing the approval window rejects the dApp request within 2 s; a second `connect` after approval returns without a window; `connect({ silent: true })` before any approval returns no accounts and opens no window; revoking in Settings makes the next connect prompt again; a `signMessage` from a never-connected origin is rejected with `Not connected`; lock empties the dApp's logged accounts.
   Verify: `just check`; full `just e2e`.

## Out of scope

- Per-account chains and the `chain` argument (SHIP-6).
- Idle-based auto-lock re-arm semantics and the popup's own lock detection polish (SHIP-7b).
- MAIN-world injection (SHIP-6).

## Risks

- Removing the keep-alive port changes worker lifetime; every dApp message and poll wakes the worker, and pending approvals live in `storage.session`, so a restart mid-approval is survivable. The e2e covers the approval round trip.
- Requiring a connected origin for `SIGN_*` is a behaviour change for pages that signed without connecting; Wallet Standard requires connect first.
- `storage.session` access from the popup requires `chrome.storage.session.setAccessLevel` only for content scripts; the popup and worker are trusted contexts, so no change.
- Event delivery is best effort: a tab whose content script is gone simply drops the message.

## Deviations

Review outcomes (applied after the five steps landed):

1. **Approve claims before it fulfils.** `approvals.ts` gained a third map, `cinder_inflight`: `APPROVE_REQUEST` checks the wallet is unlocked, `claimApproval`s the request under the lock (refusing anything not pending, past `createdAt + PAGE_TIMEOUT_MS`, older than the TTL, or — for sign kinds — from an origin no longer connected), fulfils it, then `settleClaimed`s the real result; a fulfilment failure settles it as rejected so it can never be approved again. Every other settler (`rejectApproval`, `cancelApproval`, `onWindowRemoved`, `onTabRemoved`, `rejectForOrigin`, `expirePending`, `rejectAll`) ignores inflight ids, so a cancel, window close or lock that races a broadcast no longer turns it into a `rejected` the page retries. Router tests hold `sendRawTransaction` open to prove each race.
2. **The content script gives up strictly before the page.** `PAGE_TIMEOUT_MS` (120 s) is exported from `lib/messages.ts` and used by the injected script; the poll loop moved to `lib/approval-poll.ts` with an injected `send` and clock, runs on a wall-clock deadline of `PAGE_TIMEOUT_MS - 10 s` (not a poll count), sends `CANCEL_APPROVAL` when it passes, then throws `Request timeout`. `PendingApproval.deadline` is stamped at enqueue and `claimApproval` refuses after it, so even a stuck content script cannot leave a late Approve valid. The e2e cannot wait 110 s; `approval-poll.test.ts` drives the loop with a fake clock instead.
3. **Disconnect and revoke reject what the site had pending** (`rejectForOrigin`: `Disconnected` / `Site revoked`), and the claim re-checks `origins.isConnected` for sign kinds.
4. **Closing the tab cancels.** `PendingApproval` carries `tabId` / `frameId` from the sender; `tabs.onRemoved` settles that tab's requests as `Page closed` and closes their windows (`installApprovalLifecycle` in `approvals.ts` registers both browser listeners). The content script also sends `CANCEL_APPROVAL` for every in-flight id on `pagehide` (navigation as well as close), and a page cancel closes the window too.
5. **Origin validation.** Page senders must present `sender.origin` as a bare `http:`/`https:` origin (`new URL(origin).origin === origin`); `"null"`, `''`, a URL with a path, `file:` and other extensions throw `Untrusted sender` before `remember` or `enqueueApproval`. Only when the browser gives no `origin` at all does `sender.url` stand in, reduced to its origin, so `/app` and `/other` share one grant (`pageOrigin` in `sender-gate.ts`).
6. **Migration keeps the auto-lock deadline**: `ensureMigrated` reads `lumen-autolock` with `chrome.alarms.get`, clears it, and re-creates `cinder-autolock` at the same `scheduledTime` without calling `scheduleAutoLock` (re-entrancy).
7. **Tests that would fail**: the origins lock test now asserts two concurrent connects both survive and a concurrent connect + disconnect leaves the origin absent (verified to fail with `withLock` as a passthrough); router tests cover auto-lock re-arming on popup but not page messages, and a connected origin while locked (plain connect prompts, silent returns no accounts and no window).
8. **Defence in depth**: results keep their `origin`; `POLL_APPROVAL` and `CANCEL_APPROVAL` from a page must match the pending, inflight or settled record's origin or throw `Approval expired`.
9. **Results TTL**: results carry `settledAt`; the sweep drops any older than `APPROVAL_TTL_MS` that nobody polled.
10. **Polish**: the sweep alarm is created only when `chrome.alarms.get` finds none; `ApprovalScreen` listens for the `locked` event, shows the unlock form again, and after unlock re-fetches the request so a settled one renders as expired with Approve disabled; keyring `unlock` runs an `onUnlocked` hook that sends `WALLET_EVENT unlocked` to extension pages only, which `App.tsx` handles by re-running `initializeWallet()`; `WALLET_DISCONNECT` excludes the asking frame from the `disconnected` push so the page emits `change` once.

## Parking lot

- Connection grants are not cluster-scoped: a site connected on devnet is connected on mainnet too. SHIP-6 (per-account chains) to decide whether a grant records the cluster it was given on.
- `standard:events` `change` for `chains` once SHIP-6 lands.
- Approval window position and size per screen.
