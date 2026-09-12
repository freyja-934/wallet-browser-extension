import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import { TEST_MNEMONIC, TEST_PASSWORD } from '../test/fixtures';
import { enqueueApproval, getApprovalResult } from './approvals';
import * as origins from './origins';
import {
  clearWallet,
  createWallet,
  getPublicState,
  getSettings,
  lock,
  resetKeyringForTests,
  setBuildHeliusApiKeyForTests,
  setLockHooks,
  touchActivity,
  unlock,
  updateSettings,
} from './keyring';

const BUILD_KEY = 'build-seed-not-a-real-key';
const USER_KEY = 'user-typed-not-a-real-key';

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
  resetKeyringForTests();
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

  it('moves every lumen_* key to its cinder_* name once and removes the old one', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    const local = chromeStub.storage.local.snapshot();
    const session = chromeStub.storage.session.snapshot();
    // Simulate an install that wrote under the old names only.
    await chromeStub.storage.local.clear();
    await chromeStub.storage.session.clear();
    await chromeStub.storage.local.set({
      lumen_vault: local.cinder_vault,
      lumen_settings: { cluster: 'devnet' },
      lumen_accounts: local.cinder_accounts,
    });
    await chromeStub.storage.session.set({ lumen_session: session.cinder_session });
    await chromeStub.alarms.create('lumen-autolock', { delayInMinutes: 15 });
    resetKeyringForTests();

    const state = await getPublicState();
    expect(state.hasVault).toBe(true);
    expect(state.isLocked).toBe(false);
    expect(state.accounts[0]?.address).toBe(
      (local.cinder_accounts as { accounts: { address: string }[] }).accounts[0].address,
    );
    const migratedLocal = chromeStub.storage.local.snapshot();
    expect(Object.keys(migratedLocal).sort()).toEqual(['cinder_accounts', 'cinder_settings', 'cinder_vault']);
    expect(migratedLocal.cinder_vault).toEqual(local.cinder_vault);
    expect(migratedLocal.cinder_settings).toEqual({ cluster: 'devnet' });
    expect(Object.keys(chromeStub.storage.session.snapshot())).toEqual(['cinder_session']);
    expect(chromeStub.alarms.scheduled()).not.toHaveProperty('lumen-autolock');
    expect(JSON.stringify(chromeStub.storage.local.snapshot())).not.toContain('lumen');
  });

  it('keeps the cinder_* value when both names exist, and still drops the old key', async () => {
    await chromeStub.storage.local.set({
      lumen_settings: { cluster: 'devnet' },
      cinder_settings: { cluster: 'mainnet-beta' },
    });
    expect((await getSettings()).cluster).toBe('mainnet-beta');
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty('lumen_settings');
  });
});

describe('session storage', () => {
  it('never falls back to local storage for the session', async () => {
    delete (chromeStub.storage as { session?: unknown }).session;
    await expect(createWallet(TEST_PASSWORD, TEST_MNEMONIC)).rejects.toThrow('Session storage unavailable');
    expect(JSON.stringify(chromeStub.storage.local.snapshot())).not.toContain('seedB64');
  });
});

describe('lock', () => {
  it('rejects pending approvals, clears the alarm, and runs the onLocked hook', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    const pendingId = await enqueueApproval('connect', 'https://dapp.example');
    const calls: string[] = [];
    setLockHooks({ onLocked: () => { calls.push('locked'); }, onCleared: () => { calls.push('cleared'); } });

    const state = await lock();
    expect(state.isLocked).toBe(true);
    expect(chromeStub.alarms.scheduled()).toEqual({});
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty('cinder_session');
    await expect(getApprovalResult(pendingId)).resolves.toEqual({ status: 'rejected', error: 'Wallet locked' });
    expect(calls).toEqual(['locked']);
  });

  it('clearWallet also forgets connected sites and runs onCleared after onLocked', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await origins.connect('https://dapp.example', [0]);
    const calls: string[] = [];
    setLockHooks({ onLocked: () => { calls.push('locked'); }, onCleared: () => { calls.push('cleared'); } });

    const state = await clearWallet();
    expect(state).toEqual({ hasVault: false, isLocked: true, accounts: [], activeAccountIndex: 0 });
    expect(await origins.list()).toEqual([]);
    expect(chromeStub.storage.local.snapshot()).toEqual({});
    expect(calls).toEqual(['locked', 'cleared']);
  });

  it('a throwing hook does not break lock', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    setLockHooks({ onLocked: () => { throw new Error('tab gone'); } });
    expect((await lock()).isLocked).toBe(true);
  });
});

describe('touchActivity', () => {
  it('re-arms the auto-lock alarm while unlocked and does nothing while locked', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await updateSettings({ autoLockTimeout: 5 });
    await chromeStub.alarms.clear('cinder-autolock');
    await touchActivity();
    expect(chromeStub.alarms.scheduled()['cinder-autolock']).toEqual({ delayInMinutes: 5 });

    await lock();
    await touchActivity();
    expect(chromeStub.alarms.scheduled()).toEqual({});

    await unlock(TEST_PASSWORD);
    await chromeStub.alarms.clear('cinder-autolock');
    await touchActivity();
    expect(chromeStub.alarms.scheduled()).toHaveProperty('cinder-autolock');
  });

  it('respects "never" auto-lock', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await updateSettings({ autoLockTimeout: 0 });
    await touchActivity();
    expect(chromeStub.alarms.scheduled()).toEqual({});
  });
});
