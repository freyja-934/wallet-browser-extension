/**
 * Preconditions the test process reads from devnet itself, and the one message
 * they fail with. A rate limit, a DNS failure or an RPC error here says nothing
 * about the wallet, so it must never surface as a product assertion failing:
 * every such read is wrapped and reported as `devnet unreachable: <error>`.
 */

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
