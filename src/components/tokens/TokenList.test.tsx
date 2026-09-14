// @vitest-environment jsdom
/**
 * What the token list says about where its numbers came from.
 *
 * The keyless Mainnet list is assembled from a third party's idea of which mints a
 * wallet holds, and the line under it is the wallet's disclosure of that. Two things
 * are pinned here because nothing else pins them: that the line describes what the
 * code actually does, and that a holding left out past the per-refresh cap is not
 * reported as a holding the chain refused — the user can act on the first and not on
 * the second, and blaming the endpoint for the cap points them at the wrong thing.
 *
 * The list itself runs for real: the chrome stub is the worker, the web3.js
 * `Connection` is the chain, and `heliusService` does its own two confirming reads.
 */

import '@testing-library/jest-dom/vitest';
import {
  ACCOUNT_SIZE,
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Connection, PublicKey, SolanaJSONRPCError, type AccountInfo } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JUPITER_BALANCES_URL, JUPITER_TOKEN_SEARCH_URL } from '../../config/constants';
import { DEFAULT_SETTINGS } from '../../lib/messages';
import { resetRpcCooldowns } from '../../lib/rpc-rotate';
import { TEST_ADDRESS } from '../../test/fixtures';
import { acceptCrossRealmUint8Arrays } from '../../test/realm';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../../test/chrome-stub';
import { makeQueryClient, makeStore, renderWithProviders } from '../../test/render';
import { stubChain } from '../../test/chain';
import { TokenList, omittedHoldingsLine } from './TokenList';

/** Held, confirmed, and shown. */
const HELD = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** Reported by Jupiter, with no token account of this wallet's behind it. */
const ELSEWHERE = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

let chrome: ChromeStub;

describe('TokenList, keyless Jupiter source', () => {
  // The list derives the wallet's associated token account per mint to read its balance.
  acceptCrossRealmUint8Arrays();

  function mintAccount(decimals: number): AccountInfo<Buffer> {
    const data = Buffer.alloc(82);
    data.writeUInt8(decimals, 44);
    data.writeUInt8(1, 45);
    return { executable: false, owner: TOKEN_PROGRAM_ID, lamports: 1_461_600, data };
  }

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

  beforeEach(() => {
    chrome = installChromeStub();
    chrome.runtime.respond((message) => {
      const { type } = message as { type?: string };
      if (type === 'GET_SETTINGS') {
        return { success: true, settings: { ...DEFAULT_SETTINGS, cluster: 'mainnet-beta' } };
      }
      return { success: false, error: `unexpected ${String(type)}` };
    });

    stubChain({
      balance: async () => 5_000,
      tokens: async () => {
        throw new SolanaJSONRPCError({ code: -32602, message: 'Request blocked' }, 'failed to get token accounts');
      },
    });

    const held = new PublicKey(HELD);
    const holding = getAssociatedTokenAddressSync(held, new PublicKey(TEST_ADDRESS), true, TOKEN_PROGRAM_ID);
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) =>
      keys.map((key) => {
        const address = key.toBase58();
        // Both mints read fine; only one has a token account of this wallet's behind it.
        if (address === HELD || address === ELSEWHERE) return mintAccount(6);
        if (address === holding.toBase58()) return tokenAccountInfo(held, 1_500_000n);
        return null;
      }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith(`${JUPITER_BALANCES_URL}/`)) {
          return Response.json({
            SOL: { amount: '5000', uiAmount: 0.000005 },
            [HELD]: { amount: '1500000', uiAmount: 1.5 },
            // Jupiter's wallet-level figure for a mint this wallet holds elsewhere.
            [ELSEWHERE]: { amount: '227000000', uiAmount: 227 },
          });
        }
        if (url.startsWith(JUPITER_TOKEN_SEARCH_URL)) {
          return Response.json([{ id: HELD, name: 'USD Coin', symbol: 'USDC' }]);
        }
        return Response.json({});
      }),
    );
  });

  afterEach(() => {
    cleanup();
    uninstallChromeStub();
    resetRpcCooldowns();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('says the mints came from Jupiter and the numbers from the chain, and counts what it dropped', async () => {
    renderWithProviders(<TokenList />, { store: makeStore(), queryClient: makeQueryClient() });

    const note = await screen.findByTestId('tokens-from-jupiter');
    await waitFor(() => expect(screen.getByTestId(`asset-${HELD}`)).toHaveTextContent('1.5'));

    expect(note).toHaveTextContent('this list of mints came from Jupiter');
    expect(note).toHaveTextContent('read from the chain');
    // The holding with no token account behind it is dropped and said out loud.
    expect(note).toHaveTextContent('1 holding the chain would not confirm is not shown.');
    expect(screen.queryByTestId(`asset-${ELSEWHERE}`)).toBeNull();
    // Nothing was past the cap, so nothing claims anything about a cap.
    expect(note).not.toHaveTextContent('one refresh reads');
  });
});

describe('omittedHoldingsLine', () => {
  it('is empty when nothing was left out', () => {
    expect(omittedHoldingsLine(undefined)).toBe('');
    expect(omittedHoldingsLine({ unconfirmed: 0, beyondCap: 0 })).toBe('');
  });

  it('blames the chain only for the holdings the chain was actually asked about', () => {
    expect(omittedHoldingsLine({ unconfirmed: 3, beyondCap: 0 })).toBe(
      '3 holdings the chain would not confirm are not shown.',
    );
  });

  /**
   * The 4,023-mint wallet from the ADR. Every one of the 3,823 past the cap was
   * never asked about, so a line saying their mint accounts could not be read would
   * be false — and would send the user looking for an endpoint problem that is not
   * there, instead of at the cap, which is the thing they can do something about.
   */
  it('says the cap is the cap, and does not report unread holdings as unreadable ones', () => {
    const line = omittedHoldingsLine({ unconfirmed: 0, beyondCap: 3823 });

    expect(line).toBe('3823 further holdings went unread: one refresh reads the first 200 mints Jupiter returned.');
    expect(line).not.toContain('could not be read');
    expect(line).not.toContain('would not confirm');
  });

  it('keeps the two reasons apart when both happened', () => {
    expect(omittedHoldingsLine({ unconfirmed: 1, beyondCap: 12 })).toBe(
      '1 holding the chain would not confirm is not shown. ' +
        '12 further holdings went unread: one refresh reads the first 200 mints Jupiter returned.',
    );
  });
});
