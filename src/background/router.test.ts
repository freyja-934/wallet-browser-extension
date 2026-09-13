import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TRANSACTION_BYTES } from '../lib/bridge';
import type { PendingApproval, WalletPublicState } from '../lib/messages';
import { installChromeStub, STUB_EXTENSION_ID, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import { TEST_ADDRESS, TEST_MNEMONIC, TEST_PASSWORD } from '../test/fixtures';
import { installApprovalLifecycle, onWindowRemoved } from './approvals';
import { resetKeyringForTests } from './keyring';
import { handleMessage } from './router';

/** The RPC the router broadcasts through, replaced so a test can hold a broadcast open. */
const rpc = vi.hoisted(() => ({ sendRawTransaction: vi.fn<[Uint8Array, unknown], Promise<string>>() }));
vi.mock('./transfers', () => ({
  getConnection: async () => ({ sendRawTransaction: rpc.sendRawTransaction }),
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
});

afterEach(() => {
  uninstallChromeStub();
});

async function createFixtureWallet(): Promise<WalletPublicState> {
  const result = await handleMessage(
    { type: 'CREATE_WALLET', password: TEST_PASSWORD, seedPhrase: TEST_MNEMONIC },
    popup,
    BASE,
  );
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
    { type: 'SIGN_AND_SEND_TRANSACTION', transaction: selfTransfer() },
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
    await expect(handleMessage({ type: 'SIGN_MESSAGE', message: [1] }, page, BASE)).rejects.toThrow('Not connected');
    await expect(handleMessage({ type: 'SIGN_TRANSACTION', transaction: [1] }, page, BASE)).rejects.toThrow(
      'Not connected',
    );
    await expect(handleMessage({ type: 'SIGN_AND_SEND_TRANSACTION', transaction: [1] }, page, BASE)).rejects.toThrow(
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

    await expect(handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)).resolves.toEqual({ accounts: [TEST_ADDRESS] });
    expect(chromeStub.windows.created()).toHaveLength(1);

    // Another origin is still a stranger.
    const other = (await handleMessage({ type: 'WALLET_CONNECT' }, otherPage, BASE)) as { pendingId?: string };
    expect(other.pendingId).toEqual(expect.any(String));
    expect(chromeStub.windows.created()).toHaveLength(2);
  });

  it('a silent connect from a stranger returns no accounts and opens nothing', async () => {
    await createFixtureWallet();
    await expect(handleMessage({ type: 'WALLET_CONNECT', silent: true }, page, BASE)).resolves.toEqual({ accounts: [] });
    expect(chromeStub.windows.created()).toEqual([]);
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty('cinder_connected');

    // Once connected, silent gets the accounts like any other connect.
    await connectPage(page);
    await expect(handleMessage({ type: 'WALLET_CONNECT', silent: true }, page, BASE)).resolves.toEqual({
      accounts: [TEST_ADDRESS],
    });
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
      value: { connected: true, accounts: [TEST_ADDRESS], publicKey: TEST_ADDRESS },
    });
    await expect(handleMessage({ type: 'GET_ACCOUNTS' }, page, BASE)).resolves.toEqual({ accounts: [TEST_ADDRESS] });
  });

  it('SIGN_MESSAGE while locked queues an approval that cannot be fulfilled until unlock', async () => {
    // The approval window renders the unlock form; APPROVE_REQUEST before that fails at the keyring.
    await createFixtureWallet();
    await connectPage(page);
    await handleMessage({ type: 'LOCK' }, popup, BASE);

    const { pendingId } = (await handleMessage({ type: 'SIGN_MESSAGE', message: [104, 105] }, page, BASE)) as {
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
      await expect(handleMessage({ type: 'SIGN_MESSAGE', message: [1] }, sender, BASE)).rejects.toThrow('Untrusted sender');
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

    await expect(handleMessage({ type: 'WALLET_CONNECT', silent: true }, page, BASE)).resolves.toEqual({ accounts: [] });
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
      value: { connected: true, accounts: [TEST_ADDRESS], publicKey: TEST_ADDRESS },
    });
  });

  it('rejects a malformed transaction from a page and from the popup', async () => {
    await createFixtureWallet();
    for (const transaction of ['AQ==', [], [256], new Array(MAX_TRANSACTION_BYTES + 1).fill(0)]) {
      await expect(handleMessage({ type: 'SIGN_TRANSACTION', transaction }, page, BASE)).rejects.toThrow(
        'Invalid transaction',
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
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved', value: { signature: SIGNATURE_BYTES } });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(chromeStub.windows.removed()).toEqual([]);
  });

  it('the approval window closing during the broadcast does not either', async () => {
    const { pendingId, broadcast, approving } = await startBroadcast();
    const [, signWindow] = chromeStub.windows.created();
    await onWindowRemoved(signWindow.id);
    broadcast.resolve(SIGNATURE);
    await approving;
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved', value: { signature: SIGNATURE_BYTES } });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('a LOCK during the broadcast does not either: the page learns the real outcome', async () => {
    const { pendingId, broadcast, approving } = await startBroadcast();
    const { state } = (await handleMessage({ type: 'LOCK' }, popup, BASE)) as { state: WalletPublicState };
    expect(state.isLocked).toBe(true);
    broadcast.resolve(SIGNATURE);
    await approving;
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved', value: { signature: SIGNATURE_BYTES } });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('two concurrent APPROVE_REQUESTs broadcast once; the loser is told the request is gone', async () => {
    await createFixtureWallet();
    await connectPage(page);
    const { pendingId } = (await handleMessage(
      { type: 'SIGN_AND_SEND_TRANSACTION', transaction: selfTransfer() },
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
    await expect(poll(pendingId)).resolves.toMatchObject({ status: 'approved', value: { signature: SIGNATURE_BYTES } });
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
      { type: 'SIGN_AND_SEND_TRANSACTION', transaction: selfTransfer() },
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
    const { pendingId } = (await handleMessage({ type: 'SIGN_MESSAGE', message: [104, 105] }, page, BASE)) as {
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
    const { pendingId } = (await handleMessage({ type: 'SIGN_MESSAGE', message: [1] }, page, BASE)) as {
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
