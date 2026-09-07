import { Transaction } from '../../store/slices/walletSlice';

interface TransactionRowProps {
  transaction: Transaction;
  address: string;
  onClick?: () => void;
}

export function TransactionRow({ transaction, address, onClick }: TransactionRowProps) {
  const isIncoming = transaction.to === address;
  const amount = typeof transaction.amount === 'number' ? transaction.amount : parseFloat(transaction.amount || '0');
  
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = diff / (1000 * 60 * 60);
    
    if (hours < 24) {
      return `${Math.floor(hours)}h ago`;
    }
    return date.toLocaleDateString();
  };

  const formatAddress = (addr?: string) => {
    if (!addr) return 'Unknown';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'text-ui-success';
      case 'pending': return 'text-ui-warning';
      case 'failed': return 'text-ui-danger';
      default: return 'text-fg-2';
    }
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-bg-2 border border-transparent hover:border-ui-border transition-all duration-fast"
    >
      {/* Icon */}
      <div className={`h-9 w-9 rounded-full grid place-items-center ${isIncoming ? 'bg-ui-success/10' : 'bg-bg-2'}`}>
        <svg className={`w-5 h-5 ${isIncoming ? 'text-ui-success' : 'text-fg-2'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isIncoming ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          )}
        </svg>
      </div>

      {/* Details */}
      <div className="flex-1 text-left">
        <div className="text-[15px] text-fg-0">
          {isIncoming ? 'Received' : 'Sent'} {transaction.type}
        </div>
        <div className="text-xs text-fg-2">
          {isIncoming ? 'From' : 'To'} {formatAddress(isIncoming ? transaction.from : transaction.to)}
        </div>
      </div>

      {/* Amount & Time */}
      <div className="text-right">
        <div className={`text-[15px] ${isIncoming ? 'text-ui-success' : 'text-fg-0'}`}>
          {isIncoming ? '+' : '-'}{amount.toFixed(4)}
        </div>
        <div className={`text-xs ${getStatusColor(transaction.status)}`}>
          {formatTime(transaction.timestamp)}
        </div>
      </div>
    </button>
  );
}
