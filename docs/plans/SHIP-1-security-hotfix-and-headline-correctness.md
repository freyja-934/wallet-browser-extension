# SHIP-1 — Security hotfix and headline correctness

## Goal

Close the live bridge vulnerability and fix the four one-file bugs in the features the README leads with, each with a test that fails on the old code. Ships as one PR from `freyja-934/ship-1-security-hotfix`.

## Context

- `src/content/content-script.ts` used to build the worker message as `{ type, ...payload, origin }`, so any page could override `type` and reach popup-only handlers. Step 1 is done on this branch: `src/lib/bridge.ts` copies only the fields each dApp type accepts, the worker rejects non-dApp types from non-extension senders and reads origin from `sender.origin`, and `e2e/dapp.spec.ts` has a regression test that fails on the old `dist/`.
- `fulfillApproval` returns the base58 signature string; `injected.ts` runs `Uint8Array.from` on it, producing an 88-element array of digits and zeros. wallet-adapter `bs58.encode`s that and confirms a signature that does not exist.
- `src/lib/tx-preview.ts` labels Token index 4 (Approve) as "Transfer tokens" and 3 (Transfer) as "Approve delegate"; System index 3 is CreateWithSeed, not Assign. System encodes its index as u32 LE, Token as u8.
- `injected.ts` sets `version` to the app version with a cast; `@wallet-standard/base` requires the literal `'1.0.0'`. The icon is a Solana-brand gradient with an invalid hex colour.
- `previewTransaction` awaits `getConnection()` outside its `try`, so an RPC failure rejects the whole preview; `ApprovalScreen` enables Approve before the preview settles. A v0 message with lookup-table indexes makes `decodeInstruction` throw.
- The devnet fixture must hold SOL for the `signAndSend` e2e (SHIP-0 item 10).

## Steps

1. [x] Files: `src/lib/bridge.ts`, `src/lib/bridge.test.ts`, `src/content/content-script.ts`, `src/background/service-worker.ts`, `e2e/dapp.spec.ts`
   Bridge builds the worker message from explicit fields; worker allow-lists page senders to `DAPP_MESSAGE_TYPES` + `POLL_APPROVAL` and ignores payload `origin`.
   Verify: `just check` (34 tests); new e2e fails on old `dist/`, passes on new. Done.

2. Files: `src/background/service-worker.ts`, `examples/test-dapp/main.js`, `e2e/dapp.spec.ts`
   `fulfillApproval` returns `signature: [...bs58.decode(signature)]` (64 bytes; `bs58` is already a dependency). The test dApp logs `signatureLength`, the base58 form (`bs58` import), and polls `getSignatureStatuses` for up to 30 s, logging `confirmed: true|false`. The e2e asserts `"signatureLength": 64` and `"confirmed": true`.
   Verify: `just check`; `just e2e e2e/dapp.spec.ts` with a funded fixture.

3. Files: `src/lib/tx-preview.ts`, `src/lib/tx-preview.test.ts`
   System: `index = data.readUInt32LE(0)` → `1` Assign (warn), `2` Transfer SOL, `3` CreateWithSeed, `10` AssignWithSeed (warn). Token and Token-2022: `index = data[0]` → `3` Transfer, `4` Approve (warn), `5` Revoke, `6` SetAuthority (warn), `7` MintTo, `8` Burn, `9` CloseAccount (warn), `10` FreezeAccount (warn), `12` TransferChecked, `13` ApproveChecked (warn), `14` MintToChecked, `15` BurnChecked. Guard `ix.data.length` before reading. `TransactionMessageCompat` returns `label: 'Unreadable instruction'` with a danger warning when an account index exceeds `staticAccountKeys` instead of building an undefined key. Tests build every instruction above with the `@solana/spl-token` and `SystemProgram` builders and assert label plus warning presence; add a v0 message whose index exceeds the static keys; delete the vacuous "builds a legacy transaction" test.
   Verify: `just test src/lib/tx-preview.test.ts`; `just check`.

4. Files: `src/content/injected.ts`, new `src/config/brand.ts`, new `src/config/brand.test.ts`
   `brand.ts` (no React imports) exports `CINDER_MARK_SVG` (32×32 rounded square with the glow gradient in valid 6-digit hex) and `CINDER_ICON_DATA_URI = 'data:image/svg+xml;base64,' + btoa(...)`. `injected.ts` uses `version: '1.0.0'` without a cast and `icon: CINDER_ICON_DATA_URI`. Test decodes the data URI, parses it as XML, and asserts every `#` colour is 3 or 6 hex digits.
   Verify: `just check`; `just ext`; in `just dapp`, `wallet.version === '1.0.0'` and the icon renders in the wallet-adapter modal.

5. Files: `src/background/service-worker.ts`, `src/components/transactions/ApprovalScreen.tsx`
   `previewTransaction` decodes inside its own `try` (unreadable bytes return `success: false`, `error: 'Could not decode transaction'`, empty instructions, one danger warning), then moves `getConnection()` inside the simulation `try` so RPC failure returns the decode-only preview with `error: 'No RPC endpoint'`. `ApprovalScreen` tracks `previewSettled` and keeps Approve disabled for requests with `transactionBytes` until it is true.
   Verify: `just check`; `just e2e e2e/dapp.spec.ts` (the harness already waits for Approve to become enabled).

## Out of scope

- The sender allow-list moving next to `parseRequest` (SHIP-2).
- Address-lookup-table resolution and balance diff (SHIP-6).
- Connected-origins gating of `GET_ACCOUNTS` (SHIP-5).

## Risks

- Step 2 changes the wire shape of `signAndSend` results (`number[]` instead of string). Nothing else reads it; `approvals.ts` stores the value verbatim.
- Step 3 is a behaviour change for the preview warnings; the e2e only checks that a preview renders, so the unit tests are the gate.
- Step 5 keeps the existing e2e wait on `approval-approve` being enabled; if the preview never settles the test times out rather than approving blind, which is the intended failure mode.

## Parking lot

- A dApp-side `confirmTransaction` helper in the test dApp for the SHIP-6 balance-diff check.
