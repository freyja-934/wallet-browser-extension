import { Connection, PublicKey, SolanaJSONRPCError } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRpcCooldowns } from '../lib/rpc-rotate';
import { TEST_ADDRESS } from '../test/fixtures';

const A = 'https://a.example';
const B = 'https://b.example';

// Two endpoints and mutable settings; every service call reads these at call time.
const runtime = vi.hoisted(() => ({
  settings: {
    autoLockTimeout: 15,
    preferredCurrency: 'USD',
    theme: 'system' as const,
    hideSmallBalances: false,
    smallBalanceThreshold: 1,
    cluster: 'mainnet-beta' as 'mainnet-beta' | 'devnet',
    heliusApiKey: undefined as string | undefined,
  },
}));

vi.mock('../lib/runtime-rpc', () => ({
  runtimeSettings: async () => ({ ...runtime.settings }),
  runtimeCluster: async () => runtime.settings.cluster,
  runtimeRpcUrls: async () => ['https://a.example', 'https://b.example'],
}));

import { heliusService } from './helius';

const MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_ACCOUNT = '7QGBDz9pC7uXxRnZp1r5BLpiXMhr9oFqTDvyMGAxAiBH';

function rpcError(code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: 'cinder', error: { code, message } });
}

/** Stub `fetch` (used by `rpcJson` and the enhanced-history path); returns the URLs requested, in order. */
function stubFetch(respond: (url: string, body: { method?: string }) => Response): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as { method?: string }) : {};
      return respond(url, body);
    }),
  );
  return requested;
}

function oneTokenAccount() {
  return {
    context: { slot: 1 },
    value: [
      {
        pubkey: new PublicKey(TOKEN_ACCOUNT),
        account: {
          executable: false,
          owner: new PublicKey(TEST_ADDRESS),
          lamports: 2_039_280,
          data: {
            program: 'spl-token',
            space: 165,
            parsed: { type: 'account', info: { mint: MINT, tokenAmount: { amount: '10', decimals: 6, uiAmount: 0.00001 } } },
          },
        },
      },
    ],
  } as unknown as Awaited<ReturnType<Connection['getParsedTokenAccountsByOwner']>>;
}

beforeEach(() => {
  runtime.settings.cluster = 'mainnet-beta';
  runtime.settings.heliusApiKey = undefined;
});

afterEach(() => {
  resetRpcCooldowns();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('heliusService.getTokenBalances', () => {
  it('returns the SOL balance when every endpoint refuses the token-account call', async () => {
    const tokenCalls: string[] = [];
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockImplementation(async function (
      this: Connection,
    ) {
      tokenCalls.push(this.rpcEndpoint);
      // A: Chrome's HTTP/2 shape with no reason phrase. B: the method is not served.
      if (this.rpcEndpoint === A) throw new Error(`failed to get token accounts owned by account ${TEST_ADDRESS}: Error: 403 : {}`);
      throw new SolanaJSONRPCError({ code: -32601, message: 'Method not found' }, 'failed to get token accounts');
    });
    const requested = stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.lamports).toBe('5000');
    expect(balances.nativeBalance).toBe(5_000 / 1e9);
    expect(balances.tokens).toEqual([]);
    expect(balances.tokensError).toEqual(expect.any(String));
    expect(tokenCalls).toEqual([A, B]);
    // Nothing to name, so DAS is never tried.
    expect(requested).toEqual([]);
  });

  it('keeps mint and amount without a name when no endpoint serves DAS', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(1_000);
    vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockResolvedValue(oneTokenAccount());
    const requested = stubFetch((_url, body) => {
      expect(body.method).toBe('getAssetsByOwner');
      return rpcError(-32601, 'Method not found');
    });

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBeUndefined();
    expect(balances.tokens).toEqual([{ mint: MINT, amount: '10', decimals: 6, tokenAccount: TOKEN_ACCOUNT }]);
    expect(balances.tokens[0]).not.toHaveProperty('name');
    expect(requested).toEqual([A, B]);
  });

  it('names a token from DAS when the second endpoint serves it', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(1_000);
    vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockResolvedValue(oneTokenAccount());
    const requested = stubFetch((url) =>
      url === A
        ? rpcError(-32601, 'Method not found')
        : Response.json({
            jsonrpc: '2.0',
            id: 'cinder',
            result: {
              items: [{ id: MINT, interface: 'FungibleToken', content: { metadata: { name: 'Wrapped SOL', symbol: 'wSOL' } } }],
            },
          }),
    );

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens[0]).toMatchObject({ mint: MINT, name: 'Wrapped SOL', symbol: 'wSOL' });
    expect(requested).toEqual([A, B]);
  });
});

describe('heliusService.getTransactionHistory', () => {
  it('uses the RPC path when no Helius key is stored', async () => {
    const signatureCalls: string[] = [];
    vi.spyOn(Connection.prototype, 'getSignaturesForAddress').mockImplementation(async function (this: Connection) {
      signatureCalls.push(this.rpcEndpoint);
      return [{ signature: 'sig1', slot: 1, err: null, memo: null, blockTime: 100 }];
    });
    vi.spyOn(Connection.prototype, 'getParsedTransaction').mockResolvedValue(null);
    const requested = stubFetch(() => rpcError(-32601, 'unexpected'));

    const history = await heliusService.getTransactionHistory(TEST_ADDRESS, { limit: 5 });

    expect(history).toEqual([
      expect.objectContaining({ signature: 'sig1', type: 'unknown', status: 'success', timestamp: 100_000 }),
    ]);
    // web3.js binds fetch at load, so the RPC path never touches the stub; no enhanced-history call either.
    expect(requested).toEqual([]);
    expect(signatureCalls.length).toBeGreaterThan(0);
  });

  it('uses the enhanced API on mainnet when a key is stored', async () => {
    runtime.settings.heliusApiKey = 'not-a-real-key';
    const spy = vi.spyOn(Connection.prototype, 'getSignaturesForAddress').mockResolvedValue([]);
    const requested = stubFetch(() => Response.json([]));

    await expect(heliusService.getTransactionHistory(TEST_ADDRESS)).resolves.toEqual([]);

    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain(`https://api.helius.xyz/v0/addresses/${TEST_ADDRESS}/transactions?api-key=not-a-real-key`);
    expect(spy).not.toHaveBeenCalled();
  });
});
