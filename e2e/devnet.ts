/**
 * Preconditions the test process reads from devnet itself, and the one message
 * they fail with. A rate limit, a DNS failure or an RPC error here says nothing
 * about the wallet, so it must never surface as a product assertion failing:
 * every such read is wrapped and reported as `devnet unreachable: <error>`.
 */

import { test } from './fixtures';
import { TEST_ADDRESS } from './popup';

/** Devnet is the cluster the e2e build talks to (`VITE_NETWORK=devnet`). */
export const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

/**
 * How long a wait that depends on a devnet round trip gets. Deliberately
 * generous: the assertion still has to pass, it is only allowed to take the
 * time a slow cluster needs, so a busy devnet reads as slow rather than broken.
 */
export const CHAIN_TIMEOUT_MS = 45_000;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fail the test as an environment failure, never as a product failure. */
export function devnetUnreachable(error: unknown): Error {
  return new Error(`devnet unreachable: ${reason(error)}`);
}

/**
 * Run a precondition read against devnet (a balance, a rent minimum, anything
 * the test needs before it can assert). Whatever it throws comes back as
 * `devnet unreachable: <error>`.
 */
export async function devnetPrecondition<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw devnetUnreachable(`${what}: ${reason(error)}`);
  }
}

/** One JSON-RPC call to devnet as a precondition; an HTTP or RPC error fails the test the same way. */
export async function devnetRpc<T>(method: string, params: unknown[]): Promise<T> {
  return devnetPrecondition(method, async () => {
    const response = await fetch(DEVNET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`answered HTTP ${response.status}`);
    const json = (await response.json()) as { result?: T; error?: { code?: number; message?: string } };
    if (json.error) throw new Error(json.error.message ?? `RPC error ${json.error.code}`);
    if (json.result === undefined) throw new Error('answered with no result');
    return json.result;
  });
}

/**
 * The public fixture's devnet balance, read once per test process. It is a
 * shared address anyone can derive, and bots sweep it to zero, so it is empty
 * as often as not — which is a fact about the faucet, never about the wallet.
 */
let balanceRead: Promise<bigint> | null = null;

export function fixtureBalance(): Promise<bigint> {
  balanceRead ??= devnetRpc<{ value: number }>('getBalance', [TEST_ADDRESS])
    .then((answer) => BigInt(answer.value))
    .catch((error: unknown) => {
      // A failed read is not an answer: the next test asks again rather than
      // inheriting one cluster hiccup as "unfunded".
      balanceRead = null;
      throw error;
    });
  return balanceRead;
}

/** What a bare system account must hold to exist at all, read once per test process. */
let rentRead: Promise<bigint> | null = null;

export function rentExemptMinimum(): Promise<bigint> {
  rentRead ??= devnetRpc<number>('getMinimumBalanceForRentExemption', [0])
    .then((lamports) => BigInt(lamports))
    .catch((error: unknown) => {
      rentRead = null;
      throw error;
    });
  return rentRead;
}

/** `5000n` → `0.000005`: lamports as SOL, without trailing-zero noise. */
function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/**
 * Skip — never soften — a test the fixture cannot pay for. The same principle
 * as `devnetUnreachable`: an empty shared faucet address says nothing about the
 * product, so it must not read as a product assertion failing. Every assertion
 * stays exactly as strict as it was, and the whole test runs whenever the
 * wallet is funded.
 *
 * `needs` is the least the address must hold for the test to mean anything, and
 * `what` names that in words, so the skip line says what to top up and why.
 */
export async function skipUnlessFixtureHolds(needs: bigint, what: string): Promise<void> {
  const balance = await fixtureBalance();
  if (balance >= needs) return;
  const reason =
    `devnet fixture ${TEST_ADDRESS} holds ${formatSol(balance)} SOL; ${what} needs ${formatSol(needs)} SOL ` +
    `(short ${formatSol(needs - balance)} SOL). Top it up at https://faucet.solana.com, then re-run. ` +
    'An empty fixture is a faucet fact, not a wallet bug.';
  // The default `list` reporter shows a skip as a bare dash and keeps the reason in
  // the report only. Print it too: a run that quietly skips six tests has to say why
  // where the person watching it will actually read it.
  console.log(`SKIP: ${reason}`);
  test.skip(true, reason);
}
