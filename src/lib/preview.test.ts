import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
} from '@solana/web3.js';
import { ACCOUNT_SIZE, AccountLayout, TOKEN_PROGRAM_ID, createApproveInstruction } from '@solana/spl-token';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPreview,
  estimatedFeeLamports,
  MAX_COMPUTE_UNITS,
  MAX_SIMULATED_ACCOUNTS,
  NOT_A_SIGNER_ERROR,
  UNREADABLE_TRANSACTION_WARNING,
  type PreviewDeps,
  type SimulationValue,
} from './preview';

const payer = PublicKey.unique();
const other = PublicKey.unique();
const SYSTEM = SystemProgram.programId.toBase58();

function tx(instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 })], from = payer) {
  const message = MessageV0.compile({ payerKey: from, recentBlockhash: PublicKey.default.toBase58(), instructions });
  return new VersionedTransaction(message);
}

function bytes(withApprove = false): Uint8Array {
  const instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 })];
  if (withApprove) instructions.push(createApproveInstruction(PublicKey.unique(), PublicKey.unique(), payer, 5n));
  return tx(instructions).serialize();
}

function info(lamports: number, owner: PublicKey = SystemProgram.programId, data: Buffer = Buffer.alloc(0)): AccountInfo<Buffer> {
  return { executable: false, owner, lamports, data };
}

function tokenAccount(mint: PublicKey, holder: PublicKey, amount: bigint): Buffer {
  const buffer = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint,
      owner: holder,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    buffer,
  );
  return buffer;
}

const simulated = (owner: string, lamports: number, data: Buffer = Buffer.alloc(0)) => ({
  owner,
  lamports,
  data: [data.toString('base64'), 'base64'],
});

type Spied = {
  owner: PublicKey;
  fetchLookupTables: ReturnType<typeof vi.fn<[PublicKey[]], Promise<AddressLookupTableAccount[]>>>;
  fetchAccounts: ReturnType<typeof vi.fn<[PublicKey[]], Promise<Map<string, AccountInfo<Buffer> | null>>>>;
  fetchMintDecimals: ReturnType<typeof vi.fn<[PublicKey[]], Promise<Map<string, number>>>>;
  simulate: ReturnType<typeof vi.fn<[VersionedTransaction, string[]], Promise<SimulationValue>>>;
};

/** Deps that answer with nothing: no tables, no accounts, no mints; `simulate` as given. Every function is a spy. */
function deps(overrides: Partial<PreviewDeps> = {}): Spied {
  return {
    owner: overrides.owner ?? payer,
    fetchLookupTables: vi.fn(overrides.fetchLookupTables ?? (async () => [])),
    fetchAccounts: vi.fn(
      overrides.fetchAccounts ?? (async (keys: PublicKey[]) => new Map(keys.map((key) => [key.toBase58(), null]))),
    ),
    fetchMintDecimals: vi.fn(overrides.fetchMintDecimals ?? (async () => new Map<string, number>())),
    simulate: vi.fn(
      overrides.simulate ?? (async (): Promise<SimulationValue> => ({ err: null, logs: [], unitsConsumed: 150, accounts: null })),
    ),
  };
}

describe('buildPreview', () => {
  it('returns a danger warning and never touches the network when the bytes do not decode', async () => {
    const d = deps();
    const preview = await buildPreview(Uint8Array.from([1, 2, 3]), d);
    expect(d.simulate).not.toHaveBeenCalled();
    expect(d.fetchAccounts).not.toHaveBeenCalled();
    expect(preview).toEqual({
      success: false,
      error: 'Could not decode transaction',
      instructions: [],
      warnings: [UNREADABLE_TRANSACTION_WARNING],
      signerOk: false,
      unreadable: true,
    });
  });

  it('keeps the decoded instructions and warnings when the RPC fails', async () => {
    const preview = await buildPreview(
      bytes(true),
      deps({
        simulate: async () => {
          throw new Error('403 Forbidden');
        },
      }),
    );
    expect(preview.success).toBe(false);
    expect(preview.error).toBe('403 Forbidden');
    expect(preview.instructions.map((ix) => ix.label)).toEqual(['Transfer SOL', 'Approve delegate']);
    expect(preview.warnings).toEqual([{ level: 'warn', message: expect.stringContaining('Approve delegate') }]);
    expect(preview).toMatchObject({ signerOk: true, unreadable: false });
    expect(preview.diff).toBeUndefined();
  });

  it('a failing account read is reported the same way, before simulating', async () => {
    const d = deps({
      fetchAccounts: async () => {
        throw new Error('');
      },
    });
    const preview = await buildPreview(bytes(), d);
    expect(preview.error).toBe('Simulation failed');
    expect(d.simulate).not.toHaveBeenCalled();
  });

  it('reports a simulation error with the instructions still attached and no diff', async () => {
    const preview = await buildPreview(
      bytes(),
      deps({ simulate: async () => ({ err: { InstructionError: [0, 'Custom'] }, logs: ['Program log: boom'] }) }),
    );
    expect(preview.success).toBe(false);
    expect(preview.error).toBe(JSON.stringify({ InstructionError: [0, 'Custom'] }));
    expect(preview.logs).toEqual(['Program log: boom']);
    expect(preview.instructions).toHaveLength(1);
    expect(preview.diff).toBeUndefined();
  });

  it('reports success with logs and units when the simulation passes', async () => {
    const preview = await buildPreview(bytes(), deps({ simulate: async () => ({ err: null, logs: null, unitsConsumed: 150 }) }));
    expect(preview).toMatchObject({ success: true, error: undefined, logs: [], unitsConsumed: 150, signerOk: true, unreadable: false });
    expect(preview.instructions.map((ix) => ix.label)).toEqual(['Transfer SOL']);
    // No account state came back: no diff.
    expect(preview.diff).toBeUndefined();
  });

  it('stops before the network when the active account is not a required signer', async () => {
    const d = deps({ owner: other });
    const preview = await buildPreview(bytes(), d);
    expect(preview).toMatchObject({ success: false, error: NOT_A_SIGNER_ERROR, signerOk: false, unreadable: false });
    expect(preview.instructions.map((ix) => ix.label)).toEqual(['Transfer SOL']);
    expect(d.fetchAccounts).not.toHaveBeenCalled();
    expect(d.simulate).not.toHaveBeenCalled();
  });

  it('simulates the writable accounts with the owner first and builds the SOL diff and fee', async () => {
    const d = deps({
      fetchAccounts: async (keys) =>
        new Map(keys.map((key, i) => [key.toBase58(), i === 0 ? info(1_000_000) : info(10)])),
      simulate: async (_tx, addresses) => ({
        err: null,
        logs: [],
        unitsConsumed: 150,
        accounts: addresses.map((address) => (address === payer.toBase58() ? simulated(SYSTEM, 994_999) : simulated(SYSTEM, 11))),
      }),
    });
    const preview = await buildPreview(bytes(), d);
    expect(d.fetchAccounts).toHaveBeenCalledTimes(1);
    expect(d.fetchAccounts.mock.calls[0][0].map((key) => key.toBase58())).toEqual([payer.toBase58(), other.toBase58()]);
    expect(d.simulate.mock.calls[0][1]).toEqual([payer.toBase58(), other.toBase58()]);
    expect(preview.success).toBe(true);
    expect(preview.diff).toEqual({
      sol: { pre: '1000000', post: '994999' },
      tokens: [],
      fee: '5000',
      partial: false,
    });
    expect(d.fetchMintDecimals).not.toHaveBeenCalled();
  });

  it('adds token rows for the owner with the decimals it fetched', async () => {
    const mint = PublicKey.unique();
    const ata = PublicKey.unique();
    const transfer = tx([
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: ata, lamports: 0 }),
    ]);
    const d = deps({
      fetchAccounts: async (keys) =>
        new Map(
          keys.map((key) => [
            key.toBase58(),
            key.equals(ata) ? info(1, TOKEN_PROGRAM_ID, tokenAccount(mint, payer, 300n)) : info(50),
          ]),
        ),
      simulate: async (_tx, addresses) => ({
        err: null,
        logs: [],
        accounts: addresses.map((address) =>
          address === ata.toBase58()
            ? simulated(TOKEN_PROGRAM_ID.toBase58(), 1, tokenAccount(mint, payer, 100n))
            : simulated(SYSTEM, 45_000),
        ),
      }),
      fetchMintDecimals: async (mints: PublicKey[]) => new Map(mints.map((m) => [m.toBase58(), 2])),
    });
    const preview = await buildPreview(transfer.serialize(), d);
    expect(d.fetchMintDecimals.mock.calls[0][0].map((m) => m.toBase58())).toEqual([mint.toBase58()]);
    expect(preview.diff?.tokens).toEqual([
      { mint: mint.toBase58(), pre: '300', post: '100', decimals: 2, programId: TOKEN_PROGRAM_ID.toBase58() },
    ]);
    expect(preview.diff?.sol).toEqual({ pre: '50', post: '45000' });
  });

  it('renders base units when the mint read fails', async () => {
    const mint = PublicKey.unique();
    const ata = PublicKey.unique();
    const d = deps({
      fetchAccounts: async (keys) =>
        new Map(keys.map((key) => [key.toBase58(), key.equals(ata) ? info(1, TOKEN_PROGRAM_ID, tokenAccount(mint, payer, 1n)) : info(1)])),
      simulate: async (_tx, addresses) => ({
        err: null,
        logs: [],
        accounts: addresses.map((address) =>
          address === ata.toBase58() ? simulated(TOKEN_PROGRAM_ID.toBase58(), 1, tokenAccount(mint, payer, 0n)) : simulated(SYSTEM, 1),
        ),
      }),
      fetchMintDecimals: async () => {
        throw new Error('rate limited');
      },
    });
    const preview = await buildPreview(tx([SystemProgram.transfer({ fromPubkey: payer, toPubkey: ata, lamports: 0 })]).serialize(), d);
    expect(preview.success).toBe(true);
    expect(preview.diff?.tokens).toEqual([{ mint: mint.toBase58(), pre: '1', post: '0', decimals: null, programId: TOKEN_PROGRAM_ID.toBase58() }]);
  });

  it('caps the simulated accounts and marks the diff partial', async () => {
    // One instruction writing MAX_SIMULATED_ACCOUNTS accounts besides the payer: one over the cap, within the packet size.
    const recipients = Array.from({ length: MAX_SIMULATED_ACCOUNTS }, () => PublicKey.unique());
    const many = tx([
      new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: recipients.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
        data: Buffer.alloc(0),
      }),
    ]);
    const d = deps({
      fetchAccounts: async (keys) => new Map(keys.map((key) => [key.toBase58(), info(1)])),
      simulate: async (_tx, addresses) => ({ err: null, logs: [], accounts: addresses.map(() => simulated(SYSTEM, 1)) }),
    });
    const preview = await buildPreview(many.serialize(), d);
    const addresses = d.simulate.mock.calls[0][1];
    expect(addresses).toHaveLength(MAX_SIMULATED_ACCOUNTS);
    expect(addresses[0]).toBe(payer.toBase58());
    expect(preview.diff?.partial).toBe(true);
  });

  it('fetches the lookup tables a v0 message names and resolves through them', async () => {
    const tableKey = PublicKey.unique();
    const table = new AddressLookupTableAccount({
      key: tableKey,
      state: { deactivationSlot: 0n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [other] },
    });
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 })],
    }).compileToV0Message([table]);
    const serialized = new VersionedTransaction(message).serialize();

    const d = deps({
      fetchLookupTables: async () => [table],
      fetchAccounts: async (keys) => new Map(keys.map((key) => [key.toBase58(), info(1)])),
      simulate: async (_tx, addresses) => ({ err: null, logs: [], accounts: addresses.map(() => simulated(SYSTEM, 1)) }),
    });
    const preview = await buildPreview(serialized, d);
    expect(d.fetchLookupTables.mock.calls[0][0].map((key) => key.toBase58())).toEqual([tableKey.toBase58()]);
    expect(preview).toMatchObject({ success: true, unreadable: false, signerOk: true });
    expect(preview.instructions.map((ix) => ix.label)).toEqual(['Transfer SOL']);
    // The table entry is writable and made it into the simulated set.
    expect(d.simulate.mock.calls[0][1]).toEqual([payer.toBase58(), other.toBase58()]);

    // Without the table the instruction is unreadable and the preview says so, even though the
    // simulation passed: the table failure is a warning, never an `error` beside `success: true`.
    const missing = await buildPreview(
      serialized,
      deps({
        fetchLookupTables: async () => {
          throw new Error('Table not found');
        },
        simulate: async (_tx, addresses) => ({ err: null, logs: [], accounts: addresses.map(() => simulated(SYSTEM, 1)) }),
      }),
    );
    expect(missing.unreadable).toBe(true);
    expect(missing.success).toBe(true);
    expect(missing.error).toBeUndefined();
    expect(missing.instructions.map((ix) => ix.label)).toEqual(['Unreadable instruction']);
    expect(missing.warnings).toEqual([
      { level: 'danger', message: expect.stringContaining('lookup table') },
      { level: 'warn', message: 'Table not found' },
    ]);
  });

  it('reports a failed table read as a warning and a failed simulation as the error, side by side', async () => {
    const tableKey = PublicKey.unique();
    const table = new AddressLookupTableAccount({
      key: tableKey,
      state: { deactivationSlot: 0n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [other] },
    });
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 })],
    }).compileToV0Message([table]);
    const preview = await buildPreview(
      new VersionedTransaction(message).serialize(),
      deps({
        fetchLookupTables: async () => {
          throw new Error('Table not found');
        },
        simulate: async () => {
          throw new Error('503');
        },
      }),
    );
    expect(preview).toMatchObject({ success: false, error: '503', unreadable: true });
    expect(preview.warnings).toContainEqual({ level: 'warn', message: 'Table not found' });
  });
});

describe('estimatedFeeLamports', () => {
  it('is 5000 lamports per required signature', () => {
    expect(estimatedFeeLamports(tx())).toBe(5000n);
    const two = tx([
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 }),
      SystemProgram.transfer({ fromPubkey: other, toPubkey: payer, lamports: 1 }),
    ]);
    expect(estimatedFeeLamports(two)).toBe(10_000n);
  });

  it('adds the compute-budget priority fee, rounded up, over the set or default unit limit', () => {
    const priced = tx([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 }),
    ]);
    // 300000 * 1000 / 1e6 = 300
    expect(estimatedFeeLamports(priced)).toBe(5_300n);
    const noLimit = tx([
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 }),
    ]);
    // One non-budget instruction: 200000 units * 1 / 1e6 = 0.2 → 1
    expect(estimatedFeeLamports(noLimit)).toBe(5_001n);
  });

  it('clamps an explicit unit limit above the runtime maximum', () => {
    const oversized = tx([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 2_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1 }),
    ]);
    // 1_400_000 * 1000 / 1e6 = 1400, not 2000.
    expect(MAX_COMPUTE_UNITS).toBe(1_400_000n);
    expect(estimatedFeeLamports(oversized)).toBe(5_000n + 1_400n);
  });
});
