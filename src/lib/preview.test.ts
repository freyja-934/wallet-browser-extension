import { MessageV0, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { createApproveInstruction } from '@solana/spl-token';
import { describe, expect, it, vi } from 'vitest';
import { buildPreview, UNREADABLE_TRANSACTION_WARNING } from './preview';

function txBytes(withApprove = false): Uint8Array {
  const payer = PublicKey.unique();
  const instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: PublicKey.unique(), lamports: 1 })];
  if (withApprove) {
    instructions.push(createApproveInstruction(PublicKey.unique(), PublicKey.unique(), payer, 5n));
  }
  const message = MessageV0.compile({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions });
  return new VersionedTransaction(message).serialize();
}

describe('buildPreview', () => {
  it('returns a danger warning and never simulates when the bytes do not decode', async () => {
    const simulate = vi.fn();
    const preview = await buildPreview(Uint8Array.from([1, 2, 3]), simulate);
    expect(simulate).not.toHaveBeenCalled();
    expect(preview).toEqual({
      success: false,
      error: 'Could not decode transaction',
      instructions: [],
      warnings: [UNREADABLE_TRANSACTION_WARNING],
    });
  });

  it('keeps the decoded instructions and warnings when the RPC fails', async () => {
    const preview = await buildPreview(txBytes(true), async () => {
      throw new Error('403 Forbidden');
    });
    expect(preview.success).toBe(false);
    expect(preview.error).toBe('403 Forbidden');
    expect(preview.instructions.map((ix) => ix.label)).toEqual(['Transfer SOL', 'Approve delegate']);
    expect(preview.warnings).toEqual([{ level: 'warn', message: expect.stringContaining('Approve delegate') }]);
  });

  it('falls back to a generic message when the failure has none', async () => {
    const preview = await buildPreview(txBytes(), async () => {
      throw new Error('');
    });
    expect(preview.error).toBe('Simulation failed');
  });

  it('reports a simulation error with the instructions still attached', async () => {
    const preview = await buildPreview(txBytes(), async () => ({
      err: { InstructionError: [0, 'Custom'] },
      logs: ['Program log: boom'],
    }));
    expect(preview.success).toBe(false);
    expect(preview.error).toBe(JSON.stringify({ InstructionError: [0, 'Custom'] }));
    expect(preview.logs).toEqual(['Program log: boom']);
    expect(preview.instructions).toHaveLength(1);
  });

  it('reports success with logs and units when the simulation passes', async () => {
    const preview = await buildPreview(txBytes(), async () => ({ err: null, logs: null, unitsConsumed: 150 }));
    expect(preview).toMatchObject({ success: true, error: undefined, logs: [], unitsConsumed: 150 });
    expect(preview.instructions.map((ix) => ix.label)).toEqual(['Transfer SOL']);
  });
});
