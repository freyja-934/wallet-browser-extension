# SHIP-6 — Wallet Standard surface and transaction preview

## Goal

Make the wallet correct for wallet-adapter dApps on both clusters (per-account chains, the `chain` argument, send options, one approval per batched call), refuse to sign transaction bytes as a message, and turn the approval window into a trust surface with a balance-change diff computed from a simulation with resolved lookup tables. Inject the provider as a MAIN-world content script.

## Context

- `injected.ts` advertises `solana:mainnet` only; wallet-adapter's `sendTransaction` throws when the account's `chains` lack the endpoint chain, so devnet dApps cannot send. `signTransaction(...inputs)`, `signAndSendTransaction(...inputs)`, and `signMessage(...inputs)` loop one approval window per input; `options` is dropped; the base58 decoder is hand-rolled.
- `signMessage` signs arbitrary bytes; a serialized transaction message signed this way is a valid transaction signature.
- The preview decodes through `staticAccountKeys` only (lookup-table indexes decode as "Unreadable instruction" since SHIP-1), simulates without `replaceRecentBlockhash`, shows program names and pass/fail but no amounts, and the `Transaction.from` fallbacks are dead because `VersionedTransaction.deserialize` accepts legacy bytes. Simulation with `accounts` returns post-state only; pre-state needs `getMultipleAccountsInfo`. The RPC rejects `sigVerify: true` together with `replaceRecentBlockhash: true`. Legacy `Message.getAccountKeys()` takes no arguments; only `MessageV0.getAccountKeys({ addressLookupTableAccounts })` resolves tables.
- Since SHIP-5: `WALLET_CONNECT` returns `{ accounts, cluster }`; `src/background/events.ts` pushes `locked` / `cleared` / `disconnected` / `revoked` / `accountsChanged` / `clusterChanged` with `{ accounts, cluster }` to connected tabs and the injected wallet exposes a `cluster` getter and rebuilds accounts on those events; approvals are claimed atomically before fulfilment (`claimApproval` / inflight state), carry `windowId`, `tabId`, `deadline`, and are rejected on window close, tab close, disconnect, revoke, lock, expiry, or the page's cancel. Batch approvals in this phase must go through the same claim and settle path. Since SHIP-3, connections come from `rpcUrlsFor(settings)`.
- Connection grants are not cluster-scoped (a site connected on devnet stays connected on mainnet, as in Phantom); this phase makes the accounts advertise the active cluster's chain and re-stamps them on `clusterChanged`, and the Connected sites card is unchanged.
- Static `content_scripts` with `"world": "MAIN"` need Chrome 111; `chrome.storage.session` needs 102.
- Localnet is intentionally unsupported: wallet-adapter maps localhost endpoints to `solana:localnet`.

## Steps

1. Files: `src/lib/messages.ts`, `src/lib/protocol.ts`, `src/lib/bridge.ts`, `src/content/injected.ts`, `src/background/router.ts`
   `PendingApproval` gains `chain?: string`, `transactions?: number[][]`, `messages?: number[][]`, `options?: { skipPreflight?, preflightCommitment?, maxRetries?, minContextSlot?, commitment? }` (single-item fields stay for compatibility one phase, then go). Protocol: `SIGN_TRANSACTION` / `SIGN_AND_SEND_TRANSACTION` carry `transactions: number[][]` (1 to 10 items, each validated by `validateByteArray`), optional `chain` (`solana:mainnet` | `solana:devnet`), optional `options` (validated field by field); `SIGN_MESSAGE` carries `messages: number[][]`. Bridge copies them. Router: batch requests are enqueued as one approval carrying every item (claimed and settled once); rejects a `chain` that does not match `settings.cluster` with `'Cinder is on Devnet; switch networks in Settings'` (or Mainnet); an absent chain is accepted; enqueues one approval per call; `fulfillApproval` signs every item in order and returns `signedTransactions: number[][]` / `signatures: number[][]`; `signAndSend` forwards the four send options to `sendRawTransaction` and, when `options.commitment` is present, polls `getSignatureStatuses` (bounded to 30 s) to that level before returning. `signTransactionBytes` uses `VersionedTransaction.deserialize` only. Injected: wallet `chains: [SOLANA_MAINNET_CHAIN, SOLANA_DEVNET_CHAIN]`; `bytesToAccount(address, cluster)` stamps `chains` from the cluster in the connect response and re-stamps on the `change` event; the three features send all inputs in one message and map outputs in order; `bs58` replaces the hand-rolled decoder.
   Verify: `just check` (protocol tests for the new fields, batch limits, chain enum); `just e2e e2e/dapp.spec.ts`.

2. Files: `src/lib/tx-preview.ts`, `src/lib/tx-preview.test.ts`, new `src/lib/balance-diff.ts`, new `src/lib/balance-diff.test.ts`
   `tx-preview.ts`: `deserializeTransaction` returns `VersionedTransaction` only (delete the `Transaction.from` branch); `getInstructions(tx, lookupTables?: AddressLookupTableAccount[])` resolves keys with `message.version === 'legacy' ? message.getAccountKeys() : message.getAccountKeys({ addressLookupTableAccounts })` and only marks an instruction unreadable when a key is still missing; `requiredSigners(tx)` returns the static keys covered by `header.numRequiredSignatures`; `isTransactionMessage(bytes)` returns true when `VersionedMessage.deserialize` or `Message.from` parses the bytes (the signMessage guard). `balance-diff.ts`: pure `balanceDiff(pre: Map<string, AccountInfo<Buffer> | null>, post: Map<string, { owner: string; lamports: number; data: Buffer }>, owner: PublicKey, decimalsByMint: Map<string, number>)` returning `{ sol: { pre: bigint; post: bigint }; tokens: Array<{ mint: string; pre: bigint; post: bigint; decimals: number; programId: string }> }`, decoding token accounts with `AccountLayout.decode` for accounts owned by either token program and grouping by mint for `account.owner === owner`. Tests use hand-built token account buffers.
   Verify: `just test src/lib/tx-preview.test.ts src/lib/balance-diff.test.ts`; `just check`.

3. Files: `src/lib/preview.ts`, `src/lib/preview.test.ts`, `src/background/router.ts`, `src/components/transactions/ApprovalScreen.tsx`, new `src/components/transactions/BalanceDiff.tsx`
   `buildPreview(bytes, deps)` takes `{ fetchLookupTables(keys), fetchAccounts(keys), fetchMintDecimals(mints), simulate(tx, addresses) }` and produces `PreviewResult` plus `diff?`, `signerOk: boolean`, and `unreadable: boolean`; pipeline: deserialize → lookup tables → resolve keys → decode → signer check (early return with `error: 'This transaction does not require a signature from your account'`) → writable keys → `fetchAccounts` (pre) → `simulate` with `{ sigVerify: false, replaceRecentBlockhash: true, innerInstructions: true, accounts: { encoding: 'base64', addresses } }` → mints of touched token accounts → `fetchMintDecimals` → `balanceDiff`. Router wires the deps to the connection. `ApprovalScreen`: renders `BalanceDiff` (SOL and token rows, pre → post, coloured by sign, fee note) above the instruction list, previews every item of a batch, and gates Approve: disabled while unsettled or when `unreadable` or `!signerOk`; when the simulation failed, Approve stays enabled but turns danger-styled and reads "Approve anyway". `signMessage` requests render UTF-8 when `TextDecoder('utf-8', { fatal: true })` succeeds, otherwise hex with a byte count; the router rejects `SIGN_MESSAGE` items where `isTransactionMessage` is true with `'Refusing to sign a transaction as a message'`.
   Verify: `just check`; `just e2e e2e/dapp.spec.ts`.

4. Files: `manifest.json`, `src/content/content-script.ts`, `vite.injected.config.ts`
   Manifest: second `content_scripts` entry `{ matches: same, js: ['src/content/injected.js'], run_at: 'document_start', world: 'MAIN', all_frames: false }`; remove `src/content/injected.js` from `web_accessible_resources` (keep `assets/*` until SHIP-9); `minimum_chrome_version: "111"`. Content script: delete the `<script>` injection. `vite.injected.config.ts`: confirm the IIFE output path is unchanged (no edit expected; if the bundle must not reference `chrome`, keep it that way).
   Verify: `just check`; `just ext`; `just e2e e2e/dapp.spec.ts e2e/smoke.spec.ts`.

5. Files: `examples/test-dapp/main.js`, `examples/test-dapp/index.html`, `e2e/dapp.spec.ts`
   Test dApp: buttons for sign-all (two self-transfers in one call), wrong-chain sign (`chain: 'solana:mainnet'` on the devnet build), message-as-transaction (`signMessage` with a serialized transaction message), and logs the balance diff is not observable, so log the approval count instead via `change` events. e2e: batch sign opens one approval window and returns two signed transactions; the wrong-chain request is rejected with the settings hint; the transaction-as-message request is rejected; the 0-lamport signAndSend approval shows a SOL diff row whose delta is the fee; the connect response carries `solana:devnet` in `accounts[0].chains`.
   Verify: `just check`; full `just e2e`.

## Out of scope

- `solana:signIn` (needs `@solana/wallet-standard-util`).
- Send-path changes in the popup (SHIP-7a).
- Removing `assets/*` from `web_accessible_resources` (SHIP-9).

## Risks

- Batch approvals change the approval payload shape; SHIP-5's lifecycle tests must be extended, not weakened.
- `replaceRecentBlockhash` makes simulation succeed for transactions whose blockhash has expired; the diff is still correct, and the send path re-fetches a blockhash only for popup sends, not for dApp-signed transactions (as before).
- `minimum_chrome_version` 111 excludes Chrome released before March 2023.
- Simulation `accounts` is capped by the RPC (typically 32 addresses); cap the writable-key list and mark the diff partial when truncated.

## Parking lot

- Rendering inner instructions from the simulation.
- Signing with a non-active account when the transaction requires it.
