import { useQuery, useQueryClient } from '@tanstack/react-query';
import { heliusService } from '../services/helius';
import { walletService } from '../services/wallet';
import type { NFT, Token, Transaction } from '../store/slices/walletSlice';

export function useBalances(address?: string) {
  return useQuery({
    queryKey: ['balances', address],
    enabled: !!address,
    queryFn: async () => {
      const data = await walletService.getTokenBalances(address!);
      return data;
    },
  });
}

export function useNFTs(address?: string) {
  return useQuery({
    queryKey: ['nfts', address],
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
  return useQuery({
    queryKey: ['transactions', address],
    enabled: !!address,
    queryFn: async () => {
      const rows = await heliusService.getTransactionHistory(address!, { limit: 20 });
      return rows.map((tx): Transaction => {
        const native = tx.nativeTransfers?.[0];
        const token = tx.tokenTransfers?.[0];
        return {
          signature: tx.signature,
          timestamp: tx.timestamp,
          type: tx.type,
          status: tx.status,
          from: native?.from || token?.from,
          to: native?.to || token?.to,
          amount: native
            ? (native.amount / 1e9).toString()
            : token?.amount,
          fee: tx.fee,
        };
      });
    },
  });
}

export function useInvalidateWalletData() {
  const client = useQueryClient();
  return (address?: string) => {
    void client.invalidateQueries({ queryKey: ['balances', address] });
    void client.invalidateQueries({ queryKey: ['nfts', address] });
    void client.invalidateQueries({ queryKey: ['transactions', address] });
  };
}

export type { Token };
