import type { ApprovalResult } from '../background/approvals';
import {
  MAX_MESSAGE_BYTES,
  MAX_TRANSACTION_BYTES,
  validateByteArray,
  validateByteArrays,
  validateChain,
  validateSendOptions,
  validateSingleTransaction,
} from './bridge';
import {
  isExtensionMessageType,
  MAX_ACCOUNT_NAME_LENGTH,
  type ConnectedSite,
  type ExtensionMessageType,
  type KnownChain,
  type PendingApproval,
  type SendOptions,
  type WalletPublicState,
  type WalletSettings,
} from './messages';
import type { PreviewResult } from './preview';

/**
 * Every message the service worker accepts, one member per
 * `EXTENSION_MESSAGE_TYPES` entry, carrying exactly the fields the router reads.
 * The wire `origin` is never part of the union: the worker takes it from the sender.
 */
export type WalletRequest =
  | { type: 'GET_STATE' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<WalletSettings> }
  | { type: 'CREATE_WALLET'; password: string; seedPhrase?: string }
  | { type: 'UNLOCK'; password: string }
  | { type: 'LOCK' }
  | { type: 'CLEAR_WALLET' }
  | { type: 'SWITCH_ACCOUNT'; index: number }
  | { type: 'ADD_ACCOUNT' }
  | { type: 'RENAME_ACCOUNT'; index: number; name: string }
  | { type: 'CHANGE_PASSWORD'; currentPassword: string; newPassword: string }
  | { type: 'EXPORT_SEED'; password: string }
  | { type: 'EXPORT_PRIVATE_KEY'; password: string; accountIndex?: number }
  | { type: 'GET_ACCOUNTS' }
  | { type: 'WALLET_CONNECT'; silent?: boolean }
  | { type: 'WALLET_DISCONNECT' }
  | { type: 'SIGN_MESSAGE'; messages: number[][] }
  | { type: 'SIGN_TRANSACTION'; transactions: number[][]; chain?: KnownChain; options?: SendOptions }
  | { type: 'SIGN_AND_SEND_TRANSACTION'; transactions: number[][]; chain?: KnownChain; options?: SendOptions }
  | { type: 'PREVIEW_TRANSACTION'; transaction: number[] }
  | { type: 'GET_PENDING_REQUEST'; id: string }
  | { type: 'POLL_APPROVAL'; id: string }
  | { type: 'APPROVE_REQUEST'; id: string }
  | { type: 'REJECT_REQUEST'; id: string; reason?: string }
  | { type: 'CANCEL_APPROVAL'; id: string }
  | { type: 'GET_CONNECTED_SITES' }
  | { type: 'REVOKE_SITE'; origin: string }
  | { type: 'SEND_TRANSFER'; to: string; amountSmallest: string; mint?: string; source?: string }
  | { type: 'ESTIMATE_FEE'; to: string; amountSmallest: string; mint?: string; source?: string };

/** Fields of the request for one message type, without `type`. */
export type WalletRequestPayload<T extends ExtensionMessageType> = Omit<Extract<WalletRequest, { type: T }>, 'type'>;

type StateResponse = { state: WalletPublicState };
type SettingsResponse = { settings: WalletSettings };
type PendingResponse = { pendingId: string };
type EmptyResponse = Record<string, never>;

/** What the worker resolves with for each message type (before the `success` envelope). */
export interface WalletResponses {
  GET_STATE: StateResponse;
  GET_SETTINGS: SettingsResponse;
  UPDATE_SETTINGS: SettingsResponse;
  CREATE_WALLET: StateResponse;
  UNLOCK: StateResponse;
  LOCK: StateResponse;
  CLEAR_WALLET: StateResponse;
  SWITCH_ACCOUNT: StateResponse;
  ADD_ACCOUNT: StateResponse;
  RENAME_ACCOUNT: StateResponse;
  CHANGE_PASSWORD: EmptyResponse;
  EXPORT_SEED: { seedPhrase: string };
  EXPORT_PRIVATE_KEY: { privateKey: string };
  GET_ACCOUNTS: { accounts: string[] };
  /**
   * A prompt (`pendingId`), or the accounts straight away for a connected origin or a
   * silent connect, with the active cluster so the page can stamp its accounts' chains.
   */
  WALLET_CONNECT: PendingResponse | { accounts: string[]; cluster: WalletSettings['cluster'] };
  WALLET_DISCONNECT: { disconnected: true };
  SIGN_MESSAGE: PendingResponse;
  SIGN_TRANSACTION: PendingResponse;
  SIGN_AND_SEND_TRANSACTION: PendingResponse;
  PREVIEW_TRANSACTION: { preview: PreviewResult };
  GET_PENDING_REQUEST: { request: PendingApproval | null };
  POLL_APPROVAL: ApprovalResult;
  APPROVE_REQUEST: EmptyResponse;
  REJECT_REQUEST: EmptyResponse;
  CANCEL_APPROVAL: EmptyResponse;
  GET_CONNECTED_SITES: { sites: ConnectedSite[] };
  REVOKE_SITE: EmptyResponse;
  SEND_TRANSFER: { signature: string };
  ESTIMATE_FEE: FeeEstimate;
}

/** What the worker learned about the recipient while estimating a send. */
export type RecipientInfo = {
  /**
   * The account the transfer credits exists on-chain: the wallet for a SOL send,
   * the recipient's associated token account for a token send. A SOL send to a
   * missing account must fund its rent; a token send to a missing ATA creates it.
   */
  exists: boolean;
  /** The wallet address itself exists, whatever its token account does. */
  walletExists: boolean;
  /** Owned by SPL Token or Token-2022: a token account, not a wallet. */
  isTokenAccount: boolean;
  /** Not on the ed25519 curve: a PDA, so no key can sign for it. */
  offCurve: boolean;
};

/**
 * The `ESTIMATE_FEE` response: lamports as decimal strings. Type aliases, so the
 * router's `Record<string, unknown>` accepts them. `rentExemptMin` is what the
 * account this send may have to create costs: a bare system account for SOL, a
 * token account of the mint's own program for a token send.
 */
export type FeeEstimate = {
  feeLamports: string;
  rentExemptMin: string;
  recipient: RecipientInfo;
};

/** How far a `SEND_TRANSFER` got before it failed. */
export type SendErrorCode = 'expired' | 'timeout' | 'broadcast-failed';

/**
 * Separates the user-facing line from the signature in a `SEND_TRANSFER` error.
 * A send that has already been signed has a signature whether or not it
 * confirmed, and the popup needs it to link the explorer; the envelope carries
 * only `error: string`, so the signature rides along in the text.
 */
export const SEND_SIGNATURE_SEPARATOR = ' · signature ';

/** The `SEND_TRANSFER` failure shape: a line for the screen, plus the signature when one exists. */
export type SendFailure = { message: string; signature?: string };

/**
 * A send that failed with a signature worth showing. `message` (and so anything
 * that stringifies the error) carries the signature suffix; `parseSendError`
 * splits it back apart.
 */
export class SendError extends Error {
  readonly code: SendErrorCode;
  readonly signature?: string;
  /** The user-facing line on its own, without the signature suffix. */
  readonly reason: string;

  constructor(code: SendErrorCode, reason: string, signature?: string) {
    super(signature ? `${reason}${SEND_SIGNATURE_SEPARATOR}${signature}` : reason);
    this.name = 'SendError';
    this.code = code;
    this.reason = reason;
    if (signature !== undefined) this.signature = signature;
  }
}

/** Split a `SEND_TRANSFER` error string back into its line and its signature. */
export function parseSendError(raw: string): SendFailure {
  const at = raw.lastIndexOf(SEND_SIGNATURE_SEPARATOR);
  if (at === -1) return { message: raw };
  const signature = raw.slice(at + SEND_SIGNATURE_SEPARATOR.length);
  return BASE58_SIGNATURE.test(signature) ? { message: raw.slice(0, at), signature } : { message: raw };
}

export type WalletResponse = WalletResponses[ExtensionMessageType];

type MissingRequest = Exclude<ExtensionMessageType, WalletRequest['type']>;
type ExtraRequest = Exclude<WalletRequest['type'], ExtensionMessageType>;
type MissingResponse = Exclude<ExtensionMessageType, keyof WalletResponses>;
/** Compile-time proof that the union and the response map cover the allowlist exactly. */
export const PROTOCOL_COVERS_ALLOWLIST: [MissingRequest, ExtraRequest, MissingResponse] extends [never, never, never]
  ? true
  : never = true;

const THEMES: readonly WalletSettings['theme'][] = ['light', 'dark', 'system'];
const CLUSTERS: readonly WalletSettings['cluster'][] = ['mainnet-beta', 'devnet'];

function invalid(field: string): never {
  throw new Error(`Invalid ${field}`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(field);
  return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(field);
  return value;
}

/** Absent, `null`, or `''` all mean "not provided"; anything else must be a string. */
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, field);
}

/** Hardened derivation adds 2^31 to the index, so anything above 0x7fffffff cannot be a child index. */
const MAX_INDEX = 0x7fffffff;

function requireIndex(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_INDEX) invalid(field);
  return value;
}

function optionalIndex(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireIndex(value, field);
}

/**
 * An account label the popup shows: trimmed, non-empty, and short enough to
 * render. Stored beside the public addresses, never inside the vault.
 */
function requireAccountName(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(field);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ACCOUNT_NAME_LENGTH) invalid(field);
  return trimmed;
}

/** Base58 with no 0/O/I/l, the alphabet Solana addresses use; 32 bytes encodes to 32-44 characters. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A 64-byte signature in the same alphabet. */
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/** Absent, `null`, or `''` mean "not provided"; anything else must look like an address. */
function optionalAddress(value: unknown, field: string): string | undefined {
  const text = optionalString(value, field);
  if (text === undefined) return undefined;
  if (!BASE58_ADDRESS.test(text)) invalid(field);
  return text;
}

/** Decimal digits only: lamports or token base units, no sign, no fraction, no exponent. */
function requireIntegerString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) invalid(field);
  return value;
}

/** Longest Helius key we accept: a UUID is 36 characters, leave room for other formats. */
export const MAX_HELIUS_KEY_LENGTH = 64;

/** Helius keys are UUIDs; nothing that could break out of the `?api-key=` query string gets through. */
const HELIUS_KEY_SHAPE = new RegExp(`^[A-Za-z0-9-]{0,${MAX_HELIUS_KEY_LENGTH}}$`);

/** Trimmed. `''` (so whitespace too) clears the field; otherwise an absolute `https://` URL that `new URL` can parse. */
function requireRpcUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(field);
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    invalid(field);
  }
  if (parsed.protocol !== 'https:') invalid(field);
  return trimmed;
}

/** Trimmed. `''` clears the field; otherwise only `HELIUS_KEY_SHAPE`. */
function requireHeliusApiKey(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(field);
  const trimmed = value.trim();
  if (!HELIUS_KEY_SHAPE.test(trimmed)) invalid(field);
  return trimmed;
}

function requireRpcUrlCluster(value: unknown, field: string): WalletSettings['cluster'] {
  if (typeof value !== 'string' || !(CLUSTERS as readonly string[]).includes(value)) invalid(field);
  return value as WalletSettings['cluster'];
}

function requireSettings(value: unknown): Partial<WalletSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('settings');
  const input = value as Record<string, unknown>;
  const out: Partial<WalletSettings> = {};
  for (const key of Object.keys(input)) {
    const field = `settings.${key}`;
    const raw = input[key];
    switch (key) {
      case 'autoLockTimeout':
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) invalid(field);
        out.autoLockTimeout = raw;
        break;
      case 'preferredCurrency':
        out.preferredCurrency = requireString(raw, field);
        break;
      case 'theme':
        if (typeof raw !== 'string' || !(THEMES as readonly string[]).includes(raw)) invalid(field);
        out.theme = raw as WalletSettings['theme'];
        break;
      case 'hideSmallBalances':
        if (typeof raw !== 'boolean') invalid(field);
        out.hideSmallBalances = raw;
        break;
      case 'smallBalanceThreshold':
        if (typeof raw !== 'number' || !Number.isFinite(raw)) invalid(field);
        out.smallBalanceThreshold = raw;
        break;
      case 'cluster':
        if (typeof raw !== 'string' || !(CLUSTERS as readonly string[]).includes(raw)) invalid(field);
        out.cluster = raw as WalletSettings['cluster'];
        break;
      case 'rpcUrl':
        out.rpcUrl = requireRpcUrl(raw, field);
        break;
      case 'heliusApiKey':
        out.heliusApiKey = requireHeliusApiKey(raw, field);
        break;
      case 'rpcUrlCluster':
        out.rpcUrlCluster = requireRpcUrlCluster(raw, field);
        break;
      default:
        invalid('settings');
    }
  }
  return out;
}

/**
 * Validate one runtime message into a `WalletRequest`, copying only the fields
 * that type accepts. Throws `Unknown message type` or `Invalid <field>`.
 */
export function parseRequest(input: unknown): WalletRequest {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== 'string' || !isExtensionMessageType(type)) {
    throw new Error('Unknown message type');
  }

  switch (type) {
    case 'GET_STATE':
    case 'GET_SETTINGS':
    case 'LOCK':
    case 'CLEAR_WALLET':
    case 'GET_ACCOUNTS':
    case 'WALLET_DISCONNECT':
    case 'GET_CONNECTED_SITES':
    case 'ADD_ACCOUNT':
      return { type };
    case 'WALLET_CONNECT': {
      // Absent or null means an ordinary connect; anything else must be a boolean.
      if (raw.silent === undefined || raw.silent === null) return { type };
      if (typeof raw.silent !== 'boolean') invalid('silent');
      return { type, silent: raw.silent };
    }
    case 'UPDATE_SETTINGS':
      return { type, settings: requireSettings(raw.settings) };
    case 'CREATE_WALLET': {
      const seedPhrase = optionalString(raw.seedPhrase, 'seedPhrase');
      const password = requireString(raw.password, 'password');
      return seedPhrase === undefined ? { type, password } : { type, password, seedPhrase };
    }
    case 'UNLOCK':
    case 'EXPORT_SEED':
      return { type, password: requireString(raw.password, 'password') };
    case 'SWITCH_ACCOUNT':
      return { type, index: requireIndex(raw.index, 'index') };
    case 'RENAME_ACCOUNT':
      return { type, index: requireIndex(raw.index, 'index'), name: requireAccountName(raw.name, 'name') };
    case 'CHANGE_PASSWORD':
      return {
        type,
        currentPassword: requireString(raw.currentPassword, 'currentPassword'),
        newPassword: requireString(raw.newPassword, 'newPassword'),
      };
    case 'EXPORT_PRIVATE_KEY': {
      const password = requireString(raw.password, 'password');
      const accountIndex = optionalIndex(raw.accountIndex, 'accountIndex');
      return accountIndex === undefined ? { type, password } : { type, password, accountIndex };
    }
    case 'SIGN_MESSAGE':
      // Wallet Standard does not forbid signing an empty message.
      return { type, messages: validateByteArrays(raw.messages, MAX_MESSAGE_BYTES, 'messages', true) };
    case 'SIGN_TRANSACTION':
    case 'SIGN_AND_SEND_TRANSACTION': {
      // Validated again here even though the bridge already did: the worker trusts no page-side check.
      const request: Extract<WalletRequest, { type: typeof type }> = {
        type,
        transactions:
          type === 'SIGN_AND_SEND_TRANSACTION'
            ? validateSingleTransaction(raw.transactions)
            : validateByteArrays(raw.transactions, MAX_TRANSACTION_BYTES, 'transactions'),
      };
      const chain = validateChain(raw.chain);
      if (chain !== undefined) request.chain = chain;
      const options = validateSendOptions(raw.options);
      if (options !== undefined) request.options = options;
      return request;
    }
    case 'PREVIEW_TRANSACTION':
      return { type, transaction: validateByteArray(raw.transaction, MAX_TRANSACTION_BYTES, 'transaction') };
    case 'GET_PENDING_REQUEST':
    case 'POLL_APPROVAL':
    case 'APPROVE_REQUEST':
    case 'CANCEL_APPROVAL':
      return { type, id: requireNonEmptyString(raw.id, 'id') };
    case 'REVOKE_SITE':
      return { type, origin: requireNonEmptyString(raw.origin, 'origin') };
    case 'REJECT_REQUEST': {
      const id = requireNonEmptyString(raw.id, 'id');
      const reason = optionalString(raw.reason, 'reason');
      return reason === undefined ? { type, id } : { type, id, reason };
    }
    case 'SEND_TRANSFER':
    case 'ESTIMATE_FEE': {
      const request: Extract<WalletRequest, { type: typeof type }> = {
        type,
        to: requireNonEmptyString(raw.to, 'to'),
        amountSmallest: requireIntegerString(raw.amountSmallest, 'amountSmallest'),
      };
      const mint = optionalString(raw.mint, 'mint');
      if (mint !== undefined) request.mint = mint;
      // The token account the tokens leave: a row's own account, which need not be the ATA.
      const source = optionalAddress(raw.source, 'source');
      if (source !== undefined) request.source = source;
      return request;
    }
    default: {
      const unreachable: never = type;
      throw new Error(`Unknown message type: ${String(unreachable)}`);
    }
  }
}
