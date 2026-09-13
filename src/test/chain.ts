/**
 * The chain boundary for component tests: the two `Connection` calls
 * `heliusService.getTokenBalances` makes. Everything above them — the endpoint
 * rotation, the failure classification, `walletService`, React Query — is the
 * real thing, so a test that breaks one endpoint exercises the code that
 * decides whether the screen says "unavailable" or "no endpoint reachable".
 *
 * Not a test file itself: `test.include` only collects `*.test.{ts,tsx}`.
 */

import { Connection, PublicKey, type ParsedAccountData } from '@solana/web3.js';
import { vi } from 'vitest';

type ParsedTokenAccounts = Awaited<ReturnType<Connection['getParsedTokenAccountsByOwner']>>;

/** One SPL token account as `getParsedTokenAccountsByOwner` returns it. */
export interface TokenAccountRow {
  mint: string;
  tokenAccount: string;
  /** Integer smallest units, as the RPC sends them. */
  amount: string;
  decimals: number;
  program?: 'spl-token' | 'spl-token-2022';
}

export function tokenAccounts(rows: TokenAccountRow[]): ParsedTokenAccounts {
  return {
    context: { slot: 1 },
    value: rows.map((row) => ({
      pubkey: new PublicKey(row.tokenAccount),
      account: {
        executable: false,
        owner: new PublicKey(row.tokenAccount),
        lamports: 2_039_280,
        data: {
          program: row.program ?? 'spl-token',
          space: 165,
          parsed: {
            type: 'account',
            info: { mint: row.mint, tokenAmount: { amount: row.amount, decimals: row.decimals, uiAmount: 0 } },
          },
        } as unknown as ParsedAccountData,
      },
    })),
  } as unknown as ParsedTokenAccounts;
}

export const noTokenAccounts = (): ParsedTokenAccounts => tokenAccounts([]);

/**
 * Answer the SOL balance and the token-account calls. `balance` is what
 * `Connection.getBalance` does at every URL — resolve lamports, reject, or
 * never settle; `tokens` the same for `getParsedTokenAccountsByOwner`.
 */
export function stubChain(options: {
  balance: () => Promise<number>;
  tokens?: () => Promise<ParsedTokenAccounts>;
}): void {
  vi.spyOn(Connection.prototype, 'getBalance').mockImplementation(options.balance);
  vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockImplementation(
    options.tokens ?? (async () => noTokenAccounts()),
  );
}

/** A promise that never settles: what a query looks like while it is still in flight. */
export const pending = <T>(): Promise<T> => new Promise<T>(() => {});

/** web3.js wraps a `getBalance` failure as `failed to get balance of account X: <cause>`. */
export function balanceError(address: string, cause: string): Error {
  return new Error(`failed to get balance of account ${address}: ${cause}`);
}
