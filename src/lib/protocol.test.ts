import { describe, expect, it } from 'vitest';
import { MAX_BATCH_ITEMS, MAX_MESSAGE_BYTES, MAX_TRANSACTION_BYTES } from './bridge';
import { EXTENSION_MESSAGE_TYPES, type ExtensionMessageType } from './messages';
import { MAX_HELIUS_KEY_LENGTH, parseRequest, PROTOCOL_COVERS_ALLOWLIST } from './protocol';

interface Case {
  valid: Record<string, unknown>;
  malformed: Record<string, unknown>;
  error: string;
}

const cases: Record<ExtensionMessageType, Case> = {
  GET_STATE: { valid: {}, malformed: {}, error: '' },
  GET_SETTINGS: { valid: {}, malformed: {}, error: '' },
  LOCK: { valid: {}, malformed: {}, error: '' },
  CLEAR_WALLET: { valid: {}, malformed: {}, error: '' },
  GET_ACCOUNTS: { valid: {}, malformed: {}, error: '' },
  WALLET_CONNECT: { valid: { silent: true }, malformed: { silent: 'yes' }, error: 'Invalid silent' },
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
  SIGN_MESSAGE: { valid: { messages: [[1, 2, 3]] }, malformed: { messages: [[256]] }, error: 'Invalid messages' },
  SIGN_TRANSACTION: {
    valid: { transactions: [[1]], chain: 'solana:devnet' },
    malformed: { transactions: [] },
    error: 'Invalid transactions',
  },
  SIGN_AND_SEND_TRANSACTION: {
    valid: { transactions: [[0, 255], [7]], chain: 'solana:mainnet', options: { skipPreflight: true, commitment: 'confirmed' } },
    malformed: { transactions: 'AQ==' },
    error: 'Invalid transactions',
  },
  PREVIEW_TRANSACTION: {
    valid: { transaction: [7] },
    malformed: { transaction: new Array(MAX_TRANSACTION_BYTES + 1).fill(0) },
    error: 'Invalid transaction',
  },
  GET_PENDING_REQUEST: { valid: { id: 'abc' }, malformed: { id: '' }, error: 'Invalid id' },
  POLL_APPROVAL: { valid: { id: 'abc' }, malformed: { id: 5 }, error: 'Invalid id' },
  APPROVE_REQUEST: { valid: { id: 'abc' }, malformed: {}, error: 'Invalid id' },
  CANCEL_APPROVAL: { valid: { id: 'abc' }, malformed: { id: '' }, error: 'Invalid id' },
  GET_CONNECTED_SITES: { valid: {}, malformed: {}, error: '' },
  REVOKE_SITE: { valid: { origin: 'https://dapp.example' }, malformed: { origin: '' }, error: 'Invalid origin' },
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
    // Coverage is enforced by tsc (the constant's type is `never` when the union or
    // response map drifts from the allowlist); vitest does not typecheck, so this
    // runtime assertion only documents the intent.
    expect(PROTOCOL_COVERS_ALLOWLIST).toBe(true);
    expect(Object.keys(cases).sort()).toEqual([...EXTENSION_MESSAGE_TYPES].sort());
  });

  for (const type of EXTENSION_MESSAGE_TYPES) {
    const { valid, malformed, error } = cases[type];

    it(`${type}: accepts a valid payload and copies only its fields`, () => {
      // REVOKE_SITE names an origin on purpose (popup-only); every other type must drop a smuggled one.
      const smuggled = 'origin' in valid ? { extra: 1 } : { origin: 'https://evil.example', extra: 1 };
      const out = parseRequest({ type, ...valid, ...smuggled });
      expect(out).toEqual({ type, ...valid });
      if (!('origin' in valid)) expect(Object.keys(out)).not.toContain('origin');
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
    expect(parseRequest({ type: 'CREATE_WALLET', password: 'pw', seedPhrase: '' })).toStrictEqual({
      type: 'CREATE_WALLET',
      password: 'pw',
    });
    expect(parseRequest({ type: 'SEND_TRANSFER', to: 'x', amountSmallest: '1', mint: '' })).toStrictEqual({
      type: 'SEND_TRANSFER',
      to: 'x',
      amountSmallest: '1',
    });
    expect(parseRequest({ type: 'REJECT_REQUEST', id: 'a', reason: '' })).toStrictEqual({
      type: 'REJECT_REQUEST',
      id: 'a',
    });
  });

  it('treats an absent, null, or false silent flag on WALLET_CONNECT as an ordinary connect', () => {
    expect(parseRequest({ type: 'WALLET_CONNECT' })).toStrictEqual({ type: 'WALLET_CONNECT' });
    expect(parseRequest({ type: 'WALLET_CONNECT', silent: null })).toStrictEqual({ type: 'WALLET_CONNECT' });
    expect(parseRequest({ type: 'WALLET_CONNECT', silent: false })).toStrictEqual({ type: 'WALLET_CONNECT', silent: false });
    for (const silent of [1, 'true', {}]) {
      expect(() => parseRequest({ type: 'WALLET_CONNECT', silent })).toThrow('Invalid silent');
    }
  });

  it('requires a string password on CREATE_WALLET', () => {
    expect(() => parseRequest({ type: 'CREATE_WALLET' })).toThrow('Invalid password');
    expect(() => parseRequest({ type: 'CREATE_WALLET', password: 42 })).toThrow('Invalid password');
  });

  it('accepts an empty SIGN_MESSAGE item and rejects one over the byte cap', () => {
    expect(parseRequest({ type: 'SIGN_MESSAGE', messages: [[]] })).toStrictEqual({ type: 'SIGN_MESSAGE', messages: [[]] });
    expect(() => parseRequest({ type: 'SIGN_MESSAGE', messages: [new Array(MAX_MESSAGE_BYTES + 1).fill(0)] })).toThrow(
      'Invalid messages',
    );
    // The singular fields of the old protocol are not read.
    expect(() => parseRequest({ type: 'SIGN_MESSAGE', message: [1] })).toThrow('Invalid messages');
    expect(() => parseRequest({ type: 'SIGN_TRANSACTION', transaction: [1] })).toThrow('Invalid transactions');
  });

  it('accepts 1 to MAX_BATCH_ITEMS items per sign request and nothing outside that', () => {
    const full = Array.from({ length: MAX_BATCH_ITEMS }, (_, i) => [i + 1]);
    expect(parseRequest({ type: 'SIGN_TRANSACTION', transactions: full })).toStrictEqual({
      type: 'SIGN_TRANSACTION',
      transactions: full,
    });
    expect(parseRequest({ type: 'SIGN_MESSAGE', messages: full })).toStrictEqual({ type: 'SIGN_MESSAGE', messages: full });
    const over = [...full, [1]];
    for (const type of ['SIGN_TRANSACTION', 'SIGN_AND_SEND_TRANSACTION'] as const) {
      expect(() => parseRequest({ type, transactions: over })).toThrow('Invalid transactions');
      expect(() => parseRequest({ type, transactions: [] })).toThrow('Invalid transactions');
      expect(() => parseRequest({ type, transactions: [[]] })).toThrow('Invalid transactions');
      expect(() => parseRequest({ type, transactions: [[1], 'x'] })).toThrow('Invalid transactions');
      expect(() => parseRequest({ type, transactions: [new Array(MAX_TRANSACTION_BYTES + 1).fill(0)] })).toThrow(
        'Invalid transactions',
      );
    }
    expect(() => parseRequest({ type: 'SIGN_MESSAGE', messages: over })).toThrow('Invalid messages');
    expect(() => parseRequest({ type: 'SIGN_MESSAGE', messages: [] })).toThrow('Invalid messages');
    // PREVIEW_TRANSACTION still takes one transaction.
    expect(() => parseRequest({ type: 'PREVIEW_TRANSACTION', transactions: [[1]] })).toThrow('Invalid transaction');
  });

  it('accepts the four Solana chain ids on a sign request, drops an absent one, and refuses others', () => {
    for (const chain of ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet']) {
      expect(parseRequest({ type: 'SIGN_AND_SEND_TRANSACTION', transactions: [[1]], chain })).toStrictEqual({
        type: 'SIGN_AND_SEND_TRANSACTION',
        transactions: [[1]],
        chain,
      });
    }
    for (const chain of [undefined, null]) {
      expect(parseRequest({ type: 'SIGN_TRANSACTION', transactions: [[1]], chain })).toStrictEqual({
        type: 'SIGN_TRANSACTION',
        transactions: [[1]],
      });
    }
    for (const chain of ['solana:mainnet-beta', 'devnet', '', 1, {}]) {
      expect(() => parseRequest({ type: 'SIGN_TRANSACTION', transactions: [[1]], chain })).toThrow('Invalid chain');
    }
    // A chain means nothing on a message.
    expect(parseRequest({ type: 'SIGN_MESSAGE', messages: [[1]], chain: 'solana:devnet' })).toStrictEqual({
      type: 'SIGN_MESSAGE',
      messages: [[1]],
    });
  });

  it('validates send options field by field and drops empty or unknown ones', () => {
    const options = { skipPreflight: false, preflightCommitment: 'finalized', maxRetries: 0, minContextSlot: 42, commitment: 'processed' };
    expect(parseRequest({ type: 'SIGN_AND_SEND_TRANSACTION', transactions: [[1]], options: { ...options, extra: 1 } })).toStrictEqual({
      type: 'SIGN_AND_SEND_TRANSACTION',
      transactions: [[1]],
      options,
    });
    for (const empty of [{}, { extra: 1 }, undefined, null]) {
      expect(parseRequest({ type: 'SIGN_TRANSACTION', transactions: [[1]], options: empty })).toStrictEqual({
        type: 'SIGN_TRANSACTION',
        transactions: [[1]],
      });
    }
    const bad: Array<[unknown, string]> = [
      [{ skipPreflight: 1 }, 'Invalid options.skipPreflight'],
      [{ preflightCommitment: 'now' }, 'Invalid options.preflightCommitment'],
      [{ maxRetries: '3' }, 'Invalid options.maxRetries'],
      [{ minContextSlot: -1 }, 'Invalid options.minContextSlot'],
      [{ commitment: 'confirm' }, 'Invalid options.commitment'],
      ['confirmed', 'Invalid options'],
      [[], 'Invalid options'],
    ];
    for (const [options, message] of bad) {
      expect(() => parseRequest({ type: 'SIGN_AND_SEND_TRANSACTION', transactions: [[1]], options })).toThrow(message);
    }
  });

  it('only accepts a non-negative integer below the hardened-derivation limit as an index', () => {
    for (const index of [1.5, NaN, -1, Infinity, 2 ** 31]) {
      expect(() => parseRequest({ type: 'SWITCH_ACCOUNT', index })).toThrow('Invalid index');
      expect(() => parseRequest({ type: 'EXPORT_PRIVATE_KEY', password: 'pw', accountIndex: index })).toThrow(
        'Invalid accountIndex',
      );
    }
    expect(parseRequest({ type: 'SWITCH_ACCOUNT', index: 2 ** 31 - 1 })).toStrictEqual({
      type: 'SWITCH_ACCOUNT',
      index: 2 ** 31 - 1,
    });
  });

  it('requires a non-empty string recipient on SEND_TRANSFER', () => {
    for (const to of ['', 5]) {
      expect(() => parseRequest({ type: 'SEND_TRANSFER', to, amountSmallest: '1' })).toThrow('Invalid to');
    }
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
      [{ bogus: 1 }, 'Invalid settings'],
    ];
    for (const [settings, message] of bad) {
      expect(() => parseRequest({ type: 'UPDATE_SETTINGS', settings })).toThrow(message);
    }
    expect(() => parseRequest({ type: 'UPDATE_SETTINGS' })).toThrow('Invalid settings');
    expect(() => parseRequest({ type: 'UPDATE_SETTINGS', settings: [] })).toThrow('Invalid settings');
  });

  it('accepts an https rpcUrl or an empty string to clear it', () => {
    for (const rpcUrl of ['https://rpc.example', 'https://rpc.example/v1?x=1', '']) {
      expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: { rpcUrl } })).toEqual({
        type: 'UPDATE_SETTINGS',
        settings: { rpcUrl },
      });
    }
  });

  it('rejects an rpcUrl that is not an absolute https URL', () => {
    for (const rpcUrl of [
      'http://rpc.example',
      'javascript:alert(1)',
      'ftp://rpc.example',
      'rpc.example',
      'https://',
      '//rpc.example',
      42,
      null,
    ]) {
      expect(() => parseRequest({ type: 'UPDATE_SETTINGS', settings: { rpcUrl } })).toThrow('Invalid settings.rpcUrl');
    }
  });

  it('accepts a Helius key up to the length cap or an empty string to clear it', () => {
    for (const heliusApiKey of ['', 'abcd1234-ab12-cd34-ef56-abcdef123456', 'k'.repeat(MAX_HELIUS_KEY_LENGTH)]) {
      expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: { heliusApiKey } })).toEqual({
        type: 'UPDATE_SETTINGS',
        settings: { heliusApiKey },
      });
    }
  });

  it('rejects a Helius key over the cap or of the wrong type', () => {
    for (const heliusApiKey of ['k'.repeat(MAX_HELIUS_KEY_LENGTH + 1), 7, null, { key: 'x' }]) {
      expect(() => parseRequest({ type: 'UPDATE_SETTINGS', settings: { heliusApiKey } })).toThrow(
        'Invalid settings.heliusApiKey',
      );
    }
  });

  it('rejects a Helius key that could escape the api-key query string', () => {
    for (const heliusApiKey of ['abc&x=1', 'abc?x', 'abc/def', 'a b', 'key#', 'k=v', 'ключ']) {
      expect(() => parseRequest({ type: 'UPDATE_SETTINGS', settings: { heliusApiKey } })).toThrow(
        'Invalid settings.heliusApiKey',
      );
    }
  });

  it('trims the rpc fields; whitespace-only clears them', () => {
    expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: { rpcUrl: '  https://rpc.example/  ' } })).toEqual({
      type: 'UPDATE_SETTINGS',
      settings: { rpcUrl: 'https://rpc.example/' },
    });
    expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: { rpcUrl: '   ' } })).toEqual({
      type: 'UPDATE_SETTINGS',
      settings: { rpcUrl: '' },
    });
    expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: { heliusApiKey: ' abc-123 ' } })).toEqual({
      type: 'UPDATE_SETTINGS',
      settings: { heliusApiKey: 'abc-123' },
    });
    expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: { heliusApiKey: '\t\n' } })).toEqual({
      type: 'UPDATE_SETTINGS',
      settings: { heliusApiKey: '' },
    });
  });

  it('accepts only a known cluster for rpcUrlCluster', () => {
    for (const rpcUrlCluster of ['mainnet-beta', 'devnet']) {
      expect(parseRequest({ type: 'UPDATE_SETTINGS', settings: { rpcUrlCluster } })).toEqual({
        type: 'UPDATE_SETTINGS',
        settings: { rpcUrlCluster },
      });
    }
    for (const rpcUrlCluster of ['', 'testnet', 1, null]) {
      expect(() => parseRequest({ type: 'UPDATE_SETTINGS', settings: { rpcUrlCluster } })).toThrow(
        'Invalid settings.rpcUrlCluster',
      );
    }
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
