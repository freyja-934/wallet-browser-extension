# SHIP-7a — Send path on integer units

## Goal

Make popup sends correct end to end: integer units from the balance to the wire, a real fee, a Max that the parser accepts, idempotent token-account creation, checked transfers on the right token program, recipient sanity checks, and a confirmation loop that knows when a blockhash has expired.

## Context

- `SendModal.tsx` holds `SendAsset.balance` as a float and computes Max as `(balance - 0.01).toString()`, which yields values like `0.11345670000000001` that `toSmallestUnit` rejects, and `0` for balances under 0.01 SOL. Fee is a hardcoded `5000`; `walletService.estimateFee()` returns `5000`.
- `transfers.ts` treats any `getAccount` error as "ATA missing", uses `createAssociatedTokenAccountInstruction` and unchecked `createTransferInstruction` with `TOKEN_PROGRAM_ID` only, derives the ATA with the default program, never checks the recipient, and confirms with a 75-call fixed poll that ignores `lastValidBlockHeight`.
- Since SHIP-4 the balances query exposes `lamports: string` and tokens tagged with `programId`; since SHIP-2 requests are typed in `src/lib/protocol.ts`; since SHIP-3 the worker resolves connections from settings.
- `@solana/spl-token` 0.4 exports `createAssociatedTokenAccountIdempotentInstruction`, `createTransferCheckedInstruction`, `getAssociatedTokenAddressSync(mint, owner, allowOwnerOffCurve, programId)`, `getMint(connection, mint, commitment, programId)`; web3.js exposes `getFeeForMessage`, `getMinimumBalanceForRentExemption`, `getBlockHeight`, `getSignatureStatuses`, `PublicKey.isOnCurve`.

## Steps

1. Files: `src/lib/units.ts`, `src/lib/units.test.ts`, `src/store/slices/uiSlice.ts`, `src/lib/protocol.ts`
   `units.ts` gains `maxSendable(balanceSmallest: bigint, feeSmallest: bigint): bigint` (never negative) and `parseAmount(input, decimals)` that trims, rejects more decimals than allowed with a friendly message, and returns `bigint`. `SendAsset` becomes `{ mint?, symbol, balanceSmallest: string, decimals, programId? }`. Protocol adds `ESTIMATE_FEE { to, amountSmallest, mint? }` → `{ feeLamports: string, rentExemptMin: string, recipient: { exists: boolean; isTokenAccount: boolean; offCurve: boolean } }`.
   Verify: `just test src/lib/units.test.ts`; `just check`.

2. Files: `src/background/transfers.ts`, new `src/background/transfers.test.ts`, `src/background/router.ts`, `src/messaging/client.ts`
   `transfers.ts`: `estimateTransfer(params)` builds the same message the send will use, calls `getFeeForMessage` (fallback 5000), `getMinimumBalanceForRentExemption(0)`, fetches the recipient account (exists, owner is a token program, `isOnCurve`), and returns the `ESTIMATE_FEE` shape. `sendTransfer`: SOL sends reject when the sender's remaining lamports would be between 1 and the rent-exempt minimum ("Leave at least … SOL or send Max") and when a non-existent recipient would receive less than the rent-exempt minimum; SPL sends detect the program from the mint's owner, derive both ATAs with that program and `allowOwnerOffCurve: true`, add `createAssociatedTokenAccountIdempotentInstruction`, and use `createTransferCheckedInstruction` with decimals from `getMint`; confirmation polls `getSignatureStatuses` every 400 ms and stops with "Transaction expired before confirmation; safe to retry" once `getBlockHeight() > lastValidBlockHeight`. Tests mock `Connection` methods (no network) and cover: fee fallback, rent guard, ATA idempotent instruction present, Token-2022 program threading, expiry path, on-chain error path. Router and client expose `ESTIMATE_FEE`.
   Verify: `just test src/background/transfers.test.ts`; `just check`.

3. Files: `src/components/tokens/SendModal.tsx`, `src/components/tokens/AmountInput.tsx`, `src/components/tokens/TokenList.tsx`, `e2e/send.spec.ts`
   Send modal works in smallest units: the asset selector carries `balanceSmallest`; amount validation uses `parseAmount`; Max uses `maxSendable(balance, fee)` for SOL and the full balance for tokens, rendered with `fromSmallestUnit`; Continue is disabled while the balance query is loading or errored; Review calls `ESTIMATE_FEE` and shows the fee, a "creates the recipient account" note when it does not exist, and a warning when the recipient is off-curve or already a token account; RPC failures toast a friendly message with the raw text behind a Details toggle. `TokenList` passes `balanceSmallest` and `programId` into `showSend`. e2e: Max then Continue reaches Review with the amount equal to balance minus fee; a 10-decimal input shows the decimals error; Review shows the fee row.
   Verify: `just check`; `just e2e e2e/send.spec.ts`; full `just e2e`.

## Out of scope

- Priority fees and compute-budget instructions.
- Address book.

## Risks

- `getFeeForMessage` needs a compiled message with a recent blockhash; the estimate fetches one and discards it, the send fetches its own.
- Token-2022 mints with transfer fees or transfer hooks may still fail on-chain; the error path surfaces the on-chain message.

## Parking lot

- Confirming popup sends through the SHIP-6 balance diff before signing.
