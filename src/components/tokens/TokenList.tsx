import React, { useState } from 'react';
import { WRAPPED_SOL_MINT } from '../../config/constants';
import { useBalances } from '../../hooks/useWalletQueries';
import { setRefreshing, showSend } from '../../store/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { TextField } from '../ui/Input';
import { AssetRow } from './AssetRow';

export const TokenList: React.FC = () => {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const { hideSmallBalances, isRefreshing } = useAppSelector(state => state.ui);
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

  const filteredTokens = tokens.filter(token => {
    const matchesSearch =
      token.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.symbol?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.mint.toLowerCase().includes(searchQuery.toLowerCase());
    const meetsBalanceThreshold = !hideSmallBalances || (token.usdValue && token.usdValue > 1);
    return matchesSearch && meetsBalanceThreshold;
  });

  const solToken = tokens.find(t => t.mint === WRAPPED_SOL_MINT);
  const solUsdValue = (data?.totalUsdValue ?? 0) - tokens.reduce((sum, t) => sum + (t.usdValue || 0), 0);

  const handleAssetClick = () => {
    dispatch(showSend());
  };

  if (isLoading && tokens.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-a"></div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-4">
      <div className="relative">
        <TextField
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search assets..."
          className="pl-10"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-sm text-fg-1">Assets</h3>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh balances"
            className={`p-1.5 rounded-md hover:bg-bg-2 transition-colors ${isRefreshing ? 'animate-spin' : ''}`}
          >
            <svg className="w-4 h-4 text-fg-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </CardHeader>
        <div className="divide-y divide-ui-border/60">
          <AssetRow
            icon={<div className="h-5 w-5 grad-solana rounded-full" />}
            name="Solana"
            subtitle={`${solBalance.toFixed(4)} SOL`}
            value={`$${Math.max(solUsdValue, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            delta={solToken?.priceChange24h ? `${solToken.priceChange24h >= 0 ? '+' : ''}${solToken.priceChange24h.toFixed(2)}%` : undefined}
            onClick={handleAssetClick}
          />
          {filteredTokens.map((token) => {
            const balance = parseFloat(token.amount) / Math.pow(10, token.decimals);
            return (
              <AssetRow
                key={token.mint}
                icon={
                  token.logoURI ? (
                    <img src={token.logoURI} alt={token.symbol} className="w-5 h-5 rounded-full" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-bg-2 flex items-center justify-center text-[10px] text-fg-2">
                      {token.symbol?.slice(0, 2) || '??'}
                    </div>
                  )
                }
                name={token.symbol || 'Unknown'}
                subtitle={`${balance.toFixed(4)} ${token.symbol || ''}`}
                value={`$${(token.usdValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                delta={token.priceChange24h ? `${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%` : undefined}
                onClick={handleAssetClick}
              />
            );
          })}
        </div>
        {!isLoading && filteredTokens.length === 0 && searchQuery && (
          <CardContent>
            <p className="text-center text-fg-3 text-sm">No tokens found</p>
          </CardContent>
        )}
      </Card>
    </div>
  );
};
