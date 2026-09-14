// @vitest-environment jsdom
/**
 * SendModal over the real query layer and the real Redux slices. The worker is
 * the chrome stub answering `GET_SETTINGS` and `ESTIMATE_FEE`, the chain is the
 * web3.js `Connection`; `parseAmount`, `maxForAsset` and `fromSmallestUnit` are
 * the product's own, so a float creeping into the amount path fails here rather
 * than reaching a signature.
 */

import '@testing-library/jest-dom/vitest';
import {
  ACCOUNT_SIZE,
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Connection, PublicKey, SolanaJSONRPCError, type AccountInfo } from '@solana/web3.js';
import { type QueryClient } from '@tanstack/react-query';
import { Buffer } from 'buffer';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JUPITER_BALANCES_URL, JUPITER_TOKEN_SEARCH_URL } from '../../config/constants';
import { DEFAULT_SETTINGS } from '../../lib/messages';
import { resetRpcCooldowns } from '../../lib/rpc-rotate';
import { FALLBACK_FEE_LAMPORTS } from '../../lib/units';
import { showSend } from '../../store/slices/uiSlice';
import { stubChain } from '../../test/chain';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../../test/chrome-stub';
import { TEST_ADDRESS } from '../../test/fixtures';
import { acceptCrossRealmUint8Arrays } from '../../test/realm';
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

/** A mint the chain confirms, and one it does not. */
const CONFIRMED_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const UNCONFIRMED_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

let chrome: ChromeStub;

function stubWorker(cluster: 'devnet' | 'mainnet-beta' = 'devnet'): void {
  chrome = installChromeStub();
  chrome.runtime.respond((message) => {
    const { type } = message as { type?: string };
    if (type === 'GET_SETTINGS') return { success: true, settings: { ...DEFAULT_SETTINGS, cluster } };
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
  vi.unstubAllGlobals();
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

/**
 * The keyless mainnet list, end to end through the real service and query layer:
 * Jupiter names the mints, `getMultipleAccounts` says what their decimals are and
 * what the wallet's own token account of each one holds, and the send selector is
 * built from the result. The decimals assertion is the point — they are what
 * `parseAmount` converts the typed amount with, so a value taken from Jupiter
 * instead of the chain would be a wrong send amount — and the balance beside it is
 * the account's, not Jupiter's, so Max cannot offer what a send could not move.
 */
describe('SendModal, keyless token list', () => {
  // The list derives the wallet's associated token account per mint to read its balance.
  acceptCrossRealmUint8Arrays();

  /** An SPL mint account; byte 44 is the decimals, byte 45 the initialised flag. */
  function mintAccount(decimals: number): AccountInfo<Buffer> {
    const data = Buffer.alloc(82);
    data.writeUInt8(decimals, 44);
    data.writeUInt8(1, 45);
    return { executable: false, owner: TOKEN_PROGRAM_ID, lamports: 1_461_600, data };
  }

  /** The wallet's own token account of `mint`, holding `amount` smallest units. */
  function tokenAccountInfo(mint: PublicKey, amount: bigint): AccountInfo<Buffer> {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint,
        owner: new PublicKey(TEST_ADDRESS),
        amount,
        delegateOption: 0,
        delegate: PublicKey.default,
        delegatedAmount: 0n,
        state: 1,
        isNativeOption: 0,
        isNative: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data,
    );
    return { executable: false, owner: TOKEN_PROGRAM_ID, lamports: 2_039_280, data };
  }

  /** Mainnet, nothing configured, and a host that refuses `getTokenAccountsByOwner` as publicnode does. */
  async function openOnKeylessMainnet() {
    uninstallChromeStub();
    stubWorker('mainnet-beta');
    stubChain({
      balance: async () => BALANCE_LAMPORTS,
      tokens: async () => {
        throw new SolanaJSONRPCError({ code: -32602, message: 'Request blocked' }, 'failed to get token accounts');
      },
    });
    const confirmed = new PublicKey(CONFIRMED_MINT);
    const holding = getAssociatedTokenAddressSync(confirmed, new PublicKey(TEST_ADDRESS), true, TOKEN_PROGRAM_ID);
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) =>
      // Jupiter claims both mints; only one has a mint account to read and a token
      // account of this wallet's to read a balance out of, and only that one is shown.
      keys.map((key) => {
        const address = key.toBase58();
        if (address === CONFIRMED_MINT) return mintAccount(6);
        if (address === holding.toBase58()) return tokenAccountInfo(confirmed, 1_500_000n);
        return null;
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(`${JUPITER_BALANCES_URL}/`)) {
          return Response.json({
            SOL: { amount: String(BALANCE_LAMPORTS), uiAmount: 1 },
            [CONFIRMED_MINT]: { amount: '1500000', uiAmount: 1.5 },
            [UNCONFIRMED_MINT]: { amount: '99', uiAmount: 99 },
          });
        }
        if (url.startsWith(JUPITER_TOKEN_SEARCH_URL)) {
          return Response.json([{ id: CONFIRMED_MINT, name: 'USD Coin', symbol: 'USDC' }]);
        }
        return Response.json({ jsonrpc: '2.0', id: 'cinder', error: { code: -32601, message: 'Method not found' } });
      }),
    );

    const store = makeStore();
    const view = renderWithProviders(<SendModal />, { store, queryClient: makeQueryClient() });
    store.dispatch(showSend());
    await waitFor(() => expect(screen.getByTestId('send-available')).toHaveTextContent('1.000009973 SOL'));
    return view;
  }

  it('offers the mint the chain confirmed, keyed by mint because no token account is known', async () => {
    await openOnKeylessMainnet();

    const selector = await screen.findByTestId('send-asset');
    await waitFor(() => expect(selector).toHaveTextContent('USDC — 1.5'));

    const values = Array.from(selector.querySelectorAll('option')).map((option) => option.value);
    expect(values).toEqual(['SOL', CONFIRMED_MINT]);
    // The mint whose account could not be read is not offered at any decimals.
    expect(values).not.toContain(UNCONFIRMED_MINT);
  });

  it('converts the typed amount with the decimals the chain gave, not any Jupiter stated', async () => {
    await openOnKeylessMainnet();

    const selector = await screen.findByTestId('send-asset');
    await waitFor(() => expect(selector).toHaveTextContent('USDC'));
    fireEvent.change(selector, { target: { value: CONFIRMED_MINT } });

    await waitFor(() => expect(screen.getByTestId('send-available')).toHaveTextContent('1.5 USDC'));
    fillRecipientAndAcknowledge();

    // Seven decimal places against the six the mint account declares.
    fireEvent.change(amountField(), { target: { value: '0.1234567' } });
    expect(await screen.findByTestId('send-amount-error')).toHaveTextContent('Use at most 6 decimal places');
    expect(screen.getByTestId('send-continue')).toBeDisabled();

    // Six go through, so it was the decimals that blocked it.
    fireEvent.change(amountField(), { target: { value: '0.123456' } });
    await waitFor(() => expect(screen.getByTestId('send-continue')).toBeEnabled());
  });
});
