// @vitest-environment jsdom
/**
 * SendModal over the real query layer and the real Redux slices. The worker is
 * the chrome stub answering `GET_SETTINGS` and `ESTIMATE_FEE`, the chain is the
 * web3.js `Connection`; `parseAmount`, `maxForAsset` and `fromSmallestUnit` are
 * the product's own, so a float creeping into the amount path fails here rather
 * than reaching a signature.
 */

import '@testing-library/jest-dom/vitest';
import { type QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/messages';
import { resetRpcCooldowns } from '../../lib/rpc-rotate';
import { FALLBACK_FEE_LAMPORTS } from '../../lib/units';
import { showSend } from '../../store/slices/uiSlice';
import { stubChain } from '../../test/chain';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../../test/chrome-stub';
import { makeQueryClient, makeStore, renderWithProviders } from '../../test/render';
import { SendModal } from './SendModal';

/**
 * A balance chosen so float math is visibly wrong: `1000009973 / 1e9 - 7500 / 1e9`
 * is `1.0000024730000001` in IEEE 754, sixteen decimal places, which `parseAmount`
 * then refuses for being finer than SOL. The integer path gives `1.000002473`.
 */
const BALANCE_LAMPORTS = 1_000_009_973;
/**
 * Deliberately not `FALLBACK_FEE_LAMPORTS`: Max has to spend the fee the worker
 * quoted, and a test that used the fallback's own number could not tell the two apart.
 */
const FEE_LAMPORTS = 7500n;
/** Any valid on-curve address that is not the sender. */
const RECIPIENT = 'Fbfa7UPLAfng7Wkvr2qCrZVPqEwMzLFPvD8McPRfhBkS';

let chrome: ChromeStub;

function stubWorker(): void {
  chrome = installChromeStub();
  chrome.runtime.respond((message) => {
    const { type } = message as { type?: string };
    if (type === 'GET_SETTINGS') return { success: true, settings: { ...DEFAULT_SETTINGS, cluster: 'devnet' } };
    if (type === 'ESTIMATE_FEE') {
      return {
        success: true,
        feeLamports: FEE_LAMPORTS.toString(),
        rentExemptMin: '890880',
        recipient: { exists: true, walletExists: true, isTokenAccount: false, offCurve: false },
      };
    }
    return { success: false, error: `unexpected ${String(type)}` };
  });
}

function sentTypes(): string[] {
  return chrome.runtime.sent().map((message) => String((message as { type?: unknown }).type));
}

/** The modal open on SOL with the balance loaded. */
async function openSendModal() {
  stubChain({ balance: async () => BALANCE_LAMPORTS });
  const store = makeStore();
  const queryClient = makeQueryClient();
  const view = renderWithProviders(<SendModal />, { store, queryClient });
  store.dispatch(showSend());

  await waitFor(() => expect(screen.getByTestId('send-available')).toHaveTextContent('1.000009973 SOL'));
  return view;
}

/**
 * Wait until the worker has priced a send and no read is still in flight. Max
 * spends the quoted fee, so a test that raced this read would silently measure
 * the fallback instead and pass for the wrong reason.
 */
async function feeQuoted(queryClient: QueryClient): Promise<void> {
  await waitFor(() => {
    expect(sentTypes()).toContain('ESTIMATE_FEE');
    expect(queryClient.isFetching()).toBe(0);
  });
}

function amountField(): HTMLInputElement {
  return screen.getByTestId('send-amount') as HTMLInputElement;
}

/** Fill in everything a Continue needs apart from the amount. */
function fillRecipientAndAcknowledge(): void {
  fireEvent.change(screen.getByTestId('send-recipient'), { target: { value: RECIPIENT } });
  fireEvent.click(screen.getByTestId('send-ack'));
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

describe('SendModal', () => {
  it('Max fills the integer amount the balance minus the quoted fee leaves', async () => {
    const { queryClient } = await openSendModal();
    // The fee is priced against the recipient, so name one before reading it.
    fillRecipientAndAcknowledge();
    await feeQuoted(queryClient);

    fireEvent.click(screen.getByTestId('send-max'));

    // The balance less the quoted 7,500 lamports, in exact units.
    expect(amountField().value).toBe('1.000002473');
    // Not what float math would have produced, and not the fixed fallback fee
    // either: Max spends the fee this send was actually priced at.
    expect(amountField().value).not.toBe(String(BALANCE_LAMPORTS / 1e9 - Number(FEE_LAMPORTS) / 1e9));
    expect(amountField().value).not.toBe(
      String((BALANCE_LAMPORTS - Number(FALLBACK_FEE_LAMPORTS)) / 1e9),
    );
    expect(screen.queryByTestId('send-amount-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-continue')).toBeEnabled();
  });

  it('refuses an amount finer than the asset and keeps Continue out of reach', async () => {
    await openSendModal();
    fillRecipientAndAcknowledge();

    // Ten decimal places; SOL has nine.
    fireEvent.change(amountField(), { target: { value: '0.0000000001' } });

    expect(await screen.findByTestId('send-amount-error')).toHaveTextContent('Use at most 9 decimal places');
    expect(screen.getByTestId('send-continue')).toBeDisabled();

    // The same form with a payable amount goes through, so it was the decimals
    // that blocked it and not a field this test forgot to fill.
    fireEvent.change(amountField(), { target: { value: '0.5' } });
    await waitFor(() => expect(screen.getByTestId('send-continue')).toBeEnabled());
    expect(screen.queryByTestId('send-amount-error')).not.toBeInTheDocument();
  });

  it('shows the quoted fee on the Review pane', async () => {
    await openSendModal();
    fillRecipientAndAcknowledge();
    fireEvent.change(amountField(), { target: { value: '0.5' } });

    await waitFor(() => expect(screen.getByTestId('send-continue')).toBeEnabled());
    fireEvent.click(screen.getByTestId('send-continue'));

    // 7,500 lamports as SOL, not "…" and not "Unavailable".
    await waitFor(() => expect(screen.getByTestId('send-fee')).toHaveTextContent('0.0000075 SOL'));
  });
});
