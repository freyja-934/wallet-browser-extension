import React, { useEffect, useState } from 'react';
import { fetchBalances } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { TransactionRow } from './TransactionRow';

export const TransactionHistory: React.FC = () => {
  const dispatch = useAppDispatch();
  const { transactions, accounts, activeAccountIndex, isLoading } = useAppSelector(state => state.wallet);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');
  
  const activeAccount = accounts[activeAccountIndex];
  
  useEffect(() => {
    if (transactions.length === 0) {
      dispatch(fetchBalances());
    }
  }, [dispatch, transactions.length]);

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
      {/* Filter Pills */}
      <div className="flex gap-1 rounded-md bg-bg-2 p-1">
        <FilterButton 
          active={filter === 'all'} 
          onClick={() => setFilter('all')}
        >
          All
        </FilterButton>
        <FilterButton 
          active={filter === 'sent'} 
          onClick={() => setFilter('sent')}
        >
          Sent
        </FilterButton>
        <FilterButton 
          active={filter === 'received'} 
          onClick={() => setFilter('received')}
        >
          Received
        </FilterButton>
      </div>

      {/* Transactions Card */}
      <Card>
        <CardHeader>
          <h3 className="text-sm text-fg-1">Recent Activity</h3>
        </CardHeader>
        
        {filteredTransactions.length === 0 ? (
          <CardContent>
            <p className="text-center text-fg-3 text-sm py-8">
              No transactions found
            </p>
          </CardContent>
        ) : (
          <div className="divide-y divide-ui-border/60">
            {filteredTransactions.map((tx) => (
              <TransactionRow
                key={tx.signature}
                transaction={tx}
                address={activeAccount?.address || ''}
                onClick={() => handleViewTransaction(tx.signature)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

function FilterButton({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex-1 px-3 h-8 rounded-sm text-xs font-medium transition-colors ${
        active 
          ? 'bg-bg-1 text-fg-0 shadow-sm' 
          : 'hover:bg-bg-1/50 text-fg-2'
      }`}
    >
      {children}
    </button>
  );
}