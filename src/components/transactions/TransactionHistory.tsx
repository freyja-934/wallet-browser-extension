import React, { useState } from 'react';
import { useTransactions } from '../../hooks/useWalletQueries';
import { useAppSelector } from '../../store/store';
import { Card, CardHeader } from '../ui/Card';
import { TransactionRow } from './TransactionRow';

export const TransactionHistory: React.FC = () => {
  const { accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const activeAccount = accounts[activeAccountIndex];
  const { data: transactions = [], isLoading } = useTransactions(activeAccount?.address);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');

  const filteredTransactions = transactions.filter(tx => {
    if (!activeAccount) return false;
    if (filter === 'all') return true;
    if (filter === 'sent') return tx.from === activeAccount.address;
    if (filter === 'received') return tx.to === activeAccount.address;
    return true;
  });

  const handleViewTransaction = (signature: string) => {
    window.open(`https://solana.fm/tx/${signature}`, '_blank');
  };

  if (isLoading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-a"></div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-4">
      <Card>
        <CardHeader className="flex gap-2">
          {(['all', 'sent', 'received'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1 rounded-md text-xs ${filter === value ? 'bg-bg-2 text-fg-0' : 'text-fg-2'}`}
            >
              {value}
            </button>
          ))}
        </CardHeader>
        <div>
          {filteredTransactions.map((tx) => (
            <TransactionRow
              key={tx.signature}
              transaction={tx}
              address={activeAccount.address}
              onClick={() => handleViewTransaction(tx.signature)}
            />
          ))}
          {filteredTransactions.length === 0 && (
            <p className="p-4 text-sm text-fg-3 text-center">No transactions yet</p>
          )}
        </div>
      </Card>
    </div>
  );
};
