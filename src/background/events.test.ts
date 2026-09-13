import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeStub, STUB_EXTENSION_ID, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import { TEST_ADDRESS, TEST_MNEMONIC, TEST_PASSWORD } from '../test/fixtures';
import { installWalletEvents, sendToConnected, sendWalletEvent } from './events';
import { getSettings, resetKeyringForTests } from './keyring';
import * as origins from './origins';
import { handleMessage } from './router';

const BASE = `chrome-extension://${STUB_EXTENSION_ID}/`;
const popup = { origin: `chrome-extension://${STUB_EXTENSION_ID}`, url: `${BASE}index.html` };
const A = 'https://a.example';
const B = 'https://b.example';
const pageA = { origin: A, url: `${A}/`, tab: { id: 1 }, frameId: 0 };
const pageB = { origin: B, url: `${B}/`, tab: { id: 2 }, frameId: 0 };

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
  resetKeyringForTests();
});

afterEach(() => {
  uninstallChromeStub();
});

/** The build cluster (`VITE_NETWORK`) the worker reports when nothing is stored. */
async function buildCluster(): Promise<string> {
  return (await getSettings()).cluster;
}

async function createAndConnect(...pages: (typeof pageA)[]): Promise<void> {
  await handleMessage({ type: 'CREATE_WALLET', password: TEST_PASSWORD, seedPhrase: TEST_MNEMONIC }, popup, BASE);
  for (const page of pages) {
    const { pendingId } = (await handleMessage({ type: 'WALLET_CONNECT' }, page, BASE)) as { pendingId: string };
    await handleMessage({ type: 'APPROVE_REQUEST', id: pendingId }, popup, BASE);
  }
}

describe('sendWalletEvent', () => {
  it('sends to every registered tab and frame with that tab’s own origin', async () => {
    await origins.remember({ tab: { id: 1 }, frameId: 0 }, A);
    await origins.remember({ tab: { id: 1 }, frameId: 4 }, B);
    await origins.remember({ tab: { id: 2 }, frameId: 0 }, A);
    await sendWalletEvent('locked', { accounts: [], cluster: 'devnet' });
    expect(chromeStub.tabs.sent()).toEqual([
      { tabId: 1, frameId: 0, message: { type: 'WALLET_EVENT', event: 'locked', origin: A, accounts: [], cluster: 'devnet' } },
      { tabId: 1, frameId: 4, message: { type: 'WALLET_EVENT', event: 'locked', origin: B, accounts: [], cluster: 'devnet' } },
      { tabId: 2, frameId: 0, message: { type: 'WALLET_EVENT', event: 'locked', origin: A, accounts: [], cluster: 'devnet' } },
    ]);
    // ...and tells the popup, which has no tab.
    expect(chromeStub.runtime.sent()).toEqual([{ type: 'WALLET_EVENT', event: 'locked' }]);
  });

  it('targets one origin when asked and never the popup', async () => {
    await origins.remember({ tab: { id: 1 } }, A);
    await origins.remember({ tab: { id: 2 } }, B);
    await sendWalletEvent('disconnected', { origin: A, accounts: [], cluster: 'devnet' });
    expect(chromeStub.tabs.sent().map((sent) => sent.tabId)).toEqual([1]);
    expect(chromeStub.runtime.sent()).toEqual([]);
  });

  it('swallows a tab that is gone and still reaches the others', async () => {
    await origins.remember({ tab: { id: 1 } }, A);
    await origins.remember({ tab: { id: 2 } }, B);
    const original = chromeStub.tabs.sendMessage;
    chromeStub.tabs.sendMessage = async (tabId, message, options) => {
      if (tabId === 1) throw new Error('Could not establish connection');
      return original(tabId, message, options);
    };
    chromeStub.runtime.sendMessage = async () => {
      throw new Error('Receiving end does not exist');
    };
    await expect(sendWalletEvent('locked', { accounts: [], cluster: 'devnet' })).resolves.toBeUndefined();
    expect(chromeStub.tabs.sent().map((sent) => sent.tabId)).toEqual([2]);
  });
});

describe('sendToConnected', () => {
  it('reaches connected origins only', async () => {
    await createAndConnect(pageA);
    await handleMessage({ type: 'WALLET_CONNECT', silent: true }, pageB, BASE);
    await sendToConnected('accountsChanged', { accounts: [TEST_ADDRESS], cluster: 'devnet' });
    expect(chromeStub.tabs.sent().map((sent) => sent.tabId)).toEqual([1]);
  });
});

describe('router events', () => {
  it('LOCK tells every registered page and the popup, with no accounts', async () => {
    installWalletEvents();
    await createAndConnect(pageA);
    await handleMessage({ type: 'WALLET_CONNECT', silent: true }, pageB, BASE);
    await handleMessage({ type: 'LOCK' }, popup, BASE);
    const locked = chromeStub.tabs.sent().filter((sent) => (sent.message as { event: string }).event === 'locked');
    expect(locked.map((sent) => [sent.tabId, (sent.message as { origin: string }).origin])).toEqual([[1, A], [2, B]]);
    expect(locked.every((sent) => (sent.message as { accounts: string[] }).accounts.length === 0)).toBe(true);
    expect(chromeStub.runtime.sent()).toEqual([{ type: 'WALLET_EVENT', event: 'locked' }]);
  });

  it('UNLOCK tells extension pages only, never a tab', async () => {
    installWalletEvents();
    await createAndConnect(pageA);
    await handleMessage({ type: 'LOCK' }, popup, BASE);
    const before = chromeStub.tabs.sent().length;
    await handleMessage({ type: 'UNLOCK', password: TEST_PASSWORD }, popup, BASE);
    expect(chromeStub.runtime.sent()).toEqual([
      { type: 'WALLET_EVENT', event: 'locked' },
      { type: 'WALLET_EVENT', event: 'unlocked' },
    ]);
    expect(chromeStub.tabs.sent()).toHaveLength(before);
  });

  it('CLEAR_WALLET sends locked then cleared and forgets every site', async () => {
    installWalletEvents();
    await createAndConnect(pageA);
    await handleMessage({ type: 'CLEAR_WALLET' }, popup, BASE);
    expect(chromeStub.tabs.sent().map((sent) => (sent.message as { event: string }).event)).toEqual(['locked', 'cleared']);
    expect(chromeStub.storage.local.snapshot()).toEqual({});
  });

  it('WALLET_DISCONNECT tells that origin’s other frames, not the one that asked; REVOKE_SITE tells them all', async () => {
    await createAndConnect(pageA, pageB);
    // A second tab and an iframe of the same site.
    await handleMessage({ type: 'WALLET_CONNECT', silent: true }, { ...pageA, tab: { id: 3 } }, BASE);
    await handleMessage({ type: 'WALLET_CONNECT', silent: true }, { ...pageA, frameId: 5 }, BASE);
    const cluster = await buildCluster();
    await handleMessage({ type: 'WALLET_DISCONNECT' }, pageA, BASE);
    // The asking frame's own disconnect() emits `change`; a push as well would make the page emit twice.
    expect(chromeStub.tabs.sent()).toEqual([
      { tabId: 3, frameId: 0, message: { type: 'WALLET_EVENT', event: 'disconnected', origin: A, accounts: [], cluster } },
      { tabId: 1, frameId: 5, message: { type: 'WALLET_EVENT', event: 'disconnected', origin: A, accounts: [], cluster } },
    ]);
    await handleMessage({ type: 'REVOKE_SITE', origin: B }, popup, BASE);
    expect(chromeStub.tabs.sent().at(-1)).toEqual({
      tabId: 2,
      frameId: 0,
      message: { type: 'WALLET_EVENT', event: 'revoked', origin: B, accounts: [], cluster },
    });
    expect(await origins.list()).toEqual([]);
  });

  it('SWITCH_ACCOUNT and a cluster change reach connected pages; other settings do not', async () => {
    await createAndConnect(pageA);
    await handleMessage({ type: 'WALLET_CONNECT', silent: true }, pageB, BASE);
    const cluster = await buildCluster();
    const other = cluster === 'devnet' ? 'mainnet-beta' : 'devnet';
    await handleMessage({ type: 'SWITCH_ACCOUNT', index: 0 }, popup, BASE);
    expect(chromeStub.tabs.sent()).toEqual([
      {
        tabId: 1,
        frameId: 0,
        message: { type: 'WALLET_EVENT', event: 'accountsChanged', origin: A, accounts: [TEST_ADDRESS], cluster },
      },
    ]);
    await handleMessage({ type: 'UPDATE_SETTINGS', settings: { autoLockTimeout: 5 } }, popup, BASE);
    expect(chromeStub.tabs.sent()).toHaveLength(1);
    await handleMessage({ type: 'UPDATE_SETTINGS', settings: { cluster: other } }, popup, BASE);
    expect(chromeStub.tabs.sent().at(-1)).toEqual({
      tabId: 1,
      frameId: 0,
      message: { type: 'WALLET_EVENT', event: 'clusterChanged', origin: A, accounts: [TEST_ADDRESS], cluster: other },
    });
    await handleMessage({ type: 'UPDATE_SETTINGS', settings: { cluster: other } }, popup, BASE);
    expect(chromeStub.tabs.sent()).toHaveLength(2);
  });
});
