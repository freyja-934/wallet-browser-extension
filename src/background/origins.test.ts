import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import * as origins from './origins';

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
});

afterEach(() => {
  uninstallChromeStub();
});

const A = 'https://a.example';
const B = 'https://b.example';

describe('connected origins', () => {
  it('is empty on a fresh install', async () => {
    expect(await origins.isConnected(A)).toBe(false);
    expect(await origins.list()).toEqual([]);
  });

  it('connect records the origin in chrome.storage.local with its time and accounts', async () => {
    const before = Date.now();
    await origins.connect(A, [0, 1]);
    expect(await origins.isConnected(A)).toBe(true);
    expect(await origins.isConnected(B)).toBe(false);
    const stored = chromeStub.storage.local.snapshot()[origins.CONNECTED_KEY] as Record<string, unknown>;
    expect(stored[A]).toMatchObject({ accountIndexes: [0, 1] });
    expect((stored[A] as { connectedAt: number }).connectedAt).toBeGreaterThanOrEqual(before);
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty(origins.CONNECTED_KEY);
  });

  it('lists most recently connected first and disconnect removes one origin', async () => {
    await origins.connect(A, [0]);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await origins.connect(B, [0]);
    expect((await origins.list()).map((site) => site.origin)).toEqual([B, A]);

    expect(await origins.disconnect(A)).toBe(true);
    expect(await origins.disconnect(A)).toBe(false);
    expect(await origins.isConnected(A)).toBe(false);
    expect(await origins.isConnected(B)).toBe(true);
  });

  it('never matches a prototype key', async () => {
    expect(await origins.isConnected('constructor')).toBe(false);
    expect(await origins.isConnected('__proto__')).toBe(false);
    expect(await origins.disconnect('constructor')).toBe(false);
  });

  it('clear forgets every origin', async () => {
    await origins.connect(A, [0]);
    await origins.connect(B, [0]);
    await origins.clear();
    expect(await origins.list()).toEqual([]);
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty(origins.CONNECTED_KEY);
  });

  it('serialises concurrent connects so none is lost', async () => {
    await Promise.all([origins.connect(A, [0]), origins.connect(B, [0]), origins.disconnect(A)]);
    expect(await origins.isConnected(A)).toBe(false);
    expect(await origins.isConnected(B)).toBe(true);
  });
});

describe('delivery registry', () => {
  it('remembers tab and frame per origin in chrome.storage.session', async () => {
    await origins.remember({ tab: { id: 7 }, frameId: 0 }, A);
    await origins.remember({ tab: { id: 7 }, frameId: 3 }, B);
    await origins.remember({ tab: { id: 9 } }, A);
    expect(chromeStub.storage.session.snapshot()[origins.TABS_KEY]).toEqual({ '7:0': A, '7:3': B, '9:0': A });
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty(origins.TABS_KEY);
    expect(await origins.tabsFor(A)).toEqual([
      { tabId: 7, frameId: 0, origin: A },
      { tabId: 9, frameId: 0, origin: A },
    ]);
    expect(await origins.tabsFor(B)).toEqual([{ tabId: 7, frameId: 3, origin: B }]);
    expect(await origins.allTabs()).toHaveLength(3);
  });

  it('ignores senders without a tab id or without an origin', async () => {
    await origins.remember({ origin: A }, A);
    await origins.remember({ tab: {} }, A);
    await origins.remember({ tab: { id: 1 } }, '');
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty(origins.TABS_KEY);
  });

  it('a navigated tab overwrites its previous origin', async () => {
    await origins.remember({ tab: { id: 7 }, frameId: 0 }, A);
    await origins.remember({ tab: { id: 7 }, frameId: 0 }, B);
    expect(await origins.tabsFor(A)).toEqual([]);
    expect(await origins.tabsFor(B)).toEqual([{ tabId: 7, frameId: 0, origin: B }]);
  });

  it('forget drops every frame of that tab only', async () => {
    await origins.remember({ tab: { id: 7 }, frameId: 0 }, A);
    await origins.remember({ tab: { id: 7 }, frameId: 3 }, B);
    await origins.remember({ tab: { id: 70 }, frameId: 0 }, A);
    await origins.forget(7);
    expect(await origins.allTabs()).toEqual([{ tabId: 70, frameId: 0, origin: A }]);
  });

  it('throws rather than falling back to local storage when session storage is missing', async () => {
    delete (chromeStub.storage as { session?: unknown }).session;
    await expect(origins.remember({ tab: { id: 7 } }, A)).rejects.toThrow('Session storage unavailable');
    expect(chromeStub.storage.local.snapshot()).toEqual({});
  });
});
