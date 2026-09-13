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
  classifyJsonRpcError,
  connectionErrorHttpStatus,
  isTransportError,
  isUnreachableFailure,
  markRpcUnhealthy,
  prioritizeRpcUrls,
  readyConnection,
  resetRpcCooldowns,
  rpcJson,
  withRotatedConnection,
  type RpcFailure,
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
 * The host is unreachable from this network: the ISP's security filter answers a
 * raw socket to :443 with a plain-HTTP 302 to a warning page, so every TLS
 * handshake fails before any HTTP exchange, while https://api.devnet.solana.com
 * answered 200 over the same network. The skip and cooldown codes below are
 * therefore taken from web3.js's `SolanaJSONRPCErrorCode` (method-not-found and
 * the two "not served by this node" codes skip; the node-health codes cool down)
 * plus a message heuristic for providers that use their own codes. Verification
 * against publicnode from another network is pending; re-run the probe and update
 * this block when the host is reachable.
 */
const BLOCKED_HTTP_STATUS = 403;
/** -32601 method not found, -32010 key excluded from secondary index, -32011 history not available. */
const BLOCKED_RPC_CODES = [-32601, -32010, -32011] as const;
/** -32004 block not available, -32005 node unhealthy, -32007 slot skipped, ... */
const UNHEALTHY_RPC_CODES = [-32004, -32005, -32007, -32009, -32014, -32016] as const;
/** Invalid params, preflight failure, signature verification: every endpoint would say the same. */
const CALLER_RPC_CODES = [-32602, -32002, -32003] as const;

const A = 'https://a.example';
const B = 'https://b.example';
const KEY = 'test-key';

afterEach(() => {
  resetRpcCooldowns();
  vi.unstubAllGlobals();
});

describe('rpcUrlsFor', () => {
  const custom = 'https://rpc.example/v1';

  it('mainnet with no settings: publicnode and nothing else', () => {
    expect(rpcUrlsFor('mainnet-beta')).toEqual(['https://solana-rpc.publicnode.com']);
    expect(rpcUrlsFor('mainnet-beta', {})).toEqual([...PUBLIC_MAINNET_RPCS]);
  });

  // `api.mainnet-beta.solana.com` answers 403 to any request with an `Origin` header, which
  // every extension request has. It is not in the rotation and not in the manifest: keeping it
  // would only spend a rotation step on a host that cannot answer from here.
  it('never lists the Solana Foundation mainnet host, which 403s every browser origin', () => {
    const everywhere = [
      rpcUrlsFor('mainnet-beta'),
      rpcUrlsFor('mainnet-beta', { rpcUrl: custom, heliusApiKey: KEY }),
      rpcUrlsFor('devnet', { rpcUrl: custom, heliusApiKey: KEY }),
    ].flat();
    expect(everywhere.some((url) => url.includes('api.mainnet-beta.solana.com'))).toBe(false);
    expect(PUBLIC_MAINNET_RPCS).toHaveLength(1);
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
    // The custom URL is the public default: it keeps the first slot and is not repeated last.
    expect(rpcUrlsFor('mainnet-beta', { rpcUrl: PUBLIC_MAINNET_RPCS[0], heliusApiKey: KEY })).toEqual([
      PUBLIC_MAINNET_RPCS[0],
      heliusRpcUrlFor('mainnet-beta', KEY),
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

  it('treats a trailing slash as the same endpoint when removing duplicates', () => {
    const withSlash = `${PUBLIC_MAINNET_RPCS[0]}/`;
    expect(rpcUrlsFor('mainnet-beta', { rpcUrl: withSlash })).toEqual([withSlash]);
    expect(rpcUrlsFor('devnet', { rpcUrl: 'https://API.devnet.solana.com' })).toEqual(['https://API.devnet.solana.com']);
    // Different paths are different endpoints.
    expect(rpcUrlsFor('devnet', { rpcUrl: `${PUBLIC_DEVNET_RPCS[0]}/v1` })).toEqual([
      `${PUBLIC_DEVNET_RPCS[0]}/v1`,
      ...PUBLIC_DEVNET_RPCS,
    ]);
  });

  it('leaves out a custom URL bound to the other cluster, keeps one bound to this cluster', () => {
    const bound = { rpcUrl: custom, rpcUrlCluster: 'devnet' as const, heliusApiKey: KEY };
    expect(rpcUrlsFor('mainnet-beta', bound)).toEqual([heliusRpcUrlFor('mainnet-beta', KEY), ...PUBLIC_MAINNET_RPCS]);
    expect(rpcUrlsFor('devnet', bound)).toEqual([custom, heliusRpcUrlFor('devnet', KEY), ...PUBLIC_DEVNET_RPCS]);
  });

  it('uses a legacy custom URL without a cluster tag on either cluster', () => {
    expect(rpcUrlsFor('mainnet-beta', { rpcUrl: custom })[0]).toBe(custom);
    expect(rpcUrlsFor('devnet', { rpcUrl: custom })[0]).toBe(custom);
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
    // A serves getBalance but not DAS; B serves both.
    const requested = stubFetch((url, { method }) => {
      if (method === 'getAssetsByOwner') return url === A ? rpcError(-32601, 'Method not found') : rpcResult({ items: [] });
      if (method === 'getBalance') return rpcResult(url === A ? 5_000 : 7_000);
      return rpcError(-32601, 'Method not found');
    });

    await expect(rpcJson([A, B], 'getAssetsByOwner', { ownerAddress: TEST_ADDRESS })).resolves.toEqual({ items: [] });
    expect(requested).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);

    // Still healthy, so the next call starts at A and gets A's answer.
    await expect(rpcJson<number>([A, B], 'getBalance', [TEST_ADDRESS])).resolves.toBe(5_000);
    expect(requested).toEqual([A, B, A]);
  });

  for (const code of BLOCKED_RPC_CODES) {
    it(`skips JSON-RPC ${code} (refused method) without cooldown`, async () => {
      const requested = stubFetch((url) => (url === A ? rpcError(code, 'nope') : rpcResult('ok')));

      await expect(rpcJson([A, B], 'getTokenAccountsByOwner', [TEST_ADDRESS])).resolves.toBe('ok');
      expect(requested).toEqual([A, B]);
      expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
    });
  }

  for (const code of UNHEALTHY_RPC_CODES) {
    it(`cools a URL down on JSON-RPC ${code} (node health) and moves on`, async () => {
      const requested = stubFetch((url) => (url === A ? rpcError(code, 'unwell') : rpcResult('ok')));

      await expect(rpcJson([A, B], 'getBalance', [TEST_ADDRESS])).resolves.toBe('ok');
      expect(requested).toEqual([A, B]);
      expect(prioritizeRpcUrls([A, B])).toEqual([B, A]);
    });
  }

  for (const code of CALLER_RPC_CODES) {
    it(`throws at once on JSON-RPC ${code} without cooldown or rotation`, async () => {
      const requested = stubFetch(() => rpcError(code, 'caller problem'));

      await expect(rpcJson([A, B], 'getBalance', [])).rejects.toThrow('caller problem');
      expect(requested).toEqual([A]);
      expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
    });
  }

  it('skips a provider-specific code when the message says the method is blocked', async () => {
    const messages = [
      'Method not available on this plan',
      'getTokenAccountsByOwner is disabled on the public endpoint',
      'API key required',
      'Rate limit exceeded for this method',
      'Account excluded from secondary index; not indexed',
      'Personal token required',
    ];
    for (const message of messages) {
      resetRpcCooldowns();
      const requested = stubFetch((url) => (url === A ? rpcError(-32000, message) : rpcResult('ok')));
      await expect(rpcJson([A, B], 'getTokenAccountsByOwner', [TEST_ADDRESS])).resolves.toBe('ok');
      expect(requested).toEqual([A, B]);
      expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
    }
  });

  it('no longer skips -32600 / -32000 on the code alone', async () => {
    for (const code of [-32600, -32000]) {
      const requested = stubFetch(() => rpcError(code, 'something else went wrong'));
      await expect(rpcJson([A, B], 'getBalance', [])).rejects.toThrow('something else went wrong');
      expect(requested).toEqual([A]);
      expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
    }
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

describe('classifyJsonRpcError', () => {
  it('follows the code lists, then the message, then throws', () => {
    for (const code of BLOCKED_RPC_CODES) expect(classifyJsonRpcError(code, 'x')).toBe('skip');
    for (const code of UNHEALTHY_RPC_CODES) expect(classifyJsonRpcError(code, 'x')).toBe('cooldown');
    for (const code of CALLER_RPC_CODES) expect(classifyJsonRpcError(code, 'x')).toBe('throw');
    expect(classifyJsonRpcError(-32000, 'Method not supported')).toBe('skip');
    expect(classifyJsonRpcError(-32000, 'Node is unhealthy')).toBe('cooldown');
    expect(classifyJsonRpcError(-32000, 'Transaction simulation failed')).toBe('throw');
    expect(classifyJsonRpcError(undefined, 'forbidden')).toBe('skip');
    expect(classifyJsonRpcError('E_WEIRD', 'nothing useful')).toBe('throw');
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

  it("skips when Chrome's HTTP/2 fetch leaves the reason phrase empty", () => {
    expect(classifyConnectionError(new Error('403 : {"jsonrpc":"2.0","error":{"code":-32600}}'))).toBe('skip');
    expect(
      classifyConnectionError(new Error(`failed to get balance of account ${TEST_ADDRESS}: Error: 401 : {}`)),
    ).toBe('skip');
    expect(classifyConnectionError(new Error('failed to get recent blockhash: Error: 503 : down'))).toBe('cooldown');
  });

  it('follows the JSON-RPC verdicts on a SolanaJSONRPCError', () => {
    for (const code of BLOCKED_RPC_CODES) {
      expect(classifyConnectionError(new SolanaJSONRPCError({ code, message: 'nope' }, 'failed'))).toBe('skip');
    }
    for (const code of UNHEALTHY_RPC_CODES) {
      expect(classifyConnectionError(new SolanaJSONRPCError({ code, message: 'unwell' }, 'failed'))).toBe('cooldown');
    }
    for (const code of CALLER_RPC_CODES) {
      expect(classifyConnectionError(new SolanaJSONRPCError({ code, message: 'bad' }, 'failed'))).toBe('throw');
    }
    expect(classifyConnectionError(new Error('failed to get token accounts: Method not found'))).toBe('skip');
    // getBalance wraps the JSON-RPC error in a plain Error and drops the code; the message still decides.
    expect(classifyConnectionError(new Error('failed to get balance of account x: Error: Node is unhealthy'))).toBe(
      'cooldown',
    );
  });

  it('cools down on 429, 5xx, transport errors, and anything unreadable', () => {
    expect(classifyConnectionError(new Error('429 Too Many Requests: slow'))).toBe('cooldown');
    expect(classifyConnectionError(new Error('503 Service Unavailable: down'))).toBe('cooldown');
    expect(classifyConnectionError(new TypeError('Failed to fetch'))).toBe('cooldown');
    expect(classifyConnectionError(new DOMException('The operation timed out', 'TimeoutError'))).toBe('cooldown');
    expect(classifyConnectionError('string error')).toBe('cooldown');
  });

  it('throws on a TypeError that is not a transport failure: our bug would recur on every endpoint', () => {
    expect(classifyConnectionError(new TypeError("Cannot read properties of undefined (reading 'value')"))).toBe('throw');
  });

  it('throws on an HTTP status that is neither auth nor endpoint trouble', () => {
    expect(classifyConnectionError(new Error('400 Bad Request: nope'))).toBe('throw');
    expect(classifyConnectionError(new Error('failed to get balance of account x: Error: 404 : {}'))).toBe('throw');
  });
});

describe('failure shape helpers', () => {
  const web3Wrapped = new Error(`failed to get balance of account ${TEST_ADDRESS}: TypeError: Failed to fetch`);
  const bug = new TypeError("Cannot read properties of undefined (reading 'value')");
  const table: Array<[label: string, error: unknown, status: number | undefined, transport: boolean, unreachable: boolean]> = [
    ["TypeError 'Failed to fetch'", new TypeError('Failed to fetch'), undefined, true, true],
    ['AbortError', new DOMException('The user aborted a request.', 'AbortError'), undefined, true, true],
    ['web3 getBalance wrapping a fetch failure', web3Wrapped, undefined, true, true],
    ["TypeError 'Cannot read properties of undefined'", bug, undefined, false, false],
    ['403', new Error('403 Forbidden: nope'), 403, false, true],
    ['503', new Error('failed to get balance of account x: Error: 503 : down'), 503, false, false],
    ['plain Error', new Error('something else'), undefined, false, false],
  ];

  it.each(table)('%s', (_label, error, status, transport, unreachable) => {
    expect(connectionErrorHttpStatus(error)).toBe(status);
    expect(isTransportError(error)).toBe(transport);
    expect(isUnreachableFailure(error)).toBe(unreachable);
  });
});

describe('withRotatedConnection', () => {
  it('reports every failure to the observer in order, the throw verdict included', async () => {
    const seen: RpcFailure[] = [];
    const bug = new TypeError("Cannot read properties of undefined (reading 'value')");
    await expect(
      withRotatedConnection(
        [A, B],
        async (connection) => {
          if (connection.rpcEndpoint === A) throw new Error('503 Service Unavailable: down');
          throw bug;
        },
        (failure) => seen.push(failure),
      ),
    ).rejects.toBe(bug);
    expect(seen.map(({ url, verdict }) => ({ url, verdict }))).toEqual([
      { url: A, verdict: 'cooldown' },
      { url: B, verdict: 'throw' },
    ]);
    expect(seen[1].error).toBe(bug);
    // The bug threw at once: B was not cooled down, only A was.
    expect(prioritizeRpcUrls([A, B])).toEqual([B, A]);
  });


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

  it('rethrows a caller error at once: no cooldown, no second URL', async () => {
    const seen: string[] = [];
    await expect(
      withRotatedConnection([A, B], async (connection) => {
        seen.push(connection.rpcEndpoint);
        throw new SolanaJSONRPCError({ code: -32602, message: 'Invalid params' }, 'failed to get balance');
      }),
    ).rejects.toThrow('Invalid params');
    expect(seen).toEqual([A]);
    expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
  });

  it('cools down a node-health code and moves on', async () => {
    const seen: string[] = [];
    const result = await withRotatedConnection([A, B], async (connection) => {
      seen.push(connection.rpcEndpoint);
      if (connection.rpcEndpoint === A) {
        throw new SolanaJSONRPCError({ code: -32005, message: 'Node is unhealthy' }, 'failed to get balance');
      }
      return 'from-b';
    });
    expect(result).toBe('from-b');
    expect(seen).toEqual([A, B]);
    expect(prioritizeRpcUrls([A, B])).toEqual([B, A]);
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

  it('rethrows a caller error from the first host without probing the second', async () => {
    const probed: string[] = [];
    const spy = vi.spyOn(Connection.prototype, 'getLatestBlockhash').mockImplementation(async function (
      this: Connection,
    ) {
      probed.push(this.rpcEndpoint);
      throw new SolanaJSONRPCError({ code: -32602, message: 'Invalid params' }, 'failed to get recent blockhash');
    });
    try {
      await expect(readyConnection([A, B])).rejects.toThrow('Invalid params');
      expect(probed).toEqual([A]);
      expect(prioritizeRpcUrls([A, B])).toEqual([A, B]);
    } finally {
      spy.mockRestore();
    }
  });
});
