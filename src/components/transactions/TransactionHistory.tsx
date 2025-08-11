import { format } from 'date-fns';
import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import { fetchBalances } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';

export const TransactionHistory: React.FC = () => {
  const dispatch = useAppDispatch();
  const { transactions, accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');
  const activeAddress = accounts[activeAccountIndex]?.address;

  useEffect(() => {
    // Fetch transactions if not loaded
    if (transactions.length === 0) {
      dispatch(fetchBalances());
    }
  }, [dispatch, transactions.length]);

  const filteredTransactions = transactions.filter(tx => {
    if (filter === 'all') return true;
    if (filter === 'sent') return tx.from === activeAddress;
    if (filter === 'received') return tx.to === activeAddress;
    return true;
  });

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'TRANSFER':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        );
      case 'SWAP':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        );
      case 'NFT_TRANSFER':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
    }
  };

  const formatAddress = (address: string | undefined) => {
    if (!address) return 'Unknown';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const getTransactionAmount = () => {
    // For now, return a placeholder - will be enhanced with actual parsing
    return '0.00';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex space-x-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('sent')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'sent'
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Sent
          </button>
          <button
            onClick={() => setFilter('received')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === 'received'
                ? 'bg-indigo-100 text-indigo-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Received
          </button>
        </div>
      </div>

      {/* Transaction List */}
      <div className="flex-1 overflow-y-auto bg-white">
        {filteredTransactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg className="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-lg font-medium">No transactions yet</p>
            <p className="text-sm mt-1">Your transaction history will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredTransactions.map((tx, index) => (
              <motion.div
                key={tx.signature}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="px-4 py-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => {
                  // Open transaction in explorer
                  window.open(
                    `https://solscan.io/tx/${tx.signature}`,
                    '_blank'
                  );
                }}
              >
                <div className="flex items-center space-x-3">
                  {/* Icon */}
                  <div className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    ${tx.status === 'success' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}
                  `}>
                    {getTransactionIcon(tx.type)}
                  </div>

                  {/* Details */}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-medium text-gray-900">
                        {tx.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                      </h3>
                      <span className={`text-sm font-medium ${
                        tx.from === activeAddress ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {tx.from === activeAddress ? '-' : '+'} {getTransactionAmount()} SOL
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <span>
                        {tx.from === activeAddress ? 'To' : 'From'}: {formatAddress(tx.from === activeAddress ? tx.to : tx.from)}
                      </span>
                      <span>{format(new Date(tx.timestamp), 'MMM d, h:mm a')}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
