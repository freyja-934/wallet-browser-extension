import {
  AddressLookupTableAccount,
  Message,
  MessageV0,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  AuthorityType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createApproveCheckedInstruction,
  createApproveInstruction,
  createBurnCheckedInstruction,
  createBurnInstruction,
  createCloseAccountInstruction,
  createFreezeAccountInstruction,
  createMintToCheckedInstruction,
  createMintToInstruction,
  createRevokeInstruction,
  createSetAuthorityInstruction,
  createThawAccountInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import { describe, expect, it } from 'vitest';
import {
  collectWarnings,
  decodeInstruction,
  deserializeTransaction,
  getInstructions,
  isTransactionMessage,
  lookupTableKeys,
  requiredSigners,
} from './tx-preview';

const a = PublicKey.unique();
const b = PublicKey.unique();
const c = PublicKey.unique();
const mint = PublicKey.unique();

function decode(ix: TransactionInstruction) {
  const decoded = decodeInstruction(ix);
  return { ...decoded, warnings: collectWarnings([decoded]) };
}

describe('System Program instructions (u32 LE index)', () => {
  it('labels Assign (index 1) with an ownership warning', () => {
    const ix = SystemProgram.assign({ accountPubkey: a, programId: b });
    expect(ix.data.readUInt32LE(0)).toBe(1);
    const out = decode(ix);
    expect(out.label).toBe('Assign account');
    expect(out.warnings).toEqual([{ level: 'warn', message: expect.stringContaining('ownership') }]);
  });

  it('labels Transfer (index 2) without a warning', () => {
    const ix = SystemProgram.transfer({ fromPubkey: a, toPubkey: b, lamports: 1 });
    expect(ix.data.readUInt32LE(0)).toBe(2);
    const out = decode(ix);
    expect(out.programName).toBe('System Program');
    expect(out.label).toBe('Transfer SOL');
    expect(out.warnings).toEqual([]);
  });

  it('labels CreateAccountWithSeed (index 3) as creation, not Assign', () => {
    const ix = SystemProgram.createAccountWithSeed({
      fromPubkey: a,
      newAccountPubkey: b,
      basePubkey: a,
      seed: 'seed',
      lamports: 1,
      space: 0,
      programId: c,
    });
    expect(ix.data.readUInt32LE(0)).toBe(3);
    const out = decode(ix);
    expect(out.label).toBe('Create account with seed');
    expect(out.warnings).toEqual([]);
  });

  it('labels AssignWithSeed (index 10) with an ownership warning', () => {
    const ix = SystemProgram.assign({ accountPubkey: a, basePubkey: b, seed: 'seed', programId: c });
    expect(ix.data.readUInt32LE(0)).toBe(10);
    const out = decode(ix);
    expect(out.label).toBe('Assign account with seed');
    expect(out.warnings).toEqual([{ level: 'warn', message: expect.stringContaining('ownership') }]);
  });

  it('does not read a u32 from a truncated System instruction', () => {
    const ix = new TransactionInstruction({ programId: SystemProgram.programId, keys: [], data: Buffer.from([2]) });
    const out = decode(ix);
    expect(out.label).toBe('System Program');
    expect(out.warnings).toEqual([]);
  });
});

describe('Token Program instructions (u8 index)', () => {
  const cases: Array<{
    name: string;
    index: number;
    ix: TransactionInstruction;
    label: string;
    warns: boolean;
  }> = [
    { name: 'Transfer', index: 3, ix: createTransferInstruction(a, b, c, 1), label: 'Transfer tokens', warns: false },
    { name: 'Approve', index: 4, ix: createApproveInstruction(a, b, c, 1), label: 'Approve delegate', warns: true },
    { name: 'Revoke', index: 5, ix: createRevokeInstruction(a, b), label: 'Revoke delegate', warns: false },
    {
      name: 'SetAuthority',
      index: 6,
      ix: createSetAuthorityInstruction(a, b, AuthorityType.AccountOwner, c),
      label: 'Set authority',
      warns: true,
    },
    { name: 'MintTo', index: 7, ix: createMintToInstruction(mint, a, b, 1), label: 'Mint tokens', warns: false },
    { name: 'Burn', index: 8, ix: createBurnInstruction(a, mint, b, 1), label: 'Burn tokens', warns: false },
    {
      name: 'CloseAccount',
      index: 9,
      ix: createCloseAccountInstruction(a, b, c),
      label: 'Close token account',
      warns: true,
    },
    {
      name: 'FreezeAccount',
      index: 10,
      ix: createFreezeAccountInstruction(a, mint, b),
      label: 'Freeze token account',
      warns: true,
    },
    {
      name: 'TransferChecked',
      index: 12,
      ix: createTransferCheckedInstruction(a, mint, b, c, 1, 0),
      label: 'Transfer tokens (checked)',
      warns: false,
    },
    {
      name: 'ApproveChecked',
      index: 13,
      ix: createApproveCheckedInstruction(a, mint, b, c, 1, 0),
      label: 'Approve delegate (checked)',
      warns: true,
    },
    {
      name: 'MintToChecked',
      index: 14,
      ix: createMintToCheckedInstruction(mint, a, b, 1, 0),
      label: 'Mint tokens (checked)',
      warns: false,
    },
    {
      name: 'BurnChecked',
      index: 15,
      ix: createBurnCheckedInstruction(a, mint, b, 1, 0),
      label: 'Burn tokens (checked)',
      warns: false,
    },
  ];

  it.each(cases)('labels $name (index $index)', ({ index, ix, label, warns }) => {
    expect(ix.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(ix.data[0]).toBe(index);
    const out = decode(ix);
    expect(out.programName).toBe('Token Program');
    expect(out.label).toBe(label);
    if (warns) {
      expect(out.warnings).toEqual([{ level: 'warn', message: expect.stringContaining(label) }]);
    } else {
      expect(out.warnings).toEqual([]);
    }
  });

  it('decodes Token-2022 with the same table', () => {
    const approve = createApproveInstruction(a, b, c, 1, [], TOKEN_2022_PROGRAM_ID);
    const out = decode(approve);
    expect(out.programName).toBe('Token-2022 Program');
    expect(out.label).toBe('Approve delegate');
    expect(out.warnings).toHaveLength(1);

    const transfer = createTransferCheckedInstruction(a, mint, b, c, 1, 0, [], TOKEN_2022_PROGRAM_ID);
    expect(decode(transfer).label).toBe('Transfer tokens (checked)');
  });

  it('does not confuse a Token index with a System index', () => {
    // Token index 3 is Transfer; System index 3 is CreateAccountWithSeed.
    // Token index 4 is Approve; the old decoder called it a transfer.
    expect(decode(createTransferInstruction(a, b, c, 1)).warnings).toEqual([]);
    expect(decode(createApproveInstruction(a, b, c, 1)).label).not.toBe('Transfer tokens');
  });
});

describe('unknown programs', () => {
  it('flags an unknown program as danger', () => {
    const unknown = new TransactionInstruction({ programId: PublicKey.unique(), keys: [], data: Buffer.from([1]) });
    const out = decode(unknown);
    expect(out.known).toBe(false);
    expect(out.warnings).toEqual([{ level: 'danger', message: expect.stringContaining('Unknown program') }]);
  });
});

describe('v0 messages', () => {
  it('reads instructions whose accounts are all static keys', () => {
    const payer = PublicKey.unique();
    const message = MessageV0.compile({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 })],
    });
    const tx = deserializeTransaction(new VersionedTransaction(message).serialize());
    const decoded = getInstructions(tx).map(decodeInstruction);
    expect(decoded.map((ix) => ix.label)).toEqual(['Transfer SOL']);
    expect(collectWarnings(decoded)).toEqual([]);
  });

  it('marks an instruction whose account index reaches into a lookup table as unreadable', () => {
    const payer = PublicKey.unique();
    // Static keys: [payer, System]. Account index 2 lives in the lookup table.
    const message = new MessageV0({
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      staticAccountKeys: [payer, SystemProgram.programId],
      recentBlockhash: PublicKey.default.toBase58(),
      compiledInstructions: [
        {
          programIdIndex: 1,
          accountKeyIndexes: [0, 2],
          data: SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 }).data,
        },
      ],
      addressTableLookups: [{ accountKey: PublicKey.unique(), writableIndexes: [0], readonlyIndexes: [] }],
    });
    const tx = deserializeTransaction(new VersionedTransaction(message).serialize());
    expect(tx).toBeInstanceOf(VersionedTransaction);

    let decoded: ReturnType<typeof decodeInstruction>[] = [];
    expect(() => {
      decoded = getInstructions(tx).map(decodeInstruction);
    }).not.toThrow();
    expect(decoded).toHaveLength(1);
    expect(decoded[0].label).toBe('Unreadable instruction');
    expect(decoded[0].known).toBe(false);
    expect(collectWarnings(decoded)).toEqual([{ level: 'danger', message: expect.stringContaining('lookup table') }]);
  });
  it('marks an instruction whose program id index is out of range as unreadable instead of throwing', () => {
    const payer = PublicKey.unique();
    // Static keys: [payer, System]. Program id index 5 has no static key; the old decoder threw on toBase58().
    const message = new MessageV0({
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      staticAccountKeys: [payer, SystemProgram.programId],
      recentBlockhash: PublicKey.default.toBase58(),
      compiledInstructions: [{ programIdIndex: 5, accountKeyIndexes: [0, 1], data: Buffer.from([2, 0, 0, 0]) }],
      addressTableLookups: [{ accountKey: PublicKey.unique(), writableIndexes: [0, 1, 2, 3], readonlyIndexes: [] }],
    });
    const tx = deserializeTransaction(new VersionedTransaction(message).serialize());
    let decoded: ReturnType<typeof decodeInstruction>[] = [];
    expect(() => {
      decoded = getInstructions(tx).map(decodeInstruction);
    }).not.toThrow();
    expect(decoded.map((ix) => ix.label)).toEqual(['Unreadable instruction']);
    expect(collectWarnings(decoded)).toEqual([{ level: 'danger', message: expect.stringContaining('cannot resolve') }]);
  });

  it('labels TransferWithSeed (System 11) and ThawAccount (Token 11)', () => {
    const seeded = SystemProgram.transfer({
      fromPubkey: a,
      basePubkey: b,
      toPubkey: c,
      lamports: 1,
      seed: 'seed',
      programId: SystemProgram.programId,
    });
    expect(seeded.data.readUInt32LE(0)).toBe(11);
    expect(decode(seeded)).toMatchObject({ label: 'Transfer SOL (seed)', warnings: [] });
    const thaw = createThawAccountInstruction(a, mint, b);
    expect(thaw.data[0]).toBe(11);
    expect(decode(thaw)).toMatchObject({ label: 'Thaw token account', warnings: [] });
  });
});

describe('deserializeTransaction', () => {
  it('returns a VersionedTransaction for legacy wire bytes as well as v0', () => {
    const payer = PublicKey.unique();
    const legacy = new Transaction({ feePayer: payer, recentBlockhash: PublicKey.default.toBase58() }).add(
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 }),
    );
    const tx = deserializeTransaction(legacy.serialize({ requireAllSignatures: false }));
    expect(tx).toBeInstanceOf(VersionedTransaction);
    expect(tx.message.version).toBe('legacy');
    expect(getInstructions(tx).map(decodeInstruction).map((ix) => ix.label)).toEqual(['Transfer SOL']);
    expect(() => deserializeTransaction(Uint8Array.from([1, 2, 3]))).toThrow();
  });
});

describe('lookup tables', () => {
  const payer = PublicKey.unique();
  const tableKey = PublicKey.unique();
  const table = new AddressLookupTableAccount({
    key: tableKey,
    state: { deactivationSlot: 0n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [c, b] },
  });
  /** A v0 transfer whose recipient `b` is table entry 1, compiled through the table. */
  function withTable(): VersionedTransaction {
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 })],
    }).compileToV0Message([table]);
    expect(message.addressTableLookups).toHaveLength(1);
    return deserializeTransaction(new VersionedTransaction(message).serialize());
  }

  it('lists the tables a v0 message needs and none for legacy', () => {
    expect(lookupTableKeys(withTable()).map((key) => key.toBase58())).toEqual([tableKey.toBase58()]);
    const legacy = MessageV0.compile({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 })],
    });
    expect(lookupTableKeys(new VersionedTransaction(legacy))).toEqual([]);
  });

  it('resolves the instruction once the table is supplied', () => {
    const tx = withTable();
    const [ix] = getInstructions(tx, [table]);
    expect('unreadable' in ix).toBe(false);
    const decoded = decodeInstruction(ix);
    expect(decoded.label).toBe('Transfer SOL');
    expect((ix as TransactionInstruction).keys.map((key) => key.pubkey.toBase58())).toEqual([payer.toBase58(), b.toBase58()]);
    expect((ix as TransactionInstruction).keys[1].isWritable).toBe(true);
    expect((ix as TransactionInstruction).keys[1].isSigner).toBe(false);
    expect(collectWarnings([decoded])).toEqual([]);
  });

  it('is unreadable without the table, or with the wrong table, but only for instructions that use it', () => {
    const tx = withTable();
    expect(getInstructions(tx).map(decodeInstruction).map((ix) => ix.label)).toEqual(['Unreadable instruction']);
    const other = new AddressLookupTableAccount({ key: PublicKey.unique(), state: { ...table.state } });
    expect(getInstructions(tx, [other]).map(decodeInstruction).map((ix) => ix.label)).toEqual(['Unreadable instruction']);

    // Two instructions, the first static-only: it still reads when the table is missing.
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }),
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 }),
      ],
    }).compileToV0Message([table]);
    const two = new VersionedTransaction(message);
    expect(getInstructions(two).map(decodeInstruction).map((ix) => ix.label)).toEqual(['Transfer SOL', 'Unreadable instruction']);
    expect(getInstructions(two, [table]).map(decodeInstruction).map((ix) => ix.label)).toEqual(['Transfer SOL', 'Transfer SOL']);
  });
});

describe('requiredSigners', () => {
  it('returns the static keys the header covers, for legacy and v0', () => {
    const payer = PublicKey.unique();
    const v0 = MessageV0.compile({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 })],
    });
    expect(requiredSigners(new VersionedTransaction(v0)).map((key) => key.toBase58())).toEqual([payer.toBase58()]);

    // A second signer: `a` must sign as the source of the second transfer.
    const legacy = Message.compile({
      payerKey: payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [
        SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 }),
        SystemProgram.transfer({ fromPubkey: a, toPubkey: b, lamports: 1 }),
      ],
    });
    const signers = requiredSigners(new VersionedTransaction(legacy)).map((key) => key.toBase58());
    expect(signers).toHaveLength(2);
    expect(signers).toContain(payer.toBase58());
    expect(signers).toContain(a.toBase58());
    expect(signers).not.toContain(b.toBase58());
  });
});

describe('isTransactionMessage', () => {
  const payer = PublicKey.unique();
  const instructions = [SystemProgram.transfer({ fromPubkey: payer, toPubkey: b, lamports: 1 })];

  it('is true for a serialized legacy or v0 message', () => {
    const legacy = Message.compile({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions });
    expect(isTransactionMessage(legacy.serialize())).toBe(true);
    const v0 = MessageV0.compile({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions });
    expect(isTransactionMessage(v0.serialize())).toBe(true);
  });

  it('is false for text, an empty message, random bytes, and a whole signed transaction', () => {
    expect(isTransactionMessage(new TextEncoder().encode('hello from lumen test dapp'))).toBe(false);
    expect(isTransactionMessage(new TextEncoder().encode('Sign in to dapp.example\nNonce: 12345'))).toBe(false);
    expect(isTransactionMessage(new Uint8Array(0))).toBe(false);
    expect(isTransactionMessage(Uint8Array.from([1, 2, 3]))).toBe(false);
    expect(isTransactionMessage(new Uint8Array(200))).toBe(false);
    const v0 = MessageV0.compile({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions });
    expect(isTransactionMessage(new VersionedTransaction(v0).serialize())).toBe(false);
  });

  it('is false when the bytes parse but do not round-trip, since no valid signature could cover them', () => {
    const legacy = Message.compile({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions });
    const trailing = Buffer.concat([legacy.serialize(), Buffer.from([0])]);
    expect(isTransactionMessage(trailing)).toBe(false);
  });
});
