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

const VAULT_KEYS = ['cinder_vault', 'lumen_vault'] as const;
const SETTINGS_KEYS = ['cinder_settings', 'lumen_settings'] as const;
const SESSION_KEYS = ['cinder_session', 'lumen_session'] as const;
const ACCOUNTS_KEYS = ['cinder_accounts', 'lumen_accounts'] as const;
const AUTOLOCK_ALARMS = ['cinder-autolock', 'lumen-autolock'] as const;

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
  const data = await chrome.storage.local.get(key);
  return data[key] as T | undefined;
}

async function localGetFirst<T>(keys: readonly string[]): Promise<T | undefined> {
  for (const key of keys) {
    const value = await localGet<T>(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

async function localSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

function sessionStore() {
  return chrome.storage.session ?? chrome.storage.local;
}

async function sessionGet<T>(key: string): Promise<T | undefined> {
  const data = await sessionStore().get(key);
  return data[key] as T | undefined;
}

async function sessionGetFirst<T>(keys: readonly string[]): Promise<T | undefined> {
  for (const key of keys) {
    const value = await sessionGet<T>(key);
    if (value !== undefined) return value;
  }
  return undefined;
}

async function sessionSet(key: string, value: unknown): Promise<void> {
  await sessionStore().set({ [key]: value });
}

async function sessionRemoveAll(keys: readonly string[]): Promise<void> {
  await sessionStore().remove([...keys]);
}

async function writeSession(session: SessionPayload): Promise<void> {
  await sessionSet(SESSION_KEYS[0], session);
}

async function readSession(): Promise<SessionPayload | undefined> {
  const raw = await sessionGetFirst<LegacySession>(SESSION_KEYS);
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
  return !!(await localGetFirst<StoredVault>(VAULT_KEYS));
}

export async function getSettings(): Promise<WalletSettings> {
  const stored = (await localGetFirst<Partial<WalletSettings>>(SETTINGS_KEYS)) ?? {};
  const settings: WalletSettings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    cluster: stored.cluster ?? getCluster(),
  };
  // The build-time key is a dev convenience: it only fills in when the user has stored none.
  if (!stored.heliusApiKey && BUILD_HELIUS_API_KEY) settings.heliusApiKey = BUILD_HELIUS_API_KEY;
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

export async function updateSettings(partial: Partial<WalletSettings>): Promise<WalletSettings> {
  const current = await getSettings();
  const next: WalletSettings = { ...current, ...partial };
  if ('rpcUrl' in partial) {
    const rpcUrl = normalizeOptional(partial.rpcUrl);
    if (rpcUrl !== undefined && !isHttpsUrl(rpcUrl)) throw new Error('Invalid rpcUrl');
    if (rpcUrl === undefined) delete next.rpcUrl;
    else next.rpcUrl = rpcUrl;
  }
  if ('heliusApiKey' in partial) {
    const heliusApiKey = normalizeOptional(partial.heliusApiKey);
    if (heliusApiKey === undefined) delete next.heliusApiKey;
    else next.heliusApiKey = heliusApiKey;
  }
  await localSet(SETTINGS_KEYS[0], next);
  await scheduleAutoLock();
  return getSettings();
}

export async function getPublicState(): Promise<WalletPublicState> {
  const vault = await localGetFirst<StoredVault>(VAULT_KEYS);
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
  const stored = await localGetFirst<{ accounts: WalletAccountInfo[] }>(ACCOUNTS_KEYS);
  if (stored?.accounts?.length) return stored.accounts;
  const seed = Buffer.from(session.seedB64, 'base64');
  return await generateAccountsFromSeed(seed, 1);
}

async function persistAccounts(accounts: WalletAccountInfo[]): Promise<void> {
  await localSet(ACCOUNTS_KEYS[0], { accounts });
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
  await localSet(VAULT_KEYS[0], { encrypted, createdAt: Date.now() } satisfies StoredVault);
  await persistAccounts(accounts);
  await writeSession({ seedB64: seed.toString('base64'), activeAccountIndex: 0 });
  await scheduleAutoLock();
  return getPublicState();
}

async function decryptVault(password: string): Promise<VaultPayload> {
  const vault = await localGetFirst<StoredVault>(VAULT_KEYS);
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
  return getPublicState();
}

export async function lock(): Promise<WalletPublicState> {
  await sessionRemoveAll(SESSION_KEYS);
  if (chrome.alarms) {
    await Promise.all(AUTOLOCK_ALARMS.map((name) => chrome.alarms.clear(name)));
  }
  return getPublicState();
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
  await localSet(VAULT_KEYS[0], { encrypted, createdAt: Date.now() } satisfies StoredVault);
}

export async function clearWallet(): Promise<WalletPublicState> {
  await lock();
  await chrome.storage.local.remove([...VAULT_KEYS, ...SETTINGS_KEYS, ...ACCOUNTS_KEYS]);
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
  await Promise.all(AUTOLOCK_ALARMS.map((name) => chrome.alarms.clear(name)));
  if (settings.autoLockTimeout <= 0) return;
  await chrome.alarms.create(AUTOLOCK_ALARMS[0], {
    delayInMinutes: Math.max(settings.autoLockTimeout, 1),
  });
}

export function registerAutoLock(): void {
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if ((AUTOLOCK_ALARMS as readonly string[]).includes(alarm.name)) {
      void lock();
    }
  });
}
