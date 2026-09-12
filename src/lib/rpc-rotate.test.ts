import { Connection, SolanaJSONRPCError } from '@solana/web3.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ADDRESS } from '../test/fixtures';
import {
  heliusRpcUrlFor,
  PUBLIC_DEVNET_RPCS,
  PUBLIC_MAINNET_RPCS,
  rpcUrlsFor,
} from '../config/constants';
import {
  classifyConnectionError,
  markRpcUnhealthy,
  prioritizeRpcUrls,
  readyConnection,
  resetRpcCooldowns,
  rpcJson,
  SKIP_HTTP_STATUSES,
  SKIP_RPC_CODES,
  withRotatedConnection,
} from './rpc-rotate';

/*
 * publicnode probe (SHIP-3 step 1), 2026-09-12, from this machine with
 * `curl --max-time 20 -X POST https://solana-rpc.publicnode.com` and
 * `Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop`:
 *
 *   getHealth               unreachable during implementation
 *   getBalance              unreachable during implementation
 *   getTokenAccountsByOwner unreachable during implementation
 *   getAssetsByOwner        unreachable during implementation
 *
 * Every attempt (three curl retries with --tlsv1.2 / --tlsv1.3, plus Node 24
 * fetch and `openssl s_client`) failed in the TLS handshake with
 * "wrong version number" / "tlsv1 alert protocol version" before any HTTP
 * exchange, while https://api.devnet.solana.com and https://api.github.com
 * answered 200 over the same network. The fixtures below therefore pin the
 * documented fallback: HTTP 403 and JSON-RPC -32601 / -32600 / -32000 are the
 * codes a blocked method must skip on. Re-run the probe and update this block
 * when the host is reachable.
 */
const BLOCKED_HTTP_STATUS = 403;
const BLOCKED_RPC_CODES = [-32601, -32600, -32000] as const;

const A = 'https://a.example';
const B = 'https://b.example';
const KEY = 'test-key';

afterEach(() => {
  resetRpcCooldowns();
  vi.unstubAllGlobals();
});

describe('rpcUrlsFor', () => {
  const custom = 'https://rpc.example/v1';

  it('pins the blocked-method fixtures to the skip lists', () => {
    expect(SKIP_HTTP_STATUSES).toContain(BLOCKED_HTTP_STATUS);
    for (const code of BLOCKED_RPC_CODES) expect(SKIP_RPC_CODES).toContain(code);
  });

  it('mainnet with no settings: publicnode first, then the Solana Foundation host', () => {
    expect(rpcUrlsFor('mainnet-beta')).toEqual([
      'https://solana-rpc.publicnode.com',
      'https://api.mainnet-beta.solana.com',
    ]);
    expect(rpcUrlsFor('mainnet-beta', {})).toEqual([...PUBLIC_MAINNET_RPCS]);
  });

  it('devnet with no settings: the public devnet host only', () => {
    expect(rpcUrlsFor('devnet')).toEqual(['https://api.devnet.solana.com']);
    expect(rpcUrlsFor('devnet', {})).toEqual([...PUBLIC_DEVNET_RPCS]);
  });

  it('custom URL only: custom first, then the public defaults', () => {
    expect(rpcUrlsFor('mainnet-beta', { rpcUrl: custom })).toEqual([custom, ...PUBLIC_MAINNET_RPCS]);
    expect(rpcUrlsFor('devnet', { rpcUrl: custom })).toEqual([custom, ...PUBLIC_DEVNET_RPCS]);
  });

  it('Helius key only: Helius for the cluster first, then the public defaults', () => {
    expect(rpcUrlsFor('mainnet-beta', { heliusApiKey: KEY })).toEqual([
      `https://mainnet.helius-rpc.com/?api-key=${KEY}`,
      ...PUBLIC_MAINNET_RPCS,
    ]);
    expect(rpcUrlsFor('devnet', { heliusApiKey: KEY })).toEqual([
      `https://devnet.helius-rpc.com/?api-key=${KEY}`,
      ...PUBLIC_DEVNET_RPCS,
    ]);
  });

  it('custom URL and Helius key: custom, Helius, public', () => {
    expect(rpcUrlsFor('mainnet-beta', { rpcUrl: custom, heliusApiKey: KEY })).toEqual([
      custom,
      heliusRpcUrlFor('mainnet-beta', KEY),
      ...PUBLIC_MAINNET_RPCS,
    ]);
    expect(rpcUrlsFor('devnet', { rpcUrl: custom, heliusApiKey: KEY })).toEqual([
      custom,
      heliusRpcUrlFor('devnet', KEY),
      ...PUBLIC_DEVNET_RPCS,
    ]);
  });

  it('treats empty strings and undefined as unset', () => {
    expect(rpcUrlsFor('mainnet-beta', { rpcUrl: '', heliusApiKey: '' })).toEqual([...PUBLIC_MAINNET_RPCS]);
    expect(rpcUrlsFor('mainnet-beta', { rpcUrl: undefined, heliusApiKey: undefined })).toEqual([
      ...PUBLIC_MAINNET_RPCS,
    ]);
    expect(heliusRpcUrlFor('mainnet-beta', '')).toBeUndefined();
    expect(heliusRpcUrlFor('mainnet-beta', undefined)).toBeUndefined();
  });

  it('removes duplicates, first occurrence wins', () => {
    expect(rpcUrlsFor('mainnet-beta', { rpcUrl: PUBLIC_MAINNET_RPCS[1] })).toEqual([
      PUBLIC_MAINNET_RPCS[1],
      PUBLIC_MAINNET_RPCS[0],
    ]);
    const helius = heliusRpcUrlFor('devnet', KEY)!;
    expect(rpcUrlsFor('devnet', { rpcUrl: helius, heliusApiKey: KEY })).toEqual([helius, ...PUBLIC_DEVNET_RPCS]);
  });

  it('is pure: the same input gives a fresh, equal array each time', () => {
    const first = rpcUrlsFor('mainnet-beta', { heliusApiKey: KEY });
    const second = rpcUrlsFor('mainnet-beta', { heliusApiKey: KEY });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe('prioritizeRpcUrls', () => {
  it('keeps cooled endpoints last', () => {
    markRpcUnhealthy(A, 1_000);
    expect(prioritizeRpcUrls([A, B], 1_001)).toEqual([B, A]);
  });

  it('uses the original order once the cooldown expires', () => {
    markRpcUnhealthy(A, 1_000);
    expect(prioritizeRpcUrls([A, B], 40_000)).toEqual([A, B]);
  });
});

function rpcResult(result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id: 'cinder', result });
}

function rpcError(code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: 'cinder', error: { code, message } });
}

/** Stub `fetch` with a per-URL responder; returns the list of URLs requested, in order. */
function stubFetch(respond: (url: string, body: { method: string }) => Response | Promise<Response>): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      return respond(url, JSON.parse(String(init?.body)) as { method: string });
    }),
  );
  return requested;
}

describe('rpcJson', () => {
  it('rotates to the next URL after 503 and cools the first one down', async () => {
    const requested = stubFetch((url) => (url === A ? new Response('nope', { status: 503 }) : rpcResult({ ok: true })));

    await expect(rpcJson<{ ok: boolean }>([A, B], 'getHealth', [])).resolves.toEqual({ ok: true });
    expect(requested).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([B, A]);
  });

  it('cools a URL down after 429', async () => {
    const requested = stubFetch((url) => (url === A ? new Response('slow down', { status: 429 }) : rpcResult('ok')));

    await expect(rpcJson([A, B], 'getHealth', [])).resolves.toBe('ok');
    expect(requested).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([B, A]);
  });

  it('cools a URL down when fetch itself rejects', async () => {
    const requested = stubFetch((url) => {
      if (url === A) throw new TypeError('Failed to fetch');
      return rpcResult('ok');
    });

    await expect(rpcJson([A, B], 'getHealth', [])).resolves.toBe('ok');
    expect(requested).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([B, A]);
  });

  it('does not rotate a 400', async () => {
    const requested = stubFetch(() => new Response('bad', { status: 400 }));

    await expect(rpcJson([A, B], 'getHealth', [])).rejects.toThrow('getHealth failed: 400');
    expect(requested).toEqual([A]);
  });

  it('skips a 403 for this call without cooling the URL down', async () => {
    const requested = stubFetch((url) =>
      url === A ? new Response('forbidden', { status: BLOCKED_HTTP_STATUS }) : rpcResult('ok'),
    );

    await expect(rpcJson([A, B], 'getBalance', [TEST_ADDRESS])).resolves.toBe('ok');
    expect(requested).toEqual([A, B]);
    // A is still healthy, so the next call starts at A again.
    expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
    await expect(rpcJson([A, B], 'getBalance', [TEST_ADDRESS])).resolves.toBe('ok');
    expect(requested).toEqual([A, B, A, B]);
  });

  it('skips a 401 the same way', async () => {
    const requested = stubFetch((url) => (url === A ? new Response('auth', { status: 401 }) : rpcResult('ok')));

    await expect(rpcJson([A, B], 'getHealth', [])).resolves.toBe('ok');
    expect(requested).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
  });

  it('-32601 on URL A leaves A healthy for the next call', async () => {
    const requested = stubFetch((url) => (url === A ? rpcError(-32601, 'Method not found') : rpcResult({ items: [] })));

    await expect(rpcJson([A, B], 'getAssetsByOwner', { ownerAddress: TEST_ADDRESS })).resolves.toEqual({ items: [] });
    expect(requested).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);

    await expect(rpcJson([A, B], 'getBalance', [TEST_ADDRESS])).resolves.toEqual({ items: [] });
    expect(requested).toEqual([A, B, A, B]);
  });

  for (const code of BLOCKED_RPC_CODES) {
    it(`skips JSON-RPC ${code} (blocked-method fixture) without cooldown`, async () => {
      const requested = stubFetch((url) => (url === A ? rpcError(code, 'blocked') : rpcResult('ok')));

      await expect(rpcJson([A, B], 'getTokenAccountsByOwner', [TEST_ADDRESS])).resolves.toBe('ok');
      expect(requested).toEqual([A, B]);
      expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
    });
  }

  it('throws at once on a JSON-RPC error that is not a blocked method', async () => {
    const requested = stubFetch(() => rpcError(-32602, 'Invalid params'));

    await expect(rpcJson([A, B], 'getBalance', [])).rejects.toThrow('Invalid params');
    expect(requested).toEqual([A]);
    expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
  });

  it('surfaces the last error when every URL is skipped', async () => {
    const requested = stubFetch(() => rpcError(-32601, 'Method not found'));

    await expect(rpcJson([A, B], 'getAssetsByOwner', {})).rejects.toThrow('Method not found');
    expect(requested).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
  });

  it('tries DAS on every URL in order, not only Helius', async () => {
    const helius = heliusRpcUrlFor('devnet', KEY)!;
    const requested = stubFetch((url) => (url === helius ? new Response('nope', { status: 503 }) : rpcResult({ items: [1] })));

    await expect(rpcJson([helius, ...PUBLIC_DEVNET_RPCS], 'getAssetsByOwner', {})).resolves.toEqual({ items: [1] });
    expect(requested).toEqual([helius, ...PUBLIC_DEVNET_RPCS]);
  });

  it('fails fast on an empty URL list', async () => {
    const requested = stubFetch(() => rpcResult('ok'));
    await expect(rpcJson([], 'getHealth', [])).rejects.toThrow('getHealth failed: no RPC endpoint');
    expect(requested).toEqual([]);
  });
});

describe('classifyConnectionError', () => {
  it('skips on a web3.js 403 / 401 message, wrapped or not', () => {
    expect(classifyConnectionError(new Error('403 Forbidden: <html>'))).toBe('skip');
    expect(classifyConnectionError(new Error('failed to get balance of account x: Error: 403 Forbidden: nope'))).toBe(
      'skip',
    );
    expect(classifyConnectionError(new Error('401 Unauthorized: key'))).toBe('skip');
  });

  it('skips on a SolanaJSONRPCError carrying a blocked-method code', () => {
    for (const code of BLOCKED_RPC_CODES) {
      expect(classifyConnectionError(new SolanaJSONRPCError({ code, message: 'blocked' }, 'failed'))).toBe('skip');
    }
    expect(classifyConnectionError(new Error('failed to get token accounts: Method not found'))).toBe('skip');
  });

  it('cools down on 429, 5xx, transport errors, and anything unreadable', () => {
    expect(classifyConnectionError(new Error('429 Too Many Requests: slow'))).toBe('cooldown');
    expect(classifyConnectionError(new Error('503 Service Unavailable: down'))).toBe('cooldown');
    expect(classifyConnectionError(new TypeError('Failed to fetch'))).toBe('cooldown');
    expect(classifyConnectionError(new SolanaJSONRPCError({ code: -32602, message: 'bad' }, 'x'))).toBe('cooldown');
    expect(classifyConnectionError('string error')).toBe('cooldown');
  });
});

describe('withRotatedConnection', () => {
  it('builds confirmed connections that do not retry on 429, in URL order', async () => {
    const seen: string[] = [];
    await withRotatedConnection([A, B], async (connection) => {
      seen.push(connection.rpcEndpoint);
      expect(connection.commitment).toBe('confirmed');
      return 1;
    });
    expect(seen).toEqual([A]);
  });

  it('skips a 403 without cooldown and returns the next URL’s result', async () => {
    const seen: string[] = [];
    const result = await withRotatedConnection([A, B], async (connection) => {
      seen.push(connection.rpcEndpoint);
      if (connection.rpcEndpoint === A) throw new Error('403 Forbidden: no');
      return 'from-b';
    });
    expect(result).toBe('from-b');
    expect(seen).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
  });

  it('cools down a URL that returns 503 so the next call starts elsewhere', async () => {
    const seen: string[] = [];
    await withRotatedConnection([A, B], async (connection) => {
      seen.push(connection.rpcEndpoint);
      if (connection.rpcEndpoint === A) throw new Error('503 Service Unavailable: down');
      return 'from-b';
    });
    expect(seen).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([B, A]);
  });

  it('rethrows the last error when every URL fails', async () => {
    await expect(
      withRotatedConnection([A, B], async (connection) => {
        throw new Error(`${connection.rpcEndpoint} is down`);
      }),
    ).rejects.toThrow(`${B} is down`);
  });
});

describe('readyConnection', () => {
  // web3.js binds `fetch` when it loads, so a stubbed global is not seen; spy on the method instead.
  it('probes getLatestBlockhash and skips a 403 host without cooling it down', async () => {
    const probed: string[] = [];
    const spy = vi.spyOn(Connection.prototype, 'getLatestBlockhash').mockImplementation(async function (
      this: Connection,
    ) {
      probed.push(this.rpcEndpoint);
      if (this.rpcEndpoint === A) throw new Error('failed to get recent blockhash: Error: 403 Forbidden: no');
      return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 2 };
    });
    try {
      const connection = await readyConnection([A, B]);
      expect(connection.rpcEndpoint).toBe(B);
      expect(probed).toEqual([A, B]);
      expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
    } finally {
      spy.mockRestore();
    }
  });

  it('cools down a host whose probe fails with 503', async () => {
    const spy = vi.spyOn(Connection.prototype, 'getLatestBlockhash').mockImplementation(async function (
      this: Connection,
    ) {
      if (this.rpcEndpoint === A) throw new Error('failed to get recent blockhash: Error: 503 Service Unavailable: x');
      return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 2 };
    });
    try {
      const connection = await readyConnection([A, B]);
      expect(connection.rpcEndpoint).toBe(B);
      expect(prioritizeRpcUrls([A, B])).toEqual([B, A]);
    } finally {
      spy.mockRestore();
    }
  });
});
