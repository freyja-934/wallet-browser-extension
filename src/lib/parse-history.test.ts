import { describe, expect, it } from 'vitest';
import {
  activityFromParsedTx,
  displayTokenAmount,
  normalizeHeliusTransfers,
  type ParsedTxInput,
} from './parse-history';

const owner = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const other = 'So11111111111111111111111111111111111111112';
const mint = 'Fbfa7UPLAfng7Wkvr2qCrZVPqEwMzLFPvD8McPRfhBkS';

function tx(partial: Partial<ParsedTxInput> & { instructions?: ParsedTxInput['transaction']['message']['instructions'] }): ParsedTxInput {
  return {
    meta: {
      err: null,
      fee: 5000,
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
      ...partial.meta,
    },
    transaction: {
      message: {
        instructions: partial.instructions ?? partial.transaction?.message.instructions ?? [],
      },
    },
  };
}

describe('activityFromParsedTx', () => {
  it('reads a native SOL transfer involving the owner', () => {
    const result = activityFromParsedTx(tx({
      instructions: [{
        program: 'system',
        parsed: {
          type: 'transfer',
          info: { source: owner, destination: other, lamports: 1_000_000 },
        },
      }],
    }), owner);

    expect(result.type).toBe('TRANSFER');
    expect(result.nativeTransfers).toEqual([{
      from: owner,
      to: other,
      amount: 1_000_000,
    }]);
  });

  it('ignores native transfers that do not touch the owner', () => {
    const result = activityFromParsedTx(tx({
      instructions: [{
        program: 'system',
        parsed: {
          type: 'transfer',
          info: { source: other, destination: other, lamports: 10 },
        },
      }],
    }), owner);

    expect(result.nativeTransfers).toEqual([]);
    expect(result.type).toBe('unknown');
  });

  it('reads a self token transfer when balances do not change', () => {
    const result = activityFromParsedTx(tx({
      meta: {
        err: null,
        fee: 5000,
        preTokenBalances: [
          { mint, owner, uiTokenAmount: { amount: '1000000', decimals: 6 } },
        ],
        postTokenBalances: [
          { mint, owner, uiTokenAmount: { amount: '1000000', decimals: 6 } },
        ],
        innerInstructions: [],
      },
      instructions: [{
        program: 'spl-token',
        parsed: {
          type: 'transfer',
          info: { authority: owner, source: 'ata1', destination: 'ata1', amount: '1000' },
        },
      }],
    }), owner);

    expect(result.type).toBe('TOKEN_TRANSFER');
    expect(result.tokenTransfers).toEqual([{
      mint,
      from: owner,
      to: owner,
      amount: '1000',
      decimals: 6,
    }]);
  });

  it('diffs token balances for the owner', () => {
    const result = activityFromParsedTx(tx({
      meta: {
        err: null,
        fee: 5000,
        preTokenBalances: [
          { mint, owner, uiTokenAmount: { amount: '1000000', decimals: 6 } },
          { mint, owner: other, uiTokenAmount: { amount: '0', decimals: 6 } },
        ],
        postTokenBalances: [
          { mint, owner, uiTokenAmount: { amount: '999000', decimals: 6 } },
          { mint, owner: other, uiTokenAmount: { amount: '1000', decimals: 6 } },
        ],
        innerInstructions: [],
      },
    }), owner);

    expect(result.type).toBe('TOKEN_TRANSFER');
    expect(result.tokenTransfers).toEqual([{
      mint,
      from: owner,
      to: other,
      amount: '1000',
      decimals: 6,
    }]);
  });
});

describe('normalizeHeliusTransfers', () => {
  it('maps fromUserAccount and rawTokenAmount', () => {
    const result = normalizeHeliusTransfers({
      nativeTransfers: [{ fromUserAccount: owner, toUserAccount: other, amount: 2_000_000 }],
      tokenTransfers: [{
        fromUserAccount: owner,
        toUserAccount: other,
        mint,
        rawTokenAmount: { tokenAmount: '1000', decimals: 6 },
      }],
    });

    expect(result.nativeTransfers[0]).toEqual({ from: owner, to: other, amount: 2_000_000 });
    expect(result.tokenTransfers[0]).toEqual({
      mint,
      from: owner,
      to: other,
      amount: '1000',
      decimals: 6,
    });
  });

  it('reads nothing out of a body whose transfer fields are not arrays of objects', () => {
    // What an HTTP body can actually carry: a string, an object, a list of junk.
    const result = normalizeHeliusTransfers({
      nativeTransfers: 'rate limited',
      tokenTransfers: { message: 'nope' },
    });

    expect(result).toEqual({ nativeTransfers: [], tokenTransfers: [] });
    expect(normalizeHeliusTransfers({})).toEqual({ nativeTransfers: [], tokenTransfers: [] });
    expect(normalizeHeliusTransfers({ nativeTransfers: [null, 7, 'x'] }).nativeTransfers).toEqual([]);
  });
});

describe('displayTokenAmount', () => {
  it('formats raw units and leaves UI amounts alone', () => {
    expect(displayTokenAmount('1000', 6)).toBe('0.001');
    expect(displayTokenAmount('0.01', 6)).toBe('0.01');
  });
});
