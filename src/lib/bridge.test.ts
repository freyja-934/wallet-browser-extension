import { describe, expect, it } from 'vitest';
import { buildRuntimeMessage, MAX_BATCH_ITEMS, MAX_MESSAGE_BYTES, MAX_TRANSACTION_BYTES } from './bridge';
import { DAP_MESSAGE_TYPES, EXTENSION_MESSAGE_TYPES } from './messages';

const ORIGIN = 'https://dapp.example';

describe('buildRuntimeMessage', () => {
  it('ignores a type smuggled in the payload', () => {
    const out = buildRuntimeMessage('WALLET_CONNECT', { type: 'EXPORT_SEED', password: 'guess' }, ORIGIN);
    expect(out).toEqual({ type: 'WALLET_CONNECT', origin: ORIGIN });
    expect(Object.keys(out)).not.toContain('password');
  });

  it('never lets a privileged type through, whatever the payload says', () => {
    const privileged = EXTENSION_MESSAGE_TYPES.filter(
      (type) => !(DAP_MESSAGE_TYPES as readonly string[]).includes(type),
    );
    expect(privileged.length).toBeGreaterThan(0);
    for (const type of privileged) {
      expect(() => buildRuntimeMessage(type, {}, ORIGIN)).toThrow('Unknown message type');
      for (const outer of DAP_MESSAGE_TYPES) {
        const payload = outer.startsWith('SIGN_')
          ? { type, transactions: [[1]], messages: [[1]] }
          : { type };
        expect(buildRuntimeMessage(outer, payload, ORIGIN).type).toBe(outer);
      }
    }
  });

  it('forwards silent on WALLET_CONNECT only when it is exactly true', () => {
    expect(buildRuntimeMessage('WALLET_CONNECT', { silent: true }, ORIGIN)).toEqual({
      type: 'WALLET_CONNECT',
      origin: ORIGIN,
      silent: true,
    });
    for (const silent of [false, 'true', 1, undefined]) {
      expect(buildRuntimeMessage('WALLET_CONNECT', { silent }, ORIGIN)).toEqual({ type: 'WALLET_CONNECT', origin: ORIGIN });
    }
    expect(buildRuntimeMessage('GET_ACCOUNTS', { silent: true }, ORIGIN)).toEqual({ type: 'GET_ACCOUNTS', origin: ORIGIN });
  });

  it('uses the caller origin, not one from the payload', () => {
    const out = buildRuntimeMessage('GET_ACCOUNTS', { origin: 'https://evil.example' }, ORIGIN);
    expect(out.origin).toBe(ORIGIN);
  });

  it('drops fields the type does not accept', () => {
    const out = buildRuntimeMessage(
      'SIGN_MESSAGE',
      { messages: [[104, 105]], to: 'x', amountSmallest: '1', chain: 'solana:devnet', options: { commitment: 'confirmed' } },
      ORIGIN,
    );
    expect(out).toStrictEqual({ type: 'SIGN_MESSAGE', origin: ORIGIN, messages: [[104, 105]] });
    for (const type of ['SIGN_TRANSACTION', 'SIGN_AND_SEND_TRANSACTION'] as const) {
      expect(buildRuntimeMessage(type, { transactions: [[1]], messages: [[2]], origin: 'x', id: 7 }, ORIGIN)).toStrictEqual({
        type,
        origin: ORIGIN,
        transactions: [[1]],
      });
    }
  });

  it('allows an empty message but never an empty transaction or an empty batch', () => {
    expect(buildRuntimeMessage('SIGN_MESSAGE', { messages: [[]] }, ORIGIN)).toEqual({
      type: 'SIGN_MESSAGE',
      origin: ORIGIN,
      messages: [[]],
    });
    expect(() => buildRuntimeMessage('SIGN_TRANSACTION', { transactions: [[]] }, ORIGIN)).toThrow('Invalid transactions');
    expect(() => buildRuntimeMessage('SIGN_TRANSACTION', { transactions: [] }, ORIGIN)).toThrow('Invalid transactions');
    expect(() => buildRuntimeMessage('SIGN_MESSAGE', { messages: [] }, ORIGIN)).toThrow('Invalid messages');
  });

  it('copies transaction bytes and rejects malformed ones', () => {
    const bytes = [0, 1, 255];
    const out = buildRuntimeMessage('SIGN_TRANSACTION', { transactions: [bytes] }, ORIGIN);
    expect(out.transactions).toEqual([bytes]);
    expect(out.transactions![0]).not.toBe(bytes);

    const bad: unknown[] = [undefined, null, 'abc', {}, [], [256], [-1], [1.5], ['1'], [null]];
    for (const transaction of bad) {
      expect(() => buildRuntimeMessage('SIGN_AND_SEND_TRANSACTION', { transactions: [transaction] }, ORIGIN)).toThrow(
        'Invalid transactions',
      );
      // ...and the same value where the batch itself should be.
      expect(() => buildRuntimeMessage('SIGN_AND_SEND_TRANSACTION', { transactions: transaction }, ORIGIN)).toThrow(
        'Invalid transactions',
      );
    }
    expect(() =>
      buildRuntimeMessage('SIGN_TRANSACTION', { transactions: [new Array(MAX_TRANSACTION_BYTES + 1).fill(0)] }, ORIGIN),
    ).toThrow('Invalid transactions');
    expect(() =>
      buildRuntimeMessage('SIGN_MESSAGE', { messages: [new Array(MAX_MESSAGE_BYTES + 1).fill(0)] }, ORIGIN),
    ).toThrow('Invalid messages');
    // The old singular field is not read any more.
    expect(() => buildRuntimeMessage('SIGN_TRANSACTION', { transaction: bytes }, ORIGIN)).toThrow('Invalid transactions');
    expect(() => buildRuntimeMessage('SIGN_MESSAGE', { message: bytes }, ORIGIN)).toThrow('Invalid messages');
  });

  it('accepts up to MAX_BATCH_ITEMS items and refuses one more', () => {
    const full = Array.from({ length: MAX_BATCH_ITEMS }, (_, i) => [i]);
    expect(buildRuntimeMessage('SIGN_TRANSACTION', { transactions: full }, ORIGIN).transactions).toEqual(full);
    expect(buildRuntimeMessage('SIGN_MESSAGE', { messages: full }, ORIGIN).messages).toEqual(full);
    const over = [...full, [0]];
    expect(() => buildRuntimeMessage('SIGN_TRANSACTION', { transactions: over }, ORIGIN)).toThrow('Invalid transactions');
    expect(() => buildRuntimeMessage('SIGN_MESSAGE', { messages: over }, ORIGIN)).toThrow('Invalid messages');
  });

  it('copies a known chain, drops an absent one, and refuses anything else', () => {
    for (const chain of ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet']) {
      expect(buildRuntimeMessage('SIGN_TRANSACTION', { transactions: [[1]], chain }, ORIGIN).chain).toBe(chain);
    }
    for (const chain of [undefined, null]) {
      expect(buildRuntimeMessage('SIGN_AND_SEND_TRANSACTION', { transactions: [[1]], chain }, ORIGIN)).toStrictEqual({
        type: 'SIGN_AND_SEND_TRANSACTION',
        origin: ORIGIN,
        transactions: [[1]],
      });
    }
    for (const chain of ['solana:foo', 'ethereum:1', '', 7, {}, ['solana:devnet']]) {
      expect(() => buildRuntimeMessage('SIGN_TRANSACTION', { transactions: [[1]], chain }, ORIGIN)).toThrow('Invalid chain');
    }
  });

  it('copies send options field by field and refuses a wrong type', () => {
    const options = {
      skipPreflight: true,
      preflightCommitment: 'processed',
      maxRetries: 3,
      minContextSlot: 100,
      commitment: 'finalized',
      bogus: 'dropped',
    };
    const out = buildRuntimeMessage('SIGN_AND_SEND_TRANSACTION', { transactions: [[1]], options }, ORIGIN);
    expect(out.options).toStrictEqual({
      skipPreflight: true,
      preflightCommitment: 'processed',
      maxRetries: 3,
      minContextSlot: 100,
      commitment: 'finalized',
    });
    expect(out.options).not.toBe(options);

    // Empty, absent, or null options are simply not sent.
    for (const empty of [{}, { bogus: 1 }, undefined, null]) {
      expect(buildRuntimeMessage('SIGN_TRANSACTION', { transactions: [[1]], options: empty }, ORIGIN)).toStrictEqual({
        type: 'SIGN_TRANSACTION',
        origin: ORIGIN,
        transactions: [[1]],
      });
    }

    const bad: Array<[Record<string, unknown>, string]> = [
      [{ skipPreflight: 'yes' }, 'Invalid options.skipPreflight'],
      [{ preflightCommitment: 'soon' }, 'Invalid options.preflightCommitment'],
      [{ maxRetries: -1 }, 'Invalid options.maxRetries'],
      [{ maxRetries: 1.5 }, 'Invalid options.maxRetries'],
      [{ minContextSlot: '5' }, 'Invalid options.minContextSlot'],
      [{ commitment: 'final' }, 'Invalid options.commitment'],
    ];
    for (const [options, message] of bad) {
      expect(() => buildRuntimeMessage('SIGN_AND_SEND_TRANSACTION', { transactions: [[1]], options }, ORIGIN)).toThrow(message);
    }
    for (const options of ['confirmed', 5, [], true]) {
      expect(() => buildRuntimeMessage('SIGN_AND_SEND_TRANSACTION', { transactions: [[1]], options }, ORIGIN)).toThrow(
        'Invalid options',
      );
    }
  });

  it('rejects unknown or non-string types and non-object payloads', () => {
    expect(() => buildRuntimeMessage('NOPE', {}, ORIGIN)).toThrow('Unknown message type');
    expect(() => buildRuntimeMessage(undefined, {}, ORIGIN)).toThrow('Unknown message type');
    expect(() => buildRuntimeMessage(['WALLET_CONNECT'], {}, ORIGIN)).toThrow('Unknown message type');
    expect(buildRuntimeMessage('WALLET_CONNECT', null, ORIGIN)).toEqual({ type: 'WALLET_CONNECT', origin: ORIGIN });
    expect(buildRuntimeMessage('WALLET_CONNECT', 'string', ORIGIN)).toEqual({ type: 'WALLET_CONNECT', origin: ORIGIN });
  });
});
