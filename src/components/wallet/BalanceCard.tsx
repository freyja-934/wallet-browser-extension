import { accountAt } from '../../lib/messages';
import { useBalances, usePrices } from '../../hooks/useWalletQueries';
import { errorMessage } from '../../lib/errors';
import { formatLamports } from '../../lib/units';
import { isEndpointsUnreachable } from '../../services/helius';
import type { WalletBalances, WalletPrices } from '../../services/wallet';
import { useAppSelector } from '../../store/store';
import { EndpointsUnreachableBody, ErrorCard } from '../ui/EmptyState';

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Portfolio USD from the two queries; undefined until both have answered. Display math only, never sent anywhere. */
function usdTotal(balances: WalletBalances | undefined, prices: WalletPrices | undefined): number | undefined {
  if (!balances || !prices) return undefined;
  const tokensUsd = balances.tokens.reduce((sum, token) => {
    const price = prices.tokens.get(token.mint);
    if (!price) return sum;
    return sum + (Number(token.amount) / 10 ** token.decimals) * price.price;
  }, 0);
  return balances.solBalance * prices.sol.price + tokensUsd;
}

export function BalanceCard() {
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const cluster = useAppSelector((state) => state.ui.cluster);
  const address = accountAt(accounts, activeAccountIndex)?.address;
  const balances = useBalances(address);
  const prices = usePrices(balances.data?.tokens.map((token) => token.mint) ?? []);

  // Loading and error both show a dash: a figure here is a real balance or nothing.
  const sol = balances.data && !balances.isError ? formatLamports(BigInt(balances.data.lamports)) : '—';
  const usd = balances.isError ? undefined : usdTotal(balances.data, prices.data);
  // Tokens could not be listed, so the sum is SOL alone; say so rather than present it as the portfolio.
  const solOnly = Boolean(balances.data?.tokensError);

  return (
    <div className="text-center">
      <p className="text-[11px] uppercase tracking-[0.2em] text-fg-2">Portfolio</p>
      <p className="mt-2 text-[42px] font-semibold leading-none tracking-tight tabular text-fg-0" data-testid="sol-balance">
        {sol}
        <span className="ml-1.5 text-lg font-medium text-fg-2">SOL</span>
      </p>
      <p className="mt-3 text-sm text-fg-2" data-testid="usd-balance">
        {cluster === 'devnet'
          ? 'Devnet · USD prices are hidden'
          : usd === undefined
            ? '—'
            : `${formatUsd(usd)}${solOnly ? ' · SOL only' : ''}`}
      </p>
      {balances.isError && (
        <div className="mt-4 text-left">
          <ErrorCard
            testId="balance-error"
            title="Balance unavailable"
            body={
              isEndpointsUnreachable(balances.error) ? (
                <EndpointsUnreachableBody />
              ) : (
                errorMessage(balances.error, 'The RPC endpoint did not answer.')
              )
            }
            onRetry={() => void balances.refetch()}
          />
        </div>
      )}
    </div>
  );
}
