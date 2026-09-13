// @vitest-environment jsdom
/**
 * The approval window over the chrome stub standing in for the worker. What is
 * under test is the one thing neither the worker tests nor Playwright can see:
 * that the window previews, and names, the account its request is *pinned* to
 * rather than the one that happens to be active.
 *
 * The stub previews the way the worker does — `signerOk` is true only for the
 * account that is actually a required signer — so a window that forgot to pass
 * the pin gets `signerOk: false`, the not-a-signer banner, and an Approve button
 * that can never be pressed. That is the failure this file exists to catch.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type PendingApproval, type WalletAccountInfo } from '../../lib/messages';
import { NOT_A_SIGNER_ERROR } from '../../lib/preview';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../../test/chrome-stub';
import { TEST_ADDRESS } from '../../test/fixtures';
import { ApprovalScreen } from './ApprovalScreen';

/** Any valid address that is not account 0's; stands in for a second derived account. */
const SECOND_ADDRESS = 'Fbfa7UPLAfng7Wkvr2qCrZVPqEwMzLFPvD8McPRfhBkS';

const ACCOUNTS: WalletAccountInfo[] = [
  { address: TEST_ADDRESS, name: 'Account 1', derivationPath: "m/44'/501'/0'/0'", index: 0 },
  { address: SECOND_ADDRESS, name: 'Account 2', derivationPath: "m/44'/501'/1'/0'", index: 1 },
];

/** The account the transaction under test actually needs a signature from. */
const FEE_PAYER_INDEX = 1;

const REQUEST_ID = 'pending-1';

let chrome: ChromeStub;

/** A pending `signTransaction` from a dApp, pinned to whichever account it names. */
function pendingRequest(accountAtEnqueue?: number): PendingApproval {
  const request: PendingApproval = {
    id: REQUEST_ID,
    kind: 'signTransaction',
    origin: 'https://dapp.example',
    createdAt: 0,
    deadline: Date.now() + 60_000,
    transactions: [[1, 2, 3]],
  };
  if (accountAtEnqueue !== undefined) request.accountAtEnqueue = accountAtEnqueue;
  return request;
}

/**
 * The worker as this window sees it: state, settings, the pending request, and a
 * preview built for the account it is asked for — exactly what `previewTransaction`
 * does with its `accountIndex`. The wallet is unlocked and active on account 0.
 */
function stubWorker(request: PendingApproval): void {
  chrome = installChromeStub();
  chrome.runtime.respond((message) => {
    const { type, accountIndex } = message as { type?: string; accountIndex?: number };
    if (type === 'GET_STATE') {
      return {
        success: true,
        state: { hasVault: true, isLocked: false, accounts: ACCOUNTS, activeAccountIndex: 0 },
      };
    }
    if (type === 'GET_SETTINGS') return { success: true, settings: { ...DEFAULT_SETTINGS, cluster: 'devnet' } };
    if (type === 'GET_PENDING_REQUEST') return { success: true, request };
    if (type === 'PREVIEW_TRANSACTION') {
      const signerOk = accountIndex === FEE_PAYER_INDEX;
      return {
        success: true,
        preview: {
          success: signerOk,
          instructions: [],
          warnings: [],
          signerOk,
          unreadable: false,
          ...(signerOk ? {} : { error: NOT_A_SIGNER_ERROR }),
        },
      };
    }
    return { success: false, error: `unexpected ${String(type)}` };
  });
}

/** Every PREVIEW_TRANSACTION the window sent, in order. */
function previewCalls(): { type: string; transaction: number[]; accountIndex?: number }[] {
  return chrome.runtime
    .sent()
    .map((message) => message as { type: string; transaction: number[]; accountIndex?: number })
    .filter((message) => message.type === 'PREVIEW_TRANSACTION');
}

/** jsdom has no media queries; the frame's backdrop reads prefers-reduced-motion on mount. */
function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  stubMatchMedia();
  window.history.replaceState({}, '', `/approve.html?id=${REQUEST_ID}`);
});

afterEach(() => {
  cleanup();
  uninstallChromeStub();
});

describe('ApprovalScreen and the account its request is pinned to', () => {
  it('previews for the pinned account, names it, and leaves Approve pressable', async () => {
    stubWorker(pendingRequest(FEE_PAYER_INDEX));
    render(<ApprovalScreen />);

    // The pin travels with the preview: without it the worker previews for the active
    // account, `signerOk` is false, and the button below can never be enabled.
    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    expect(previewCalls()[0]).toEqual({
      type: 'PREVIEW_TRANSACTION',
      transaction: [1, 2, 3],
      accountIndex: FEE_PAYER_INDEX,
    });

    // And the row says which key is about to sign — the pinned one, not the active one.
    const account = await screen.findByTestId('approval-account');
    expect(account).toHaveTextContent('Account 2');
    expect(account).toHaveTextContent(`${SECOND_ADDRESS.slice(0, 4)}…${SECOND_ADDRESS.slice(-4)}`);

    await waitFor(() => expect(screen.getByTestId('approval-approve')).toBeEnabled());
    expect(screen.queryAllByText(NOT_A_SIGNER_ERROR)).toHaveLength(0);
  });

  it('falls back to the active account when the request pinned none', async () => {
    stubWorker(pendingRequest());
    render(<ApprovalScreen />);

    await waitFor(() => expect(previewCalls()).toHaveLength(1));
    expect(previewCalls()[0]!.accountIndex).toBeUndefined();
    const account = await screen.findByTestId('approval-account');
    expect(account).toHaveTextContent('Account 1');
    // The active account cannot sign this one, and the window says so rather than
    // offering an Approve that would fail.
    // Once in the banner above the request, once on the item it belongs to.
    await waitFor(() => expect(screen.getAllByText(NOT_A_SIGNER_ERROR)).toHaveLength(2));
    expect(screen.getByTestId('approval-approve')).toBeDisabled();
  });
});
