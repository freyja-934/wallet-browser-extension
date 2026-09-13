import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { accountAt, DEFAULT_SETTINGS } from '../../lib/messages';
import { useSettings } from '../../hooks/useSettings';
import { useBalances, usePrices, useTokenNames } from '../../hooks/useWalletQueries';
import { errorMessage } from '../../lib/errors';
import { displayTokenAmount } from '../../lib/parse-history';
import { formatLamports } from '../../lib/units';
import { TOKENS_UNAVAILABLE, isEndpointsUnreachable, type TokenBalance } from '../../services/helius';
import { setRefreshing, showSend } from '../../store/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { EndpointsUnreachableBody, ErrorCard, SettingsLink, Skeleton } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { TextField } from '../ui/Input';
import { AssetRow } from './AssetRow';

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDelta(change: number | undefined): string | undefined {
  if (!change) return undefined;
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** What a token is called on screen: symbol, then name, then its short mint. Never a placeholder. */
function tokenLabel(token: TokenBalance): string {
  return token.symbol || token.name || shortMint(token.mint);
}

async function copyMint(mint: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(mint);
    toast.success('Mint address copied');
  } catch {
    toast.error('Could not copy');
  }
}

export function TokenList() {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const { isRefreshing } = useAppSelector((state) => state.ui);
  const { data: settings } = useSettings();
  const hideSmallBalances = settings?.hideSmallBalances ?? DEFAULT_SETTINGS.hideSmallBalances;
  const address = accountAt(accounts, activeAccountIndex)?.address;
  const { data, isError, error, refetch } = useBalances(address);
  // On-chain names arrive after balances; until then, and if they never do, a token shows its short mint.
  const { data: names } = useTokenNames(data?.tokens ?? []);
  const tokens = useMemo(
    () =>
      (data?.tokens ?? []).map((token) => {
        const found = names?.[token.mint];
        if (!found || (token.symbol && token.name)) return token;
        return {
          ...token,
          name: token.name || found.name || undefined,
          symbol: token.symbol || found.symbol || undefined,
        };
      }),
    [data, names],
  );
  const { data: prices } = usePrices(tokens.map((token) => token.mint));
  const [searchQuery, setSearchQuery] = useState('');

  const handleRefresh = async () => {
    dispatch(setRefreshing(true));
    await refetch();
    dispatch(setRefreshing(false));
  };

  if (isError) {
    return (
      <ErrorCard
        testId="tokens-error"
        title="Could not load assets"
        body={isEndpointsUnreachable(error) ? <EndpointsUnreachableBody /> : errorMessage(error, 'The RPC endpoint did not answer.')}
        onRetry={handleRefresh}
      />
    );
  }

  if (!data) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-11 w-full rounded-full" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
    );
  }

  const query = searchQuery.trim().toLowerCase();
  const rows = tokens
    .map((token) => {
      const balance = displayTokenAmount(token.amount, token.decimals);
      const price = prices?.tokens.get(token.mint);
      const usdValue = price ? Number(balance) * price.price : undefined;
      return { token, balance, usdValue, delta: formatDelta(price?.priceChange24h) };
    })
    .filter(({ token, usdValue }) => {
      const matchesSearch =
        !query ||
        token.name?.toLowerCase().includes(query) ||
        token.symbol?.toLowerCase().includes(query) ||
        token.mint.toLowerCase().includes(query);
      // A token is "small" only when a price says so; without one there is nothing to hide it on.
      const small = hideSmallBalances && usdValue !== undefined && usdValue < 1;
      return matchesSearch && !small;
    });

  const solDisplay = formatLamports(BigInt(data.lamports));
  const tokensUnavailable = data.tokensError === TOKENS_UNAVAILABLE || data.endpointsUnreachable === true;

  return (
    <div className="space-y-3 pb-4">
      <div className="relative">
        <TextField
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search assets"
          className="pl-11"
        />
        <Icon name="search" className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
      </div>

      <div className="flex items-center justify-between px-1">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-fg-2">Assets</h3>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label="Refresh balances"
          className={`p-1.5 text-fg-2 hover:text-fg-0 ${isRefreshing ? 'animate-spin' : ''}`}
        >
          <Icon name="refresh" className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1">
        <AssetRow
          testId="asset-sol"
          icon={<div className="h-5 w-5 rounded-[32%] bg-brand-b shadow-glow" />}
          name="Solana"
          subtitle={`${solDisplay} SOL`}
          value={prices ? formatUsd(data.solBalance * prices.sol.price) : '—'}
          delta={formatDelta(prices?.sol.priceChange24h)}
          onClick={() => dispatch(showSend({ symbol: 'SOL', balanceSmallest: data.lamports, decimals: 9 }))}
        />
        {rows.map(({ token, balance, usdValue, delta }) => {
          const label = tokenLabel(token);
          const named = Boolean(token.symbol || token.name);
          return (
            <AssetRow
              key={token.tokenAccount}
              testId={`asset-${token.mint}`}
              icon={
                token.logoURI ? (
                  <img src={token.logoURI} alt="" className="h-5 w-5 rounded-full" />
                ) : named ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-2 text-[10px] text-fg-2">
                    {label.slice(0, 2).toUpperCase()}
                  </div>
                ) : (
                  <div className="h-2.5 w-2.5 rounded-full bg-fg-3" />
                )
              }
              name={label}
              subtitle={named ? `${balance} ${token.symbol ?? ''}`.trim() : balance}
              value={usdValue === undefined ? '—' : formatUsd(usdValue)}
              delta={delta}
              action={
                named ? undefined : (
                  <button
                    type="button"
                    aria-label="Copy mint address"
                    data-testid="copy-mint"
                    onClick={() => void copyMint(token.mint)}
                    className="grid h-8 w-8 place-items-center rounded-full text-fg-2 hover:bg-white/10 hover:text-fg-0"
                  >
                    <Icon name="copy" className="h-3.5 w-3.5" />
                  </button>
                )
              }
              onClick={() =>
                dispatch(
                  showSend({
                    mint: token.mint,
                    symbol: label,
                    balanceSmallest: token.amount,
                    decimals: token.decimals,
                    programId: token.programId,
                    source: token.tokenAccount,
                  }),
                )
              }
            />
          );
        })}
      </div>

      {tokensUnavailable ? (
        <p className="px-3 py-4 text-center text-xs leading-relaxed text-fg-2" data-testid="tokens-unavailable">
          Add an RPC endpoint in <SettingsLink /> to see tokens and NFTs
        </p>
      ) : data.tokensError ? (
        <ErrorCard testId="tokens-error" title="Could not load tokens" body={data.tokensError} onRetry={handleRefresh} />
      ) : rows.length === 0 && query ? (
        <p className="py-6 text-center text-sm text-fg-3">No tokens found</p>
      ) : null}
    </div>
  );
}
