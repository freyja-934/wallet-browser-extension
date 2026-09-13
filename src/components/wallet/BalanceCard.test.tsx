// @vitest-environment jsdom
/**
 * BalanceCard over the real query layer. React Query, `walletService`,
 * `heliusService` and the endpoint rotation all run; only the two boundaries
 * are stubbed — `chrome.runtime.sendMessage`, which is what
 * `extensionClient.getSettings` talks to, and the web3.js `Connection` calls
 * that reach the chain. No hook of the component's own is mocked, so the
 * classification that decides between "the RPC did not answer" and "no
 * endpoint reachable" is the product's, not the test's.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/messages';
import { resetRpcCooldowns } from '../../lib/rpc-rotate';
import { balanceError, pending, stubChain } from '../../test/chain';
import { installChromeStub, uninstallChromeStub } from '../../test/chrome-stub';
import { TEST_ADDRESS } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { BalanceCard } from './BalanceCard';

/** Devnet: one public endpoint, and prices are hidden, so the card is the SOL figure and nothing else. */
function stubWorker(): void {
  const chrome = installChromeStub();
  chrome.runtime.respond((message) => {
    const { type } = message as { type?: string };
    if (type === 'GET_SETTINGS') return { success: true, settings: { ...DEFAULT_SETTINGS, cluster: 'devnet' } };
    return { success: false, error: `unexpected ${String(type)}` };
  });
}

beforeEach(() => {
  resetRpcCooldowns();
  stubWorker();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  uninstallChromeStub();
});

describe('BalanceCard', () => {
  it('renders the error card, not a figure, when the balances query fails', async () => {
    stubChain({ balance: async () => { throw balanceError(TEST_ADDRESS, 'node is unhealthy'); } });

    renderWithProviders(<BalanceCard />);

    const card = await screen.findByTestId('balance-error');
    expect(within(card).getByText('Balance unavailable')).toBeInTheDocument();
    expect(card).toHaveTextContent('node is unhealthy');
    expect(screen.getByTestId('sol-balance')).toHaveTextContent(/^—\s*SOL$/);
  });

  it('renders a dash rather than a zero while the balance is still loading', async () => {
    stubChain({ balance: pending<number> });

    renderWithProviders(<BalanceCard />);

    // The query is in flight for the whole assertion: a dash now and a dash a
    // tick later, never the `0` an "empty means zero" bug would paint.
    expect(screen.getByTestId('sol-balance')).toHaveTextContent(/^—\s*SOL$/);
    await waitFor(() => expect(screen.getByTestId('usd-balance')).toHaveTextContent('Devnet'));
    expect(screen.getByTestId('sol-balance')).toHaveTextContent(/^—\s*SOL$/);
    expect(screen.queryByTestId('balance-error')).not.toBeInTheDocument();
  });

  it('renders the SOL figure the lamports say, exactly', async () => {
    stubChain({ balance: async () => 1_234_500_000 });

    renderWithProviders(<BalanceCard />);

    await waitFor(() => expect(screen.getByTestId('sol-balance')).toHaveTextContent(/^1\.2345\s*SOL$/));
    expect(screen.queryByTestId('balance-error')).not.toBeInTheDocument();
  });

  it('shows the "no endpoint reachable" guidance when nothing answered at all', async () => {
    stubChain({ balance: async () => { throw balanceError(TEST_ADDRESS, 'TypeError: Failed to fetch'); } });

    renderWithProviders(<BalanceCard />);

    const card = await screen.findByTestId('balance-error');
    expect(card).toHaveTextContent('No RPC endpoint reachable from this network');
    expect(within(card).getByTestId('open-settings-link')).toBeInTheDocument();
    // Not the generic line: an unreachable network is a different instruction to the user.
    expect(card).not.toHaveTextContent('The RPC endpoint did not answer');
  });
});
