import type { AccountInfo, PublicKey } from '@solana/web3.js';
import { ACCOUNT_SIZE, AccountLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

/** An account as the simulation reports it afterwards (`null`: it does not exist then). */
export interface PostAccount {
  owner: string;
  lamports: number;
  data: Buffer;
}

export interface TokenDelta {
  mint: string;
  pre: bigint;
  post: bigint;
  /** From the mint; `null` when the mint could not be read, in which case the amounts are base units. */
  decimals: number | null;
  /** The token program that owns the account: Token or Token-2022. */
  programId: string;
}

export interface BalanceDiff {
  sol: { pre: bigint; post: bigint };
  /** One row per mint whose balance for `owner` changed, in first-seen order. */
  tokens: TokenDelta[];
}

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
/** Token-2022 accounts longer than the base layout carry an account-type byte: 2 is a token account (1 a mint). */
const ACCOUNT_TYPE_ACCOUNT = 2;

interface TokenHolding {
  mint: string;
  owner: string;
  amount: bigint;
  programId: string;
}

/**
 * Decode a token account owned by either token program. Anything else — a
 * mint, a program, a plain wallet, a Token-2022 mint with extensions — is `null`.
 */
export function decodeTokenAccount(programId: string, data: Uint8Array): TokenHolding | null {
  if (!TOKEN_PROGRAMS.has(programId) || data.length < ACCOUNT_SIZE) return null;
  if (data.length > ACCOUNT_SIZE && data[ACCOUNT_SIZE] !== ACCOUNT_TYPE_ACCOUNT) return null;
  try {
    const raw = AccountLayout.decode(data.subarray(0, ACCOUNT_SIZE));
    return { mint: raw.mint.toBase58(), owner: raw.owner.toBase58(), amount: raw.amount, programId };
  } catch {
    return null;
  }
}

/**
 * Pure: the owner's SOL and token balances before and after, from the accounts
 * read before the simulation and the accounts the simulation returned. An
 * address in `post` mapped to `null` no longer exists afterwards (a closed token
 * account counts as 0); an address absent from `post` was not simulated and is
 * taken as unchanged. Token accounts are grouped by mint for `account.owner === owner`.
 */
export function balanceDiff(
  pre: Map<string, AccountInfo<Buffer> | null>,
  post: Map<string, PostAccount | null>,
  owner: PublicKey,
  decimalsByMint: Map<string, number>,
): BalanceDiff {
  const ownerKey = owner.toBase58();

  const solPre = BigInt(pre.get(ownerKey)?.lamports ?? 0);
  const solPost = post.has(ownerKey) ? BigInt(post.get(ownerKey)?.lamports ?? 0) : solPre;

  const byMint = new Map<string, TokenDelta>();
  const bump = (holding: TokenHolding, side: 'pre' | 'post') => {
    if (holding.owner !== ownerKey) return;
    const row = byMint.get(holding.mint) ?? {
      mint: holding.mint,
      pre: 0n,
      post: 0n,
      decimals: decimalsByMint.get(holding.mint) ?? null,
      programId: holding.programId,
    };
    row[side] += holding.amount;
    byMint.set(holding.mint, row);
  };

  const addresses = new Set([...pre.keys(), ...post.keys()]);
  for (const address of addresses) {
    const before = pre.get(address);
    const beforeHolding = before ? decodeTokenAccount(before.owner.toBase58(), before.data) : null;
    if (beforeHolding) bump(beforeHolding, 'pre');

    if (post.has(address)) {
      const after = post.get(address);
      const afterHolding = after ? decodeTokenAccount(after.owner, after.data) : null;
      if (afterHolding) bump(afterHolding, 'post');
    } else if (beforeHolding) {
      // Not simulated: the balance stands.
      bump(beforeHolding, 'post');
    }
  }

  return {
    sol: { pre: solPre, post: solPost },
    tokens: [...byMint.values()].filter((row) => row.pre !== row.post),
  };
}

/** The mints of every token account in `pre` and `post` that belongs to `owner`, for the decimals lookup. */
export function touchedMints(
  pre: Map<string, AccountInfo<Buffer> | null>,
  post: Map<string, PostAccount | null>,
  owner: PublicKey,
): string[] {
  const ownerKey = owner.toBase58();
  const mints = new Set<string>();
  for (const info of pre.values()) {
    const holding = info ? decodeTokenAccount(info.owner.toBase58(), info.data) : null;
    if (holding?.owner === ownerKey) mints.add(holding.mint);
  }
  for (const info of post.values()) {
    const holding = info ? decodeTokenAccount(info.owner, info.data) : null;
    if (holding?.owner === ownerKey) mints.add(holding.mint);
  }
  return [...mints];
}
