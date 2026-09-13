# SHIP-14 — Bind a signature to the account that was asked for

## Goal

A signature request names an account. Cinder currently validates that name and then
throws it away, signing with whatever account happens to be active. Make the account
the request names the account whose key signs, make the approval window say which
account that is, and make a request the wallet cannot honour fail rather than sign
with the wrong key.

## Context

Found by the pre-submission audit on 2026-09-13. Four independent lenses (security,
chain correctness, Wallet Standard, engineering judgment) converged on the same
defect from different directions, which is why it is worth a phase of its own.

The chain of evidence, all verified by reading the code:

- `checkInputs` (`src/content/injected.ts:190-201`) requires `input.account.address`
  to be one of the wallet's own, then discards it. The payload sent for a message is
  `{ messages }` only (`injected.ts:322`).
- The protocol has nowhere to put it: `{ type: 'SIGN_MESSAGE'; messages: number[][] }`
  (`src/lib/protocol.ts:46`).
- `PendingApproval` (`src/lib/messages.ts`) records `chain` and `clusterAtEnqueue` but
  no account.
- `fulfillApproval` signs with no index: `signMessage(Uint8Array.from(message))`
  (`src/background/router.ts:358`), and `getKeypair` falls back to
  `session.activeAccountIndex` (`src/background/keyring.ts:480-484`).
- The approval window names an account only on connect (`ApprovalScreen.tsx:243-258`);
  a signMessage or signTransaction approval shows Origin, Type and Chain and no address.

Two consequences, both real:

1. **Wrong signer, silently.** Connect hands the site every account, so a dApp may
   legitimately ask `accounts[1]` to sign a login challenge. It gets back a signature
   made by `accounts[0]`, with no error. This is a Wallet Standard conformance bug:
   the `account` input is what selects the signer.
2. **The screen is not what gets signed.** Nothing pins a pending approval to an
   account, so switching accounts in the popup between the approval rendering and the
   user pressing Approve changes the key that signs. The preview, the balance diff and
   the `signerOk` check were all computed for the other account.

The fix follows a pattern this codebase already has and tests: `clusterAtEnqueue` on
`PendingApproval`, the `onCluster` predicate, and `rejectForClusterChange`
(`src/background/approvals.ts:317-330`). Account binding is the same shape.

Note for the implementer: `getKeypair(accountIndex?)` and `signMessage(bytes, accountIndex?)`
already take an index. The gap is everything upstream of them.

## Steps

1. **Carry the account through the protocol.**
   Files: `src/lib/protocol.ts`, `src/lib/bridge.ts`, `src/content/injected.ts`.
   Add an optional `account?: string` (a base58 address) to `SIGN_MESSAGE`,
   `SIGN_TRANSACTION` and `SIGN_AND_SEND_TRANSACTION`. Validate it in `parseRequest`
   with the existing base58 address validator; reject a malformed one. `buildRuntimeMessage`
   must copy it like any other accepted field and nothing else — the field is
   page-controlled, so it is a name to resolve, never an index to trust.
   `checkInputs` should return the single account address the inputs agree on and
   throw if they disagree, the way it already does for `chain`. Send that address.
   Verify: `just check`

2. **Resolve it to an account, once, at enqueue.**
   Files: `src/background/router.ts`, `src/lib/messages.ts`.
   Resolve the address to a derivation index against the wallet's own accounts when
   the request is enqueued. An address this wallet does not hold is refused there and
   then, with a message naming the problem. When the request names no account, fall
   back to the active index and record that. Store the resolved index on
   `PendingApproval` as `accountAtEnqueue`, beside `clusterAtEnqueue`.
   Verify: `just check`

3. **Sign with the account the approval was built for.**
   Files: `src/background/router.ts`.
   `fulfillApproval` passes `request.accountAtEnqueue` to `signMessage` and to the
   transaction signing path. Build the preview for that same account, so `signerOk`
   and the balance diff describe the key that will actually sign.
   Verify: `just check`

4. **Reject pending signature approvals when the active account changes.**
   Files: `src/background/approvals.ts`, `src/background/router.ts`.
   Mirror `rejectForClusterChange`: an `onAccount` predicate and a
   `rejectForAccountChange(index)` that rejects pending requests pinned to a different
   account, called from `SWITCH_ACCOUNT`. A rejected request must give the page the
   same shaped error the cluster path gives. Do not reject connect approvals.
   Verify: `just check`

5. **Name the signing account on every signature approval.**
   Files: `src/components/transactions/ApprovalScreen.tsx`.
   Move the account row out of the `isConnect` branch into the shared request card so
   signMessage, signTransaction and signAndSendTransaction all show the name and
   address of the key about to sign. The data is already loaded. Keep the connect
   screen's existing wording.
   Verify: `just check`

6. **Tests.**
   Files: `src/background/router.test.ts`, `src/background/approvals.test.ts`,
   `src/lib/protocol.test.ts`, `src/content/injected.test.ts`, `e2e/dapp.spec.ts`.
   Cover, at least: a message signed for a named non-active account is signed by that
   account's key and not the active one; a request naming an address the wallet does
   not hold is refused; switching accounts rejects a pending signature approval;
   inputs naming two different accounts are refused; and the approval window shows the
   signing address. The e2e case must not need funds — a signMessage is free.
   Verify: `just check`, then `just e2e`

## Out of scope

- **The all-accounts connect model.** Connect discloses every account, including ones
  created later, and the stored per-origin `accountIndexes` is never read. That is a
  permission-model decision for the owner, not a bug fix, and it is recorded as a
  known limitation instead. Do not change what connect shares.
- Per-account approval scoping, account-picker UI in the approval window, and any
  change to how `addressesActiveFirst` orders accounts.
- Hardware wallets, and anything about the send path in the popup, which already signs
  with the active account by construction.

## Risks

- This is the signing path. A mistake signs the wrong thing or refuses a legitimate
  request. Every change must be covered by a test that would fail without it.
- The page controls the account name. Resolving it to an index must happen against the
  wallet's own account list in the worker; never let a page-supplied number reach
  `getKeypair`.
- A dApp that today passes `accounts[1]` and quietly receives `accounts[0]`'s signature
  will start getting a signature from `accounts[1]`. That is the point, but it is a
  behaviour change at the dApp surface and belongs in the CHANGELOG.

## Parking lot

- Rendering `accountIndexes` in Connected Sites, or deleting the field.
- An account picker inside the approval window, so the user can redirect a signature
  without going back to the popup.
