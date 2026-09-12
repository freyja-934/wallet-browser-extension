import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_TRANSACTION_BYTES } from '../lib/bridge';
import type { PendingApproval, WalletPublicState } from '../lib/messages';
import { installChromeStub, STUB_EXTENSION_ID, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import { TEST_ADDRESS, TEST_MNEMONIC, TEST_PASSWORD } from '../test/fixtures';
import { resetKeyringForTests } from './keyring';
import { handleMessage } from './router';

const BASE = `chrome-extension://${STUB_EXTENSION_ID}/`;
const popup = { origin: `chrome-extension://${STUB_EXTENSION_ID}`, url: `${BASE}index.html` };
const page = { origin: 'https://dapp.example', url: 'https://dapp.example/app', tab: { id: 7 }, frameId: 0 };
const otherPage = { origin: 'https://other.example', url: 'https://other.example/', tab: { id: 8 }, frameId: 0 };

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
  resetKeyringForTests();
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
async function connectPage(sender: typeof page): Promise<string> {
  const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, sender, BASE)) as { pendingId: string };
  await handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, popup, BASE);
  return pendingId;
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

  it('opens the unlock window and throws on WALLET_CONNECT while locked', async () => {
    await createFixtureWallet();
    await handleMessage({ type: 'LOCK' }, popup, BASE);

    await expect(handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)).rejects.toThrow(
      'Wallet is locked. Unlock Cinder Wallet and try again.',
    );
    const [unlockWindow] = chromeStub.windows.created();
    expect(unlockWindow?.options.url).toBe(`${BASE}index.html`);
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty('cinder_pending');
  });

  it('SIGN_MESSAGE while locked queues an approval that cannot be fulfilled', async () => {
    // Today only WALLET_CONNECT short-circuits to the unlock window; a locked
    // sign request opens the approval window and fails at APPROVE_REQUEST.
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

  it('falls back to sender.url as the origin when sender.origin is missing', async () => {
    await createFixtureWallet();
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, { url: page.url }, BASE)) as {
      pendingId: string;
    };
    const { request } = (await handleMessage({ type: 'GET_PENDING_REQUEST', id: pendingId }, popup, BASE)) as {
      request: PendingApproval | null;
    };
    expect(request?.origin).toBe(page.url);
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
