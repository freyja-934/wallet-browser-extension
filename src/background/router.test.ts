import { PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TRANSACTION_BYTES } from '../lib/bridge';
import type { PendingApproval, WalletPublicState } from '../lib/messages';
import { installChromeStub, STUB_EXTENSION_ID, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import { TEST_ADDRESS, TEST_MNEMONIC, TEST_PASSWORD } from '../test/fixtures';
import { installApprovalLifecycle, onWindowRemoved } from './approvals';
import { resetKeyringForTests } from './keyring';
import { CONFIRMATION_POLL_MS, CONFIRMATION_TIMEOUT_MS, handleMessage } from './router';

/** The RPC the router broadcasts through, replaced so a test can hold a broadcast open. */
const rpc = vi.hoisted(() => ({
  sendRawTransaction: vi.fn<[Uint8Array, unknown], Promise<string>>(),
  getSignatureStatuses: vi.fn<[string[]], Promise<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>>(),
}));
vi.mock('./transfers', () => ({
  getConnection: async () => ({
    sendRawTransaction: rpc.sendRawTransaction,
    getSignatureStatuses: rpc.getSignatureStatuses,
  }),
  sendTransfer: async () => {
    throw new Error('not under test');
  },
}));

const BASE = `chrome-extension://${STUB_EXTENSION_ID}/`;
const popup = { origin: `chrome-extension://${STUB_EXTENSION_ID}`, url: `${BASE}index.html` };
const page = { origin: 'https://dapp.example', url: 'https://dapp.example/app', tab: { id: 7 }, frameId: 0 };
const otherPage = { origin: 'https://other.example', url: 'https://other.example/', tab: { id: 8 }, frameId: 0 };

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
  resetKeyringForTests();
  rpc.sendRawTransaction.mockReset();
  rpc.getSignatureStatuses.mockReset();
});

afterEach(() => {
  uninstallChromeStub();
});

/** The fixture wallet on Mainnet, whatever `VITE_NETWORK` the build environment carries. */
async function createFixtureWallet(): Promise<WalletPublicState> {
  const result = await handleMessage(
    { type: 'CREATE_WALLET', password: TEST_PASSWORD, seedPhrase: TEST_MNEMONIC },
    popup,
    BASE,
  );
  await handleMessage({ type: 'UPDATE_SETTINGS', settings: { cluster: 'mainnet-beta' } }, popup, BASE);
  return result.state as WalletPublicState;
}

/** Connect `sender` the way a user would: prompt, then Approve in the window. */
async function connectPage(sender: { origin?: string; url?: string; tab?: { id?: number }; frameId?: number }): Promise<string> {
  const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, sender, BASE)) as { pendingId: string };
  await handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, popup, BASE);
  return pendingId;
}

/** A v0 self-transfer of 0 lamports from the fixture account, as bytes. */
function selfTransfer(): number[] {
  const payer = new PublicKey(TEST_ADDRESS);
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })],
  }).compileToV0Message();
  return [...new VersionedTransaction(message).serialize()];
}

const SIGNATURE_BYTES = Array.from({ length: 64 }, (_, i) => i);
const SIGNATURE = bs58.encode(Uint8Array.from(SIGNATURE_BYTES));
const MAINNET = { accounts: [TEST_ADDRESS], cluster: 'mainnet-beta' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const poll = (id: string, sender = page) => handleMessage({ type: 'POLL_APPROVAL', id }, sender, BASE);
const approve = (id: string) => handleMessage({ type: 'APPROVE_REQUEST', id }, popup, BASE);

/**
 * A connected page asks to sign-and-send, Approve is clicked, and the broadcast
 * is held open. Returns the handle to release it and the in-progress approve.
 */
async function startBroadcast() {
  await createFixtureWallet();
  await connectPage(page);
  const { pendingId } = (await handleMessage(
    { type: 'SIGN_AND_SEND_TRANSACTION', transactions: [selfTransfer()] },
    page,
    BASE,
  )) as { pendingId: string };
  const broadcast = deferred<string>();
  rpc.sendRawTransaction.mockReturnValueOnce(broadcast.promise);
  const approving = approve(pendingId);
  await vi.waitFor(() => expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1));
  return { pendingId, broadcast, approving };
}

describe('handleMessage', () => {
  it('rejects a privileged type from a page before touching the payload', async () => {
    await expect(handleMessage({ type: 'EXPORT_SEED', password: TEST_PASSWORD }, page, BASE)).rejects.toThrow(
      'Not allowed from a page',
    );
    expect(chromeStub.windows.created()).toEqual([]);
    expect(chromeStub.storage.local.snapshot()).toEqual({});
  });

  it('refuses every privileged type from a page without touching storage', async () => {
    await createFixtureWallet();
    const before = chromeStub.storage.local.snapshot();
    const privileged = [
      { type: 'UNLOCK', password: TEST_PASSWORD },
      { type: 'GET_STATE' },
      { type: 'CLEAR_WALLET' },
      { type: 'GET_PENDING_REQUEST', id: 'any' },
    ];
    for (const raw of privileged) {
      await expect(handleMessage(raw, page, BASE)).rejects.toThrow('Not allowed from a page');
    }
    expect(chromeStub.storage.local.snapshot()).toEqual(before);
    expect(chromeStub.windows.created()).toEqual([]);
  });

  it('rejects a non-string UNLOCK password before consulting the keyring', async () => {
    // Fresh install: the keyring would say 'No wallet found', so 'Invalid password'
    // proves the parser rejected the payload first.
    await expect(handleMessage({ type: 'UNLOCK', password: 42 }, popup, BASE)).rejects.toThrow('Invalid password');
    expect(chromeStub.storage.session.snapshot()).toEqual({});
  });

  it('rejects unknown and non-string types', async () => {
    for (const raw of [{ type: 'STEAL' }, { type: 1 }, {}, null, 'GET_STATE']) {
      await expect(handleMessage(raw, popup, BASE)).rejects.toThrow('Unknown message type');
    }
  });

  it('reports no vault to the popup on a fresh install', async () => {
    const result = await handleMessage({ type: 'GET_STATE' }, popup, BASE);
    expect(result.state).toEqual({ hasVault: false, isLocked: true, accounts: [], activeAccountIndex: 0 });
  });

  it('creates the fixture wallet unlocked and derives the fixture address', async () => {
    const created = await createFixtureWallet();
    expect(created.hasVault).toBe(true);
    expect(created.isLocked).toBe(false);

    const { state } = (await handleMessage({ type: 'GET_STATE' }, popup, BASE)) as { state: WalletPublicState };
    expect(state.hasVault).toBe(true);
    expect(state.isLocked).toBe(false);
    expect(state.activeAccountIndex).toBe(0);
    expect(state.accounts[0]?.address).toBe(TEST_ADDRESS);
    expect(chromeStub.storage.session.snapshot()).toHaveProperty('cinder_session');
    expect(chromeStub.alarms.scheduled()).toHaveProperty('cinder-autolock');
  });

  it('locks, then answers GET_ACCOUNTS with nothing for a connected page', async () => {
    await createFixtureWallet();
    await connectPage(page);
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, page, BASE)).resolves.toEqual({ accounts: [TEST_ADDRESS] });
    const { state } = (await handleMessage({ type: 'LOCK' }, popup, BASE)) as { state: WalletPublicState };
    expect(state.isLocked).toBe(true);
    expect(state.accounts).toEqual([]);
    expect(chromeStub.alarms.scheduled()).toEqual({});
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, page, BASE)).resolves.toEqual({ accounts: [] });
  });

  it('refuses GET_ACCOUNTS and every SIGN_* from an origin that never connected', async () => {
    await createFixtureWallet();
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, page, BASE)).rejects.toThrow('Not connected');
    await expect(handleMessage({ type: 'SIGN_MESSAGE', messages: [[1]] }, page, BASE)).rejects.toThrow('Not connected');
    await expect(handleMessage({ type: 'SIGN_TRANSACTION', transactions: [[1]] }, page, BASE)).rejects.toThrow(
      'Not connected',
    );
    await expect(handleMessage({ type: 'SIGN_AND_SEND_TRANSACTION', transactions: [[1]] }, page, BASE)).rejects.toThrow(
      'Not connected',
    );
    expect(chromeStub.windows.created()).toEqual([]);
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty('cinder_pending');
  });

  it('a connect approval records the origin; a second connect returns accounts with no window', async () => {
    await createFixtureWallet();
    await connectPage(page);
    expect(chromeStub.windows.created()).toHaveLength(1);
    expect(chromeStub.storage.local.snapshot().cinder_connected).toMatchObject({
      [page.origin]: { accountIndexes: [0] },
    });

    await expect(handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)).resolves.toEqual(MAINNET);
    expect(chromeStub.windows.created()).toHaveLength(1);

    // Another origin is still a stranger.
    const other = (await handleMessage({ type: 'WALLET_CONNECT' }, otherPage, BASE)) as { pendingId?: string };
    expect(other.pendingId).toEqual(expect.any(String));
    expect(chromeStub.windows.created()).toHaveLength(2);
  });

  it('a silent connect from a stranger returns no accounts and opens nothing', async () => {
    await createFixtureWallet();
    await expect(handleMessage({ type: 'WALLET_CONNECT', silent: true }, page, BASE)).resolves.toEqual({
      accounts: [],
      cluster: 'mainnet-beta',
    });
    expect(chromeStub.windows.created()).toEqual([]);
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty('cinder_connected');

    // Once connected, silent gets the accounts like any other connect.
    await connectPage(page);
    await expect(handleMessage({ type: 'WALLET_CONNECT', silent: true }, page, BASE)).resolves.toEqual(MAINNET);
    expect(chromeStub.windows.created()).toHaveLength(1);
  });

  it('WALLET_DISCONNECT and REVOKE_SITE forget the origin so the next connect prompts again', async () => {
    await createFixtureWallet();
    await connectPage(page);
    await expect(handleMessage({ type: 'WALLET_DISCONNECT' }, page, BASE)).resolves.toEqual({ disconnected: true });
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, page, BASE)).rejects.toThrow('Not connected');
    const again = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId?: string };
    expect(again.pendingId).toEqual(expect.any(String));
    await handleMessage({ type: 'APPROVE_REQUEST', id: again.pendingId! }, popup, BASE);

    const { sites } = (await handleMessage({ type: 'GET_CONNECTED_SITES' }, popup, BASE)) as {
      sites: { origin: string }[];
    };
    expect(sites.map((site) => site.origin)).toEqual([page.origin]);
    await expect(handleMessage({ type: 'REVOKE_SITE', origin: page.origin }, page, BASE)).rejects.toThrow(
      'Not allowed from a page',
    );
    await expect(handleMessage({ type: 'REVOKE_SITE', origin: page.origin }, popup, BASE)).resolves.toEqual({});
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, page, BASE)).rejects.toThrow('Not connected');
  });

  it('records the tab and frame of every page message in the session registry', async () => {
    await createFixtureWallet();
    await handleMessage({ type: 'WALLET_CONNECT', silent: true }, page, BASE);
    await handleMessage({ type: 'WALLET_CONNECT', silent: true }, { ...otherPage, frameId: 2 }, BASE);
    await handleMessage({ type: 'GET_STATE' }, { ...popup, tab: { id: 99 }, frameId: 0 }, BASE);
    expect(chromeStub.storage.session.snapshot().cinder_tabs).toEqual({
      '7:0': page.origin,
      '8:2': otherPage.origin,
    });
  });

  it('CANCEL_APPROVAL from the page rejects its own pending request', async () => {
    await createFixtureWallet();
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };
    await expect(handleMessage({ type: 'CANCEL_APPROVAL', id: pendingId }, page, BASE)).resolves.toEqual({});
    await expect(handleMessage({ type: 'POLL_APPROVAL', id: pendingId }, page, BASE)).resolves.toEqual({
      status: 'rejected',
      error: 'Request timeout',
    });
    await expect(handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, popup, BASE)).rejects.toThrow(
      'Approval expired',
    );
  });

  it('WALLET_CONNECT while locked opens the approval window, which unlocks inline, then approves', async () => {
    await createFixtureWallet();
    await handleMessage({ type: 'LOCK' }, popup, BASE);

    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };
    const [approveWindow] = chromeStub.windows.created();
    expect(approveWindow?.options.url).toBe(`${BASE}approve.html?id=${encodeURIComponent(pendingId)}`);
    expect(chromeStub.windows.created().some((w) => String(w.options.url).endsWith('index.html'))).toBe(false);

    // Approve before unlocking neither connects the origin nor settles the request.
    await expect(handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, popup, BASE)).rejects.toThrow(
      'Wallet is locked',
    );
    await expect(handleMessage({ type: 'POLL_APPROVAL', id: pendingId }, page, BASE)).resolves.toEqual({
      status: 'pending',
    });
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty('cinder_connected');
  });

  it('a locked connect approved after an inline unlock returns the accounts', async () => {
    await createFixtureWallet();
    await handleMessage({ type: 'LOCK' }, popup, BASE);
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };
    await handleMessage({ type: 'UNLOCK', password: TEST_PASSWORD }, popup, BASE);
    await expect(handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, popup, BASE)).resolves.toEqual({});
    await expect(handleMessage({ type: 'POLL_APPROVAL', id: pendingId }, page, BASE)).resolves.toEqual({
      status: 'approved',
      value: { connected: true, accounts: [TEST_ADDRESS], publicKey: TEST_ADDRESS, cluster: 'mainnet-beta' },
    });
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, page, BASE)).resolves.toEqual({ accounts: [TEST_ADDRESS] });
  });

  it('SIGN_MESSAGE while locked queues an approval that cannot be fulfilled until unlock', async () => {
    // The approval window renders the unlock form; APPROVE_REQUEST before that fails at the keyring.
    await createFixtureWallet();
    await connectPage(page);
    await handleMessage({ type: 'LOCK' }, popup, BASE);

    const { pendingId } = (await handleMessage({ type: 'SIGN_MESSAGE', messages: [[104, 105]] }, page, BASE)) as {
      pendingId: string;
    };
    expect(pendingId).toEqual(expect.any(String));
    const [, approveWindow] = chromeStub.windows.created();
    expect(approveWindow?.options.url).toBe(`${BASE}approve.html?id=${encodeURIComponent(pendingId)}`);

    await expect(handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, popup, BASE)).rejects.toThrow(
      'Wallet is locked',
    );
    await expect(handleMessage({ type: 'POLL_APPROVAL', id: pendingId }, page, BASE)).resolves.toEqual({
      status: 'pending',
    });
  });

  it('binds WALLET_CONNECT to the sender origin, ignoring one in the payload', async () => {
    await createFixtureWallet();

    const { pendingId } = (await handleMessage(
      { type: 'WALLET_CONNECT', origin: 'https://evil.example' },
      page,
      BASE,
    )) as { pendingId: string };

    const { request } = (await handleMessage({ type: 'GET_PENDING_REQUEST', id: pendingId }, popup, BASE)) as {
      request: PendingApproval | null;
    };
    expect(request?.kind).toBe('connect');
    expect(request?.origin).toBe(page.origin);

    const [approveWindow] = chromeStub.windows.created();
    expect(approveWindow?.options).toMatchObject({
      url: `${BASE}approve.html?id=${encodeURIComponent(pendingId)}`,
      type: 'popup',
    });
  });

  it('falls back to the origin of sender.url when sender.origin is missing, so paths of one site share a grant', async () => {
    await createFixtureWallet();
    const app = { url: 'https://dapp.example/app', tab: { id: 7 }, frameId: 0 };
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, app, BASE)) as { pendingId: string };
    const { request } = (await handleMessage({ type: 'GET_PENDING_REQUEST', id: pendingId }, popup, BASE)) as {
      request: PendingApproval | null;
    };
    expect(request?.origin).toBe('https://dapp.example');
    await approve(pendingId);

    const other = { url: 'https://dapp.example/other?x=1#y', tab: { id: 7 }, frameId: 0 };
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, other, BASE)).resolves.toEqual({ accounts: [TEST_ADDRESS] });
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, page, BASE)).resolves.toEqual({ accounts: [TEST_ADDRESS] });
    expect(Object.keys(chromeStub.storage.local.snapshot().cinder_connected as object)).toEqual(['https://dapp.example']);
  });

  it('refuses an opaque, empty, missing or path-bearing origin before remembering or enqueueing anything', async () => {
    await createFixtureWallet();
    const untrusted = [
      { origin: 'null', url: 'https://dapp.example/app', tab: { id: 9 }, frameId: 0 },
      { origin: '', url: 'https://dapp.example/app', tab: { id: 9 }, frameId: 0 },
      { origin: 'https://dapp.example/app', tab: { id: 9 }, frameId: 0 },
      { origin: `chrome-extension://${'z'.repeat(32)}`, tab: { id: 9 }, frameId: 0 },
      { url: 'file:///tmp/page.html', tab: { id: 9 }, frameId: 0 },
      { tab: { id: 9 }, frameId: 0 },
      {},
    ];
    for (const sender of untrusted) {
      for (const raw of [{ type: 'WALLET_CONNECT' }, { type: 'WALLET_CONNECT', silent: true }, { type: 'GET_ACCOUNTS' }]) {
        await expect(handleMessage(raw, sender, BASE), JSON.stringify(sender)).rejects.toThrow('Untrusted sender');
      }
    }
    expect(chromeStub.windows.created()).toEqual([]);
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty('cinder_tabs');
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty('cinder_pending');
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty('cinder_connected');
  });

  it('two sandboxed frames never share a grant, with each other or with the site that hosts them', async () => {
    await createFixtureWallet();
    await connectPage(page);
    const sandboxA = { origin: 'null', url: 'https://dapp.example/frame-a', tab: { id: 7 }, frameId: 1 };
    const sandboxB = { origin: 'null', url: 'https://other.example/frame-b', tab: { id: 8 }, frameId: 1 };
    for (const sender of [sandboxA, sandboxB]) {
      await expect(handleMessage({ type: 'GET_ACCOUNTS' }, sender, BASE)).rejects.toThrow('Untrusted sender');
      await expect(handleMessage({ type: 'WALLET_CONNECT' }, sender, BASE)).rejects.toThrow('Untrusted sender');
      await expect(handleMessage({ type: 'SIGN_MESSAGE', messages: [[1]] }, sender, BASE)).rejects.toThrow('Untrusted sender');
    }
    expect(Object.keys(chromeStub.storage.local.snapshot().cinder_connected as object)).toEqual([page.origin]);
    expect(chromeStub.storage.session.snapshot().cinder_tabs).toEqual({ '7:0': page.origin });
  });

  it('re-arms auto-lock on a popup message but not on a page message', async () => {
    await createFixtureWallet();
    await chromeStub.alarms.clear('cinder-autolock');
    await handleMessage({ type: 'WALLET_CONNECT', silent: true }, page, BASE);
    expect(chromeStub.alarms.scheduled()).not.toHaveProperty('cinder-autolock');
    await handleMessage({ type: 'GET_STATE' }, popup, BASE);
    expect(chromeStub.alarms.scheduled()).toHaveProperty('cinder-autolock');
  });

  it('a connected origin while locked: a plain connect prompts, a silent one gets no accounts and no window', async () => {
    await createFixtureWallet();
    await connectPage(page);
    await handleMessage({ type: 'LOCK' }, popup, BASE);
    expect(chromeStub.windows.created()).toHaveLength(1);

    await expect(handleMessage({ type: 'WALLET_CONNECT', silent: true }, page, BASE)).resolves.toEqual({
      accounts: [],
      cluster: 'mainnet-beta',
    });
    expect(chromeStub.windows.created()).toHaveLength(1);

    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };
    expect(pendingId).toEqual(expect.any(String));
    expect(chromeStub.windows.created()).toHaveLength(2);
    expect(chromeStub.windows.created()[1].options.url).toBe(`${BASE}approve.html?id=${encodeURIComponent(pendingId)}`);
  });

  it('CANCEL_APPROVAL and POLL_APPROVAL from another page leave the request pending', async () => {
    await createFixtureWallet();
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };
    await expect(handleMessage({ type: 'CANCEL_APPROVAL', id: pendingId }, otherPage, BASE)).rejects.toThrow(
      'Approval expired',
    );
    await expect(poll(pendingId, otherPage)).rejects.toThrow('Approval expired');
    await expect(poll(pendingId)).resolves.toEqual({ status: 'pending' });
    expect(chromeStub.windows.removed()).toEqual([]);
    await approve(pendingId);
    // A settled record is guarded the same way, and the mismatch does not consume it.
    await expect(poll(pendingId, otherPage)).rejects.toThrow('Approval expired');
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved' });
  });

  it('refuses APPROVE_REQUEST from the requesting page itself', async () => {
    await createFixtureWallet();
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };

    await expect(handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, page, BASE)).rejects.toThrow(
      'Not allowed from a page',
    );
    await expect(handleMessage({ type: 'POLL_APPROVAL', id: pendingId }, page, BASE)).resolves.toEqual({
      status: 'pending',
    });
  });

  it('completes a connect approval with the fixture account', async () => {
    await createFixtureWallet();
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };

    await expect(handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, popup, BASE)).resolves.toEqual({});
    await expect(handleMessage({ type: 'POLL_APPROVAL', id: pendingId }, page, BASE)).resolves.toEqual({
      status: 'approved',
      value: { connected: true, accounts: [TEST_ADDRESS], publicKey: TEST_ADDRESS, cluster: 'mainnet-beta' },
    });
  });

  it('rejects a malformed transaction from a page and from the popup', async () => {
    await createFixtureWallet();
    for (const transaction of ['AQ==', [], [256], new Array(MAX_TRANSACTION_BYTES + 1).fill(0)]) {
      await expect(handleMessage({ type: 'SIGN_TRANSACTION', transactions: [transaction] }, page, BASE)).rejects.toThrow(
        'Invalid transactions',
      );
      await expect(handleMessage({ type: 'SIGN_TRANSACTION', transactions: transaction }, page, BASE)).rejects.toThrow(
        'Invalid transactions',
      );
      await expect(handleMessage({ type: 'PREVIEW_TRANSACTION', transaction }, popup, BASE)).rejects.toThrow(
        'Invalid transaction',
      );
    }
    expect(chromeStub.windows.created()).toEqual([]);
  });

  it('rejects a bad password on UNLOCK without leaking anything else', async () => {
    await createFixtureWallet();
    await handleMessage({ type: 'LOCK' }, popup, BASE);
    await expect(handleMessage({ type: 'UNLOCK', password: 'wrong' }, popup, BASE)).rejects.toThrow('Invalid password');
    const { state } = (await handleMessage({ type: 'GET_STATE' }, popup, BASE)) as { state: WalletPublicState };
    expect(state.isLocked).toBe(true);
  });
});

describe('APPROVE_REQUEST claims the request before fulfilling it', () => {
  it('a CANCEL_APPROVAL from the page during the broadcast does not turn the result into a rejection', async () => {
    const { pendingId, broadcast, approving } = await startBroadcast();
    await expect(handleMessage({ type: 'CANCEL_APPROVAL', id: pendingId }, page, BASE)).resolves.toEqual({});
    await expect(poll(pendingId)).resolves.toEqual({ status: 'pending' });
    broadcast.resolve(SIGNATURE);
    await expect(approving).resolves.toEqual({});
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved', value: { signatures: [SIGNATURE_BYTES] } });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(chromeStub.windows.removed()).toEqual([]);
  });

  it('the approval window closing during the broadcast does not either', async () => {
    const { pendingId, broadcast, approving } = await startBroadcast();
    const [, signWindow] = chromeStub.windows.created();
    await onWindowRemoved(signWindow.id);
    broadcast.resolve(SIGNATURE);
    await approving;
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved', value: { signatures: [SIGNATURE_BYTES] } });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('a LOCK during the broadcast does not either: the page learns the real outcome', async () => {
    const { pendingId, broadcast, approving } = await startBroadcast();
    const { state } = (await handleMessage({ type: 'LOCK' }, popup, BASE)) as { state: WalletPublicState };
    expect(state.isLocked).toBe(true);
    broadcast.resolve(SIGNATURE);
    await approving;
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved', value: { signatures: [SIGNATURE_BYTES] } });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('two concurrent APPROVE_REQUESTs broadcast once; the loser is told the request is gone', async () => {
    await createFixtureWallet();
    await connectPage(page);
    const { pendingId } = (await handleMessage(
      { type: 'SIGN_AND_SEND_TRANSACTION', transactions: [selfTransfer()] },
      page,
      BASE,
    )) as { pendingId: string };
    const broadcast = deferred<string>();
    rpc.sendRawTransaction.mockReturnValue(broadcast.promise);
    const first = approve(pendingId);
    const second = approve(pendingId);
    await expect(second).rejects.toThrow('Approval expired');
    broadcast.resolve(SIGNATURE);
    await expect(first).resolves.toEqual({});
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved', value: { signatures: [SIGNATURE_BYTES] } });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('a failed broadcast settles the request as rejected and it can never be approved again', async () => {
    const { pendingId, broadcast, approving } = await startBroadcast();
    broadcast.reject(new Error('Blockhash not found'));
    await expect(approving).rejects.toThrow('Blockhash not found');
    await expect(approve(pendingId)).rejects.toThrow('Approval expired');
    await expect(poll(pendingId)).resolves.toEqual({ status: 'rejected', error: 'Blockhash not found' });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('an Approve after the page deadline throws and never signs or broadcasts', async () => {
    await createFixtureWallet();
    await connectPage(page);
    const { pendingId } = (await handleMessage(
      { type: 'SIGN_AND_SEND_TRANSACTION', transactions: [selfTransfer()] },
      page,
      BASE,
    )) as { pendingId: string };
    const pending = chromeStub.storage.session.snapshot().cinder_pending as Record<string, PendingApproval>;
    pending[pendingId].deadline = Date.now() - 1;
    await chromeStub.storage.session.set({ cinder_pending: pending });

    await expect(approve(pendingId)).rejects.toThrow('Approval expired');
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    await expect(poll(pendingId)).resolves.toEqual({ status: 'rejected', error: 'Approval expired' });
    await expect(approve(pendingId)).rejects.toThrow('Approval expired');
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe('a site losing its grant rejects what it had pending', () => {
  async function pendingSign(): Promise<string> {
    await createFixtureWallet();
    await connectPage(page);
    const { pendingId } = (await handleMessage({ type: 'SIGN_MESSAGE', messages: [[104, 105]] }, page, BASE)) as {
      pendingId: string;
    };
    await expect(poll(pendingId)).resolves.toEqual({ status: 'pending' });
    return pendingId;
  }

  it('REVOKE_SITE from the popup', async () => {
    const pendingId = await pendingSign();
    await handleMessage({ type: 'REVOKE_SITE', origin: page.origin }, popup, BASE);
    await expect(poll(pendingId)).resolves.toEqual({ status: 'rejected', error: 'Site revoked' });
    await expect(approve(pendingId)).rejects.toThrow('Approval expired');
  });

  it('WALLET_DISCONNECT from the page', async () => {
    const pendingId = await pendingSign();
    await handleMessage({ type: 'WALLET_DISCONNECT' }, page, BASE);
    await expect(poll(pendingId)).resolves.toEqual({ status: 'rejected', error: 'Disconnected' });
    await expect(approve(pendingId)).rejects.toThrow('Approval expired');
  });

  it('a revoke that races Approve loses: the claim re-checks the grant', async () => {
    const pendingId = await pendingSign();
    // Revoke the grant underneath the pending request without going through the router.
    await chrome.storage.local.remove('cinder_connected');
    await expect(approve(pendingId)).rejects.toThrow('Approval expired');
    await expect(poll(pendingId)).resolves.toEqual({ status: 'rejected', error: 'Not connected' });
  });
});

describe('the page closing', () => {
  it('rejects its pending request as Page closed and closes the approval window', async () => {
    installApprovalLifecycle();
    await createFixtureWallet();
    await connectPage(page);
    const { pendingId } = (await handleMessage({ type: 'SIGN_MESSAGE', messages: [[1]] }, page, BASE)) as {
      pendingId: string;
    };
    const [, signWindow] = chromeStub.windows.created();

    chromeStub.tabs.onRemoved.emit(page.tab.id);
    await vi.waitFor(() => {
      expect(chromeStub.windows.removed()).toEqual([signWindow.id]);
      // ...and the tab left the delivery registry.
      expect(chromeStub.storage.session.snapshot().cinder_tabs).toEqual({});
    });
    await expect(poll(pendingId)).resolves.toEqual({ status: 'rejected', error: 'Page closed' });
    await expect(approve(pendingId)).rejects.toThrow('Approval expired');
  });

  it('a pagehide cancel from the content script closes the window too', async () => {
    await createFixtureWallet();
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };
    const [connectWindow] = chromeStub.windows.created();
    await handleMessage({ type: 'CANCEL_APPROVAL', id: pendingId }, page, BASE);
    expect(chromeStub.windows.removed()).toEqual([connectWindow.id]);
    await expect(poll(pendingId)).resolves.toEqual({ status: 'rejected', error: 'Request timeout' });
  });
});

describe('UPDATE_SETTINGS rpc fields', () => {
  const update = (settings: Record<string, unknown>) =>
    handleMessage({ type: 'UPDATE_SETTINGS', settings }, popup, BASE) as Promise<{
      settings: { rpcUrl?: string; rpcUrlCluster?: string; heliusApiKey?: string };
    }>;
  const stored = () => chromeStub.storage.local.snapshot().cinder_settings as Record<string, unknown> | undefined;

  it('trims the URL before storing it', async () => {
    const { settings } = await update({ rpcUrl: '  https://rpc.example/v1  ' });
    expect(settings.rpcUrl).toBe('https://rpc.example/v1');
    expect(stored()?.rpcUrl).toBe('https://rpc.example/v1');
  });

  it("'' and whitespace both clear the URL", async () => {
    await update({ rpcUrl: 'https://rpc.example', rpcUrlCluster: 'devnet' });
    const cleared = await update({ rpcUrl: '' });
    expect(cleared.settings.rpcUrl).toBeUndefined();
    expect(cleared.settings.rpcUrlCluster).toBeUndefined();
    expect(stored()).not.toHaveProperty('rpcUrl');
    expect(stored()).not.toHaveProperty('rpcUrlCluster');

    await update({ rpcUrl: 'https://rpc.example' });
    const blank = await update({ rpcUrl: '  \t ' });
    expect(blank.settings.rpcUrl).toBeUndefined();
    expect(stored()).not.toHaveProperty('rpcUrl');
  });

  it('refuses an http URL before storing anything', async () => {
    await expect(update({ rpcUrl: 'http://rpc.example' })).rejects.toThrow('Invalid settings.rpcUrl');
    expect(stored()).toBeUndefined();
  });

  it("refuses a key containing '&' before storing anything", async () => {
    await expect(update({ heliusApiKey: 'abc&limit=1' })).rejects.toThrow('Invalid settings.heliusApiKey');
    expect(stored()).toBeUndefined();
  });

  it('stores the cluster the URL was probed against', async () => {
    const { settings } = await update({ rpcUrl: 'https://rpc.example', rpcUrlCluster: 'mainnet-beta' });
    expect(settings.rpcUrlCluster).toBe('mainnet-beta');
    expect(stored()?.rpcUrlCluster).toBe('mainnet-beta');
  });
});

/** The signature slot of a signed transaction, checked against the fixture key. */
function verifySigned(bytes: number[]): boolean {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
  const signature = tx.signatures[0];
  return nacl.sign.detached.verify(tx.message.serialize(), signature, new PublicKey(TEST_ADDRESS).toBytes());
}

describe('batched sign requests', () => {
  async function connected(): Promise<void> {
    await createFixtureWallet();
    await connectPage(page);
  }

  it('SIGN_TRANSACTION with two transactions opens one window and answers with two signed transactions in order', async () => {
    await connected();
    const legacy = new Transaction({ feePayer: new PublicKey(TEST_ADDRESS), recentBlockhash: PublicKey.default.toBase58() })
      .add(SystemProgram.transfer({ fromPubkey: new PublicKey(TEST_ADDRESS), toPubkey: new PublicKey(TEST_ADDRESS), lamports: 1 }));
    const transactions = [selfTransfer(), [...legacy.serialize({ requireAllSignatures: false })]];
    const { pendingId } = (await handleMessage({ type: 'SIGN_TRANSACTION', transactions }, page, BASE)) as { pendingId: string };
    expect(chromeStub.windows.created()).toHaveLength(2);
    const { request } = (await handleMessage({ type: 'GET_PENDING_REQUEST', id: pendingId }, popup, BASE)) as {
      request: PendingApproval | null;
    };
    expect(request).toMatchObject({ kind: 'signTransaction', transactions });
    expect(request).not.toHaveProperty('chain');
    expect(request).not.toHaveProperty('options');

    await approve(pendingId);
    const result = (await poll(pendingId)) as { status: string; value: { signedTransactions: number[][] } };
    expect(result.status).toBe('approved');
    expect(result.value.signedTransactions).toHaveLength(2);
    // Same order as the request, each one signed by the fixture account (the legacy one as legacy bytes).
    expect(VersionedTransaction.deserialize(Uint8Array.from(result.value.signedTransactions[0])).version).toBe(0);
    expect(VersionedTransaction.deserialize(Uint8Array.from(result.value.signedTransactions[1])).version).toBe('legacy');
    expect(result.value.signedTransactions.every(verifySigned)).toBe(true);
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('SIGN_AND_SEND_TRANSACTION broadcasts every item in order and returns one 64-byte signature each', async () => {
    await connected();
    const second = Array.from({ length: 64 }, (_, i) => 63 - i);
    rpc.sendRawTransaction.mockResolvedValueOnce(SIGNATURE).mockResolvedValueOnce(bs58.encode(Uint8Array.from(second)));
    const { pendingId } = (await handleMessage(
      { type: 'SIGN_AND_SEND_TRANSACTION', transactions: [selfTransfer(), selfTransfer()] },
      page,
      BASE,
    )) as { pendingId: string };
    await approve(pendingId);
    await expect(poll(pendingId)).resolves.toEqual({ status: 'approved', value: { signatures: [SIGNATURE_BYTES, second] } });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(rpc.sendRawTransaction.mock.calls[0][1]).toEqual({ skipPreflight: false });
    expect(rpc.getSignatureStatuses).not.toHaveBeenCalled();
  });

  it('SIGN_MESSAGE with three messages is one approval and three signatures in order', async () => {
    await connected();
    const messages = [[1], [], [2, 3]];
    const { pendingId } = (await handleMessage({ type: 'SIGN_MESSAGE', messages }, page, BASE)) as { pendingId: string };
    expect(chromeStub.windows.created()).toHaveLength(2);
    const { request } = (await handleMessage({ type: 'GET_PENDING_REQUEST', id: pendingId }, popup, BASE)) as {
      request: PendingApproval | null;
    };
    expect(request).toMatchObject({ kind: 'signMessage', messages });
    await approve(pendingId);
    const result = (await poll(pendingId)) as { status: string; value: { signatures: number[][] } };
    expect(result.status).toBe('approved');
    expect(result.value.signatures).toHaveLength(3);
    const publicKey = new PublicKey(TEST_ADDRESS).toBytes();
    messages.forEach((message, i) => {
      expect(result.value.signatures[i]).toHaveLength(64);
      expect(nacl.sign.detached.verify(Uint8Array.from(message), Uint8Array.from(result.value.signatures[i]), publicKey)).toBe(true);
    });
  });

  it('a second request from the same origin while a batch is pending is still refused', async () => {
    await connected();
    await handleMessage({ type: 'SIGN_TRANSACTION', transactions: [selfTransfer(), selfTransfer()] }, page, BASE);
    await expect(handleMessage({ type: 'SIGN_MESSAGE', messages: [[1]] }, page, BASE)).rejects.toThrow(
      'A request is already pending for this site',
    );
    expect(chromeStub.windows.created()).toHaveLength(2);
  });
});

describe('the chain a page names', () => {
  async function connected(): Promise<void> {
    await createFixtureWallet();
    await connectPage(page);
  }
  const sign = (chain: string) =>
    handleMessage({ type: 'SIGN_TRANSACTION', transactions: [selfTransfer()], chain }, page, BASE);

  it('accepts the active cluster and an absent chain; the pending request records the chain', async () => {
    await connected();
    const { pendingId } = (await sign('solana:mainnet')) as { pendingId: string };
    const { request } = (await handleMessage({ type: 'GET_PENDING_REQUEST', id: pendingId }, popup, BASE)) as {
      request: PendingApproval | null;
    };
    expect(request?.chain).toBe('solana:mainnet');
    await handleMessage({ type: 'REJECT_REQUEST', id: pendingId }, popup, BASE);
    await expect(handleMessage({ type: 'SIGN_TRANSACTION', transactions: [selfTransfer()] }, page, BASE)).resolves.toMatchObject({
      pendingId: expect.any(String),
    });
  });

  it('refuses the other cluster with a Settings hint and opens no window', async () => {
    await connected();
    await expect(sign('solana:devnet')).rejects.toThrow('Cinder is on Mainnet; switch networks in Settings');
    await handleMessage({ type: 'UPDATE_SETTINGS', settings: { cluster: 'devnet' } }, popup, BASE);
    await expect(sign('solana:mainnet')).rejects.toThrow('Cinder is on Devnet; switch networks in Settings');
    await expect(
      handleMessage({ type: 'SIGN_AND_SEND_TRANSACTION', transactions: [selfTransfer()], chain: 'solana:mainnet' }, page, BASE),
    ).rejects.toThrow('Cinder is on Devnet; switch networks in Settings');
    expect(chromeStub.windows.created()).toHaveLength(1);
    expect(chromeStub.storage.session.snapshot().cinder_pending ?? {}).toEqual({});
    // Now devnet is the active cluster.
    await expect(sign('solana:devnet')).resolves.toMatchObject({ pendingId: expect.any(String) });
  });

  it('refuses testnet and localnet whatever the cluster', async () => {
    await connected();
    for (const chain of ['solana:testnet', 'solana:localnet']) {
      await expect(sign(chain)).rejects.toThrow('Cinder does not support that network');
    }
    await expect(sign('solana:goerli')).rejects.toThrow('Invalid chain');
    expect(chromeStub.windows.created()).toHaveLength(1);
  });

  it('reports the active cluster on every connect answer', async () => {
    await createFixtureWallet();
    await handleMessage({ type: 'UPDATE_SETTINGS', settings: { cluster: 'devnet' } }, popup, BASE);
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };
    await approve(pendingId);
    await expect(poll(pendingId)).resolves.toEqual({
      status: 'approved',
      value: { connected: true, accounts: [TEST_ADDRESS], publicKey: TEST_ADDRESS, cluster: 'devnet' },
    });
    await expect(handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)).resolves.toEqual({
      accounts: [TEST_ADDRESS],
      cluster: 'devnet',
    });
  });
});

describe('send options', () => {
  async function pendingSend(options: Record<string, unknown>): Promise<string> {
    await createFixtureWallet();
    await connectPage(page);
    const { pendingId } = (await handleMessage(
      { type: 'SIGN_AND_SEND_TRANSACTION', transactions: [selfTransfer()], options },
      page,
      BASE,
    )) as { pendingId: string };
    return pendingId;
  }

  it('forwards the four sendRawTransaction options and nothing else', async () => {
    const pendingId = await pendingSend({
      skipPreflight: true,
      preflightCommitment: 'processed',
      maxRetries: 2,
      minContextSlot: 9,
    });
    rpc.sendRawTransaction.mockResolvedValueOnce(SIGNATURE);
    await approve(pendingId);
    expect(rpc.sendRawTransaction.mock.calls[0][1]).toEqual({
      skipPreflight: true,
      preflightCommitment: 'processed',
      maxRetries: 2,
      minContextSlot: 9,
    });
    expect(rpc.getSignatureStatuses).not.toHaveBeenCalled();
    await expect(poll(pendingId)).resolves.toEqual({ status: 'approved', value: { signatures: [SIGNATURE_BYTES] } });
  });

  it('with a commitment, waits for the signature to reach it before answering', async () => {
    const pendingId = await pendingSend({ commitment: 'confirmed' });
    rpc.sendRawTransaction.mockResolvedValueOnce(SIGNATURE);
    rpc.getSignatureStatuses
      .mockResolvedValueOnce({ value: [null] })
      .mockResolvedValueOnce({ value: [{ err: null, confirmationStatus: 'processed' }] })
      .mockResolvedValueOnce({ value: [{ err: null, confirmationStatus: 'finalized' }] });
    await approve(pendingId);
    expect(rpc.getSignatureStatuses).toHaveBeenCalledTimes(3);
    expect(rpc.getSignatureStatuses.mock.calls[0][0]).toEqual([SIGNATURE]);
    expect(rpc.sendRawTransaction.mock.calls[0][1]).toEqual({ skipPreflight: false });
    await expect(poll(pendingId)).resolves.toEqual({ status: 'approved', value: { signatures: [SIGNATURE_BYTES] } });
  });

  it('a transaction that landed with an error still answers with its signature', async () => {
    const pendingId = await pendingSend({ commitment: 'finalized' });
    rpc.sendRawTransaction.mockResolvedValueOnce(SIGNATURE);
    rpc.getSignatureStatuses.mockResolvedValueOnce({ value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'processed' }] });
    await approve(pendingId);
    expect(rpc.getSignatureStatuses).toHaveBeenCalledTimes(1);
    await expect(poll(pendingId)).resolves.toEqual({ status: 'approved', value: { signatures: [SIGNATURE_BYTES] } });
  });

  it('gives up waiting after the confirmation timeout rather than holding the page forever', async () => {
    const pendingId = await pendingSend({ commitment: 'finalized' });
    rpc.sendRawTransaction.mockResolvedValueOnce(SIGNATURE);
    // The clock jumps past the timeout after the first status poll; the level is never reached.
    const start = Date.now();
    let now = start;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    rpc.getSignatureStatuses.mockImplementation(async () => {
      now = start + CONFIRMATION_TIMEOUT_MS + CONFIRMATION_POLL_MS;
      return { value: [{ err: null, confirmationStatus: 'confirmed' }] };
    });
    try {
      await expect(approve(pendingId)).resolves.toEqual({});
    } finally {
      clock.mockRestore();
    }
    expect(rpc.getSignatureStatuses).toHaveBeenCalledTimes(1);
    await expect(poll(pendingId)).resolves.toEqual({ status: 'approved', value: { signatures: [SIGNATURE_BYTES] } });
  });
});
