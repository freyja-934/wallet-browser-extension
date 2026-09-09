import { SystemProgram, Transaction, TransactionInstruction, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { collectWarnings, decodeInstruction } from './tx-preview';

describe('tx preview decoder', () => {
  it('names system transfers and flags unknown programs', () => {
    const transfer = SystemProgram.transfer({
      fromPubkey: PublicKey.unique(),
      toPubkey: PublicKey.unique(),
      lamports: 1,
    });
    const decoded = decodeInstruction(transfer);
    expect(decoded.programName).toBe('System Program');

    const unknown = new TransactionInstruction({
      programId: PublicKey.unique(),
      keys: [],
      data: Buffer.from([1]),
    });
    const warnings = collectWarnings([decodeInstruction(unknown)]);
    expect(warnings.some((w) => w.level === 'danger')).toBe(true);
  });

  it('builds a legacy transaction', () => {
    const tx = new Transaction();
    expect(tx.instructions).toEqual([]);
  });
});
