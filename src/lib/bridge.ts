import { isDappMessageType, type DappMessageType } from './messages';

/** Solana packet limit: no serialized transaction is larger than this. */
export const MAX_TRANSACTION_BYTES = 1232;
/** Upper bound for signMessage payloads forwarded from a page. */
export const MAX_MESSAGE_BYTES = 64 * 1024;

export interface RuntimeMessage {
  type: DappMessageType;
  /** Informational only. The service worker trusts `sender.origin`, never this field. */
  origin: string;
  transaction?: number[];
  message?: number[];
}

function byteArray(value: unknown, max: number, field: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
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
    case 'SIGN_AND_SEND_TRANSACTION':
      return { type, origin, transaction: byteArray(input.transaction, MAX_TRANSACTION_BYTES, 'transaction') };
    case 'SIGN_MESSAGE':
      return { type, origin, message: byteArray(input.message, MAX_MESSAGE_BYTES, 'message') };
    case 'WALLET_CONNECT':
    case 'WALLET_DISCONNECT':
    case 'GET_ACCOUNTS':
      return { type, origin };
    default:
      throw new Error('Unknown message type');
  }
}
