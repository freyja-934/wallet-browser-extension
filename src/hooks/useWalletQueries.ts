import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpcUrlsFor } from '../config/constants';
import { displayTokenAmount, shortMintLabel } from '../lib/parse-history';
import { fromSmallestUnit } from '../lib/units';
import { heliusService, type Transaction as ChainTransaction } from '../services/helius';
import { walletService } from '../services/wallet';
import { useAppSelector } from '../store/store';
import type { NFT, Token, Transaction } from '../store/slices/walletSlice';
import { useSettings } from './useSettings';

/** Rows per history page; the last row's signature is the next page's `before`. */
export const HISTORY_PAGE_SIZE = 20;

const BALANCES_STALE_MS = 30_000;
const PRICES_STALE_MS = 60_000;
const NFTS_STALE_MS = 60_000;
const HISTORY_STALE_MS = 60_000;

function tokenLabel(mint?: string): string {
  return mint ? shortMintLabel(mint) : 'token';
}

/**
 * What a chain read depends on: the cluster and the configured primary URL
 * (`rpcUrlsFor(...)[0]`, not whichever host answered). Both live in the
 * worker's settings; Redux's cluster stands in while `useSettings` loads.
 */
function useQueryScope() {
  const reduxCluster = useAppSelector((state) => state.ui.cluster);
  const { data: settings } = useSettings();
  const cluster = settings?.cluster ?? reduxCluster;
  const primaryUrl = rpcUrlsFor(cluster, settings ?? {})[0];
  return { cluster, primaryUrl };
}

/** Key position of the address in every per-account key, for scoped invalidation. */
const ADDRESS_KEY_INDEX = 3;

export function useBalances(address?: string) {
  const { cluster, primaryUrl } = useQueryScope();
  return useQuery({
    queryKey: ['balances', cluster, primaryUrl, address],
    enabled: !!address,
    queryFn: () => walletService.getTokenBalances(address!),
    staleTime: BALANCES_STALE_MS,
    placeholderData: keepPreviousData,
    // The one query that retries: a balance is worth a second try, an error card is not.
    retry: 1,
  });
}

/**
 * USD prices for SOL and `mints`, apart from balances so a CoinGecko failure
 * never hides a balance. Disabled on devnet, where prices are hidden anyway.
 */
export function usePrices(mints: string[]) {
  const { cluster } = useQueryScope();
  const sorted = [...new Set(mints)].sort();
  return useQuery({
    queryKey: ['prices', sorted],
    enabled: cluster !== 'devnet',
    queryFn: () => walletService.getPrices(sorted),
    staleTime: PRICES_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useNFTs(address?: string) {
  const { cluster, primaryUrl } = useQueryScope();
  return useQuery({
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
    placeholderData: keepPreviousData,
  });
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
  };
}

/** History in pages of `HISTORY_PAGE_SIZE`, newest first; `fetchNextPage` asks for rows before the last signature. */
export function useTransactions(address?: string) {
  const { cluster, primaryUrl } = useQueryScope();
  return useInfiniteQuery({
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
    placeholderData: keepPreviousData,
  });
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
