import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_VAULT_VERSION, V1_KDF, type EncryptedData } from '../lib/encryption-simple';
import type { WalletAccountInfo } from '../lib/messages';
import { deriveKeypairFromSeed, mnemonicToSeedBuffer } from '../lib/wallet';
import { installChromeStub, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import { TEST_ADDRESS, TEST_MNEMONIC, TEST_PASSWORD } from '../test/fixtures';
import { enqueueApproval, getApprovalResult } from './approvals';
import * as origins from './origins';
import {
  addAccount,
  changePassword,
  clearWallet,
  createWallet,
  exportPrivateKey,
  exportSeed,
  getKeypair,
  getPublicState,
  getSettings,
  lock,
  registerAutoLock,
  renameAccount,
  resetKeyringForTests,
  setBuildHeliusApiKeyForTests,
  setLockHooks,
  signMessage,
  switchAccount,
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

  it('moves a scheduled lumen-autolock to cinder-autolock at the same time', async () => {
    const when = Date.now() + 7 * 60_000;
    await chromeStub.alarms.create('lumen-autolock', { when });
    resetKeyringForTests();
    await getSettings();
    expect(chromeStub.alarms.scheduled()).not.toHaveProperty('lumen-autolock');
    expect(chromeStub.alarms.scheduled()['cinder-autolock']).toEqual({ when });
    expect((await chromeStub.alarms.get('cinder-autolock'))?.scheduledTime).toBe(when);
  });

  it('schedules no auto-lock when there was no legacy alarm to carry over', async () => {
    await getSettings();
    expect(chromeStub.alarms.scheduled()).toEqual({});
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

  it('unlock runs the onUnlocked hook after the session is written', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await lock();
    const seen: boolean[] = [];
    setLockHooks({
      onUnlocked: async () => {
        seen.push((await getPublicState()).isLocked);
      },
    });
    await unlock(TEST_PASSWORD);
    expect(seen).toEqual([false]);
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

  it('pushes the deadline out on every touch, so the lock is idle-based, not a countdown from unlock', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await updateSettings({ autoLockTimeout: 5 });
    const armed = (await chromeStub.alarms.get('cinder-autolock'))?.scheduledTime ?? 0;
    expect(armed).toBeGreaterThan(0);

    // Four of the five minutes have passed and the user is still working.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(armed - 60_000);
      await touchActivity();
      const rearmed = (await chromeStub.alarms.get('cinder-autolock'))?.scheduledTime ?? 0;
      // The full five minutes again from now, not the minute left of the original countdown.
      expect(rearmed).toBe(armed - 60_000 + 5 * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects "never" auto-lock', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await updateSettings({ autoLockTimeout: 0 });
    await touchActivity();
    expect(chromeStub.alarms.scheduled()).toEqual({});
  });
});

const VAULT_KEY = 'cinder_vault';
const ACCOUNTS_KEY = 'cinder_accounts';

interface StoredVault {
  encrypted: EncryptedData;
  createdAt: number;
}

async function readVault(): Promise<StoredVault> {
  const stored = (await chromeStub.storage.local.get(VAULT_KEY))[VAULT_KEY] as StoredVault | undefined;
  if (!stored) throw new Error('no vault stored');
  return stored;
}

/**
 * A vault exactly as builds before this phase wrote it: no `version`, no `kdf`,
 * PBKDF2-SHA256 at 100k iterations. Written with WebCrypto rather than
 * `encrypt`, which now only produces the current format.
 */
async function writeV1Vault(payload: unknown, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: V1_KDF.iterations, hash: V1_KDF.hash },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const encrypted: EncryptedData = {
    salt: Buffer.from(salt).toString('hex'),
    nonce: Buffer.from(nonce).toString('hex'),
    ciphertext: Buffer.from(ciphertext).toString('hex'),
  };
  await chromeStub.storage.local.set({ [VAULT_KEY]: { encrypted, createdAt: Date.now() } });
}

/** The fixture account list as the vault payload carries it. */
async function fixtureAccounts(count = 1): Promise<WalletAccountInfo[]> {
  const seed = await mnemonicToSeedBuffer(TEST_MNEMONIC);
  const accounts: WalletAccountInfo[] = [];
  for (let index = 0; index < count; index += 1) {
    const { keypair, derivationPath } = await deriveKeypairFromSeed(seed, index);
    accounts.push({
      address: keypair.publicKey.toBase58(),
      name: `Account ${index + 1}`,
      derivationPath,
      index,
    });
  }
  return accounts;
}

describe('the vault', () => {
  it('creates, locks, and unlocks again with the same password', async () => {
    const created = await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    expect(created.accounts[0]?.address).toBe(TEST_ADDRESS);
    expect(created.isLocked).toBe(false);

    const locked = await lock();
    expect(locked.isLocked).toBe(true);
    expect(locked.accounts).toEqual([]);

    const unlocked = await unlock(TEST_PASSWORD);
    expect(unlocked.isLocked).toBe(false);
    expect(unlocked.accounts[0]?.address).toBe(TEST_ADDRESS);
  });

  it('writes the current format, with fresh salt and nonce on every encrypt', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    const first = await readVault();
    expect(first.encrypted.version).toBe(CURRENT_VAULT_VERSION);
    expect(first.encrypted.kdf).toEqual({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 });

    // The same vault contents, encrypted a second time under the same password.
    // A create is refused while a vault exists, so start over the supported way.
    await clearWallet();
    resetKeyringForTests();
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    const second = await readVault();
    expect(second.encrypted.salt).not.toBe(first.encrypted.salt);
    expect(second.encrypted.nonce).not.toBe(first.encrypted.nonce);
    expect(second.encrypted.ciphertext).not.toBe(first.encrypted.ciphertext);
  });

  it('opens a v1 vault, rewrites it as v2, and opens the rewritten one', async () => {
    await writeV1Vault({ mnemonic: TEST_MNEMONIC, accounts: await fixtureAccounts() }, TEST_PASSWORD);
    expect((await readVault()).encrypted.version).toBeUndefined();

    const migrated = await unlock(TEST_PASSWORD);
    expect(migrated.accounts[0]?.address).toBe(TEST_ADDRESS);

    const rewritten = await readVault();
    expect(rewritten.encrypted.version).toBe(CURRENT_VAULT_VERSION);
    expect(rewritten.encrypted.kdf?.iterations).toBe(600_000);

    await lock();
    const again = await unlock(TEST_PASSWORD);
    expect(again.isLocked).toBe(false);
    expect(again.accounts[0]?.address).toBe(TEST_ADDRESS);
    // Nothing derived a second format: the blob is still the one the migration wrote.
    expect((await readVault()).encrypted.ciphertext).toBe(rewritten.encrypted.ciphertext);
  });

  it('refuses the wrong password and stays locked', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await lock();
    await expect(unlock('not-the-password')).rejects.toThrow('Invalid password');
    expect((await getPublicState()).isLocked).toBe(true);
  });

  it('refuses a second create and leaves the first wallet exactly as it was', async () => {
    const created = await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    const before = await readVault();

    // No phrase means "generate one": the dangerous shape, and the one a retry
    // in the onboarding flow used to send after it had cleared the phrase.
    await expect(createWallet(TEST_PASSWORD)).rejects.toThrow('Wallet already exists');
    await expect(createWallet(TEST_PASSWORD, TEST_MNEMONIC)).rejects.toThrow('Wallet already exists');

    expect(await readVault()).toEqual(before);
    const state = await getPublicState();
    expect(state.accounts[0]?.address).toBe(created.accounts[0]?.address);
    expect(state.accounts[0]?.address).toBe(TEST_ADDRESS);
  });

  it('refuses a weak password and writes no vault at all', async () => {
    await expect(createWallet('short', TEST_MNEMONIC)).rejects.toThrow(/at least 8 characters/);
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty(VAULT_KEY);
    expect((await getPublicState()).hasVault).toBe(false);
    // The fixture password the e2e and the popup use still passes the rule.
    expect((await createWallet(TEST_PASSWORD, TEST_MNEMONIC)).hasVault).toBe(true);
  });

  it('reports a vault this build cannot read as a format problem, not a wrong password', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await lock();
    const vault = await readVault();
    // A blob from some future build: the password is right, the format is not one we know.
    await chromeStub.storage.local.set({
      [VAULT_KEY]: {
        ...vault,
        encrypted: { ...vault.encrypted, kdf: { name: 'Argon2id', hash: 'SHA-256', iterations: 3 } },
      },
    });

    await expect(unlock(TEST_PASSWORD)).rejects.toThrow('Unsupported vault format');
    await expect(exportSeed(TEST_PASSWORD)).rejects.toThrow('Unsupported vault format');
    // Refused, not rewritten: the blob is still there for a build that understands it.
    expect((await readVault()).encrypted.ciphertext).toBe(vault.encrypted.ciphertext);
    expect((await readVault()).encrypted.kdf?.name).toBe('Argon2id');
    expect((await getPublicState()).isLocked).toBe(true);
  });

  it('refuses a tampered ciphertext', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await lock();
    const vault = await readVault();
    // Flip one byte of the ciphertext; AES-GCM authentication must reject it.
    const bytes = Buffer.from(vault.encrypted.ciphertext, 'hex');
    bytes[0] ^= 0xff;
    await chromeStub.storage.local.set({
      [VAULT_KEY]: {
        ...vault,
        encrypted: { ...vault.encrypted, ciphertext: bytes.toString('hex') },
      },
    });

    await expect(unlock(TEST_PASSWORD)).rejects.toThrow('Invalid password');
    expect((await getPublicState()).isLocked).toBe(true);
  });
});

describe('changePassword', () => {
  it('rejects a weak password and leaves the old one working', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    const before = await readVault();

    await expect(changePassword(TEST_PASSWORD, 'short')).rejects.toThrow(/at least 8 characters/);
    expect((await readVault()).encrypted.ciphertext).toBe(before.encrypted.ciphertext);

    await lock();
    expect((await unlock(TEST_PASSWORD)).isLocked).toBe(false);
  });

  it('rewrites the vault so only the new password opens it', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await changePassword(TEST_PASSWORD, 'TestWallet2!');
    await lock();

    await expect(unlock(TEST_PASSWORD)).rejects.toThrow('Invalid password');
    expect((await unlock('TestWallet2!')).accounts[0]?.address).toBe(TEST_ADDRESS);
  });
});

describe('the session', () => {
  it('keeps the active account across an unlock', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    // Two accounts on record, as a later ADD_ACCOUNT leaves them; the addresses
    // are re-derived on unlock, so only the names have to be right here.
    await chromeStub.storage.local.set({ [ACCOUNTS_KEY]: { accounts: await fixtureAccounts(2) } });
    expect((await switchAccount(1)).activeAccountIndex).toBe(1);

    const unlocked = await unlock(TEST_PASSWORD);
    expect(unlocked.activeAccountIndex).toBe(1);
    expect(unlocked.accounts).toHaveLength(2);
  });

  it('exports the private key of the account that was asked for, not the active one', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await chromeStub.storage.local.set({ [ACCOUNTS_KEY]: { accounts: await fixtureAccounts(2) } });

    const key = await exportPrivateKey(TEST_PASSWORD, 1);
    // A base58 ed25519 secret key: 64 bytes, and the public half is account 1's address.
    const secret = bs58.decode(key);
    expect(secret).toHaveLength(64);
    expect(Keypair.fromSecretKey(secret).publicKey.toBase58()).toBe((await fixtureAccounts(2))[1]?.address);
    expect(await exportPrivateKey(TEST_PASSWORD, 0)).not.toBe(key);
    // The export left the wallet unlocked on the account the user had active.
    expect((await getPublicState()).activeAccountIndex).toBe(0);
  });

  it('exports the seed phrase only with the right password', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    expect(await exportSeed(TEST_PASSWORD)).toBe(TEST_MNEMONIC);
    await expect(exportSeed('not-the-password')).rejects.toThrow('Invalid password');
  });

  it('keeps the account the user chose across a lock and unlock', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await addAccount();
    expect((await switchAccount(1)).activeAccountIndex).toBe(1);

    await lock();
    const unlocked = await unlock(TEST_PASSWORD);
    // The session is gone, so the choice came back from cinder_accounts.
    expect(unlocked.activeAccountIndex).toBe(1);
    expect(unlocked.accounts).toHaveLength(2);
  });

  it('falls back to the first account when the stored selection no longer exists', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await lock();
    // A list of one with a selection pointing past it, as an interrupted write could leave.
    const stored = (await chromeStub.storage.local.get(ACCOUNTS_KEY))[ACCOUNTS_KEY] as {
      accounts: WalletAccountInfo[];
    };
    await chromeStub.storage.local.set({ [ACCOUNTS_KEY]: { ...stored, activeAccountIndex: 4 } });

    expect((await unlock(TEST_PASSWORD)).activeAccountIndex).toBe(0);
  });
});

describe('exporting a secret', () => {
  it('does not unlock a locked wallet as a side effect', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    const expected = await exportPrivateKey(TEST_PASSWORD, 0);
    await lock();
    await chromeStub.alarms.clear('cinder-autolock');
    let unlockedHook = 0;
    setLockHooks({ onUnlocked: () => { unlockedHook += 1; } });

    expect(await exportSeed(TEST_PASSWORD)).toBe(TEST_MNEMONIC);
    expect(await exportPrivateKey(TEST_PASSWORD, 0)).toBe(expected);
    await changePassword(TEST_PASSWORD, 'TestWallet2!');

    // The password proved the export; it did not ask for a session.
    expect((await getPublicState()).isLocked).toBe(true);
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty('cinder_session');
    expect(chromeStub.alarms.scheduled()).toEqual({});
    expect(unlockedHook).toBe(0);
    // And the new password is the one that opens it afterwards.
    await expect(unlock(TEST_PASSWORD)).rejects.toThrow('Invalid password');
    expect((await unlock('TestWallet2!')).accounts[0]?.address).toBe(TEST_ADDRESS);
  });
});

describe('concurrent account changes', () => {
  it('does not drop one change when two run at once', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await addAccount();

    // Both read the list of two; without a single chain the later write wins and
    // the other change is gone — a third account, or the new name, never happened.
    await Promise.all([addAccount(), renameAccount(0, 'Savings')]);

    const state = await getPublicState();
    expect(state.accounts).toHaveLength(3);
    expect(state.accounts[0]?.name).toBe('Savings');
    expect(state.accounts.map((account) => account.index)).toEqual([0, 1, 2]);
  });
});

describe('signing keys', () => {
  it('derives the account asked for, signs with it, and refuses once locked', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    await addAccount();
    const second = (await fixtureAccounts(2))[1]!;

    // The active account by default; any other only when it is named.
    expect((await getKeypair()).publicKey.toBase58()).toBe(TEST_ADDRESS);
    expect((await getKeypair(1)).publicKey.toBase58()).toBe(second.address);

    // A real ed25519 signature, verifiable against the address the popup shows.
    const message = new TextEncoder().encode('cinder wallet test message');
    const signature = await signMessage(message);
    expect(signature).toHaveLength(64);
    expect(nacl.sign.detached.verify(message, signature, bs58.decode(TEST_ADDRESS))).toBe(true);
    // ...and the second account signs as itself, not as the active one.
    const other = await signMessage(message, 1);
    expect(other).not.toEqual(signature);
    expect(nacl.sign.detached.verify(message, other, bs58.decode(second.address))).toBe(true);

    await lock();
    await expect(getKeypair()).rejects.toThrow('Wallet is locked');
    await expect(signMessage(message)).rejects.toThrow('Wallet is locked');
  });
});

describe('the auto-lock alarm', () => {
  it('locks the wallet when cinder-autolock fires, and ignores every other alarm', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    registerAutoLock();

    // The listener does not await its `lock()`; one macrotask drains the whole
    // chain, since nothing in it waits on a timer.
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

    chromeStub.alarms.onAlarm.emit({ name: 'some-other-alarm' });
    await settled();
    expect((await getPublicState()).isLocked).toBe(false);

    chromeStub.alarms.onAlarm.emit({ name: 'cinder-autolock' });
    await settled();
    expect((await getPublicState()).isLocked).toBe(true);
    expect(chromeStub.storage.session.snapshot()).not.toHaveProperty('cinder_session');
  });
});

describe('a session written before the seed rewrite', () => {
  it('is upgraded to a seed on the next read, and the phrase leaves session storage', async () => {
    await createWallet(TEST_PASSWORD, TEST_MNEMONIC);
    // What builds before the rewrite left behind: the phrase itself, in session storage.
    await chromeStub.storage.session.set({
      cinder_session: { mnemonic: TEST_MNEMONIC, activeAccountIndex: 0 },
    });

    const state = await getPublicState();
    expect(state.isLocked).toBe(false);
    expect(state.accounts[0]?.address).toBe(TEST_ADDRESS);

    const session = chromeStub.storage.session.snapshot().cinder_session as {
      seedB64?: string;
      mnemonic?: string;
    };
    expect(session.mnemonic).toBeUndefined();
    expect(session.seedB64).toBe((await mnemonicToSeedBuffer(TEST_MNEMONIC)).toString('base64'));
    // Not just off that one key: the phrase is nowhere in session storage any more.
    expect(JSON.stringify(chromeStub.storage.session.snapshot())).not.toContain('abandon');
    // And the upgraded session still signs for the same account.
    expect((await getKeypair()).publicKey.toBase58()).toBe(TEST_ADDRESS);
  });
});

describe('the one-time key migration', () => {
  it('is retried after a failed read rather than pinned as a failure forever', async () => {
    await chromeStub.storage.local.set({ lumen_settings: { cluster: 'devnet' } });
    resetKeyringForTests();
    const get = vi.spyOn(chromeStub.storage.local, 'get');
    get.mockImplementationOnce(async () => {
      throw new Error('storage offline');
    });

    await expect(getSettings()).rejects.toThrow('storage offline');
    // The next access starts the migration again instead of re-throwing the pinned failure.
    expect((await getSettings()).cluster).toBe('devnet');
    expect(chromeStub.storage.local.snapshot()).not.toHaveProperty('lumen_settings');
    get.mockRestore();
  });
});
