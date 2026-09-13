/**
 * The popup's store must never see a secret. The thunks that carried one
 * (create, unlock, change-password, export seed, export private key) are gone;
 * these tests dispatch everything that is left against a real worker router and
 * fail if a password or a mnemonic word turns up in any action.
 */

import { configureStore, type Middleware, type UnknownAction } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMessage } from '../../background/router';
import { resetKeyringForTests } from '../../background/keyring';
import { installChromeStub, STUB_EXTENSION_ID, uninstallChromeStub, type ChromeStub } from '../../test/chrome-stub';
import { TEST_ADDRESS, TEST_MNEMONIC, TEST_PASSWORD } from '../../test/fixtures';
import uiReducer from './uiSlice';
import walletReducer, {
  clearWalletData,
  initializeWallet,
  lockWallet,
  sendTransaction,
  setActiveAccount,
  setError,
} from './walletSlice';
import * as walletSlice from './walletSlice';

const SIGNATURE = '5'.repeat(88);

/** The broadcast itself is not under test here; only what the store keeps about it. */
const rpc = vi.hoisted(() => ({ sendTransfer: vi.fn<[unknown], Promise<string>>() }));
vi.mock('../../background/transfers', () => ({
  getConnection: async () => ({}),
  sendTransfer: (params: unknown) => rpc.sendTransfer(params),
  estimateTransfer: async () => {
    throw new Error('not under test');
  },
}));

const BASE = `chrome-extension://${STUB_EXTENSION_ID}/`;
const popup = { origin: `chrome-extension://${STUB_EXTENSION_ID}`, url: `${BASE}index.html` };

let chromeStub: ChromeStub;
let actions: UnknownAction[];

/** Everything the store was asked to do, including each thunk's pending/fulfilled pair. */
const record: Middleware = () => (next) => (action) => {
  actions.push(action as UnknownAction);
  return next(action);
};

function makeStore() {
  return configureStore({
    reducer: { wallet: walletReducer, ui: uiReducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(record),
  });
}

beforeEach(() => {
  chromeStub = installChromeStub();
  resetKeyringForTests();
  actions = [];
  rpc.sendTransfer.mockReset();
  rpc.sendTransfer.mockResolvedValue(SIGNATURE);
  // The popup's client talks to the real router, so these are the actions the
  // extension actually dispatches, not ones a hand-written fake made up.
  chromeStub.runtime.sendMessage = async (message: unknown) => {
    try {
      const value = await handleMessage(message, popup, BASE);
      return { success: true, ...value } as never;
    } catch (error) {
      return { success: false, error: (error as Error).message } as never;
    }
  };
});

afterEach(() => {
  uninstallChromeStub();
});

/** The vault the popup will read, created the way the onboarding flow does: not through Redux. */
async function createFixtureWallet(): Promise<void> {
  await handleMessage({ type: 'CREATE_WALLET', password: TEST_PASSWORD, seedPhrase: TEST_MNEMONIC }, popup, BASE);
}

describe('walletSlice', () => {
  it('holds only public state after every remaining thunk', async () => {
    await createFixtureWallet();
    const store = makeStore();

    await store.dispatch(initializeWallet());
    expect(store.getState().wallet).toMatchObject({
      isInitialized: true,
      hasVault: true,
      isLocked: false,
      activeAccountIndex: 0,
    });
    expect(store.getState().wallet.accounts[0]?.address).toBe(TEST_ADDRESS);

    await store.dispatch(
      sendTransaction({ to: TEST_ADDRESS, amountSmallest: '1000' }),
    );
    store.dispatch(setActiveAccount(0));
    store.dispatch(setError('Something went wrong'));
    await store.dispatch(lockWallet());
    expect(store.getState().wallet.isLocked).toBe(true);

    await store.dispatch(clearWalletData());
    expect(store.getState().wallet).toMatchObject({ hasVault: false, isLocked: true, accounts: [] });

    // Every action that ran, and the state they left behind.
    expect(actions.length).toBeGreaterThan(8);
    const seen = JSON.stringify({ actions, state: store.getState() });
    expect(seen).not.toContain(TEST_PASSWORD);
    for (const word of new Set(TEST_MNEMONIC.split(' '))) {
      expect(seen).not.toContain(word);
    }
    expect(seen).not.toContain('seedB64');
    expect(seen).not.toContain('secretKey');
  });

  it('keeps a failed send out of the store except as a message', async () => {
    await createFixtureWallet();
    const store = makeStore();
    rpc.sendTransfer.mockRejectedValue(new Error('Blockhash expired'));
    await store.dispatch(sendTransaction({ to: TEST_ADDRESS, amountSmallest: '1000' }));
    expect(store.getState().wallet.error).toBe('Blockhash expired');

    const seen = JSON.stringify({ actions, state: store.getState() });
    expect(seen).not.toContain(TEST_PASSWORD);
    expect(seen).not.toContain('abandon');
  });

  it('exports no thunk that takes a password or a phrase', () => {
    for (const name of ['createWallet', 'unlockWallet', 'changePassword', 'exportSeedPhrase', 'exportPrivateKey']) {
      expect(walletSlice).not.toHaveProperty(name);
    }
  });

  /**
   * The names above are the thunks that used to carry a secret; a new one would
   * be called something else and walk past that list. So this one asks the
   * module what it exports: every thunk is dispatched with a sentinel string
   * where its argument goes, and the sentinel must not turn up in what the store
   * keeps (payloads, state) or in anything the popup then says to the worker.
   * A thunk that carries a password does both, whatever it is named.
   *
   * `meta.arg` is the one place excluded, and only because Redux Toolkit stamps
   * it on every thunk's actions whether the thunk reads it or not — which is the
   * whole reason no thunk may be handed a secret in the first place.
   */
  it('no exported thunk forwards its argument, whatever the thunk is called', async () => {
    await createFixtureWallet();
    const store = makeStore();
    const SENTINEL = 'sentinel-not-a-real-secret-0a1b2c';

    const sentToWorker: unknown[] = [];
    const toRouter = chromeStub.runtime.sendMessage;
    chromeStub.runtime.sendMessage = async (message: unknown) => {
      sentToWorker.push(message);
      return toRouter(message as never);
    };

    // Whatever the module exports that looks like a thunk, by shape, not by name.
    const thunks = Object.values(walletSlice as Record<string, unknown>).filter(
      (value) => typeof value === 'function' && typeof (value as { typePrefix?: unknown }).typePrefix === 'string',
    ) as Array<(arg: unknown) => never>;
    // If the module ever stops exporting thunks, this test has stopped testing anything.
    expect(thunks.length).toBeGreaterThan(0);

    for (const thunk of thunks) {
      await store.dispatch(thunk(SENTINEL));
    }

    const recorded = actions.map((action) => ({
      type: action.type,
      payload: (action as { payload?: unknown }).payload,
      error: (action as { error?: unknown }).error,
    }));
    const seen = JSON.stringify({ recorded, state: store.getState(), sentToWorker });
    expect(seen).not.toContain(SENTINEL);
    // The worker was actually spoken to, so the check above had something to look at.
    expect(sentToWorker.length).toBeGreaterThanOrEqual(thunks.length);
  });
});
