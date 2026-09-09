import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
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

const VAULT_KEY = 'lumen_vault';
const SETTINGS_KEY = 'lumen_settings';
const SESSION_KEY = 'lumen_session';
const AUTOLOCK_ALARM = 'lumen-autolock';

interface VaultPayload {
  mnemonic: string;
  accounts: WalletAccountInfo[];
}

interface StoredVault {
  encrypted: EncryptedData;
  createdAt: number;
}

interface SessionPayload {
  mnemonic: string;
  activeAccountIndex: number;
}

async function localGet<T>(key: string): Promise<T | undefined> {
  const data = await chrome.storage.local.get(key);
  return data[key] as T | undefined;
}

async function localSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

async function sessionGet<T>(key: string): Promise<T | undefined> {
  const store = chrome.storage.session ?? chrome.storage.local;
  const data = await store.get(key);
  return data[key] as T | undefined;
}

async function sessionSet(key: string, value: unknown): Promise<void> {
  const store = chrome.storage.session ?? chrome.storage.local;
  await store.set({ [key]: value });
}

async function sessionRemove(key: string): Promise<void> {
  const store = chrome.storage.session ?? chrome.storage.local;
  await store.remove(key);
}

export async function hasVault(): Promise<boolean> {
  const vault = await localGet<StoredVault>(VAULT_KEY);
  return !!vault;
}

export async function getSettings(): Promise<WalletSettings> {
  return (await localGet<WalletSettings>(SETTINGS_KEY)) ?? DEFAULT_SETTINGS;
}

export async function updateSettings(partial: Partial<WalletSettings>): Promise<WalletSettings> {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await localSet(SETTINGS_KEY, next);
  await scheduleAutoLock();
  return next;
}

export async function getPublicState(): Promise<WalletPublicState> {
  const vault = await localGet<StoredVault>(VAULT_KEY);
  const session = await sessionGet<SessionPayload>(SESSION_KEY);
  const accounts = vault && session ? await accountsFromSession(session) : [];
  return {
    hasVault: !!vault,
    isLocked: !session,
    accounts,
    activeAccountIndex: session?.activeAccountIndex ?? 0,
  };
}

async function accountsFromSession(session: SessionPayload): Promise<WalletAccountInfo[]> {
  const vault = await localGet<StoredVault>(VAULT_KEY);
  if (!vault) return [];
  // Public account metadata is stored alongside the encrypted mnemonic.
  try {
    const stored = await localGet<{ accounts: WalletAccountInfo[] }>('lumen_accounts');
    if (stored?.accounts?.length) return stored.accounts;
  } catch {
    /* fall through */
  }
  const seed = await mnemonicToSeedBuffer(session.mnemonic);
  return await generateAccountsFromSeed(seed, 1);
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
  await localSet('lumen_accounts', { accounts });
  await sessionSet(SESSION_KEY, {
    mnemonic: seedInfo.mnemonic,
    activeAccountIndex: 0,
  } satisfies SessionPayload);
  await scheduleAutoLock();
  return getPublicState();
}

export async function unlock(password: string): Promise<WalletPublicState> {
  const vault = await localGet<StoredVault>(VAULT_KEY);
  if (!vault) throw new Error('No wallet found');
  let payload: VaultPayload;
  try {
    const bytes = await decrypt(vault.encrypted, password);
    payload = JSON.parse(new TextDecoder().decode(bytes)) as VaultPayload;
  } catch {
    throw new Error('Invalid password');
  }
  const seed = await mnemonicToSeedBuffer(payload.mnemonic);
  const derived = await generateAccountsFromSeed(seed, Math.max(payload.accounts.length, 1));
  const accounts = derived.map((account, i) => ({
    ...account,
    name: payload.accounts[i]?.name ?? account.name,
  }));
  await localSet('lumen_accounts', { accounts });
  await sessionSet(SESSION_KEY, {
    mnemonic: payload.mnemonic,
    activeAccountIndex: 0,
  } satisfies SessionPayload);
  await scheduleAutoLock();
  return getPublicState();
}

export async function lock(): Promise<WalletPublicState> {
  await sessionRemove(SESSION_KEY);
  if (chrome.alarms) {
    await chrome.alarms.clear(AUTOLOCK_ALARM);
  }
  return getPublicState();
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await sessionGet<SessionPayload>(SESSION_KEY);
  if (!session) throw new Error('Wallet is locked');
  return session;
}

export async function getKeypair(accountIndex?: number): Promise<Keypair> {
  const session = await requireSession();
  const index = accountIndex ?? session.activeAccountIndex;
  const seed = await mnemonicToSeedBuffer(session.mnemonic);
  return (await deriveKeypairFromSeed(seed, index)).keypair;
}

export async function signMessage(message: Uint8Array, accountIndex?: number): Promise<Uint8Array> {
  const keypair = await getKeypair(accountIndex);
  return signBytes(message, keypair.secretKey);
}

export async function exportSeed(password: string): Promise<string> {
  await unlock(password);
  const session = await requireSession();
  return session.mnemonic;
}

export async function exportPrivateKey(password: string, accountIndex: number): Promise<string> {
  await unlock(password);
  const keypair = await getKeypair(accountIndex);
  return bs58.encode(keypair.secretKey);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const state = await unlock(currentPassword);
  const session = await requireSession();
  const payload: VaultPayload = { mnemonic: session.mnemonic, accounts: state.accounts };
  const encrypted = await encrypt(JSON.stringify(payload), newPassword);
  await localSet(VAULT_KEY, { encrypted, createdAt: Date.now() } satisfies StoredVault);
}

export async function clearWallet(): Promise<WalletPublicState> {
  await lock();
  await chrome.storage.local.remove([VAULT_KEY, SETTINGS_KEY, 'lumen_accounts']);
  return getPublicState();
}

export async function switchAccount(index: number): Promise<WalletPublicState> {
  const session = await requireSession();
  await sessionSet(SESSION_KEY, { ...session, activeAccountIndex: index });
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
