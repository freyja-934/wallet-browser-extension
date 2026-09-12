import type { Transaction } from '../../store/slices/walletSlice';
import { Icon } from '../ui/Icon';

const ROW_CLASS = 'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-white/5';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  if (hours < 24) return `${Math.max(0, Math.floor(hours))}h ago`;
  return date.toLocaleDateString();
}

function formatAddress(addr?: string): string {
  if (!addr) return 'Unknown';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function statusColorFor(status: Transaction['status']): string {
  return status === 'failed' ? 'text-ui-danger' : status === 'pending' ? 'text-ui-warning' : 'text-fg-3';
}

export function TransactionRow({
  transaction,
  address,
  onClick,
}: {
  transaction: Transaction;
  address: string;
  onClick?: () => void;
}) {
  const statusColor = statusColorFor(transaction.status);

  // The signature is real but nothing about it could be read: no direction, no
  // amount, no counterparty. Say so rather than showing "Sent · To Unknown".
  if (transaction.detailsUnavailable) {
    return (
      <button onClick={onClick} className={ROW_CLASS} data-testid="activity-row">
        <div className="h-10 w-10 shrink-0 rounded-full border border-dashed border-white/15" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] text-fg-1" data-testid="activity-details-unavailable">
            Details unavailable
          </div>
          <div className="truncate font-mono text-xs text-fg-2">{formatAddress(transaction.signature)}</div>
        </div>
        <div className={`text-xs ${statusColor}`}>{formatTime(transaction.timestamp)}</div>
      </button>
    );
  }

  const isIncoming = Boolean(transaction.to === address && transaction.from !== address);
  const amount = typeof transaction.amount === 'number' ? transaction.amount : parseFloat(transaction.amount || '0');
  const symbol = transaction.symbol || 'SOL';
  const display = typeof transaction.amount === 'string' && transaction.amount
    ? transaction.amount
    : Number.isFinite(amount) && amount !== 0
      ? amount.toFixed(4)
      : '';

  return (
    <button onClick={onClick} className={ROW_CLASS} data-testid="activity-row">
      <div className={`grid h-10 w-10 place-items-center rounded-full ${isIncoming ? 'bg-ui-success/10 text-ui-success' : 'bg-white/5 text-fg-2'}`}>
        <Icon name={isIncoming ? 'receive' : 'send'} className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] text-fg-0">{isIncoming ? 'Received' : 'Sent'}</div>
        <div className="truncate text-xs text-fg-2">
          {isIncoming ? 'From' : 'To'} {formatAddress(isIncoming ? transaction.from : transaction.to)}
        </div>
      </div>
      <div className="text-right">
        <div
          className={`text-[15px] tabular ${isIncoming ? 'text-ui-success' : 'text-fg-0'}`}
          data-testid="activity-amount"
        >
          {display
            ? `${isIncoming ? '+' : '−'}${display} ${symbol}`
            : 'On-chain'}
        </div>
        <div className={`text-xs ${statusColor}`}>{formatTime(transaction.timestamp)}</div>
      </div>
    </button>
  );
}
