/**
 * Providers for a component test: the popup's real reducers and a real React
 * Query client. Nothing here stands in for a hook — a component test drives
 * `extensionClient` through the chrome stub and the chain through the web3.js
 * `Connection`, which are the same boundaries the worker tests use, so the
 * query layer, the services and the endpoint rotation all really run.
 *
 * Not a test file itself: `test.include` only collects `*.test.{ts,tsx}`.
 */

import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Provider } from 'react-redux';
import type { WalletAccountInfo } from '../lib/messages';
import uiReducer from '../store/slices/uiSlice';
import walletReducer from '../store/slices/walletSlice';
import { TEST_ADDRESS } from './fixtures';

/** Account 0 of the public test wallet, as the worker reports it. */
export const TEST_ACCOUNT: WalletAccountInfo = {
  address: TEST_ADDRESS,
  name: 'Account 1',
  derivationPath: "m/44'/501'/0'/0'",
  index: 0,
};

/**
 * A store on the real reducers, unlocked with `accounts` already applied —
 * the state the popup is in once `initializeWallet` has answered. Per test,
 * never the app's singleton, so one test cannot leave state for the next.
 */
export function makeStore(accounts: WalletAccountInfo[] = [TEST_ACCOUNT]) {
  return configureStore({
    reducer: { wallet: walletReducer, ui: uiReducer },
    preloadedState: {
      wallet: {
        isInitialized: true,
        hasVault: true,
        isLocked: false,
        isLoading: false,
        error: null,
        accounts,
        activeAccountIndex: 0,
      },
    },
  });
}

export type TestStore = ReturnType<typeof makeStore>;

/**
 * A client with every query's own `retry` intact — a test that breaks the RPC
 * still pays for the retry the product does — but no wait between attempts, so
 * the suite does not sit out React Query's backoff.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0, gcTime: 0 },
      mutations: { retryDelay: 0 },
    },
  });
}

export interface RenderWithProviders extends RenderResult {
  store: TestStore;
  queryClient: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options: { store?: TestStore; queryClient?: QueryClient } = {},
): RenderWithProviders {
  const store = options.store ?? makeStore();
  const queryClient = options.queryClient ?? makeQueryClient();
  const result = render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </Provider>,
  );
  return { ...result, store, queryClient };
}
