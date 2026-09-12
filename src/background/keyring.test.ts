import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import { getSettings, setBuildHeliusApiKeyForTests, updateSettings } from './keyring';

const BUILD_KEY = 'build-seed-not-a-real-key';
const USER_KEY = 'user-typed-not-a-real-key';

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
  setBuildHeliusApiKeyForTests(BUILD_KEY);
});

afterEach(() => {
  setBuildHeliusApiKeyForTests('');
  uninstallChromeStub();
});

/** The raw stored object, as the popup never sees it. */
function stored(): Record<string, unknown> | undefined {
  return chromeStub.storage.local.snapshot().cinder_settings as Record<string, unknown> | undefined;
}

describe('build-time Helius key', () => {
  it('seeds heliusApiKey when nothing is stored, without writing it', async () => {
    expect((await getSettings()).heliusApiKey).toBe(BUILD_KEY);
    expect(stored()).toBeUndefined();
  });

  it('is never persisted by an unrelated update', async () => {
    const next = await updateSettings({ cluster: 'devnet' });
    expect(next.cluster).toBe('devnet');
    // Still seeded on read...
    expect(next.heliusApiKey).toBe(BUILD_KEY);
    // ...but the stored object has no key property at all.
    expect(stored()).not.toHaveProperty('heliusApiKey');
    expect(JSON.stringify(stored())).not.toContain(BUILD_KEY);
  });

  it('does not come back once the user clears the key', async () => {
    expect((await getSettings()).heliusApiKey).toBe(BUILD_KEY);

    const cleared = await updateSettings({ heliusApiKey: '' });
    expect(cleared.heliusApiKey).toBeUndefined();
    expect((await getSettings()).heliusApiKey).toBeUndefined();
    // The stored '' is what keeps the seed away.
    expect(stored()?.heliusApiKey).toBe('');

    const later = await updateSettings({ cluster: 'devnet' });
    expect(later.heliusApiKey).toBeUndefined();
    expect((await getSettings()).heliusApiKey).toBeUndefined();
    expect(stored()?.heliusApiKey).toBe('');
    expect(JSON.stringify(stored())).not.toContain(BUILD_KEY);
  });

  it('treats a whitespace-only key as cleared', async () => {
    const cleared = await updateSettings({ heliusApiKey: '  \t ' });
    expect(cleared.heliusApiKey).toBeUndefined();
    expect(stored()?.heliusApiKey).toBe('');
  });

  it('stores a user key trimmed and keeps it across unrelated updates', async () => {
    const saved = await updateSettings({ heliusApiKey: `  ${USER_KEY}  ` });
    expect(saved.heliusApiKey).toBe(USER_KEY);
    expect(stored()?.heliusApiKey).toBe(USER_KEY);

    const later = await updateSettings({ autoLockTimeout: 5 });
    expect(later.heliusApiKey).toBe(USER_KEY);
    expect(stored()?.heliusApiKey).toBe(USER_KEY);
  });

  it('does not seed when no build key is configured', async () => {
    setBuildHeliusApiKeyForTests('');
    expect((await getSettings()).heliusApiKey).toBeUndefined();
    await updateSettings({ cluster: 'devnet' });
    expect((await getSettings()).heliusApiKey).toBeUndefined();
    expect(stored()).not.toHaveProperty('heliusApiKey');
  });
});

describe('custom RPC URL', () => {
  it('trims the URL, refuses non-https, and clears on empty or whitespace', async () => {
    expect((await updateSettings({ rpcUrl: '  https://rpc.example/v1 ' })).rpcUrl).toBe('https://rpc.example/v1');
    await expect(updateSettings({ rpcUrl: 'http://rpc.example' })).rejects.toThrow('Invalid rpcUrl');
    expect(stored()?.rpcUrl).toBe('https://rpc.example/v1');

    expect((await updateSettings({ rpcUrl: '   ' })).rpcUrl).toBeUndefined();
    expect(stored()).not.toHaveProperty('rpcUrl');
    expect((await updateSettings({ rpcUrl: 'https://rpc.example' })).rpcUrl).toBe('https://rpc.example');
    expect((await updateSettings({ rpcUrl: '' })).rpcUrl).toBeUndefined();
    expect(stored()).not.toHaveProperty('rpcUrl');
  });

  it('keeps the cluster tag with the URL and drops both on clear', async () => {
    const saved = await updateSettings({ rpcUrl: 'https://rpc.example', rpcUrlCluster: 'mainnet-beta' });
    expect(saved.rpcUrlCluster).toBe('mainnet-beta');

    // Switching cluster keeps the URL stored; rpcUrlsFor simply leaves it out.
    const switched = await updateSettings({ cluster: 'devnet' });
    expect(switched.rpcUrl).toBe('https://rpc.example');
    expect(switched.rpcUrlCluster).toBe('mainnet-beta');

    const cleared = await updateSettings({ rpcUrl: '' });
    expect(cleared.rpcUrl).toBeUndefined();
    expect(cleared.rpcUrlCluster).toBeUndefined();
    expect(stored()).not.toHaveProperty('rpcUrlCluster');
  });

  it('never reports a stale cluster tag without a URL', async () => {
    await chromeStub.storage.local.set({ cinder_settings: { cluster: 'devnet', rpcUrlCluster: 'devnet' } });
    const settings = await getSettings();
    expect(settings.rpcUrl).toBeUndefined();
    expect(settings.rpcUrlCluster).toBeUndefined();
  });
});

describe('legacy storage', () => {
  it('reads settings stored under the old key and writes the new one', async () => {
    await chromeStub.storage.local.set({ lumen_settings: { cluster: 'devnet', heliusApiKey: USER_KEY } });
    expect((await getSettings()).heliusApiKey).toBe(USER_KEY);
    const next = await updateSettings({ autoLockTimeout: 30 });
    expect(next.cluster).toBe('devnet');
    expect(next.heliusApiKey).toBe(USER_KEY);
    expect(stored()?.heliusApiKey).toBe(USER_KEY);
  });
});
