import { describe, expect, it } from 'vitest';
import { MAX_TRANSACTION_BYTES } from './bridge';
import { EXTENSION_MESSAGE_TYPES, type ExtensionMessageType } from './messages';
import { parseRequest, PROTOCOL_COVERS_ALLOWLIST, type WalletRequest } from './protocol';

interface Case {
  valid: Record<string, unknown>;
  /** What `parseRequest` should hand back for `valid` (defaults to `valid` itself). */
  parsed?: WalletRequest;
  malformed: Record<string, unknown>;
  error: string;
}

const cases: Record<ExtensionMessageType, Case> = {
  GET_STATE: { valid: {}, malformed: {}, error: '' },
  GET_SETTINGS: { valid: {}, malformed: {}, error: '' },
  LOCK: { valid: {}, malformed: {}, error: '' },
  CLEAR_WALLET: { valid: {}, malformed: {}, error: '' },
  GET_ACCOUNTS: { valid: {}, malformed: {}, error: '' },
  WALLET_CONNECT: { valid: {}, malformed: {}, error: '' },
  WALLET_DISCONNECT: { valid: {}, malformed: {}, error: '' },
  UPDATE_SETTINGS: {
    valid: { settings: { autoLockTimeout: 5, cluster: 'devnet', hideSmallBalances: true } },
    malformed: { settings: { autoLockTimeout: '5' } },
    error: 'Invalid settings.autoLockTimeout',
  },
  CREATE_WALLET: {
    valid: { password: 'pw', seedPhrase: 'abandon about' },
    malformed: { password: 'pw', seedPhrase: 12 },
    error: 'Invalid seedPhrase',
  },
  UNLOCK: { valid: { password: 'pw' }, malformed: { password: 1 }, error: 'Invalid password' },
  SWITCH_ACCOUNT: { valid: { index: 1 }, malformed: { index: '1' }, error: 'Invalid index' },
  CHANGE_PASSWORD: {
    valid: { currentPassword: 'a', newPassword: 'b' },
    malformed: { currentPassword: 'a' },
    error: 'Invalid newPassword',
  },
  EXPORT_SEED: { valid: { password: 'pw' }, malformed: {}, error: 'Invalid password' },
  EXPORT_PRIVATE_KEY: {
    valid: { password: 'pw', accountIndex: 2 },
    malformed: { password: 'pw', accountIndex: -1 },
    error: 'Invalid accountIndex',
  },
  SIGN_MESSAGE: { valid: { message: [1, 2, 3] }, malformed: { message: [256] }, error: 'Invalid message' },
  SIGN_TRANSACTION: { valid: { transaction: [1] }, malformed: { transaction: [] }, error: 'Invalid transaction' },
  SIGN_AND_SEND_TRANSACTION: {
    valid: { transaction: [0, 255] },
    malformed: { transaction: 'AQ==' },
    error: 'Invalid transaction',
  },
  PREVIEW_TRANSACTION: {
    valid: { transaction: [7] },
    malformed: { transaction: new Array(MAX_TRANSACTION_BYTES + 1).fill(0) },
    error: 'Invalid transaction',
  },
  GET_PENDING_REQUEST: { valid: { id: 'abc' }, malformed: { id: '' }, error: 'Invalid id' },
  POLL_APPROVAL: { valid: { id: 'abc' }, malformed: { id: 5 }, error: 'Invalid id' },
  APPROVE_REQUEST: { valid: { id: 'abc' }, malformed: {}, error: 'Invalid id' },
  REJECT_REQUEST: {
    valid: { id: 'abc', reason: 'nope' },
    malformed: { id: 'abc', reason: { text: 'nope' } },
    error: 'Invalid reason',
  },
  SEND_TRANSFER: {
    valid: { to: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', amountSmallest: '5000', mint: 'So111' },
    malformed: { to: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', amountSmallest: '0.5' },
    error: 'Invalid amountSmallest',
  },
};

describe('parseRequest', () => {
  it('covers the allowlist exactly', () => {
    expect(PROTOCOL_COVERS_ALLOWLIST).toBe(true);
    expect(Object.keys(cases).sort()).toEqual([...EXTENSION_MESSAGE_TYPES].sort());
  });

  for (const type of EXTENSION_MESSAGE_TYPES) {
    const { valid, malformed, error } = cases[type];

    it(`${type}: accepts a valid payload and copies only its fields`, () => {
      const out = parseRequest({ type, ...valid, origin: 'https://evil.example', extra: 1 });
      expect(out).toEqual({ type, ...valid });
      expect(Object.keys(out)).not.toContain('origin');
      expect(Object.keys(out)).not.toContain('extra');
    });

    if (error) {
      it(`${type}: rejects a malformed payload with '${error}'`, () => {
        expect(() => parseRequest({ type, ...malformed })).toThrow(error);
      });
    } else {
      it(`${type}: carries no payload`, () => {
        expect(parseRequest({ type, password: 'x', id: 'y' })).toEqual({ type });
      });
    }
  }

  it('rejects unknown and non-string types', () => {
    for (const input of [{ type: 'STEAL_KEYS' }, { type: 7 }, {}, null, 'UNLOCK', { type: 'unlock' }]) {
      expect(() => parseRequest(input)).toThrow('Unknown message type');
    }
  });

  it('treats an empty seedPhrase, mint, and reason as absent', () => {
    expect(parseRequest({ type: 'CREATE_WALLET', password: 'pw', seedPhrase: '' })).toEqual({
      type: 'CREATE_WALLET',
      password: 'pw',
    });
    expect(parseRequest({ type: 'SEND_TRANSFER', to: 'x', amountSmallest: '1', mint: '' })).toEqual({
      type: 'SEND_TRANSFER',
      to: 'x',
      amountSmallest: '1',
    });
    expect(parseRequest({ type: 'REJECT_REQUEST', id: 'a', reason: '' })).toEqual({ type: 'REJECT_REQUEST', id: 'a' });
  });

  it('validates every settings field by type and rejects unknown keys', () => {
    const ok = {
      autoLockTimeout: 0,
      preferredCurrency: 'EUR',
      theme: 'dark',
      hideSmallBalances: false,
      smallBalanceThreshold: 2.5,
      cluster: 'mainnet-beta',
    };
    expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: ok })).toEqual({ type: 'UPDATE_SETTINGS', settings: ok });
    expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: {} })).toEqual({ type: 'UPDATE_SETTINGS', settings: {} });

    const bad: Array<[Record<string, unknown>, string]> = [
      [{ autoLockTimeout: -1 }, 'Invalid settings.autoLockTimeout'],
      [{ preferredCurrency: 1 }, 'Invalid settings.preferredCurrency'],
      [{ theme: 'neon' }, 'Invalid settings.theme'],
      [{ hideSmallBalances: 'yes' }, 'Invalid settings.hideSmallBalances'],
      [{ smallBalanceThreshold: NaN }, 'Invalid settings.smallBalanceThreshold'],
      [{ cluster: 'testnet' }, 'Invalid settings.cluster'],
      [{ rpcUrl: 'https://x' }, 'Invalid settings'],
    ];
    for (const [settings, message] of bad) {
      expect(() => parseRequest({ type: 'UPDATE_SETTINGS', settings })).toThrow(message);
    }
    expect(() => parseRequest({ type: 'UPDATE_SETTINGS' })).toThrow('Invalid settings');
    expect(() => parseRequest({ type: 'UPDATE_SETTINGS', settings: [] })).toThrow('Invalid settings');
  });

  it('only accepts a decimal integer string for amountSmallest', () => {
    for (const amountSmallest of ['1e9', '-5', '', ' 5', 5, '0x10']) {
      expect(() => parseRequest({ type: 'SEND_TRANSFER', to: 'x', amountSmallest })).toThrow('Invalid amountSmallest');
    }
    expect(parseRequest({ type: 'SEND_TRANSFER', to: 'x', amountSmallest: '0' })).toEqual({
      type: 'SEND_TRANSFER',
      to: 'x',
      amountSmallest: '0',
    });
  });
});
