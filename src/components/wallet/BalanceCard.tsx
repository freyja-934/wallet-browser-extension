import { useBalances } from '../../hooks/useWalletQueries';
import { useAppSelector } from '../../store/store';
import { Card, CardContent } from '../ui/Card';

export function BalanceCard() {
  const { accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const address = accounts[activeAccountIndex]?.address;
  const { data } = useBalances(address);

  const totalUsdValue = data?.totalUsdValue ?? 0;
  const solBalance = data?.solBalance ?? 0;

  return (
    <Card>
      <CardContent className="space-y-1">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-3xl font-semibold tracking-tight text-fg-0">
              ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-sm text-fg-2">Portfolio</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-fg-1">{solBalance.toFixed(4)} SOL</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
