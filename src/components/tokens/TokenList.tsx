import { WRAPPED_SOL_MINT } from '../../config/constants';
import { useBalances } from '../../hooks/useWalletQueries';
import { setRefreshing, showSend } from '../../store/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { Skeleton } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { TextField } from '../ui/Input';
import { AssetRow } from './AssetRow';
import { useState } from 'react';

export function TokenList() {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const { hideSmallBalances, isRefreshing } = useAppSelector((state) => state.ui);
  const address = accounts[activeAccountIndex]?.address;
  const { data, isLoading, refetch } = useBalances(address);
  const solBalance = data?.solBalance ?? 0;
  const tokens = data?.tokens ?? [];
  const [searchQuery, setSearchQuery] = useState('');

  const handleRefresh = async () => {
    dispatch(setRefreshing(true));
    await refetch();
    dispatch(setRefreshing(false));
  };

  const filteredTokens = tokens.filter((token) => {
    const matchesSearch =
      token.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.symbol?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.mint.toLowerCase().includes(searchQuery.toLowerCase());
    const meetsBalanceThreshold = !hideSmallBalances || (token.usdValue && token.usdValue > 1);
    return matchesSearch && meetsBalanceThreshold;
  });

  const solToken = tokens.find((t) => t.mint === WRAPPED_SOL_MINT);
  const solUsdValue = (data?.totalUsdValue ?? 0) - tokens.reduce((sum, t) => sum + (t.usdValue || 0), 0);

  if (isLoading && tokens.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-11 w-full rounded-full" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4">
      <div className="relative">
        <TextField
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search assets"
          className="pl-11"
        />
        <Icon name="search" className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
      </div>

      <div className="flex items-center justify-between px-1">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-fg-2">Assets</h3>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="Refresh balances"
          className={`p-1.5 text-fg-2 hover:text-fg-0 ${isRefreshing ? 'animate-spin' : ''}`}
        >
          <Icon name="refresh" className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1">
        <AssetRow
          icon={<div className="h-5 w-5 rounded-[32%] bg-brand-b shadow-glow" />}
          name="Solana"
          subtitle={`${solBalance.toFixed(4)} SOL`}
          value={`$${Math.max(solUsdValue, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          delta={solToken?.priceChange24h ? `${solToken.priceChange24h >= 0 ? '+' : ''}${solToken.priceChange24h.toFixed(2)}%` : undefined}
          onClick={() =>
            dispatch(showSend({ symbol: 'SOL', balance: solBalance, decimals: 9 }))
          }
        />
        {filteredTokens.map((token) => {
          const balance = parseFloat(token.amount) / Math.pow(10, token.decimals);
          return (
            <AssetRow
              key={token.mint}
              icon={
                token.logoURI ? (
                  <img src={token.logoURI} alt={token.symbol} className="h-5 w-5 rounded-full" />
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-2 text-[10px] text-fg-2">
                    {token.symbol?.slice(0, 2) || '??'}
                  </div>
                )
              }
              name={token.symbol || 'Unknown'}
              subtitle={`${balance.toFixed(4)} ${token.symbol || ''}`}
              value={`$${(token.usdValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              delta={token.priceChange24h ? `${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%` : undefined}
              onClick={() =>
                dispatch(
                  showSend({
                    mint: token.mint,
                    symbol: token.symbol || 'Unknown',
                    balance,
                    decimals: token.decimals,
                  }),
                )
              }
            />
          );
        })}
      </div>
      {!isLoading && filteredTokens.length === 0 && searchQuery && (
        <p className="py-6 text-center text-sm text-fg-3">No tokens found</p>
      )}
    </div>
  );
}
