import { describe, expect, it } from 'vitest';
import { buildRuntimeMessage, MAX_MESSAGE_BYTES, MAX_TRANSACTION_BYTES } from './bridge';
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
          ? { type, transaction: [1], message: [1] }
          : { type };
        expect(buildRuntimeMessage(outer, payload, ORIGIN).type).toBe(outer);
      }
    }
  });

  it('uses the caller origin, not one from the payload', () => {
    const out = buildRuntimeMessage('GET_ACCOUNTS', { origin: 'https://evil.example' }, ORIGIN);
    expect(out.origin).toBe(ORIGIN);
  });

  it('drops fields the type does not accept', () => {
    const out = buildRuntimeMessage('SIGN_MESSAGE', { message: [104, 105], to: 'x', amountSmallest: '1' }, ORIGIN);
    expect(out).toEqual({ type: 'SIGN_MESSAGE', origin: ORIGIN, message: [104, 105] });
    for (const type of ['SIGN_TRANSACTION', 'SIGN_AND_SEND_TRANSACTION'] as const) {
      expect(buildRuntimeMessage(type, { transaction: [1], message: [2], origin: 'x', id: 7 }, ORIGIN)).toEqual({
        type,
        origin: ORIGIN,
        transaction: [1],
      });
    }
  });

  it('allows an empty message but never an empty transaction', () => {
    expect(buildRuntimeMessage('SIGN_MESSAGE', { message: [] }, ORIGIN)).toEqual({
      type: 'SIGN_MESSAGE',
      origin: ORIGIN,
      message: [],
    });
    expect(() => buildRuntimeMessage('SIGN_TRANSACTION', { transaction: [] }, ORIGIN)).toThrow('Invalid transaction');
  });

  it('copies transaction bytes and rejects malformed ones', () => {
    const bytes = [0, 1, 255];
    const out = buildRuntimeMessage('SIGN_TRANSACTION', { transaction: bytes }, ORIGIN);
    expect(out.transaction).toEqual(bytes);
    expect(out.transaction).not.toBe(bytes);

    const bad: unknown[] = [undefined, null, 'abc', {}, [], [256], [-1], [1.5], ['1'], [null]];
    for (const transaction of bad) {
      expect(() => buildRuntimeMessage('SIGN_AND_SEND_TRANSACTION', { transaction }, ORIGIN)).toThrow(
        'Invalid transaction',
      );
    }
    expect(() =>
      buildRuntimeMessage('SIGN_TRANSACTION', { transaction: new Array(MAX_TRANSACTION_BYTES + 1).fill(0) }, ORIGIN),
    ).toThrow('Invalid transaction');
    expect(() =>
      buildRuntimeMessage('SIGN_MESSAGE', { message: new Array(MAX_MESSAGE_BYTES + 1).fill(0) }, ORIGIN),
    ).toThrow('Invalid message');
  });

  it('rejects unknown or non-string types and non-object payloads', () => {
    expect(() => buildRuntimeMessage('NOPE', {}, ORIGIN)).toThrow('Unknown message type');
    expect(() => buildRuntimeMessage(undefined, {}, ORIGIN)).toThrow('Unknown message type');
    expect(() => buildRuntimeMessage(['WALLET_CONNECT'], {}, ORIGIN)).toThrow('Unknown message type');
    expect(buildRuntimeMessage('WALLET_CONNECT', null, ORIGIN)).toEqual({ type: 'WALLET_CONNECT', origin: ORIGIN });
    expect(buildRuntimeMessage('WALLET_CONNECT', 'string', ORIGIN)).toEqual({ type: 'WALLET_CONNECT', origin: ORIGIN });
  });
});
