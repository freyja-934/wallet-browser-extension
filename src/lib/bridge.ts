import {
  isDappMessageType,
  SUPPORTED_CHAINS,
  UNSUPPORTED_CHAINS,
  type DappMessageType,
  type KnownChain,
  type SendOptions,
} from './messages';

/** Solana packet limit: no serialized transaction is larger than this. */
export const MAX_TRANSACTION_BYTES = 1232;
/** Upper bound for signMessage payloads forwarded from a page. */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** Most items one `signTransaction` / `signAndSendTransaction` / `signMessage` call may carry. */
export const MAX_BATCH_ITEMS = 10;

export interface RuntimeMessage {
  type: DappMessageType;
  /** Informational only. The service worker trusts `sender.origin`, never this field. */
  origin: string;
  transactions?: number[][];
  messages?: number[][];
  chain?: KnownChain;
  options?: SendOptions;
  /** `connect({ silent: true })`: never prompt; answer with what the site may already see. */
  silent?: boolean;
}

/**
 * Copy `value` into a fresh array of integers in 0..255, or throw `Invalid <field>`.
 * Shared by the content-script bridge and the worker's `parseRequest`.
 */
export function validateByteArray(value: unknown, max: number, field: string, allowEmpty = false): number[] {
  if (!Array.isArray(value) || (value.length === 0 && !allowEmpty) || value.length > max) {
    throw new Error(`Invalid ${field}`);
  }
  const out = new Array<number>(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const byte = value[i];
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`Invalid ${field}`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * One batch: 1 to `MAX_BATCH_ITEMS` byte arrays, each validated by
 * `validateByteArray`. Throws `Invalid <field>` for the list or any item.
 */
export function validateByteArrays(value: unknown, max: number, field: string, allowEmptyItem = false): number[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_ITEMS) {
    throw new Error(`Invalid ${field}`);
  }
  return value.map((item) => validateByteArray(item, max, field, allowEmptyItem));
}

const COMMITMENTS: readonly string[] = ['processed', 'confirmed', 'finalized'];
const KNOWN_CHAINS: readonly string[] = [...SUPPORTED_CHAINS, ...UNSUPPORTED_CHAINS];

/**
 * Absent or `null` means "not given". Otherwise one of the four Solana chain
 * identifiers; whether the wallet can sign for it is the worker's decision.
 */
export function validateChain(value: unknown): KnownChain | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !KNOWN_CHAINS.includes(value)) throw new Error('Invalid chain');
  return value as KnownChain;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`Invalid ${field}`);
  return value;
}

function requireCommitment(value: unknown, field: string): SendOptions['commitment'] {
  if (typeof value !== 'string' || !COMMITMENTS.includes(value)) throw new Error(`Invalid ${field}`);
  return value as SendOptions['commitment'];
}

/**
 * Absent or `null` means "no options". Otherwise an object whose known fields
 * are copied one by one after a type check; unknown fields are dropped and a
 * wrongly typed one throws `Invalid options.<field>`.
 */
export function validateSendOptions(value: unknown): SendOptions | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid options');
  const input = value as Record<string, unknown>;
  const out: SendOptions = {};
  if (input.skipPreflight !== undefined) {
    if (typeof input.skipPreflight !== 'boolean') throw new Error('Invalid options.skipPreflight');
    out.skipPreflight = input.skipPreflight;
  }
  if (input.preflightCommitment !== undefined) {
    out.preflightCommitment = requireCommitment(input.preflightCommitment, 'options.preflightCommitment');
  }
  if (input.maxRetries !== undefined) {
    out.maxRetries = requireNonNegativeInteger(input.maxRetries, 'options.maxRetries');
  }
  if (input.minContextSlot !== undefined) {
    out.minContextSlot = requireNonNegativeInteger(input.minContextSlot, 'options.minContextSlot');
  }
  if (input.commitment !== undefined) {
    out.commitment = requireCommitment(input.commitment, 'options.commitment');
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Build the message the content script forwards to the service worker.
 *
 * Only the outer `type` is honoured and only the fields that type accepts are
 * copied, so a page cannot smuggle a different `type`, an `origin`, or any
 * other field through the payload.
 */
export function buildRuntimeMessage(type: unknown, payload: unknown, origin: string): RuntimeMessage {
  if (typeof type !== 'string' || !isDappMessageType(type)) {
    throw new Error('Unknown message type');
  }
  const input = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  switch (type) {
    case 'SIGN_TRANSACTION':
    case 'SIGN_AND_SEND_TRANSACTION': {
      const message: RuntimeMessage = {
        type,
        origin,
        transactions: validateByteArrays(input.transactions, MAX_TRANSACTION_BYTES, 'transactions'),
      };
      const chain = validateChain(input.chain);
      if (chain !== undefined) message.chain = chain;
      const options = validateSendOptions(input.options);
      if (options !== undefined) message.options = options;
      return message;
    }
    case 'SIGN_MESSAGE':
      // Wallet Standard does not forbid signing an empty message.
      return { type, origin, messages: validateByteArrays(input.messages, MAX_MESSAGE_BYTES, 'messages', true) };
    case 'WALLET_CONNECT':
      return input.silent === true ? { type, origin, silent: true } : { type, origin };
    case 'WALLET_DISCONNECT':
    case 'GET_ACCOUNTS':
      return { type, origin };
    default:
      throw new Error('Unknown message type');
  }
}
