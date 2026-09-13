import { Keypair } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { BUILD_HELIUS_API_KEY, getCluster } from '../config/constants';
import {
  CURRENT_VAULT_VERSION,
  decrypt,
  encrypt,
  kdfFor,
  validatePasswordStrength,
  type EncryptedData,
} from '../lib/encryption-simple';
import {
  DEFAULT_SETTINGS,
  MAX_ACCOUNT_NAME_LENGTH,
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
  accountWrites = Promise.resolve();
  lockHooks = {};
}

let accountWrites: Promise<unknown> = Promise.resolve();

/**
 * Run account-list changes one at a time. `addAccount`, `renameAccount` and
 * `switchAccount` each read `cinder_accounts` and write it back; two of them in
 * flight at once would read the same list and the later write would drop the
 * earlier one's change (an account added while a rename was in the air simply
 * disappears). The worker has no transactions, so the chain is the lock — the
 * same shape `ensureMigrated` uses for its one-time move.
 */
function serializeAccountWrite<T>(work: () => Promise<T>): Promise<T> {
  const next = accountWrites.then(work, work);
  // A failed change must not wedge the chain for everything queued behind it.
  accountWrites = next.then(
    () => undefined,
    () => undefined
  );
  return next;
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

/** `cinder_accounts`: the public account list and the account the user last chose. */
interface StoredAccounts {
  accounts: WalletAccountInfo[];
  /** Absent on lists written before the selection was persisted; unlock then starts at the first. */
  activeAccountIndex?: number;
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
  const stored = await readStoredAccounts();
  if (stored?.accounts?.length) return stored.accounts;
  const seed = Buffer.from(session.seedB64, 'base64');
  return await generateAccountsFromSeed(seed, 1);
}

/**
 * The persisted account list and the account the user last chose. Names,
 * addresses and a derivation index are public — no part of this comes from the
 * session — so it reads the same whether the wallet is locked or open. That is
 * what lets the router resolve the address a page names to an index without
 * opening the vault; nothing here derives or exposes a key.
 */
export async function readStoredAccounts(): Promise<StoredAccounts | undefined> {
  return localGet<StoredAccounts>(ACCOUNTS_KEY);
}

/**
 * The account list and the selection are written together: which account the
 * user is on is public state (it names an address, not a secret), so it belongs
 * beside the list rather than only in the session, which a lock throws away.
 */
async function persistAccounts(accounts: WalletAccountInfo[], activeAccountIndex: number): Promise<void> {
  await localSet(ACCOUNTS_KEY, { accounts, activeAccountIndex } satisfies StoredAccounts);
}

/** The stored index if it still names an account, else the first account. */
function clampToAccounts(accounts: WalletAccountInfo[], wanted: number | undefined): number {
  if (wanted !== undefined && accounts.some((account) => account.index === wanted)) return wanted;
  return accounts[0]?.index ?? 0;
}

/** One place that writes the vault, so every write carries the current format. */
async function writeVault(payload: VaultPayload, password: string): Promise<void> {
  const encrypted = await encrypt(JSON.stringify(payload), password);
  await localSet(VAULT_KEY, { encrypted, createdAt: Date.now() } satisfies StoredVault);
}

/**
 * Create the one vault this installation has. An empty `mnemonic` means "make a
 * fresh one", so a create against a vault that already exists would replace a
 * wallet — with funds in it, and a phrase its owner has written down — with one
 * nobody has ever seen. Nothing in the popup should ask for that twice; the
 * worker refuses it outright rather than trusting that. Clearing the wallet
 * (Settings → Clear all wallet data) is the way to start over.
 */
export async function createWallet(password: string, mnemonic?: string): Promise<WalletPublicState> {
  if (await hasVault()) throw new Error('Wallet already exists');
  // The same rule change-password enforces, applied where it cannot be skipped:
  // the create screen checks it too, but the popup is not the boundary.
  const strength = validatePasswordStrength(password);
  if (!strength.isValid) throw new Error(strength.feedback[0] ?? 'Password is too weak');
  const seedInfo = mnemonic ? validateSeedPhrase(mnemonic) : generateSeedPhrase(12);
  if (!seedInfo.isValid) {
    throw new Error('Invalid seed phrase');
  }
  const seed = await mnemonicToSeedBuffer(seedInfo.mnemonic);
  const accounts = await generateAccountsFromSeed(seed, 1);
  await writeVault({ mnemonic: seedInfo.mnemonic, accounts }, password);
  await persistAccounts(accounts, 0);
  await writeSession({ seedB64: seed.toString('base64'), activeAccountIndex: 0 });
  await scheduleAutoLock();
  return getPublicState();
}

interface DecryptedVault {
  payload: VaultPayload;
  /** The format the stored blob was written in; below `CURRENT_VAULT_VERSION` it is migrated. */
  version: number;
}

async function decryptVault(password: string): Promise<DecryptedVault> {
  const vault = await localGet<StoredVault>(VAULT_KEY);
  if (!vault) throw new Error('No wallet found');
  // Outside the try on purpose: a blob this build cannot read is not a wrong
  // password, and telling the user it is would send them off to re-type a
  // password that was right all along. Its message travels unchanged.
  kdfFor(vault.encrypted);
  const version = vault.encrypted.version ?? 1;
  try {
    const bytes = await decrypt(vault.encrypted, password);
    return {
      payload: JSON.parse(new TextDecoder().decode(bytes)) as VaultPayload,
      version,
    };
  } catch {
    // Only the decrypt and the parse are a bad password (or a tampered blob).
    throw new Error('Invalid password');
  }
}

/**
 * Decrypt once, and bring an older blob up to the current format straight away:
 * the new blob is written before anything else happens, so a worker that dies
 * mid-unlock leaves a vault that opens with the same password either way.
 */
async function openVault(password: string): Promise<VaultPayload> {
  const { payload, version } = await decryptVault(password);
  if (version < CURRENT_VAULT_VERSION) await writeVault(payload, password);
  return payload;
}

/**
 * Establish the session from an already-decrypted payload, so the callers that
 * needed the payload anyway derive the key exactly once.
 *
 * The account list comes from `cinder_accounts`, not the vault payload: accounts
 * added after the vault was written are not in the payload and must not vanish.
 * The selection comes from the session when one is open and from the stored list
 * otherwise, so a lock does not quietly move the user back to the first account —
 * on an address they may not be watching.
 */
async function unlockWithPayload(payload: VaultPayload): Promise<WalletPublicState> {
  const seed = await mnemonicToSeedBuffer(payload.mnemonic);
  const stored = await readStoredAccounts();
  const names = stored?.accounts?.length ? stored.accounts : payload.accounts;
  const derived = await generateAccountsFromSeed(seed, Math.max(names.length, 1));
  const accounts = derived.map((account, i) => ({ ...account, name: names[i]?.name ?? account.name }));
  const previous = await readSession();
  const activeAccountIndex = clampToAccounts(accounts, previous?.activeAccountIndex ?? stored?.activeAccountIndex);
  await persistAccounts(accounts, activeAccountIndex);
  await writeSession({ seedB64: seed.toString('base64'), activeAccountIndex });
  await scheduleAutoLock();
  await runHook(lockHooks.onUnlocked);
  return getPublicState();
}

/**
 * Bring an open session up to date with a payload we just decrypted, and do
 * nothing at all when the wallet is locked. Exporting a secret or changing the
 * password proves the password; neither is a request to unlock, and neither may
 * leave a session (or an auto-lock alarm) behind that the user did not ask for.
 */
async function refreshSessionIfOpen(payload: VaultPayload): Promise<void> {
  if (!(await readSession())) return;
  await unlockWithPayload(payload);
}

export async function unlock(password: string): Promise<WalletPublicState> {
  return unlockWithPayload(await openVault(password));
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
  const payload = await openVault(password);
  await refreshSessionIfOpen(payload);
  return payload.mnemonic;
}

/**
 * The key comes from the payload just decrypted, not from the session: a locked
 * wallet exports with the password alone and stays locked afterwards.
 */
export async function exportPrivateKey(password: string, accountIndex: number): Promise<string> {
  const payload = await openVault(password);
  await refreshSessionIfOpen(payload);
  const seed = await mnemonicToSeedBuffer(payload.mnemonic);
  const { keypair } = await deriveKeypairFromSeed(seed, accountIndex);
  return bs58.encode(keypair.secretKey);
}

/**
 * The new password must pass the same strength check the create screen applies;
 * the vault is only rewritten once the current password has actually opened it,
 * so a rejected change leaves the old vault exactly as it was. A locked wallet
 * stays locked: changing the password is not a way in.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const strength = validatePasswordStrength(newPassword);
  if (!strength.isValid) throw new Error(strength.feedback[0] ?? 'Password is too weak');
  const { payload } = await decryptVault(currentPassword);
  // The stored list, not the payload's: accounts added since the vault was
  // written must survive the rewrite.
  const accounts = (await readStoredAccounts())?.accounts ?? payload.accounts;
  await writeVault({ mnemonic: payload.mnemonic, accounts }, newPassword);
  await refreshSessionIfOpen(payload);
}

export async function clearWallet(): Promise<WalletPublicState> {
  await lock();
  await chrome.storage.local.remove([VAULT_KEY, SETTINGS_KEY, ACCOUNTS_KEY]);
  await origins.clear();
  await runHook(lockHooks.onCleared);
  return getPublicState();
}

export async function switchAccount(index: number): Promise<WalletPublicState> {
  return serializeAccountWrite(async () => {
    const session = await requireSession();
    const accounts = await accountsFromSession(session);
    if (!accounts.some((account) => account.index === index)) throw new Error('No such account');
    await writeSession({ ...session, activeAccountIndex: index });
    // Also on disk, so the choice survives the lock that throws the session away.
    await persistAccounts(accounts, index);
    return getPublicState();
  });
}

/**
 * Derive the next account from the seed already in the session and append it to
 * `cinder_accounts`. The list is the source of truth for how many accounts exist:
 * the vault payload is not rewritten, so this needs no password, and `unlock`
 * derives from the stored count rather than from what the vault happened to hold.
 */
export async function addAccount(): Promise<WalletPublicState> {
  return serializeAccountWrite(async () => {
    const session = await requireSession();
    const accounts = await accountsFromSession(session);
    const nextIndex = accounts.reduce((max, account) => Math.max(max, account.index), -1) + 1;
    const seed = Buffer.from(session.seedB64, 'base64');
    const [added] = await generateAccountsFromSeed(seed, 1, nextIndex);
    // Adding does not move the user off the account they were on.
    await persistAccounts([...accounts, added], session.activeAccountIndex);
    return getPublicState();
  });
}

/** Rename one account. Names are public data: they live beside the addresses, not in the vault. */
export async function renameAccount(index: number, name: string): Promise<WalletPublicState> {
  return serializeAccountWrite(async () => {
    const session = await requireSession();
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_ACCOUNT_NAME_LENGTH) throw new Error('Invalid name');
    const accounts = await accountsFromSession(session);
    const at = accounts.findIndex((account) => account.index === index);
    if (at === -1) throw new Error('No such account');
    await persistAccounts(
      accounts.map((account, i) => (i === at ? { ...account, name: trimmed } : account)),
      session.activeAccountIndex
    );
    return getPublicState();
  });
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
