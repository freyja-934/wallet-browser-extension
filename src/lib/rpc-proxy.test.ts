import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRpc, readLimited, type RpcProxyEnv } from '../../workers/rpc/src/handle';
import { ALLOWED_METHODS, MAX_MULTIPLE_ACCOUNTS } from '../../workers/rpc/src/policy';

const ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const KEY = 'test-helius-key';

function env(limit: RpcProxyEnv['RPC_RATE_LIMIT']['limit'] = async () => ({ success: true })): RpcProxyEnv {
  return { HELIUS_API_KEY: KEY, RPC_RATE_LIMIT: { limit } };
}

function post(body: unknown, ip = '203.0.113.5'): Request {
  return new Request('https://cinder-rpc.freyja-934.workers.dev/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

function upstreamOk(result: unknown): typeof fetch {
  return vi.fn(async () => Response.json({ jsonrpc: '2.0', id: 'cinder', result })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleRpc', () => {
  it('answers a CORS preflight and does not call upstream', async () => {
    const fetchImpl = upstreamOk('ok');
    const response = await handleRpc(
      new Request('https://cinder-rpc.freyja-934.workers.dev/', { method: 'OPTIONS' }),
      env(),
      fetchImpl,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards getBalance and getTokenAccountsByOwner, and logs only the status', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line) => {
      logs.push(String(line));
    });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const raw = init?.body;
      const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw);
      const sent = JSON.parse(text) as { method: string };
      const result = sent.method === 'getBalance' ? { value: 1 } : { value: [] };
      return Response.json({ jsonrpc: '2.0', id: 'cinder', result });
    }) as unknown as typeof fetch;

    for (const method of ['getBalance', 'getTokenAccountsByOwner'] as const) {
      const response = await handleRpc(
        post({ jsonrpc: '2.0', id: 'cinder', method, params: [ADDRESS] }),
        env(),
        fetchImpl,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://mainnet.helius-rpc.com/?api-key=${KEY}`);
    const forwarded = init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : String(init.body);
    expect(JSON.parse(forwarded).method).toBe('getBalance');
    const logged = logs.map((line) => JSON.parse(line) as { status: number });
    expect(logged).toEqual([{ status: 200 }, { status: 200 }]);
    expect(logs.join('')).not.toContain(ADDRESS);
    expect(logs.join('')).not.toContain(KEY);
  });

  it('rejects getProgramAccounts without calling upstream', async () => {
    const fetchImpl = upstreamOk('nope');
    const response = await handleRpc(
      post({ jsonrpc: '2.0', id: 'cinder', method: 'getProgramAccounts', params: [ADDRESS] }),
      env(),
      fetchImpl,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'cinder',
      error: { code: -32601, message: 'Method not allowed' },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a getMultipleAccounts batch over the cap', async () => {
    const fetchImpl = upstreamOk([]);
    const keys = Array.from({ length: MAX_MULTIPLE_ACCOUNTS + 1 }, () => ADDRESS);
    const response = await handleRpc(
      post({ jsonrpc: '2.0', id: 7, method: 'getMultipleAccounts', params: [keys] }),
      env(),
      fetchImpl,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ error: { code: -32602 } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a JSON-RPC batch', async () => {
    const fetchImpl = upstreamOk('ok');
    const response = await handleRpc(
      post([{ jsonrpc: '2.0', id: 1, method: 'getHealth' }]),
      env(),
      fetchImpl,
    );
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 429 and does not call upstream when the rate limit says no', async () => {
    const fetchImpl = upstreamOk('ok');
    const response = await handleRpc(
      post({ jsonrpc: '2.0', id: 'cinder', method: 'getHealth', params: [] }),
      env(async () => ({ success: false })),
      fetchImpl,
    );
    expect(response.status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rate-limits on the connecting IP', async () => {
    const keys: string[] = [];
    await handleRpc(
      post({ jsonrpc: '2.0', id: 'cinder', method: 'getHealth', params: [] }, '198.51.100.9'),
      env(async ({ key }) => {
        keys.push(key);
        return { success: true };
      }),
      upstreamOk('ok'),
    );
    expect(keys).toEqual(['198.51.100.9']);
  });

  it('rests the proxy when the upstream key is rejected, and does not forward that body', async () => {
    const fetchImpl = vi.fn(async () => new Response('api-key rejected', { status: 401 })) as unknown as typeof fetch;
    const response = await handleRpc(
      post({ jsonrpc: '2.0', id: 'cinder', method: 'getBalance', params: [ADDRESS] }),
      env(),
      fetchImpl,
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('api-key');
  });

  it('refuses a body over the cap before calling upstream', async () => {
    const fetchImpl = upstreamOk('ok');
    const request = new Request('https://cinder-rpc.freyja-934.workers.dev/', {
      method: 'POST',
      body: 'x'.repeat(64 * 1024 + 1),
    });
    const response = await handleRpc(request, env(), fetchImpl);
    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call upstream when the secret is missing', async () => {
    const fetchImpl = upstreamOk('ok');
    const response = await handleRpc(
      post({ jsonrpc: '2.0', id: 'cinder', method: 'getBalance', params: [ADDRESS] }),
      { ...env(), HELIUS_API_KEY: '' },
      fetchImpl,
    );
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('the allowlist', () => {
  it('covers the wallet methods and not the index scans', () => {
    expect(ALLOWED_METHODS.has('getBalance')).toBe(true);
    expect(ALLOWED_METHODS.has('getTokenAccountsByOwner')).toBe(true);
    expect(ALLOWED_METHODS.has('getAssetsByOwner')).toBe(true);
    expect(ALLOWED_METHODS.has('sendTransaction')).toBe(true);
    expect(ALLOWED_METHODS.has('getProgramAccounts')).toBe(false);
    expect(ALLOWED_METHODS.has('getTokenAccountsByDelegate')).toBe(false);
  });
});

describe('readLimited', () => {
  it('returns empty when there is no body', async () => {
    const request = new Request('https://cinder-rpc.example/', { method: 'POST' });
    expect(await readLimited(request)).toBe('empty');
  });
});
