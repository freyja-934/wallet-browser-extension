import { useBalances } from '../../hooks/useWalletQueries';
import { useAppSelector } from '../../store/store';

export function BalanceCard() {
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const cluster = useAppSelector((state) => state.ui.cluster);
  const address = accounts[activeAccountIndex]?.address;
  const { data, isLoading } = useBalances(address);

  const solBalance = data?.solBalance ?? 0;

  return (
    <div className="text-center">
      <p className="text-[11px] uppercase tracking-[0.2em] text-fg-2">Portfolio</p>
      <p className="mt-2 text-[42px] font-semibold leading-none tracking-tight tabular text-fg-0" data-testid="sol-balance">
        {isLoading && !data ? '—' : solBalance.toFixed(4)}
        <span className="ml-1.5 text-lg font-medium text-fg-2">SOL</span>
      </p>
      <p className="mt-3 text-sm text-fg-2">
        {cluster === 'devnet' ? 'Devnet · USD prices are hidden' : '—'}
      </p>
    </div>
  );
}
