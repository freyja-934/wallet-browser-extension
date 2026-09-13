import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { ACCOUNT_SIZE, AccountLayout, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { describe, expect, it } from 'vitest';
import { balanceDiff, decodeTokenAccount, touchedMints, type PostAccount } from './balance-diff';

const owner = PublicKey.unique();
const stranger = PublicKey.unique();
const mintA = PublicKey.unique();
const mintB = PublicKey.unique();
const SYSTEM = '11111111111111111111111111111111';

/** A token account buffer as the program lays it out; `extra` bytes model Token-2022 extensions. */
function tokenAccount(mint: PublicKey, holder: PublicKey, amount: bigint, extra: number[] = []): Buffer {
  const base = Buffer.alloc(ACCOUNT_SIZE);
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
    base,
  );
  return extra.length === 0 ? base : Buffer.concat([base, Buffer.from(extra)]);
}

function mintAccount(decimals: number): Buffer {
  const buffer = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 1_000n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    buffer,
  );
  return buffer;
}

function preInfo(programId: PublicKey, lamports: number, data: Buffer = Buffer.alloc(0)): AccountInfo<Buffer> {
  return { executable: false, owner: programId, lamports, data };
}

function postInfo(programId: PublicKey | string, lamports: number, data: Buffer = Buffer.alloc(0)): PostAccount {
  return { owner: typeof programId === 'string' ? programId : programId.toBase58(), lamports, data };
}

const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const ataA = PublicKey.unique().toBase58();
const ataB = PublicKey.unique().toBase58();
const ata2022 = PublicKey.unique().toBase58();
const strangerAta = PublicKey.unique().toBase58();

describe('decodeTokenAccount', () => {
  it('reads Token and Token-2022 accounts and refuses everything else', () => {
    const data = tokenAccount(mintA, owner, 5n);
    expect(decodeTokenAccount(TOKEN, data)).toEqual({ mint: mintA.toBase58(), owner: owner.toBase58(), amount: 5n, programId: TOKEN });
    expect(decodeTokenAccount(TOKEN_2022, tokenAccount(mintA, owner, 7n, [2, 0, 0]))).toMatchObject({ amount: 7n, programId: TOKEN_2022 });
    // A Token-2022 mint with extensions is longer than an account but tagged as a mint.
    expect(decodeTokenAccount(TOKEN_2022, tokenAccount(mintA, owner, 7n, [1, 0, 0]))).toBeNull();
    // Owned by another program, or too short to be an account (a mint is 82 bytes).
    expect(decodeTokenAccount(SYSTEM, data)).toBeNull();
    expect(decodeTokenAccount(TOKEN, mintAccount(6))).toBeNull();
    expect(decodeTokenAccount(TOKEN, Buffer.alloc(0))).toBeNull();
  });
});

describe('balanceDiff', () => {
  const decimals = new Map([
    [mintA.toBase58(), 6],
    [mintB.toBase58(), 0],
  ]);

  it('SOL only: reports the owner lamports before and after and no token rows', () => {
    const pre = new Map([[owner.toBase58(), preInfo(new PublicKey(SYSTEM), 1_000_000)]]);
    const post = new Map([[owner.toBase58(), postInfo(SYSTEM, 994_995)]]);
    expect(balanceDiff(pre, post, owner, decimals)).toEqual({ sol: { pre: 1_000_000n, post: 994_995n }, tokens: [] });
  });

  it('an owner missing from pre is 0 before; missing from post is unchanged; null in post is 0 after', () => {
    expect(balanceDiff(new Map(), new Map(), owner, decimals).sol).toEqual({ pre: 0n, post: 0n });
    const pre = new Map([[owner.toBase58(), preInfo(new PublicKey(SYSTEM), 10)]]);
    expect(balanceDiff(pre, new Map(), owner, decimals).sol).toEqual({ pre: 10n, post: 10n });
    expect(balanceDiff(pre, new Map([[owner.toBase58(), null]]), owner, decimals).sol).toEqual({ pre: 10n, post: 0n });
  });

  it('SPL: a transfer out shows the owner mint balance falling, with the mint decimals', () => {
    const pre = new Map<string, AccountInfo<Buffer> | null>([
      [owner.toBase58(), preInfo(new PublicKey(SYSTEM), 100)],
      [ataA, preInfo(TOKEN_PROGRAM_ID, 2_039_280, tokenAccount(mintA, owner, 1_500_000n))],
      [strangerAta, preInfo(TOKEN_PROGRAM_ID, 2_039_280, tokenAccount(mintA, stranger, 0n))],
    ]);
    const post = new Map<string, PostAccount | null>([
      [owner.toBase58(), postInfo(SYSTEM, 95)],
      [ataA, postInfo(TOKEN, 2_039_280, tokenAccount(mintA, owner, 500_000n))],
      [strangerAta, postInfo(TOKEN, 2_039_280, tokenAccount(mintA, stranger, 1_000_000n))],
    ]);
    expect(balanceDiff(pre, post, owner, decimals)).toEqual({
      sol: { pre: 100n, post: 95n },
      tokens: [{ mint: mintA.toBase58(), pre: 1_500_000n, post: 500_000n, decimals: 6, programId: TOKEN }],
    });
  });

  it('groups several accounts of one mint, drops unchanged mints, and keeps a Token-2022 row apart', () => {
    const second = PublicKey.unique().toBase58();
    const pre = new Map<string, AccountInfo<Buffer> | null>([
      [ataA, preInfo(TOKEN_PROGRAM_ID, 1, tokenAccount(mintA, owner, 10n))],
      [second, preInfo(TOKEN_PROGRAM_ID, 1, tokenAccount(mintA, owner, 5n))],
      [ataB, preInfo(TOKEN_PROGRAM_ID, 1, tokenAccount(mintB, owner, 42n))],
      [ata2022, preInfo(TOKEN_2022_PROGRAM_ID, 1, tokenAccount(mintB, owner, 3n, [2]))],
    ]);
    const post = new Map<string, PostAccount | null>([
      [ataA, postInfo(TOKEN, 1, tokenAccount(mintA, owner, 0n))],
      [second, postInfo(TOKEN, 1, tokenAccount(mintA, owner, 20n))],
      [ataB, postInfo(TOKEN, 1, tokenAccount(mintB, owner, 42n))],
      [ata2022, postInfo(TOKEN_2022, 1, tokenAccount(mintB, owner, 9n, [2]))],
    ]);
    const diff = balanceDiff(pre, post, owner, decimals);
    expect(diff.tokens).toEqual([
      { mint: mintA.toBase58(), pre: 15n, post: 20n, decimals: 6, programId: TOKEN },
      // Both programs hold mintB for the owner; the row is per mint and 42 → 42 is dropped, 3 → 9 stays.
      { mint: mintB.toBase58(), pre: 45n, post: 51n, decimals: 0, programId: TOKEN },
    ]);
  });

  it('a token account created by the transaction starts at 0; one closed ends at 0; unknown decimals are null', () => {
    const created = PublicKey.unique().toBase58();
    const closed = PublicKey.unique().toBase58();
    const mintC = PublicKey.unique();
    const pre = new Map<string, AccountInfo<Buffer> | null>([
      [created, null],
      [closed, preInfo(TOKEN_2022_PROGRAM_ID, 1, tokenAccount(mintC, owner, 8n, [2]))],
    ]);
    const post = new Map<string, PostAccount | null>([
      [created, postInfo(TOKEN, 1, tokenAccount(mintA, owner, 4n))],
      [closed, null],
    ]);
    expect(balanceDiff(pre, post, owner, decimals).tokens).toEqual([
      { mint: mintA.toBase58(), pre: 0n, post: 4n, decimals: 6, programId: TOKEN },
      { mint: mintC.toBase58(), pre: 8n, post: 0n, decimals: null, programId: TOKEN_2022 },
    ]);
  });

  it('a token account of the owner that was not simulated keeps its balance', () => {
    const pre = new Map<string, AccountInfo<Buffer> | null>([[ataA, preInfo(TOKEN_PROGRAM_ID, 1, tokenAccount(mintA, owner, 9n))]]);
    expect(balanceDiff(pre, new Map(), owner, decimals).tokens).toEqual([]);
  });

  it('ignores accounts that only look like token accounts', () => {
    const fake = PublicKey.unique().toBase58();
    const pre = new Map<string, AccountInfo<Buffer> | null>([
      [fake, preInfo(new PublicKey(SYSTEM), 1, tokenAccount(mintA, owner, 99n))],
    ]);
    const post = new Map<string, PostAccount | null>([[fake, postInfo(SYSTEM, 1, tokenAccount(mintA, owner, 0n))]]);
    expect(balanceDiff(pre, post, owner, decimals).tokens).toEqual([]);
  });
});

describe('touchedMints', () => {
  it('lists each owner mint once, from either side, and nobody else’s', () => {
    const pre = new Map<string, AccountInfo<Buffer> | null>([
      [ataA, preInfo(TOKEN_PROGRAM_ID, 1, tokenAccount(mintA, owner, 1n))],
      [strangerAta, preInfo(TOKEN_PROGRAM_ID, 1, tokenAccount(mintB, stranger, 1n))],
      ['gone', null],
    ]);
    const post = new Map<string, PostAccount | null>([
      [ataA, postInfo(TOKEN, 1, tokenAccount(mintA, owner, 1n))],
      [ata2022, postInfo(TOKEN_2022, 1, tokenAccount(mintB, owner, 1n, [2]))],
    ]);
    expect(touchedMints(pre, post, owner)).toEqual([mintA.toBase58(), mintB.toBase58()]);
  });
});
