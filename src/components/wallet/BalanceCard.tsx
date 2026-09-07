import { useAppSelector } from '../../store/store';
import { Card, CardContent } from '../ui/Card';

export function BalanceCard() {
  const { totalUsdValue, solBalance } = useAppSelector(state => state.wallet);
  
  const availableBalance = totalUsdValue * 0.95; // Placeholder for staked calculation
  
  return (
    <Card>
      <CardContent className="space-y-1">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-3xl font-semibold tracking-tight text-fg-0">
              ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-fg-2">
              ${availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} available
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-fg-1">{solBalance.toFixed(4)} SOL</div>
            <div className="text-xs text-ui-success">+2.34%</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
