# SHIP-4 — Data layer and honest UI states

## Goal

Stop rendering failure as zero, stop refetching everything on every tab switch, show tokens by name where the endpoint allows it, and say plainly when it does not.

## Context

- After SHIP-3, `heliusService.getTokenBalances` returns `{ nativeBalance, lamports, tokens, tokensError? }` from two independent rotated calls, DAS is attempted on every URL, and the endpoint list comes from settings. Token accounts are still queried for `TOKEN_PROGRAM_ID` only.
- `walletService.getTokenBalances` awaits `coinGeckoService.getSolanaPrice()`; a CoinGecko failure with no cached price rejects the whole balances query, and `enforceRateLimit` sleeps 1.2 s before every price call. `coingecko.ts` has five `console.error` calls, which Chrome lists as extension errors.
- `BalanceCard`, `TokenList`, `NFTGallery`, and `TransactionHistory` read `data ?? 0 / []` and never branch on `isError`; `getTransactionHistory` and `getNFTs` swallow errors into `[]`.
- `useWalletQueries.ts` sets no `staleTime`; `Dashboard.tsx` unmounts each tab on switch, so every switch refetches; history is a fixed `limit: 20` with no pagination; `useInvalidateWalletData` ignores its address argument; query keys carry `cluster` only.
- Token metadata comes only from DAS; without it tokens render as `??` / `Unknown`. No Metaplex dependency is installed; `@solana/spl-token` exposes `getTokenMetadata` for Token-2022 mints.

## Steps

1. Files: new `src/lib/token-metadata.ts`, new `src/lib/token-metadata.test.ts`, `src/services/helius.ts`, `src/services/wallet.ts`
   `token-metadata.ts`: `metadataPda(mint)` via `PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID)` with `METADATA_PROGRAM_ID = metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`; `decodeMetadata(data)` reads key u8, skips 64 bytes, then three u32-LE-length-prefixed strings (name, symbol, uri) trimming trailing `\0`, never asserting total length; `fetchTokenMetadata(connectionFn, mints)` batches `getMultipleAccountsInfo` by 100 and returns a `Map<mint, { name, symbol }>`; for Token-2022 mints it tries `getTokenMetadata` from `@solana/spl-token` first. Tests decode a fixture buffer built by hand and a padded one. `helius.ts`: query token accounts for both `TOKEN_PROGRAM_ID` and `TOKEN_2022_PROGRAM_ID` (two `getParsedTokenAccountsByOwner` calls inside one rotated call), tag each token with `programId`; after DAS, fill missing names from `fetchTokenMetadata`; classify the token-account failure into `tokensError: 'unavailable'` when every URL answered 403 or JSON-RPC `-32601` / `-32600` (or the list has no custom or Helius URL and the primary refused), else the error message. Separately, the balances query surfaces `endpointsUnreachable: true` when every URL failed at the transport layer or with 403 (some home-network filters block publicnode entirely; `api.mainnet-beta` always 403s from a browser), so the UI can show the same 'Add an RPC endpoint in Settings' guidance instead of a generic error. `getTransactionHistory` and `getNFTs` throw instead of returning `[]` (keep the "no DAS anywhere" case as an empty result with `nftsUnavailable: true`). `wallet.ts`: prices are no longer awaited inside the balances query; `getTokenBalances` returns `{ lamports, solBalance, tokens, tokensError }` and a new `getPrices(mints)` returns `{ sol, tokens: Map }` or throws.
   Verify: `just test src/lib/token-metadata.test.ts`; `just check`.

2. Files: `src/services/coingecko.ts`, `src/hooks/useWalletQueries.ts`, `src/popup/main.tsx`, `src/store/slices/walletSlice.ts`
   CoinGecko: remove `enforceRateLimit` and every `console.error`; failures throw for the caller to handle; delete `getHistoricalPrice`, `searchTokens`, `clearCache`. Hooks: `useBalances` (staleTime 30 s, `placeholderData: keepPreviousData`), `usePrices(mints)` (separate query, staleTime 60 s, `retry: false`), `useNFTs` (60 s), `useTransactions` becomes `useInfiniteQuery` keyed on `before` with page size 20; keys include `settings.cluster` and the configured primary URL from `rpcUrlsFor(settings.cluster, settings)[0]` via `useSettings`; `useInvalidateWalletData(address)` invalidates only that address's keys. `main.tsx` sets `retry: 1` for balances only via per-query options, default `retry: false` for the rest. `walletSlice.ts` `Token` type gains `programId`.
   Verify: `just check`; `just e2e e2e/dashboard.spec.ts`.

3. Files: `src/components/wallet/BalanceCard.tsx`, `src/components/tokens/TokenList.tsx`, `src/components/ui/EmptyState.tsx`, `src/components/tokens/AssetRow.tsx`
   `EmptyState.tsx` gains an `ErrorCard({ title, body, onRetry })`. `BalanceCard`: loading → `—`; `isError` → error card with Retry, and when the error is `endpointsUnreachable` the card body says 'No RPC endpoint reachable from this network. Add one in Settings.' with a link; success → SOL from `lamports` via `formatLamports`; USD from `usePrices`, `—` when prices are unavailable, never `$0.00` on error. `TokenList`: `tokensError === 'unavailable'` → inline "Add an RPC endpoint in Settings to see tokens and NFTs" with a link to Settings; other errors → error card; tokens without a symbol show the short mint and a copy button instead of `??` / `Unknown`; the SOL row uses `lamports`. `AssetRow` accepts an optional trailing action.
   Verify: `just check`; block the primary RPC host in DevTools and confirm the error card, not zeros; on publicnode confirm the "Add an RPC endpoint" state.

4. Files: `src/components/nfts/NFTGallery.tsx`, `src/components/transactions/TransactionHistory.tsx`, `src/components/Dashboard.tsx`, `e2e/dashboard.spec.ts`
   NFTs: `isError` → error card with Retry; `nftsUnavailable` → "Add an RPC endpoint in Settings to see NFTs". History: error card; a "Load more" row calling `fetchNextPage`; rows keep the explorer link. `Dashboard.tsx` keeps all three tabs mounted and toggles visibility so switching does not remount (or relies on `staleTime`; pick one and say which). e2e: stub the balances RPC to fail with `page.route` for the popup and assert the error card text; assert the Load more row appears after 20 rows using a devnet address with history (the fixture has history).
   Verify: `just check`; `just e2e e2e/dashboard.spec.ts`; full `just e2e`.

## Out of scope

- Send-modal integer units and Max (SHIP-7a).
- Deleting the Redux settings mirror (SHIP-8a).
- Token-2022 sends (SHIP-7a).

## Risks

- Throwing from history and NFT services changes the empty state into an error state; the screens must distinguish "no rows" from "failed" (rows `[]` with no error remains the empty state).
- `placeholderData: keepPreviousData` shows the previous cluster's data for a moment after a cluster switch; the header pill already reflects the new cluster, and the query key change triggers a refetch.
- Metaplex accounts were resized historically; the decoder must not assert length.

## Parking lot

- Price sparkline per asset.
- Persisting the query cache across popup opens.
