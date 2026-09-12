import { useState } from 'react';
import { useTransactions } from '../../hooks/useWalletQueries';
import { errorMessage } from '../../lib/errors';
import { isEndpointsUnreachable } from '../../services/helius';
import { useAppSelector } from '../../store/store';
import { SecondaryButton } from '../ui/Button';
import { EmptyState, EndpointsUnreachableBody, ErrorCard, Skeleton } from '../ui/EmptyState';
import { SegmentedControl } from '../ui/Input';
import { TransactionRow } from './TransactionRow';

export function TransactionHistory() {
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const cluster = useAppSelector((state) => state.ui.cluster);
  const activeAccount = accounts[activeAccountIndex];
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useTransactions(activeAccount?.address);
  const transactions = data?.pages.flat() ?? [];
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');

  const filteredTransactions = transactions.filter((tx) => {
    if (!activeAccount) return false;
    if (filter === 'all') return true;
    if (filter === 'sent') return tx.from === activeAccount.address;
    if (filter === 'received') return tx.to === activeAccount.address && tx.from !== activeAccount.address;
    return true;
  });

  // The card replaces the list only when there is no list: a later page that
  // failed keeps the rows already shown and says so by the Load more row.
  if (isError && transactions.length === 0) {
    return (
      <div className="px-4 py-4">
        <ErrorCard
          testId="history-error"
          title="Could not load activity"
          body={isEndpointsUnreachable(error) ? <EndpointsUnreachableBody /> : errorMessage(error, 'The RPC endpoint did not answer.')}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

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
      {hasNextPage && (
        <div className="space-y-2">
          {isFetchNextPageError && (
            <p
              role="alert"
              data-testid="history-page-error"
              className="rounded-2xl border border-ui-danger/30 bg-ui-danger/10 px-3 py-2.5 text-center text-xs leading-relaxed text-fg-2"
            >
              Could not load more activity: {errorMessage(error, 'the RPC endpoint did not answer')}
            </p>
          )}
          <SecondaryButton
            type="button"
            className="h-10 w-full text-xs"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            data-testid="history-load-more"
          >
            {isFetchingNextPage ? 'Loading…' : isFetchNextPageError ? 'Retry' : 'Load more'}
          </SecondaryButton>
        </div>
      )}
    </div>
  );
}
