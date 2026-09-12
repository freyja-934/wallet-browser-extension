import {
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
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
  createTransferCheckedInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import { describe, expect, it } from 'vitest';
import { collectWarnings, decodeInstruction, deserializeTransaction, getInstructions } from './tx-preview';

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

  it('marks an instruction that reaches into a lookup table as unreadable instead of throwing', () => {
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
});
