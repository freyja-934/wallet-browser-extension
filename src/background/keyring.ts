import { Keypair } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { BUILD_HELIUS_API_KEY, getCluster } from '../config/constants';
import { decrypt, encrypt, EncryptedData } from '../lib/encryption-simple';
import {
  DEFAULT_SETTINGS,
  WalletAccountInfo,
  WalletPublicState,
  WalletSettings,
} from '../lib/messages';
import { signBytes } from '../lib/sign';
import {
  deriveKeypairFromSeed,
  generateAccountsFromSeed,
  generateSeedPhrase,
  mnemonicToSeedBuffer,
  validateSeedPhrase,
} from '../lib/wallet';
import { rejectAll } from './approvals';
import * as origins from './origins';
import { sessionArea } from './session-store';

const VAULT_KEY = 'cinder_vault';
const SETTINGS_KEY = 'cinder_settings';
const SESSION_KEY = 'cinder_session';
const ACCOUNTS_KEY = 'cinder_accounts';
const AUTOLOCK_ALARM = 'cinder-autolock';

/** Pre-rename storage keys, read once and moved to their `cinder_*` names on first access. */
const LEGACY_LOCAL_KEYS: Record<string, string> = {
  lumen_vault: VAULT_KEY,
  lumen_settings: SETTINGS_KEY,
  lumen_accounts: ACCOUNTS_KEY,
};
const LEGACY_SESSION_KEYS: Record<string, string> = { lumen_session: SESSION_KEY };
const LEGACY_AUTOLOCK_ALARM = 'lumen-autolock';

async function moveLegacyKeys(
  area: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>,
  mapping: Record<string, string>
): Promise<void> {
  const oldKeys = Object.keys(mapping);
  const found = await area.get(oldKeys);
  const present = oldKeys.filter((key) => found[key] !== undefined);
  if (present.length === 0) return;
  const current = await area.get(present.map((key) => mapping[key]));
  const copy: Record<string, unknown> = {};
  for (const key of present) {
    const target = mapping[key];
    if (current[target] === undefined) copy[target] = found[key];
  }
  if (Object.keys(copy).length > 0) await area.set(copy);
  await area.remove(present);
}

let migration: Promise<void> | undefined;

/**
 * Carry a scheduled `lumen-autolock` over to `cinder-autolock` at the same
 * moment, so the rename neither postpones nor skips the auto-lock. Not
 * `scheduleAutoLock`: that reads settings, which would re-enter the migration.
 */
async function moveLegacyAlarm(): Promise<void> {
  if (!chrome.alarms) return;
  // Chrome resolves with undefined for an alarm that does not exist; the types say otherwise.
  const legacy = (await chrome.alarms.get(LEGACY_AUTOLOCK_ALARM)) as chrome.alarms.Alarm | undefined;
  await chrome.alarms.clear(LEGACY_AUTOLOCK_ALARM);
  if (legacy) await chrome.alarms.create(AUTOLOCK_ALARM, { when: legacy.scheduledTime });
}

/** One-time move of `lumen_*` keys and the `lumen-autolock` alarm. Runs before any read or write. */
function ensureMigrated(): Promise<void> {
  if (!migration) {
    migration = (async () => {
      await moveLegacyKeys(chrome.storage.local, LEGACY_LOCAL_KEYS);
      await moveLegacyKeys(sessionArea(), LEGACY_SESSION_KEYS);
      await moveLegacyAlarm();
    })().catch((error) => {
      // Let the next access try again rather than pinning a failed promise forever.
      migration = undefined;
      throw error;
    });
  }
  return migration;
}

/** Tests only: forget that the migration ran, so a fresh stub migrates again. */
export function resetKeyringForTests(): void {
  migration = undefined;
  lockHooks = {};
}

export interface LockHooks {
  /** After the session is gone and pending approvals rejected (lock, auto-lock, clear). */
  onLocked?: () => void | Promise<void>;
  /** After a successful unlock wrote the session (the popup re-reads state on this). */
  onUnlocked?: () => void | Promise<void>;
  /** After the vault and connected sites are removed. */
  onCleared?: () => void | Promise<void>;
}

let lockHooks: LockHooks = {};

/** The worker registers event emitters here; the keyring never touches `chrome.tabs` itself. */
export function setLockHooks(hooks: LockHooks): void {
  lockHooks = { ...hooks };
}

async function runHook(hook: (() => void | Promise<void>) | undefined): Promise<void> {
  if (!hook) return;
  try {
    await hook();
  } catch {
    /* event delivery is best effort */
  }
}

interface VaultPayload {
  mnemonic: string;
  accounts: WalletAccountInfo[];
}

interface StoredVault {
  encrypted: EncryptedData;
  createdAt: number;
}

interface SessionPayload {
  seedB64: string;
  activeAccountIndex: number;
}

interface LegacySession {
  mnemonic?: string;
  seedB64?: string;
  activeAccountIndex: number;
}

async function localGet<T>(key: string): Promise<T | undefined> {
  await ensureMigrated();
  const data = await chrome.storage.local.get(key);
  return data[key] as T | undefined;
}

async function localSet(key: string, value: unknown): Promise<void> {
  await ensureMigrated();
  await chrome.storage.local.set({ [key]: value });
}

async function sessionGet<T>(key: string): Promise<T | undefined> {
  await ensureMigrated();
  const data = await sessionArea().get(key);
  return data[key] as T | undefined;
}

async function sessionSet(key: string, value: unknown): Promise<void> {
  await ensureMigrated();
  await sessionArea().set({ [key]: value });
}

async function sessionRemove(key: string): Promise<void> {
  await ensureMigrated();
  await sessionArea().remove(key);
}

async function writeSession(session: SessionPayload): Promise<void> {
  await sessionSet(SESSION_KEY, session);
}

async function readSession(): Promise<SessionPayload | undefined> {
  const raw = await sessionGet<LegacySession>(SESSION_KEY);
  if (!raw) return undefined;
  if (raw.seedB64) {
    return { seedB64: raw.seedB64, activeAccountIndex: raw.activeAccountIndex };
  }
  if (raw.mnemonic) {
    const seed = await mnemonicToSeedBuffer(raw.mnemonic);
    const next = { seedB64: seed.toString('base64'), activeAccountIndex: raw.activeAccountIndex };
    await writeSession(next);
    return next;
  }
  return undefined;
}

export async function hasVault(): Promise<boolean> {
  return !!(await localGet<StoredVault>(VAULT_KEY));
}

/**
 * Build-time Helius key (`VITE_HELIUS_API_KEY`), read at module load. A dev
 * convenience only; the test hook below swaps it without rebuilding.
 */
let buildHeliusApiKey = BUILD_HELIUS_API_KEY;

/** Tests only: replace the build-time key `getSettings` seeds from. */
export function setBuildHeliusApiKeyForTests(key: string): void {
  buildHeliusApiKey = key;
}

type StoredSettings = Partial<WalletSettings>;

async function readStoredSettings(): Promise<StoredSettings> {
  return (await localGet<StoredSettings>(SETTINGS_KEY)) ?? {};
}

/** Defaults under the stored object; the build cluster when none is stored. */
function withDefaults(stored: StoredSettings): WalletSettings {
  return { ...DEFAULT_SETTINGS, ...stored, cluster: stored.cluster ?? getCluster() };
}

/**
 * Settings as the popup sees them. The build-time key fills `heliusApiKey` only
 * when the stored object has no such property at all: a stored `''` is the user
 * having cleared it, and an empty optional field is reported as absent.
 */
export async function getSettings(): Promise<WalletSettings> {
  const stored = await readStoredSettings();
  const settings = withDefaults(stored);
  if (!('heliusApiKey' in stored) && buildHeliusApiKey) settings.heliusApiKey = buildHeliusApiKey;
  if (!settings.heliusApiKey) delete settings.heliusApiKey;
  if (!settings.rpcUrl) {
    delete settings.rpcUrl;
    delete settings.rpcUrlCluster;
  }
  return settings;
}

/** `'  '` and `''` both clear the field; whitespace around a value is never stored. */
function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Merge `partial` over what is actually stored, never over `getSettings()`: the
 * build-time key it seeds must not be written back as if the user had typed it.
 * Clearing the key stores `''` so the seed does not return; clearing the URL drops
 * its cluster tag with it. A custom URL tagged with the other cluster stays stored
 * across a cluster switch and is simply not used (see `rpcUrlsFor`).
 */
export async function updateSettings(partial: Partial<WalletSettings>): Promise<WalletSettings> {
  const stored = await readStoredSettings();
  const next: WalletSettings = { ...withDefaults(stored), ...partial };
  if ('rpcUrl' in partial) {
    const rpcUrl = normalizeOptional(partial.rpcUrl);
    if (rpcUrl !== undefined && !isHttpsUrl(rpcUrl)) throw new Error('Invalid rpcUrl');
    if (rpcUrl === undefined) {
      delete next.rpcUrl;
      delete next.rpcUrlCluster;
    } else {
      next.rpcUrl = rpcUrl;
    }
  }
  if ('rpcUrlCluster' in partial && partial.rpcUrlCluster === undefined) delete next.rpcUrlCluster;
  if ('heliusApiKey' in partial) {
    next.heliusApiKey = normalizeOptional(partial.heliusApiKey) ?? '';
  }
  await localSet(SETTINGS_KEY, next);
  await scheduleAutoLock();
  return getSettings();
}

export async function getPublicState(): Promise<WalletPublicState> {
  const vault = await localGet<StoredVault>(VAULT_KEY);
  const session = await readSession();
  const accounts = vault && session ? await accountsFromSession(session) : [];
  return {
    hasVault: !!vault,
    isLocked: !session,
    accounts,
    activeAccountIndex: session?.activeAccountIndex ?? 0,
  };
}

async function accountsFromSession(session: SessionPayload): Promise<WalletAccountInfo[]> {
  const stored = await localGet<{ accounts: WalletAccountInfo[] }>(ACCOUNTS_KEY);
  if (stored?.accounts?.length) return stored.accounts;
  const seed = Buffer.from(session.seedB64, 'base64');
  return await generateAccountsFromSeed(seed, 1);
}

async function persistAccounts(accounts: WalletAccountInfo[]): Promise<void> {
  await localSet(ACCOUNTS_KEY, { accounts });
}

export async function createWallet(password: string, mnemonic?: string): Promise<WalletPublicState> {
  const seedInfo = mnemonic ? validateSeedPhrase(mnemonic) : generateSeedPhrase(12);
  if (!seedInfo.isValid) {
    throw new Error('Invalid seed phrase');
  }
  const seed = await mnemonicToSeedBuffer(seedInfo.mnemonic);
  const accounts = await generateAccountsFromSeed(seed, 1);
  const payload: VaultPayload = { mnemonic: seedInfo.mnemonic, accounts };
  const encrypted = await encrypt(JSON.stringify(payload), password);
  await localSet(VAULT_KEY, { encrypted, createdAt: Date.now() } satisfies StoredVault);
  await persistAccounts(accounts);
  await writeSession({ seedB64: seed.toString('base64'), activeAccountIndex: 0 });
  await scheduleAutoLock();
  return getPublicState();
}

async function decryptVault(password: string): Promise<VaultPayload> {
  const vault = await localGet<StoredVault>(VAULT_KEY);
  if (!vault) throw new Error('No wallet found');
  try {
    const bytes = await decrypt(vault.encrypted, password);
    return JSON.parse(new TextDecoder().decode(bytes)) as VaultPayload;
  } catch {
    throw new Error('Invalid password');
  }
}

export async function unlock(password: string): Promise<WalletPublicState> {
  const payload = await decryptVault(password);
  const seed = await mnemonicToSeedBuffer(payload.mnemonic);
  const derived = await generateAccountsFromSeed(seed, Math.max(payload.accounts.length, 1));
  const accounts = derived.map((account, i) => ({
    ...account,
    name: payload.accounts[i]?.name ?? account.name,
  }));
  await persistAccounts(accounts);
  await writeSession({ seedB64: seed.toString('base64'), activeAccountIndex: 0 });
  await scheduleAutoLock();
  await runHook(lockHooks.onUnlocked);
  return getPublicState();
}

export async function lock(): Promise<WalletPublicState> {
  await sessionRemove(SESSION_KEY);
  if (chrome.alarms) await chrome.alarms.clear(AUTOLOCK_ALARM);
  // Nothing queued before the lock may be approved after it.
  await rejectAll('Wallet locked');
  await runHook(lockHooks.onLocked);
  return getPublicState();
}

/**
 * The popup is in use: push the auto-lock deadline out again. Called by the
 * router for every extension-page message; a no-op while locked.
 */
export async function touchActivity(): Promise<void> {
  if (!(await readSession())) return;
  await scheduleAutoLock();
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await readSession();
  if (!session) throw new Error('Wallet is locked');
  return session;
}

export async function getKeypair(accountIndex?: number): Promise<Keypair> {
  const session = await requireSession();
  const index = accountIndex ?? session.activeAccountIndex;
  const seed = Buffer.from(session.seedB64, 'base64');
  return (await deriveKeypairFromSeed(seed, index)).keypair;
}

export async function signMessage(message: Uint8Array, accountIndex?: number): Promise<Uint8Array> {
  const keypair = await getKeypair(accountIndex);
  return signBytes(message, keypair.secretKey);
}

export async function exportSeed(password: string): Promise<string> {
  const payload = await decryptVault(password);
  await unlock(password);
  return payload.mnemonic;
}

export async function exportPrivateKey(password: string, accountIndex: number): Promise<string> {
  await unlock(password);
  const keypair = await getKeypair(accountIndex);
  return bs58.encode(keypair.secretKey);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const payload = await decryptVault(currentPassword);
  const state = await unlock(currentPassword);
  const next: VaultPayload = { mnemonic: payload.mnemonic, accounts: state.accounts };
  const encrypted = await encrypt(JSON.stringify(next), newPassword);
  await localSet(VAULT_KEY, { encrypted, createdAt: Date.now() } satisfies StoredVault);
}

export async function clearWallet(): Promise<WalletPublicState> {
  await lock();
  await chrome.storage.local.remove([VAULT_KEY, SETTINGS_KEY, ACCOUNTS_KEY]);
  await origins.clear();
  await runHook(lockHooks.onCleared);
  return getPublicState();
}

export async function switchAccount(index: number): Promise<WalletPublicState> {
  const session = await requireSession();
  await writeSession({ ...session, activeAccountIndex: index });
  return getPublicState();
}

export async function scheduleAutoLock(): Promise<void> {
  if (!chrome.alarms) return;
  const settings = await getSettings();
  await chrome.alarms.clear(AUTOLOCK_ALARM);
  if (settings.autoLockTimeout <= 0) return;
  await chrome.alarms.create(AUTOLOCK_ALARM, {
    delayInMinutes: Math.max(settings.autoLockTimeout, 1),
  });
}

export function registerAutoLock(): void {
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTOLOCK_ALARM) {
      void lock();
    }
  });
}
