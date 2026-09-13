import {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from '@wallet-standard/features';
import bs58 from 'bs58';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_SEND_MESSAGE } from '../lib/bridge';
import { WALLET_CHANNEL } from '../lib/messages';
import { TEST_ADDRESS } from '../test/fixtures';

/**
 * `injected.ts` is the provider that runs in the page's own world. It is an
 * IIFE over `window`, so these tests give it a hand-written `window` — an
 * EventTarget with the three members it touches — and drive it the way the
 * content script and the page would. No jsdom: the provider never reads the
 * DOM, and the optional test dependencies are not installed (SHIP-0 item 6).
 */

const ORIGIN = 'https://dapp.example';
/** A second valid base58 address (the System Program), so account lists can change. */
const OTHER_ADDRESS = '11111111111111111111111111111111';
const DEVNET = 'solana:devnet';
const MAINNET = 'solana:mainnet';

/** Everything either side of the bridge puts on the wire. */
interface BridgeMessage {
  channel?: string;
  id?: number;
  type?: string;
  payload?: Record<string, unknown>;
  response?: unknown;
  error?: unknown;
  event?: string;
  accounts?: unknown;
  cluster?: unknown;
}

class WindowShim extends EventTarget {
  readonly location = { origin: ORIGIN };
  readonly posted: { data: BridgeMessage; targetOrigin: string }[] = [];

  /**
   * A browser delivers a same-window `postMessage` back to this window's own
   * listeners, so the provider sees every request it sends. Echoing here is
   * what makes the outbound-request filter testable rather than assumed.
   */
  postMessage(data: BridgeMessage, targetOrigin: string): void {
    this.posted.push({ data, targetOrigin });
    void Promise.resolve().then(() => this.deliver(data));
  }

  /** Dispatch a message event, from this window unless another source is named. */
  deliver(data: BridgeMessage, source: unknown = this): void {
    const event = new Event('message') as Event & { data: BridgeMessage; source: unknown };
    event.data = data;
    event.source = source;
    this.dispatchEvent(event);
  }

  /** The request the provider posted last. */
  lastRequest(): BridgeMessage {
    const last = this.posted.at(-1);
    if (!last) throw new Error('the provider posted nothing');
    return last.data;
  }

  /** Answer the last outbound request the way the content script would. */
  reply(response: Record<string, unknown>): void {
    this.deliver({ channel: WALLET_CHANNEL, id: this.lastRequest().id, response });
  }
}

type RegisterApi = { register: (...wallets: Wallet[]) => () => void };

/** Let the provider's outbound post echo, and any reply settle. */
const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** A fresh provider over a fresh window, with whatever it registered at load. */
async function loadProvider(): Promise<{ shim: WindowShim; registered: Wallet[] }> {
  vi.resetModules();
  const shim = new WindowShim();
  (globalThis as { window?: unknown }).window = shim;
  const registered: Wallet[] = [];
  // Registered before the import: `registerWallet` dispatches during it.
  shim.addEventListener('wallet-standard:register-wallet', (event) => {
    const { detail } = event as Event & { detail: (api: RegisterApi) => void };
    detail({
      register: (...wallets) => {
        registered.push(...wallets);
        return () => undefined;
      },
    });
  });
  await import('./injected');
  return { shim, registered };
}

/** The app announcing itself after the provider loaded; returns what it was handed. */
function announceApp(shim: WindowShim): Wallet[] {
  const late: Wallet[] = [];
  const event = new Event('wallet-standard:app-ready') as Event & { detail: RegisterApi };
  event.detail = {
    register: (...wallets) => {
      late.push(...wallets);
      return () => undefined;
    },
  };
  shim.dispatchEvent(event);
  return late;
}

const connectFeature = (wallet: Wallet) =>
  (wallet.features as unknown as StandardConnectFeature)[StandardConnect];
const disconnectFeature = (wallet: Wallet) =>
  (wallet.features as unknown as StandardDisconnectFeature)[StandardDisconnect];
const eventsFeature = (wallet: Wallet) =>
  (wallet.features as unknown as StandardEventsFeature)[StandardEvents];
const signTransactionFeature = (wallet: Wallet) =>
  (wallet.features as unknown as SolanaSignTransactionFeature)[SolanaSignTransaction];
const signAndSendFeature = (wallet: Wallet) =>
  (wallet.features as unknown as SolanaSignAndSendTransactionFeature)[SolanaSignAndSendTransaction];
const signMessageFeature = (wallet: Wallet) =>
  (wallet.features as unknown as SolanaSignMessageFeature)[SolanaSignMessage];

/** Connect the wallet to `addresses` on `cluster`, as the worker's answer would. */
async function connect(
  shim: WindowShim,
  wallet: Wallet,
  addresses: string[] = [TEST_ADDRESS],
  cluster = 'devnet',
): Promise<readonly WalletAccount[]> {
  const connecting = connectFeature(wallet).connect();
  await tick();
  shim.reply({ success: true, accounts: addresses, cluster });
  return (await connecting).accounts;
}

beforeEach(() => {
  // Every `send` arms a PAGE_TIMEOUT_MS timer; faking them keeps none of it
  // outliving the test. Nothing under test waits on a timer.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

describe('registration', () => {
  it('registers one wallet at load and again when the app announces itself', async () => {
    const { shim, registered } = await loadProvider();
    expect(registered).toHaveLength(1);

    const wallet = registered[0]!;
    expect(wallet.name).toBe('Cinder Wallet');
    // The Wallet Standard version, not the app's.
    expect(wallet.version).toBe('1.0.0');
    expect(wallet.chains).toEqual([MAINNET, DEVNET]);
    expect(wallet.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Object.keys(wallet.features).sort()).toEqual(
      [
        SolanaSignAndSendTransaction,
        SolanaSignMessage,
        SolanaSignTransaction,
        StandardConnect,
        StandardDisconnect,
        StandardEvents,
      ].sort(),
    );

    // An app that loaded after the provider gets the same wallet object.
    expect(announceApp(shim)).toEqual([wallet]);

    // Wallet Standard only: nothing is written onto the page's window.
    const globals = shim as unknown as Record<string, unknown>;
    expect(globals.solana).toBeUndefined();
    expect(globals.phantom).toBeUndefined();
    expect(globals.isPhantom).toBeUndefined();
  });
});

describe('connect', () => {
  it('asks the worker, then exposes the accounts it answered with', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;

    const connecting = connectFeature(wallet).connect();
    await tick();
    const request = shim.lastRequest();
    expect(request).toMatchObject({ channel: WALLET_CHANNEL, type: 'WALLET_CONNECT', payload: { silent: false } });
    expect(typeof request.id).toBe('number');
    // Posted to this page's own origin, never '*'.
    expect(shim.posted.at(-1)!.targetOrigin).toBe(ORIGIN);

    shim.reply({ success: true, accounts: [TEST_ADDRESS], cluster: 'devnet' });
    const { accounts } = await connecting;

    expect(accounts.map((account) => account.address)).toEqual([TEST_ADDRESS]);
    // An account may only sign for the cluster the wallet is actually on.
    expect(accounts[0]!.chains).toEqual([DEVNET]);
    expect(accounts[0]!.publicKey).toEqual(bs58.decode(TEST_ADDRESS));
    expect(accounts[0]!.features).toEqual([SolanaSignTransaction, SolanaSignAndSendTransaction, SolanaSignMessage]);
    expect(wallet.accounts).toEqual(accounts);
  });

  it('passes silent through and answers with nothing when there is nothing to show', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;

    const connecting = connectFeature(wallet).connect({ silent: true });
    await tick();
    expect(shim.lastRequest()).toMatchObject({ type: 'WALLET_CONNECT', payload: { silent: true } });

    shim.reply({ success: true, accounts: [], cluster: 'mainnet-beta' });
    expect((await connecting).accounts).toEqual([]);
    expect(wallet.accounts).toEqual([]);
  });

  it('rejects with the reason the worker gave', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;

    const connecting = connectFeature(wallet).connect();
    await tick();
    shim.reply({ success: false, error: 'User rejected' });
    await expect(connecting).rejects.toThrow('User rejected');
    expect(wallet.accounts).toEqual([]);
  });
});

describe('the outbound-request filter', () => {
  it('ignores its own echoed request and any reply that carries a type', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;

    const connecting = connectFeature(wallet).connect();
    await tick();
    const { id } = shim.lastRequest();
    // The echo of the request itself has already been delivered and ignored...
    expect(wallet.accounts).toEqual([]);

    // ...and so is a reply dressed up as one: `type` means outbound, whatever else it carries.
    shim.deliver({
      channel: WALLET_CHANNEL,
      id,
      type: 'WALLET_CONNECT',
      response: { success: true, accounts: [OTHER_ADDRESS], cluster: 'devnet' },
    });
    // Nor does a message from another window, or another channel, answer it.
    shim.deliver({ channel: WALLET_CHANNEL, id, response: { success: true, accounts: [OTHER_ADDRESS] } }, {});
    shim.deliver({ channel: 'not-cinder', id, response: { success: true, accounts: [OTHER_ADDRESS] } });
    await tick();
    expect(wallet.accounts).toEqual([]);

    // The real reply still lands.
    shim.reply({ success: true, accounts: [TEST_ADDRESS], cluster: 'devnet' });
    expect((await connecting).accounts.map((account) => account.address)).toEqual([TEST_ADDRESS]);
  });
});

describe('signTransaction', () => {
  it('sends a batch as one request and maps the answers back in order', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    const [account] = await connect(shim, wallet);

    const signing = signTransactionFeature(wallet).signTransaction(
      { account: account!, transaction: Uint8Array.from([1, 2, 3]) },
      { account: account!, transaction: Uint8Array.from([4, 5]) },
    );
    await tick();
    const posted = shim.posted.filter((entry) => entry.data.type === 'SIGN_TRANSACTION');
    expect(posted).toHaveLength(1);
    // The account every input named travels with the batch; the worker resolves it.
    expect(posted[0]!.data.payload).toEqual({ transactions: [[1, 2, 3], [4, 5]], account: TEST_ADDRESS });

    shim.reply({ success: true, signedTransactions: [[9, 9], [8]] });
    expect(await signing).toEqual([
      { signedTransaction: Uint8Array.from([9, 9]) },
      { signedTransaction: Uint8Array.from([8]) },
    ]);
  });

  it('refuses an answer that does not line up with the batch', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    const [account] = await connect(shim, wallet);

    const signing = signTransactionFeature(wallet).signTransaction(
      { account: account!, transaction: Uint8Array.from([1]) },
      { account: account!, transaction: Uint8Array.from([2]) },
    );
    await tick();
    shim.reply({ success: true, signedTransactions: [[9]] });
    await expect(signing).rejects.toThrow('Sign failed');
  });

  it('refuses a batch whose inputs name two different accounts, before posting anything', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    // Two accounts this wallet really holds; one approval can only sign with one key.
    const [first, second] = await connect(shim, wallet, [TEST_ADDRESS, OTHER_ADDRESS]);

    await expect(
      signTransactionFeature(wallet).signTransaction(
        { account: first!, transaction: Uint8Array.from([1]) },
        { account: second!, transaction: Uint8Array.from([2]) },
      ),
    ).rejects.toThrow('All inputs must use the same account');
    await expect(
      signMessageFeature(wallet).signMessage(
        { account: first!, message: Uint8Array.from([1]) },
        { account: second!, message: Uint8Array.from([2]) },
      ),
    ).rejects.toThrow('All inputs must use the same account');
    expect(shim.posted.some((entry) => entry.data.type?.startsWith('SIGN_'))).toBe(false);

    // The second account on its own is sent as the account to sign with.
    const signing = signTransactionFeature(wallet).signTransaction({ account: second!, transaction: Uint8Array.from([3]) });
    await tick();
    expect(shim.lastRequest().payload).toEqual({ transactions: [[3]], account: OTHER_ADDRESS });
    shim.reply({ success: true, signedTransactions: [[9]] });
    await signing;
  });

  it('refuses an account this wallet does not have, before posting anything', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    const [account] = await connect(shim, wallet);
    const stranger = { ...account!, address: OTHER_ADDRESS };

    await expect(
      signTransactionFeature(wallet).signTransaction({ account: stranger, transaction: Uint8Array.from([1]) }),
    ).rejects.toThrow('Invalid account');
    expect(shim.posted.some((entry) => entry.data.type === 'SIGN_TRANSACTION')).toBe(false);
  });
});

describe('signAndSendTransaction', () => {
  it('answers with the 64 raw signature bytes', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    const [account] = await connect(shim, wallet);

    const sending = signAndSendFeature(wallet).signAndSendTransaction({
      account: account!,
      chain: DEVNET,
      transaction: Uint8Array.from([1, 2, 3]),
      options: { commitment: 'confirmed', skipPreflight: true },
    });
    await tick();
    // Exactly these fields: the account the input named travels with the only arm
    // that broadcasts, so dropping it cannot pass here.
    expect(shim.lastRequest().payload).toEqual({
      transactions: [[1, 2, 3]],
      chain: DEVNET,
      account: TEST_ADDRESS,
      options: { commitment: 'confirmed', skipPreflight: true },
    });
    expect(shim.lastRequest().type).toBe('SIGN_AND_SEND_TRANSACTION');

    const bytes = Array.from({ length: 64 }, (_, i) => i);
    shim.reply({ success: true, signatures: [bytes] });
    const [output] = await sending;
    // Raw bytes, not the digits of a base58 string.
    expect(output!.signature).toBeInstanceOf(Uint8Array);
    expect(output!.signature).toHaveLength(64);
    expect([...output!.signature]).toEqual(bytes);
  });

  it('takes one transaction per call and posts nothing for a batch', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    const [account] = await connect(shim, wallet);

    await expect(
      signAndSendFeature(wallet).signAndSendTransaction(
        { account: account!, chain: DEVNET, transaction: Uint8Array.from([1]) },
        { account: account!, chain: DEVNET, transaction: Uint8Array.from([2]) },
      ),
    ).rejects.toThrow(SINGLE_SEND_MESSAGE);
    expect(shim.posted.some((entry) => entry.data.type === 'SIGN_AND_SEND_TRANSACTION')).toBe(false);
  });
});

describe('signMessage', () => {
  it('returns each signature beside the message it signed', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    const [account] = await connect(shim, wallet);

    const signing = signMessageFeature(wallet).signMessage(
      { account: account!, message: Uint8Array.from([104, 105]) },
      { account: account!, message: Uint8Array.from([111]) },
    );
    await tick();
    expect(shim.lastRequest().payload).toEqual({ messages: [[104, 105], [111]], account: TEST_ADDRESS });

    shim.reply({ success: true, signatures: [[1], [2]] });
    expect(await signing).toEqual([
      { signedMessage: Uint8Array.from([104, 105]), signature: Uint8Array.from([1]) },
      { signedMessage: Uint8Array.from([111]), signature: Uint8Array.from([2]) },
    ]);
  });
});

describe('wallet events from the worker', () => {
  it('emits change when the account list actually changes, and not when it does not', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    const changes: { accounts: readonly WalletAccount[] }[] = [];
    eventsFeature(wallet).on('change', (properties) => {
      changes.push({ accounts: properties.accounts ?? [] });
    });

    shim.deliver({ channel: WALLET_CHANNEL, event: 'accountsChanged', accounts: [TEST_ADDRESS, OTHER_ADDRESS], cluster: 'devnet' });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.accounts.map((account) => account.address)).toEqual([TEST_ADDRESS, OTHER_ADDRESS]);
    expect(changes[0]!.accounts[0]!.chains).toEqual([DEVNET]);

    // The same list again is not a change; dApps compare accounts by identity.
    shim.deliver({ channel: WALLET_CHANNEL, event: 'accountsChanged', accounts: [TEST_ADDRESS, OTHER_ADDRESS], cluster: 'devnet' });
    expect(changes).toHaveLength(1);
    expect(wallet.accounts[0]).toBe(changes[0]!.accounts[0]);

    // A cluster switch re-stamps every account's chains without a reconnect.
    shim.deliver({ channel: WALLET_CHANNEL, event: 'clusterChanged', accounts: [TEST_ADDRESS, OTHER_ADDRESS], cluster: 'mainnet-beta' });
    expect(changes).toHaveLength(2);
    expect(changes[1]!.accounts[0]!.chains).toEqual([MAINNET]);

    // Locking, revoking and disconnecting all empty the list.
    shim.deliver({ channel: WALLET_CHANNEL, event: 'locked' });
    expect(changes).toHaveLength(3);
    expect(changes[2]!.accounts).toEqual([]);
    expect(wallet.accounts).toEqual([]);
  });

  it('ignores an event from another window and an unknown event name', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    await connect(shim, wallet);
    const changes: unknown[] = [];
    eventsFeature(wallet).on('change', (properties) => changes.push(properties));

    shim.deliver({ channel: WALLET_CHANNEL, event: 'locked' }, {});
    shim.deliver({ channel: WALLET_CHANNEL, event: 'somethingElse', accounts: [] });
    expect(changes).toEqual([]);
    expect(wallet.accounts.map((account) => account.address)).toEqual([TEST_ADDRESS]);
  });

  it('a listener that throws does not stop the others', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    const seen: string[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    eventsFeature(wallet).on('change', () => {
      throw new Error('dApp handler blew up');
    });
    eventsFeature(wallet).on('change', () => seen.push('second'));

    shim.deliver({ channel: WALLET_CHANNEL, event: 'accountsChanged', accounts: [TEST_ADDRESS], cluster: 'devnet' });
    expect(seen).toEqual(['second']);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('disconnect', () => {
  it('tells the worker and empties the account list', async () => {
    const { shim, registered } = await loadProvider();
    const wallet = registered[0]!;
    await connect(shim, wallet);
    const changes: unknown[] = [];
    eventsFeature(wallet).on('change', (properties) => changes.push(properties));

    const disconnecting = disconnectFeature(wallet).disconnect();
    await tick();
    expect(shim.lastRequest()).toMatchObject({ type: 'WALLET_DISCONNECT' });
    shim.reply({ success: true, disconnected: true });
    await disconnecting;

    expect(wallet.accounts).toEqual([]);
    expect(changes).toHaveLength(1);
  });
});
