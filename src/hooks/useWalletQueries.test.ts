import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heliusService, type Transaction as ChainTransaction } from '../services/helius';
import { walletService, type WalletBalances } from '../services/wallet';
import { TEST_ADDRESS } from '../test/fixtures';
import {
  balancesQueryOptions,
  nftsQueryOptions,
  pricesQueryOptions,
  tokenNamesQueryOptions,
  transactionsQueryOptions,
  type QueryScope,
} from './useWalletQueries';

const scope: QueryScope = { cluster: 'devnet', primaryUrl: 'https://api.devnet.solana.com' };
const FIRST = TEST_ADDRESS;
const SECOND = 'So11111111111111111111111111111111111111112';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function balancesFor(lamports: string): WalletBalances {
  return { solBalance: Number(lamports) / 1e9, lamports, tokens: [] };
}

function row(signature: string, owner: string): ChainTransaction {
  return {
    signature,
    timestamp: 1_000,
    type: 'unknown',
    status: 'success',
    fee: 0,
    feePayer: owner,
    nativeTransfers: [],
    tokenTransfers: [],
    detailsUnavailable: true,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/*
 * Driven through query-core's observers rather than React: the options are what
 * the hooks hand to `useQuery` / `useInfiniteQuery`, and the observer is what
 * those hooks subscribe to, so what it reports is what the screen renders.
 */
describe('chain query options', () => {
  it('never keeps the previous key\'s data as a placeholder', () => {
    const all = [
      balancesQueryOptions(scope, FIRST),
      pricesQueryOptions('mainnet-beta', []),
      tokenNamesQueryOptions(scope, []),
      nftsQueryOptions(scope, FIRST),
      transactionsQueryOptions(scope, FIRST),
    ];
    for (const options of all) {
      expect(options).not.toHaveProperty('placeholderData');
    }
  });

  it('balances: a new account renders pending, not the previous account\'s balance, until its fetch settles', async () => {
    const second = deferred<WalletBalances>();
    vi.spyOn(walletService, 'getTokenBalances').mockImplementation((address) =>
      address === FIRST ? Promise.resolve(balancesFor('1000')) : second.promise,
    );
    const client = new QueryClient();
    const observer = new QueryObserver(client, balancesQueryOptions(scope, FIRST));
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.lamports).toBe('1000'));

    observer.setOptions(balancesQueryOptions(scope, SECOND));
    const switched = observer.getCurrentResult();
    expect(switched.data).toBeUndefined();
    expect(switched.isPending).toBe(true);
    expect(switched.isPlaceholderData).toBe(false);

    second.resolve(balancesFor('2000'));
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.lamports).toBe('2000'));
    unsubscribe();
    client.clear();
  });

  it('history: a new account drops the previous account\'s rows until its first page arrives', async () => {
    const second = deferred<ChainTransaction[]>();
    vi.spyOn(heliusService, 'getTransactionHistory').mockImplementation((address) =>
      address === FIRST ? Promise.resolve([row('sig-first', FIRST)]) : second.promise,
    );
    const client = new QueryClient();
    const observer = new InfiniteQueryObserver(client, transactionsQueryOptions(scope, FIRST));
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.pages[0]?.[0]?.signature).toBe('sig-first'));
    expect(observer.getCurrentResult().data?.pages[0]?.[0]?.detailsUnavailable).toBe(true);

    observer.setOptions(transactionsQueryOptions(scope, SECOND));
    const switched = observer.getCurrentResult();
    expect(switched.data).toBeUndefined();
    expect(switched.isPending).toBe(true);
    expect(switched.isPlaceholderData).toBe(false);

    second.resolve([row('sig-second', SECOND)]);
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.pages[0]?.[0]?.signature).toBe('sig-second'));
    unsubscribe();
    client.clear();
  });
});
