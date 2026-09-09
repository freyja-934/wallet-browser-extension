import { useState } from 'react';
import { useTransactions } from '../../hooks/useWalletQueries';
import { useAppSelector } from '../../store/store';
import { EmptyState, Skeleton } from '../ui/EmptyState';
import { SegmentedControl } from '../ui/Input';
import { TransactionRow } from './TransactionRow';

export function TransactionHistory() {
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const cluster = useAppSelector((state) => state.ui.cluster);
  const activeAccount = accounts[activeAccountIndex];
  const { data: transactions = [], isLoading } = useTransactions(activeAccount?.address);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');

  const filteredTransactions = transactions.filter((tx) => {
    if (!activeAccount) return false;
    if (filter === 'all') return true;
    if (filter === 'sent') return tx.from === activeAccount.address;
    if (filter === 'received') return tx.to === activeAccount.address && tx.from !== activeAccount.address;
    return true;
  });

  if (isLoading && transactions.length === 0) {
    return (
      <div className="space-y-2 px-4 py-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-4 pt-4">
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'sent', label: 'Out' },
          { value: 'received', label: 'In' },
        ]}
      />
      {filteredTransactions.length === 0 ? (
        <EmptyState icon="activity" title="No activity yet" body="Transfers you send and receive will show up here." />
      ) : (
        <div className="space-y-1">
          {filteredTransactions.map((tx) => (
            <TransactionRow
              key={tx.signature}
              transaction={tx}
              address={activeAccount.address}
              onClick={() => {
                const clusterQuery = cluster === 'devnet' ? '?cluster=devnet-solana' : '';
                window.open(`https://solana.fm/tx/${tx.signature}${clusterQuery}`, '_blank');
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
