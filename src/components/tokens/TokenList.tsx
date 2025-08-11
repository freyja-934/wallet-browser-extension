import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import { WRAPPED_SOL_MINT } from '../../config/constants';
import { setRefreshing } from '../../store/slices/uiSlice';
import { fetchBalances } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';

export const TokenList: React.FC = () => {
  const dispatch = useAppDispatch();
  const { solBalance, tokens, totalUsdValue, isLoading } = useAppSelector(state => state.wallet);
  const { hideSmallBalances, isRefreshing } = useAppSelector(state => state.ui);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // Fetch balances on mount
    dispatch(fetchBalances());
  }, [dispatch]);

  const handleRefresh = async () => {
    dispatch(setRefreshing(true));
    await dispatch(fetchBalances());
    dispatch(setRefreshing(false));
  };

  // Filter tokens
  const filteredTokens = tokens.filter(token => {
    const matchesSearch = 
      token.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.symbol?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      token.mint.toLowerCase().includes(searchQuery.toLowerCase());
    
    const meetsBalanceThreshold = !hideSmallBalances || (token.usdValue && token.usdValue > 1);
    
    return matchesSearch && meetsBalanceThreshold;
  });

  // Calculate SOL USD value
  const solToken = tokens.find(t => t.mint === WRAPPED_SOL_MINT);
  const solPrice = solToken ? (solToken.usdValue || 0) / parseFloat(solToken.amount) * Math.pow(10, solToken.decimals) : 0;
  const solUsdValue = solBalance * solPrice;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-6 bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Portfolio Value</h2>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors ${
              isRefreshing ? 'animate-spin' : ''
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        <div className="text-3xl font-bold">
          ${totalUsdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tokens..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
          />
          <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Token List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && tokens.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {/* SOL Balance */}
            <TokenItem
              symbol="SOL"
              name="Solana"
              balance={solBalance}
              usdValue={solUsdValue}
              priceChange24h={solToken?.priceChange24h || 0}
              logoURI="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
              isNative
            />

            {/* SPL Tokens */}
            {filteredTokens.map((token, index) => (
              <motion.div
                key={token.mint}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <TokenItem
                  symbol={token.symbol || 'Unknown'}
                  name={token.name || 'Unknown Token'}
                  balance={parseFloat(token.amount) / Math.pow(10, token.decimals)}
                  usdValue={token.usdValue || 0}
                  priceChange24h={token.priceChange24h || 0}
                  logoURI={token.logoURI}
                  mint={token.mint}
                />
              </motion.div>
            ))}
          </div>
        )}

        {!isLoading && filteredTokens.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <p>No tokens found</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface TokenItemProps {
  symbol: string;
  name: string;
  balance: number;
  usdValue: number;
  priceChange24h: number;
  logoURI?: string;
  mint?: string;
  isNative?: boolean;
}

const TokenItem: React.FC<TokenItemProps> = ({
  symbol,
  name,
  balance,
  usdValue,
  priceChange24h,
  logoURI,
  isNative
}) => {
  const handleClick = () => {
    // TODO: Show token details or send modal
  };

  return (
    <button
      onClick={handleClick}
      className="w-full px-4 py-3 hover:bg-gray-50 transition-colors flex items-center space-x-3"
    >
      {/* Token Logo */}
      <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden">
        {logoURI ? (
          <img 
            src={logoURI} 
            alt={symbol}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling!.classList.remove('hidden');
            }}
          />
        ) : null}
        <span className={`text-sm font-medium text-gray-600 ${logoURI ? 'hidden' : ''}`}>
          {symbol.slice(0, 2)}
        </span>
      </div>

      {/* Token Info */}
      <div className="flex-1 text-left">
        <div className="flex items-center space-x-2">
          <h3 className="font-medium text-gray-900">{symbol}</h3>
          {isNative && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
              Native
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500">{name}</p>
      </div>

      {/* Balance & Value */}
      <div className="text-right">
        <p className="font-medium text-gray-900">
          {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {symbol}
        </p>
        <div className="flex items-center justify-end space-x-2 text-sm">
          <span className="text-gray-600">
            ${usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
          <span className={`${priceChange24h >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
          </span>
        </div>
      </div>
    </button>
  );
};
