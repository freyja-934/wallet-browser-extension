import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCluster, rpcUrlsFor, type Cluster } from '../config/constants';
import { displayTokenAmount, shortMintLabel } from '../lib/parse-history';
import { fromSmallestUnit } from '../lib/units';
import { heliusService, type Transaction as ChainTransaction, type TokenNameRef } from '../services/helius';
import { walletService } from '../services/wallet';
import type { NFT, Token, Transaction } from '../store/slices/walletSlice';
import { useSettings } from './useSettings';

/** Rows per history page; the last row's signature is the next page's `before`. */
export const HISTORY_PAGE_SIZE = 20;

const BALANCES_STALE_MS = 30_000;
const PRICES_STALE_MS = 60_000;
const NFTS_STALE_MS = 60_000;
const HISTORY_STALE_MS = 60_000;
const TOKEN_NAMES_STALE_MS = 5 * 60_000;

function tokenLabel(mint?: string): string {
  return mint ? shortMintLabel(mint) : 'token';
}

/**
 * What a chain read depends on: the cluster and the configured primary URL
 * (`rpcUrlsFor(...)[0]`, not whichever host answered). Both live in the
 * worker's settings. While `useSettings` loads, the build's own cluster stands
 * in — the same value the worker falls back to when nothing is stored, so a
 * fresh install does not change query key and refetch when settings arrive.
 */
export interface QueryScope {
  cluster: Cluster;
  primaryUrl: string;
}

function useQueryScope(): QueryScope {
  const { data: settings } = useSettings();
  const cluster = settings?.cluster ?? getCluster();
  const primaryUrl = rpcUrlsFor(cluster, settings ?? {})[0];
  return { cluster, primaryUrl };
}

/** Key position of the address in every per-account key, for scoped invalidation. */
const ADDRESS_KEY_INDEX = 3;

/*
 * None of the chain queries keeps the previous key's data as a placeholder. A
 * key change here is a different scope (another account, cluster, or endpoint),
 * never a refetch of the same one, so the screen must show the loading state
 * until the new fetch settles rather than another account's figures. Tab
 * switches do not change keys; `staleTime` covers those.
 */

export function balancesQueryOptions({ cluster, primaryUrl }: QueryScope, address?: string) {
  return queryOptions({
    queryKey: ['balances', cluster, primaryUrl, address],
    enabled: !!address,
    queryFn: () => walletService.getTokenBalances(address!),
    staleTime: BALANCES_STALE_MS,
    // The one query that retries: a balance is worth a second try, an error card is not.
    retry: 1,
  });
}

export function useBalances(address?: string) {
  return useQuery(balancesQueryOptions(useQueryScope(), address));
}

export function pricesQueryOptions(cluster: Cluster, mints: string[]) {
  const sorted = [...new Set(mints)].sort();
  return queryOptions({
    queryKey: ['prices', sorted],
    enabled: cluster !== 'devnet',
    queryFn: () => walletService.getPrices(sorted),
    staleTime: PRICES_STALE_MS,
    retry: false,
  });
}

/**
 * USD prices for SOL and `mints`, apart from balances so a CoinGecko failure
 * never hides a balance. Disabled on devnet, where prices are hidden anyway.
 */
export function usePrices(mints: string[]) {
  const { cluster } = useQueryScope();
  return useQuery(pricesQueryOptions(cluster, mints));
}

export function tokenNamesQueryOptions({ cluster, primaryUrl }: QueryScope, tokens: TokenNameRef[]) {
  const unnamed = tokens.filter((token) => !token.symbol && !token.name);
  const mints = unnamed.map((token) => token.mint).sort();
  return queryOptions({
    queryKey: ['token-names', cluster, primaryUrl, mints],
    enabled: unnamed.length > 0,
    queryFn: () => walletService.getTokenNames(unnamed),
    staleTime: TOKEN_NAMES_STALE_MS,
    retry: false,
  });
}

/**
 * On-chain names for the tokens DAS left unnamed, keyed by mint. A separate,
 * slower read than balances so the SOL figure and the list never wait on it; a
 * failure here leaves those tokens showing their short mint, nothing more.
 */
export function useTokenNames(tokens: TokenNameRef[]) {
  return useQuery(tokenNamesQueryOptions(useQueryScope(), tokens));
}

export function nftsQueryOptions({ cluster, primaryUrl }: QueryScope, address?: string) {
  return queryOptions({
    queryKey: ['nfts', cluster, primaryUrl, address],
    enabled: !!address,
    queryFn: async () => {
      const page = await heliusService.getNFTs(address!);
      const nfts = page.items as NFT[];
      const nftCollections = nfts.reduce((collections, nft) => {
        const name = nft.grouping?.find((g) => g.group_key === 'collection')?.group_value || 'Unknown Collection';
        collections[name] = collections[name] || [];
        collections[name].push(nft);
        return collections;
      }, {} as Record<string, NFT[]>);
      return { nfts, nftCollections, nftsUnavailable: page.nftsUnavailable === true };
    },
    staleTime: NFTS_STALE_MS,
  });
}

export function useNFTs(address?: string) {
  return useQuery(nftsQueryOptions(useQueryScope(), address));
}

function toTransaction(tx: ChainTransaction): Transaction {
  const native = tx.nativeTransfers?.find((row) => row.amount > 0);
  const token = tx.tokenTransfers?.[0];
  const useNative = Boolean(native);
  return {
    signature: tx.signature,
    timestamp: tx.timestamp,
    type: tx.type,
    status: tx.status,
    from: useNative ? native?.from : token?.from || native?.from,
    to: useNative ? native?.to : token?.to || native?.to,
    amount: useNative && native
      ? fromSmallestUnit(BigInt(native.amount), 9)
      : token
        ? displayTokenAmount(token.amount, token.decimals)
        : undefined,
    symbol: useNative ? 'SOL' : token ? tokenLabel(token.mint) : undefined,
    mint: useNative ? undefined : token?.mint,
    fee: tx.fee,
    ...(tx.detailsUnavailable ? { detailsUnavailable: true as const } : {}),
  };
}

export function transactionsQueryOptions({ cluster, primaryUrl }: QueryScope, address?: string) {
  return infiniteQueryOptions({
    queryKey: ['transactions', cluster, primaryUrl, address],
    enabled: !!address,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const rows = await heliusService.getTransactionHistory(address!, {
        limit: HISTORY_PAGE_SIZE,
        before: pageParam,
      });
      return rows.map(toTransaction);
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < HISTORY_PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.signature,
    staleTime: HISTORY_STALE_MS,
  });
}

/** History in pages of `HISTORY_PAGE_SIZE`, newest first; `fetchNextPage` asks for rows before the last signature. */
export function useTransactions(address?: string) {
  return useInfiniteQuery(transactionsQueryOptions(useQueryScope(), address));
}

/**
 * Drop the cached chain reads for one address (all addresses when none is
 * given, e.g. before the first account exists) so they refetch on next render.
 */
export function useInvalidateWalletData() {
  const client = useQueryClient();
  return (address?: string) => {
    for (const family of ['balances', 'nfts', 'transactions']) {
      void client.invalidateQueries({
        queryKey: [family],
        predicate: (query) => !address || query.queryKey[ADDRESS_KEY_INDEX] === address,
      });
    }
  };
}

export type { Token };
