import { useQuery, useQueryClient } from '@tanstack/react-query';
import { displayTokenAmount, shortMintLabel } from '../lib/parse-history';
import { fromSmallestUnit } from '../lib/units';
import { heliusService } from '../services/helius';
import { walletService } from '../services/wallet';
import { useAppSelector } from '../store/store';
import type { NFT, Token, Transaction } from '../store/slices/walletSlice';

function tokenLabel(mint?: string): string {
  return mint ? shortMintLabel(mint) : 'token';
}

export function useBalances(address?: string) {
  const cluster = useAppSelector((state) => state.ui.cluster);
  return useQuery({
    queryKey: ['balances', cluster, address],
    enabled: !!address,
    queryFn: async () => {
      const data = await walletService.getTokenBalances(address!);
      return data;
    },
  });
}

export function useNFTs(address?: string) {
  const cluster = useAppSelector((state) => state.ui.cluster);
  return useQuery({
    queryKey: ['nfts', cluster, address],
    enabled: !!address,
    queryFn: async () => {
      const nftData = await heliusService.getNFTs(address!);
      const nfts = nftData.items as NFT[];
      const nftCollections = nfts.reduce((collections, nft) => {
        const name = nft.grouping?.find((g) => g.group_key === 'collection')?.group_value || 'Unknown Collection';
        collections[name] = collections[name] || [];
        collections[name].push(nft);
        return collections;
      }, {} as Record<string, NFT[]>);
      return { nfts, nftCollections };
    },
  });
}

export function useTransactions(address?: string) {
  const cluster = useAppSelector((state) => state.ui.cluster);
  return useQuery({
    queryKey: ['transactions', cluster, address],
    enabled: !!address,
    queryFn: async () => {
      const rows = await heliusService.getTransactionHistory(address!, { limit: 20 });
      return rows.map((tx): Transaction => {
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
      });
    },
  });
}

export function useInvalidateWalletData() {
  const client = useQueryClient();
  return (_address?: string) => {
    void client.invalidateQueries({ queryKey: ['balances'] });
    void client.invalidateQueries({ queryKey: ['nfts'] });
    void client.invalidateQueries({ queryKey: ['transactions'] });
  };
}

export type { Token };
