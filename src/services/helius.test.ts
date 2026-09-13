import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  SolanaJSONRPCError,
  SystemProgram,
  type AccountInfo,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_DEVNET_RPCS, PUBLIC_MAINNET_RPCS, heliusRpcUrlFor } from '../config/constants';
import { resetRpcCooldowns } from '../lib/rpc-rotate';
import { METADATA_PROGRAM_ID, metadataPda } from '../lib/token-metadata';
import { TEST_ADDRESS } from '../test/fixtures';

const A = 'https://a.example';
const B = 'https://b.example';
/** The user's own URL: not in the public lists, so a 401/403 from it is a real failure. */
const CUSTOM = 'https://rpc.custom.example/v1';
const [PUBLICNODE] = PUBLIC_MAINNET_RPCS;
/**
 * A second endpoint that `helius.ts` counts as public: mainnet's public list is one host
 * now (`api.mainnet-beta.solana.com` 403s every browser origin and is gone), and the
 * "public URL" set the classifier uses spans both clusters.
 */
const [PUBLIC_DEVNET] = PUBLIC_DEVNET_RPCS;
const FAKE_KEY = 'not-a-real-key';
const HELIUS = heliusRpcUrlFor('mainnet-beta', FAKE_KEY)!;

// Endpoint list and settings, mutable per test; every service call reads these at call time.
const runtime = vi.hoisted(() => ({
  settings: {
    autoLockTimeout: 15,
    preferredCurrency: 'USD',
    theme: 'system' as const,
    hideSmallBalances: false,
    smallBalanceThreshold: 1,
    cluster: 'mainnet-beta' as 'mainnet-beta' | 'devnet',
    heliusApiKey: undefined as string | undefined,
    rpcUrl: undefined as string | undefined,
  },
  urls: ['https://a.example', 'https://b.example'],
}));

vi.mock('../lib/runtime-rpc', () => ({
  runtimeSettings: async () => ({ ...runtime.settings }),
  runtimeCluster: async () => runtime.settings.cluster,
  runtimeRpcUrls: async () => [...runtime.urls],
}));

import { TOKENS_UNAVAILABLE, heliusService, isEndpointsUnreachable } from './helius';

const MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_ACCOUNT = '7QGBDz9pC7uXxRnZp1r5BLpiXMhr9oFqTDvyMGAxAiBH';
const MINT_2022 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_ACCOUNT_2022 = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const OTHER = 'Fbfa7UPLAfng7Wkvr2qCrZVPqEwMzLFPvD8McPRfhBkS';

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

/** ... and token-account failures as `failed to get token accounts owned by account X: <cause>`. */
function tokenAccountsError(cause: string): Error {
  return new Error(`failed to get token accounts owned by account ${TEST_ADDRESS}: ${cause}`);
}

const methodNotFound = () => new SolanaJSONRPCError({ code: -32601, message: 'Method not found' }, 'failed to get token accounts');

/** A parsed system transfer from the fixture address, as `getParsedTransaction` returns it. */
function parsedTransfer(signature: string, blockTime: number): ParsedTransactionWithMeta {
  return {
    blockTime,
    slot: 2,
    meta: {
      err: null,
      fee: 5000,
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
      preBalances: [],
      postBalances: [],
      logMessages: [],
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [],
        recentBlockhash: '',
        instructions: [
          {
            program: 'system',
            programId: SystemProgram.programId,
            parsed: { type: 'transfer', info: { source: TEST_ADDRESS, destination: OTHER, lamports: 1_000_000 } },
          },
        ],
      },
    },
  } as unknown as ParsedTransactionWithMeta;
}

beforeEach(() => {
  runtime.settings.cluster = 'mainnet-beta';
  runtime.settings.heliusApiKey = undefined;
  runtime.settings.rpcUrl = undefined;
  runtime.urls = [A, B];
});

afterEach(() => {
  resetRpcCooldowns();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('heliusService.getTokenBalances', () => {
  it('returns the SOL balance and tokensError "unavailable" when every endpoint refuses the token-account call', async () => {
    runtime.urls = [PUBLICNODE, B];
    const tokenCalls: string[] = [];
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockImplementation(async function (
      this: Connection,
    ) {
      tokenCalls.push(this.rpcEndpoint);
      // publicnode: a 403 in Chrome's HTTP/2 shape with no reason phrase. B: the method is not served.
      if (this.rpcEndpoint === PUBLICNODE) throw tokenAccountsError('Error: 403 : {}');
      throw methodNotFound();
    });
    const requested = stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.lamports).toBe('5000');
    expect(balances.nativeBalance).toBe(5_000 / 1e9);
    expect(balances.tokens).toEqual([]);
    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(balances.endpointsUnreachable).toBeUndefined();
    // Both token programs are asked on each URL before rotating.
    expect(tokenCalls).toEqual([PUBLICNODE, PUBLICNODE, B, B]);
    // Nothing to name, so DAS is never tried.
    expect(requested).toEqual([]);
  });

  it('reports the host and code, not "unavailable" or the address, when the call itself is rejected', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    const tokenCalls = stubTokenAccounts(() => {
      throw new SolanaJSONRPCError({ code: -32602, message: 'Invalid params: bad owner' }, 'failed to get token accounts');
    });
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.lamports).toBe('5000');
    expect(balances.tokensError).toBe('a.example: Invalid params: bad owner (-32602)');
    expect(balances.tokensError).not.toContain(TEST_ADDRESS);
    // A `throw` verdict does not rotate.
    expect(tokenCalls).toEqual([`${A}:classic`, `${A}:2022`]);
  });

  it('names a 401 from the user\'s own URL as a refusal, never "unavailable"', async () => {
    runtime.urls = [CUSTOM, PUBLICNODE, PUBLIC_DEVNET];
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    stubTokenAccounts((url) => {
      if (url === CUSTOM) throw tokenAccountsError('Error: 401 : {"error":"unauthorized"}');
      if (url === PUBLICNODE) throw methodNotFound();
      throw tokenAccountsError('Error: 403 : {}');
    });
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBe('rpc.custom.example refused (401)');
    expect(balances.tokensError).not.toBe(TOKENS_UNAVAILABLE);
    expect(balances.tokensError).not.toContain(TEST_ADDRESS);
    expect(balances.endpointsUnreachable).toBeUndefined();
  });

  it('names a 401 from a Helius key as a rejected key, without the key in the message', async () => {
    runtime.urls = [HELIUS, PUBLICNODE, PUBLIC_DEVNET];
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    stubTokenAccounts((url) => {
      if (url === HELIUS) throw tokenAccountsError('Error: 401 : {"error":"Unauthorized: invalid api key"}');
      throw methodNotFound();
    });
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBe('Helius rejected the API key (401)');
    expect(balances.tokensError).not.toContain(FAKE_KEY);
  });

  it('is "unavailable" on a public-only list when the primary refuses, whatever the fallback says', async () => {
    runtime.urls = [PUBLICNODE, PUBLIC_DEVNET];
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    stubTokenAccounts((url) => {
      if (url === PUBLICNODE) throw tokenAccountsError('Error: 403 : {}');
      throw tokenAccountsError('Error: 503 : down');
    });
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
  });

  it('reports the endpoint that failed for real, not "unavailable", when the primary merely refused the method', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    stubTokenAccounts((url) => {
      if (url === A) throw methodNotFound();
      throw tokenAccountsError('Error: 503 : down');
    });
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBe('b.example answered 503');
    expect(balances.endpointsUnreachable).toBeUndefined();
  });

  it('flags endpointsUnreachable on the result when the token call finds no endpoint at all', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    stubTokenAccounts((url) => {
      if (url === A) throw new TypeError('Failed to fetch');
      throw tokenAccountsError('Error: 403 : {}');
    });
    stubFetch(() => rpcError(-32601, 'Method not found'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.lamports).toBe('5000');
    expect(balances.tokens).toEqual([]);
    expect(balances.endpointsUnreachable).toBe(true);
    expect(balances.tokensError).toBe('a.example: Failed to fetch');
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

  it('keeps mint and amount, tagged with the token program, without waiting on any on-chain metadata lookup', async () => {
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(1_000);
    stubTokenAccounts((_url, program) => (program === CLASSIC ? oneClassic() : one2022()));
    const metaplex = vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockResolvedValue([null]);
    const token2022 = vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null);
    const requested = stubFetch((_url, body) => {
      expect(body.method).toBe('getAssetsByOwner');
      return rpcError(-32601, 'Method not found');
    });

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBeUndefined();
    expect(balances.tokens).toEqual([
      { mint: MINT, amount: '10', decimals: 6, tokenAccount: TOKEN_ACCOUNT, programId: CLASSIC },
      { mint: MINT_2022, amount: '7', decimals: 6, tokenAccount: TOKEN_ACCOUNT_2022, programId: TOKEN_2022 },
    ]);
    expect(balances.tokens[0]).not.toHaveProperty('name');
    // DAS was tried on every URL; the Metaplex and Token-2022 lookups belong to `getTokenNames`.
    expect(requested).toEqual([A, B]);
    expect(metaplex).not.toHaveBeenCalled();
    expect(token2022).not.toHaveBeenCalled();
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
});

describe('heliusService.getTokenNames', () => {
  it('names Token-2022 and classic holdings from on-chain metadata when DAS left them unnamed', async () => {
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

    const names = await heliusService.getTokenNames([
      { mint: MINT, programId: CLASSIC },
      { mint: MINT_2022, programId: TOKEN_2022 },
    ]);

    expect(names).toEqual({
      [MINT]: { name: 'Wrapped SOL', symbol: 'SOL' },
      [MINT_2022]: { name: 'USD Coin', symbol: 'USDC' },
    });
    expect(metadata).toHaveBeenCalledTimes(1);
  });

  it('asks nothing for tokens DAS already named', async () => {
    const metadata = vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo');

    await expect(
      heliusService.getTokenNames([{ mint: MINT, programId: CLASSIC, symbol: 'wSOL', name: 'Wrapped SOL' }]),
    ).resolves.toEqual({});

    expect(metadata).not.toHaveBeenCalled();
  });
});

describe('heliusService.getNFTs', () => {
  const asset = { id: 'nft1', interface: 'V1_NFT', content: { metadata: { name: 'One', symbol: 'ONE' } }, ownership: { owner: TEST_ADDRESS, frozen: false } };

  it('resolves nftsUnavailable when no endpoint serves DAS', async () => {
    runtime.urls = [PUBLICNODE, B];
    const requested = stubFetch((url) => (url === PUBLICNODE ? new Response('forbidden', { status: 403 }) : rpcError(-32601, 'Method not found')));

    await expect(heliusService.getNFTs(TEST_ADDRESS)).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 100,
      nftsUnavailable: true,
    });
    expect(requested).toEqual([PUBLICNODE, B]);
  });

  it('rejects with the endpoint that failed when one that serves DAS answered 503', async () => {
    stubFetch((url) => (url === A ? rpcError(-32601, 'Method not found') : new Response('down', { status: 503 })));

    await expect(heliusService.getNFTs(TEST_ADDRESS)).rejects.toThrow('b.example answered 503');
  });

  it('rejects with a rejected-key message, not nftsUnavailable, when the Helius URL answers 401', async () => {
    runtime.urls = [HELIUS, PUBLICNODE];
    stubFetch((url) => (url === HELIUS ? new Response('unauthorized', { status: 401 }) : rpcError(-32601, 'Method not found')));

    const failure = await heliusService.getNFTs(TEST_ADDRESS).catch((error: unknown) => error);

    expect((failure as Error).message).toBe('Helius rejected the API key (401)');
    expect((failure as Error).message).not.toContain(FAKE_KEY);
    expect(isEndpointsUnreachable(failure)).toBe(false);
  });

  it('rejects with EndpointsUnreachableError when fetch itself failed everywhere', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const failure = await heliusService.getNFTs(TEST_ADDRESS).catch((error: unknown) => error);

    expect(isEndpointsUnreachable(failure)).toBe(true);
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
      expect.objectContaining({ signature: 'sig1', type: 'unknown', status: 'success', timestamp: 100_000, detailsUnavailable: true }),
    ]);
    // web3.js binds fetch at load, so the RPC path never touches the stub; no enhanced-history call either.
    expect(requested).toEqual([]);
    expect(signatureCalls.length).toBeGreaterThan(0);
  });

  it('marks a row whose details could not be fetched instead of inventing a transfer', async () => {
    vi.spyOn(Connection.prototype, 'getSignaturesForAddress').mockResolvedValue([
      { signature: 'sig1', slot: 1, err: null, memo: null, blockTime: 100 },
      { signature: 'sig2', slot: 2, err: null, memo: null, blockTime: 200 },
    ]);
    vi.spyOn(Connection.prototype, 'getParsedTransaction').mockImplementation(async (signature) => {
      if (signature === 'sig1') throw new Error('failed to get transaction: Error: 503 : down');
      return parsedTransfer(signature, 200);
    });

    const [broken, parsed] = await heliusService.getTransactionHistory(TEST_ADDRESS, { limit: 5 });

    expect(broken).toMatchObject({ signature: 'sig1', detailsUnavailable: true, nativeTransfers: [], tokenTransfers: [] });
    expect(parsed).not.toHaveProperty('detailsUnavailable');
    expect(parsed).toMatchObject({
      signature: 'sig2',
      type: 'TRANSFER',
      nativeTransfers: [{ from: TEST_ADDRESS, to: OTHER, amount: 1_000_000 }],
    });
  });

  it('rejects when every endpoint fails the RPC path instead of resolving an empty history', async () => {
    // `getTransactionHistory` builds its own list with `rpcUrlsFor(cluster, settings)` rather
    // than the mocked `runtimeRpcUrls`, and keyless mainnet is one public host now, so the
    // second endpoint this rotation has to try comes from a stored custom URL.
    runtime.settings.rpcUrl = CUSTOM;
    const signatureCalls: string[] = [];
    vi.spyOn(Connection.prototype, 'getSignaturesForAddress').mockImplementation(async function (this: Connection) {
      signatureCalls.push(this.rpcEndpoint);
      throw new Error('503 Service Unavailable: {}');
    });
    stubFetch(() => rpcError(-32601, 'unexpected'));

    await expect(heliusService.getTransactionHistory(TEST_ADDRESS, { limit: 5 })).rejects.toThrow(/503/);
    expect(signatureCalls.length).toBeGreaterThan(1);
  });

  it('rejects with EndpointsUnreachableError when no endpoint answered', async () => {
    vi.spyOn(Connection.prototype, 'getSignaturesForAddress').mockRejectedValue(new TypeError('Failed to fetch'));

    const failure = await heliusService.getTransactionHistory(TEST_ADDRESS, { limit: 5 }).catch((error: unknown) => error);

    expect(isEndpointsUnreachable(failure)).toBe(true);
  });

  it('falls back to the RPC path, without throwing, when the enhanced API answers 200 with an object body', async () => {
    // A 200 whose body is an error object, or anything else that is not a list of
    // rows: the history is not "broken", it simply did not come from there.
    runtime.settings.heliusApiKey = FAKE_KEY;
    const signatureCalls: string[] = [];
    vi.spyOn(Connection.prototype, 'getSignaturesForAddress').mockImplementation(async function (this: Connection) {
      signatureCalls.push(this.rpcEndpoint);
      return [];
    });
    const requested = stubFetch(() => Response.json({ error: 'Too many requests' }));

    await expect(heliusService.getTransactionHistory(TEST_ADDRESS, { limit: 5 })).resolves.toEqual([]);

    expect(requested.some((url) => url.includes('api.helius.xyz'))).toBe(true);
    expect(signatureCalls.length).toBeGreaterThan(0);
  });

  it('uses the enhanced API on mainnet when a key is stored', async () => {
    runtime.settings.heliusApiKey = FAKE_KEY;
    const spy = vi.spyOn(Connection.prototype, 'getSignaturesForAddress').mockResolvedValue([]);
    const requested = stubFetch(() => Response.json([]));

    await expect(heliusService.getTransactionHistory(TEST_ADDRESS)).resolves.toEqual([]);

    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain(`https://api.helius.xyz/v0/addresses/${TEST_ADDRESS}/transactions?api-key=${FAKE_KEY}`);
    expect(spy).not.toHaveBeenCalled();
  });
});
