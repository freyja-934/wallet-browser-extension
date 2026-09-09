# PROD-2 — Activity parse and prove remaining send paths

## Goal

Activity shows real transfer amounts on the current cluster (not a wall of “On-chain”). Prove the three paths that were already coded but not confirmed: SPL token send, Receive clipboard, and dApp `signAndSend` **Approve** of a 0-lamport Devnet self-transfer.

## Context

Devnet history is `getSignaturesForAddress` only, so rows have empty `nativeTransfers` / `tokenTransfers`. The Helius REST parser is mainnet + API key, and it never remaps `fromUserAccount` → `from`. Token send and Wallet Standard send already exist; we only confirmed popup SOL and dApp **Reject**.

NFT send, Ledger, and multi-account stay parked.

## Steps

1. Files: `src/lib/parse-history.ts`, `src/lib/parse-history.test.ts`, `src/services/helius.ts`  
   Parse `getParsedTransaction` (singular — public Solana RPC has no `getParsedTransactions`) into native + token transfers. Normalize Helius field names. Signature-only fallback if RPC parse fails. Self-token sends use the transfer instruction when balances do not change.  
   Verify: `just check`

2. Files: `src/store/slices/walletSlice.ts`, `src/hooks/useWalletQueries.ts`, `src/components/transactions/TransactionRow.tsx`, `src/components/transactions/TransactionHistory.tsx`  
   Rows show `+0.001 SOL` / token display units + symbol. Self-transfers count as sent. Explorer link follows cluster.  
   Verify: `just check`

3. Files: `e2e/dapp.spec.ts`, `AGENTS.md`, `README.md`  
   Approve the existing 0-lamport `signAndSend` (Devnet fee only). Document it.  
   Verify: `just e2e e2e/dapp.spec.ts`

4. Manual Chrome on `just ext` (Devnet): Receive Copy pastes the address; Send a tiny `$CNDR` to self; Activity shows the SOL / token amounts.  
   Verify: branded Chrome or chrome-devtools on `dist/`.

## Out of scope

- NFT send (MPL Core)
- Hardware wallets / extra accounts
- Token-2022 (CNDR is `Tokenkeg…`)
- Mainnet funds
- Approving a nonzero dApp send

## Risks

- Public RPC rate-limits `getParsedTransactions`; batch and fall back to signature rows.
- Helius `tokenAmount` is often UI units; prefer `rawTokenAmount` when present.
- 0-lamport approve spends a Devnet fee (~5k lamports) from the test wallet.

## Parking lot

- Token-2022 send + balance fetch
- NFT send for MPL Core
- Parsed swap / inner-ix labels beyond first transfer
