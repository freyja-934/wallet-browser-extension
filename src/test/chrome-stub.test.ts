import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createChromeStub,
  installChromeStub,
  STUB_EXTENSION_ID,
  uninstallChromeStub,
  type ChromeStub,
  type StorageChanges,
} from './chrome-stub';

let stub: ChromeStub;

beforeEach(() => {
  stub = createChromeStub();
});

describe('storage areas', () => {
  beforeEach(async () => {
    await stub.storage.local.set({ a: 1, b: { x: [1, 2] } });
  });

  it('get(string) returns only that key, or {} when missing', async () => {
    await expect(stub.storage.local.get('a')).resolves.toStrictEqual({ a: 1 });
    await expect(stub.storage.local.get('missing')).resolves.toStrictEqual({});
  });

  it('get(string[]) returns the present keys and skips the rest', async () => {
    await expect(stub.storage.local.get(['a', 'b', 'zz'])).resolves.toStrictEqual({ a: 1, b: { x: [1, 2] } });
  });

  it('get(null) and get() return everything', async () => {
    const everything = { a: 1, b: { x: [1, 2] } };
    await expect(stub.storage.local.get(null)).resolves.toStrictEqual(everything);
    await expect(stub.storage.local.get()).resolves.toStrictEqual(everything);
  });

  it('get(object) fills in defaults for missing keys only', async () => {
    await expect(stub.storage.local.get({ a: 9, c: 'd' })).resolves.toStrictEqual({ a: 1, c: 'd' });
  });

  it('isolates stored values from later mutation on either side', async () => {
    const input = { x: [1] };
    await stub.storage.local.set({ m: input });
    input.x.push(2);
    const first = (await stub.storage.local.get('m')) as { m: { x: number[] } };
    expect(first).toStrictEqual({ m: { x: [1] } });
    first.m.x.push(3);
    await expect(stub.storage.local.get('m')).resolves.toStrictEqual({ m: { x: [1] } });
    expect(stub.storage.local.snapshot()).toStrictEqual({ a: 1, b: { x: [1, 2] }, m: { x: [1] } });
  });

  it('keeps local and session independent', async () => {
    const sessionChanges: StorageChanges[] = [];
    stub.storage.session.onChanged.addListener((changes) => sessionChanges.push(changes));

    await expect(stub.storage.session.get('a')).resolves.toStrictEqual({});
    await stub.storage.session.set({ a: 'session' });
    await expect(stub.storage.local.get('a')).resolves.toStrictEqual({ a: 1 });
    await expect(stub.storage.session.get('a')).resolves.toStrictEqual({ a: 'session' });

    await stub.storage.local.clear();
    expect(stub.storage.local.snapshot()).toStrictEqual({});
    expect(stub.storage.session.snapshot()).toStrictEqual({ a: 'session' });
    expect(sessionChanges).toStrictEqual([{ a: { newValue: 'session' } }]);
  });
});

describe('storage change events', () => {
  it('fires area and global listeners with Chrome-shaped changes for set, set, remove', async () => {
    const areaChanges: StorageChanges[] = [];
    const globalChanges: Array<[StorageChanges, string]> = [];
    stub.storage.local.onChanged.addListener((changes) => areaChanges.push(changes));
    stub.storage.onChanged.addListener((changes, areaName) => globalChanges.push([changes, areaName]));

    await stub.storage.local.set({ k: 1 });
    await stub.storage.local.set({ k: 2 });
    await stub.storage.local.remove('k');

    // A newly created key carries no `oldValue` property at all; a removed key no `newValue`.
    const expected: StorageChanges[] = [{ k: { newValue: 1 } }, { k: { oldValue: 1, newValue: 2 } }, { k: { oldValue: 2 } }];
    expect(areaChanges).toStrictEqual(expected);
    expect(globalChanges).toStrictEqual(expected.map((changes) => [changes, 'local']));
    expect(areaChanges[0]?.k).not.toHaveProperty('oldValue');
  });

  it('does not fire for no-op writes and removes', async () => {
    const changes: StorageChanges[] = [];
    stub.storage.local.onChanged.addListener((c) => changes.push(c));
    await stub.storage.local.set({});
    await stub.storage.local.set({ u: undefined });
    await stub.storage.local.remove('absent');
    await stub.storage.local.clear();
    expect(changes).toStrictEqual([]);
  });
});

describe('alarms', () => {
  it('records create, reports clear, and lists what is scheduled', async () => {
    await stub.alarms.create('tick', { delayInMinutes: 5 });
    expect(stub.alarms.scheduled()).toStrictEqual({ tick: { delayInMinutes: 5 } });
    await expect(stub.alarms.clear('tick')).resolves.toBe(true);
    await expect(stub.alarms.clear('tick')).resolves.toBe(false);
    expect(stub.alarms.scheduled()).toStrictEqual({});
  });
});

describe('windows', () => {
  it('records every create and resolves incrementing ids', async () => {
    await expect(stub.windows.create({ url: 'approve.html', type: 'popup' })).resolves.toStrictEqual({ id: 1 });
    await expect(stub.windows.create({ url: 'index.html' })).resolves.toStrictEqual({ id: 2 });
    expect(stub.windows.created()).toStrictEqual([
      { id: 1, options: { url: 'approve.html', type: 'popup' } },
      { id: 2, options: { url: 'index.html' } },
    ]);
  });
});

describe('install / uninstall', () => {
  afterEach(() => {
    uninstallChromeStub();
  });

  it('assigns the stub to globalThis.chrome and removes it again', () => {
    const installed = installChromeStub();
    const global = globalThis as { chrome?: unknown };
    expect(global.chrome).toBe(installed);
    expect(installed.runtime.id).toBe(STUB_EXTENSION_ID);
    expect(installed.runtime.getURL('index.html')).toBe(`chrome-extension://${STUB_EXTENSION_ID}/index.html`);
    uninstallChromeStub();
    expect(global.chrome).toBeUndefined();
  });
});
