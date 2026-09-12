import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey, SolanaJSONRPCError, type AccountInfo } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRpcCooldowns } from '../lib/rpc-rotate';
import { METADATA_PROGRAM_ID, metadataPda } from '../lib/token-metadata';
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

import { TOKENS_UNAVAILABLE, heliusService, isEndpointsUnreachable } from './helius';

const MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_ACCOUNT = '7QGBDz9pC7uXxRnZp1r5BLpiXMhr9oFqTDvyMGAxAiBH';
const MINT_2022 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_ACCOUNT_2022 = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

const CLASSIC = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();

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

type ParsedAccounts = Awaited<ReturnType<Connection['getParsedTokenAccountsByOwner']>>;
type TokenFilter = Parameters<Connection['getParsedTokenAccountsByOwner']>[1];

function tokenAccounts(
  rows: Array<{ mint: string; tokenAccount: string; amount: string; program: 'spl-token' | 'spl-token-2022' }>,
): ParsedAccounts {
  return {
    context: { slot: 1 },
    value: rows.map((row) => ({
      pubkey: new PublicKey(row.tokenAccount),
      account: {
        executable: false,
        owner: new PublicKey(TEST_ADDRESS),
        lamports: 2_039_280,
        data: {
          program: row.program,
          space: 165,
          parsed: { type: 'account', info: { mint: row.mint, tokenAmount: { amount: row.amount, decimals: 6, uiAmount: 0 } } },
        },
      },
    })),
  } as unknown as ParsedAccounts;
}

const none = (): ParsedAccounts => tokenAccounts([]);
const oneClassic = (): ParsedAccounts =>
  tokenAccounts([{ mint: MINT, tokenAccount: TOKEN_ACCOUNT, amount: '10', program: 'spl-token' }]);
const one2022 = (): ParsedAccounts =>
  tokenAccounts([{ mint: MINT_2022, tokenAccount: TOKEN_ACCOUNT_2022, amount: '7', program: 'spl-token-2022' }]);

function programOf(filter: TokenFilter): string {
  return 'programId' in filter ? filter.programId.toBase58() : 'mint';
}

/** Answer the classic and Token-2022 account calls separately; `calls` records `url:program` in order. */
function stubTokenAccounts(
  answer: (url: string, program: string) => ParsedAccounts,
): string[] {
  const calls: string[] = [];
  vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockImplementation(async function (
    this: Connection,
    _owner: PublicKey,
    filter: TokenFilter,
  ) {
    const program = programOf(filter);
    calls.push(`${this.rpcEndpoint}:${program === CLASSIC ? 'classic' : '2022'}`);
    return answer(this.rpcEndpoint, program);
  });
  return calls;
}

/** A Metaplex metadata account with the given name and symbol. */
function metaplexAccount(name: string, symbol: string): AccountInfo<Buffer> {
  const str = (text: string) => {
    const body = Buffer.from(text, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(body.length, 0);
    return Buffer.concat([length, body]);
  };
  return {
    executable: false,
    owner: METADATA_PROGRAM_ID,
    lamports: 1,
    data: Buffer.concat([Buffer.from([4]), Buffer.alloc(64), str(name), str(symbol), str('')]),
  };
}

/** web3.js wraps `getBalance` failures as `failed to get balance of account X: <cause>`. */
function balanceError(cause: string): Error {
  return new Error(`failed to get balance of account ${TEST_ADDRESS}: ${cause}`);
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
  it('returns the SOL balance and tokensError "unavailable" when every endpoint refuses the token-account call', async () => {
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
    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(balances.endpointsUnreachable).toBeUndefined();
    // Both token programs are asked on each URL before rotating.
    expect(tokenCalls).toEqual([A, A, B, B]);
    // Nothing to name, so DAS is never tried.
    expect(requested).toEqual([]);
  });

  it('reports the message, not "unavailable", when the call itself is rejected', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    const tokenCalls = stubTokenAccounts(() => {
      throw new SolanaJSONRPCError({ code: -32602, message: 'Invalid params: bad owner' }, 'failed to get token accounts');
    });
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.lamports).toBe('5000');
    expect(balances.tokensError).toContain('Invalid params');
    expect(balances.tokensError).not.toBe(TOKENS_UNAVAILABLE);
    // A `throw` verdict does not rotate.
    expect(tokenCalls).toEqual([`${A}:classic`, `${A}:2022`]);
  });

  it('flags endpointsUnreachable on the result when the token call finds no endpoint at all', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    stubTokenAccounts((url) => {
      if (url === A) throw new TypeError('Failed to fetch');
      throw new Error(`failed to get token accounts owned by account ${TEST_ADDRESS}: Error: 403 : {}`);
    });
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.lamports).toBe('5000');
    expect(balances.tokens).toEqual([]);
    expect(balances.endpointsUnreachable).toBe(true);
    expect(balances.tokensError).toEqual(expect.any(String));
  });

  it('rejects with EndpointsUnreachableError when no endpoint answers the balance call', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockImplementation(async function (this: Connection) {
      if (this.rpcEndpoint === A) throw balanceError('TypeError: Failed to fetch');
      throw balanceError('Error: 403 : {}');
    });
    const tokenCalls = stubTokenAccounts(none);

    const failure = await heliusService.getTokenBalances(TEST_ADDRESS).catch((error: unknown) => error);

    expect(isEndpointsUnreachable(failure)).toBe(true);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/No RPC endpoint reachable/);
    expect(tokenCalls).toEqual([]);
  });

  it('rejects with the endpoint error, not unreachable, when one endpoint answered with a server error', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockImplementation(async function (this: Connection) {
      if (this.rpcEndpoint === A) throw balanceError('Error: 503 Service Unavailable: {}');
      throw balanceError('TypeError: Failed to fetch');
    });
    stubTokenAccounts(none);

    const failure = await heliusService.getTokenBalances(TEST_ADDRESS).catch((error: unknown) => error);

    expect(isEndpointsUnreachable(failure)).toBe(false);
    expect((failure as Error).message).toContain('Failed to fetch');
  });

  it('keeps mint and amount, tagged with the token program, when no endpoint serves DAS or metadata', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(1_000);
    stubTokenAccounts((_url, program) => (program === CLASSIC ? oneClassic() : none()));
    const metadata = vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockResolvedValue([null]);
    const requested = stubFetch((_url, body) => {
      expect(body.method).toBe('getAssetsByOwner');
      return rpcError(-32601, 'Method not found');
    });

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBeUndefined();
    expect(balances.tokens).toEqual([
      { mint: MINT, amount: '10', decimals: 6, tokenAccount: TOKEN_ACCOUNT, programId: CLASSIC },
    ]);
    expect(balances.tokens[0]).not.toHaveProperty('name');
    expect(requested).toEqual([A, B]);
    // The Metaplex PDA was asked once the DAS attempt was refused.
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(metadata.mock.calls[0][0].map((key) => key.toBase58())).toEqual([metadataPda(new PublicKey(MINT)).toBase58()]);
  });

  it('names a token from DAS when the second endpoint serves it, without touching metadata', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(1_000);
    stubTokenAccounts((_url, program) => (program === CLASSIC ? oneClassic() : none()));
    const metadata = vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockResolvedValue([null]);
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

    expect(balances.tokens[0]).toMatchObject({ mint: MINT, name: 'Wrapped SOL', symbol: 'wSOL', programId: CLASSIC });
    expect(requested).toEqual([A, B]);
    expect(metadata).not.toHaveBeenCalled();
  });

  it('lists Token-2022 holdings and names them from on-chain metadata when DAS is refused', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(1_000);
    stubTokenAccounts((_url, program) => (program === CLASSIC ? oneClassic() : one2022()));
    // No metadata extension on the Token-2022 mint: `getTokenMetadata` cannot read the mint.
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null);
    const metadata = vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) =>
      keys.map((key) =>
        key.equals(metadataPda(new PublicKey(MINT_2022)))
          ? metaplexAccount('USD Coin', 'USDC')
          : key.equals(metadataPda(new PublicKey(MINT)))
            ? metaplexAccount('Wrapped SOL', 'SOL')
            : null,
      ),
    );
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens).toEqual([
      { mint: MINT, amount: '10', decimals: 6, tokenAccount: TOKEN_ACCOUNT, programId: CLASSIC, name: 'Wrapped SOL', symbol: 'SOL' },
      { mint: MINT_2022, amount: '7', decimals: 6, tokenAccount: TOKEN_ACCOUNT_2022, programId: TOKEN_2022, name: 'USD Coin', symbol: 'USDC' },
    ]);
    expect(metadata).toHaveBeenCalledTimes(1);
  });
});

describe('heliusService.getNFTs', () => {
  const asset = { id: 'nft1', interface: 'V1_NFT', content: { metadata: { name: 'One', symbol: 'ONE' } }, ownership: { owner: TEST_ADDRESS, frozen: false } };

  it('resolves nftsUnavailable when no endpoint serves DAS', async () => {
    const requested = stubFetch((url) => (url === A ? new Response('forbidden', { status: 403 }) : rpcError(-32601, 'Method not found')));

    await expect(heliusService.getNFTs(TEST_ADDRESS)).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 100,
      nftsUnavailable: true,
    });
    expect(requested).toEqual([A, B]);
  });

  it('rejects when an endpoint that serves DAS failed', async () => {
    stubFetch((url) => (url === A ? rpcError(-32601, 'Method not found') : new Response('down', { status: 503 })));

    await expect(heliusService.getNFTs(TEST_ADDRESS)).rejects.toThrow(/503/);
  });

  it('returns the page from the endpoint that serves DAS', async () => {
    stubFetch((url) =>
      url === A
        ? rpcError(-32601, 'Method not found')
        : Response.json({ jsonrpc: '2.0', id: 'cinder', result: { items: [asset], total: 1 } }),
    );

    const page = await heliusService.getNFTs(TEST_ADDRESS);

    expect(page.items).toEqual([asset]);
    expect(page.total).toBe(1);
    expect(page.nftsUnavailable).toBeUndefined();
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

  it('rejects when every endpoint fails the RPC path instead of resolving an empty history', async () => {
    const signatureCalls: string[] = [];
    vi.spyOn(Connection.prototype, 'getSignaturesForAddress').mockImplementation(async function (this: Connection) {
      signatureCalls.push(this.rpcEndpoint);
      throw new Error('503 Service Unavailable: {}');
    });
    stubFetch(() => rpcError(-32601, 'unexpected'));

    await expect(heliusService.getTransactionHistory(TEST_ADDRESS, { limit: 5 })).rejects.toThrow(/503/);
    expect(signatureCalls.length).toBeGreaterThan(1);
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
