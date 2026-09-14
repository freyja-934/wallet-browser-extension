import {
  ACCOUNT_SIZE,
  AccountLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
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
import {
  JUPITER_BALANCES_URL,
  JUPITER_TOKEN_SEARCH_URL,
  PUBLIC_DEVNET_RPCS,
  PUBLIC_MAINNET_RPCS,
  heliusRpcUrlFor,
} from '../config/constants';
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
  /** The worker did not answer the settings read at all (an MV3 restart mid-popup). */
  settingsUnavailable: false,
  urls: ['https://a.example', 'https://b.example'],
}));

vi.mock('../lib/runtime-rpc', () => ({
  runtimeSettings: async () => ({ ...runtime.settings }),
  runtimeSettingsOrUndefined: async () => (runtime.settingsUnavailable ? undefined : { ...runtime.settings }),
  runtimeCluster: async () => runtime.settings.cluster,
  runtimeRpcUrls: async () => [...runtime.urls],
}));

import {
  JUPITER_MAX_TOKENS,
  MINT_INFO_BATCH,
  TOKENS_UNAVAILABLE,
  heliusService,
  isEndpointsUnreachable,
  mintFactsFrom,
} from './helius';

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
  runtime.settingsUnavailable = false;
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
    // Nothing to name, so DAS is never tried. Mainnet with no key of the user's own does
    // reach for the keyless fallback, which this stub answers with a JSON-RPC error
    // envelope — no mints in it, so the list stays empty and `tokensError` stands.
    expect(requested).toEqual([`${JUPITER_BALANCES_URL}/${TEST_ADDRESS}`]);
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

  /**
   * The keyless Mainnet host caps `getMultipleAccounts` at ten, which is what
   * `MINT_INFO_BATCH` records — and `fetchTokenMetadata` treats a failed Metaplex
   * batch as an endpoint failure, so a 100-key batch there does not merely waste a
   * call: it stalls three seconds, fails, and discards every name already found.
   * Before the Jupiter fallback this path was unreachable keyless, because the list
   * was always empty; now every unnamed row goes through it.
   */
  it('batches the Metaplex reads at ten when the only endpoint is the public Mainnet one', async () => {
    runtime.urls = [PUBLICNODE];
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null);
    const batchSizes: number[] = [];
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) => {
      batchSizes.push(keys.length);
      return keys.map(() => null);
    });

    await heliusService.getTokenNames(
      Array.from({ length: 15 }, (_, index) => ({
        mint: new PublicKey(Buffer.alloc(32, index + 1)).toBase58(),
        programId: CLASSIC,
      })),
    );

    expect(batchSizes).toEqual([MINT_INFO_BATCH, 5]);
  });

  it('keeps the full 100-key batch for an endpoint the user configured', async () => {
    runtime.settings.rpcUrl = CUSTOM;
    runtime.urls = [CUSTOM, PUBLICNODE];
    vi.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue(null);
    const batchSizes: number[] = [];
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) => {
      batchSizes.push(keys.length);
      return keys.map(() => null);
    });

    await heliusService.getTokenNames(
      Array.from({ length: 15 }, (_, index) => ({
        mint: new PublicKey(Buffer.alloc(32, index + 1)).toBase58(),
        programId: CLASSIC,
      })),
    );

    expect(batchSizes).toEqual([15]);
  });

  it('asks nothing for tokens DAS already named', async () => {
    const metadata = vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo');

    await expect(
      heliusService.getTokenNames([{ mint: MINT, programId: CLASSIC, symbol: 'wSOL', name: 'Wrapped SOL' }]),
    ).resolves.toEqual({});

    expect(metadata).not.toHaveBeenCalled();
  });
});

describe('heliusService.getCollectibles', () => {
  const mints = (count: number) =>
    Array.from({ length: count }, (_, index) => new PublicKey(Buffer.alloc(32, index + 1)).toBase58());

  function stubMetadata(answer: (pda: string) => AccountInfo<Buffer> | null = () => null): number[] {
    const batchSizes: number[] = [];
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) => {
      batchSizes.push(keys.length);
      return keys.map((key) => answer(key.toBase58()));
    });
    return batchSizes;
  }

  it('reads the metadata accounts at ten when the only endpoint is the public Mainnet one', async () => {
    runtime.urls = [PUBLICNODE];
    const batchSizes = stubMetadata();

    await heliusService.getCollectibles(mints(15));

    expect(batchSizes).toEqual([MINT_INFO_BATCH, 5]);
  });

  it('keeps the full batch for an endpoint the user configured', async () => {
    runtime.settings.rpcUrl = CUSTOM;
    runtime.urls = [CUSTOM, PUBLICNODE];
    const batchSizes = stubMetadata();

    await heliusService.getCollectibles(mints(15));

    expect(batchSizes).toEqual([15]);
  });

  it('names a collectible from its own metadata account', async () => {
    const [mint] = mints(1);
    const pda = metadataPda(new PublicKey(mint)).toBase58();
    stubMetadata((key) => (key === pda ? metaplexAccount('Frog #8699', 'FROG') : null));

    await expect(heliusService.getCollectibles([mint])).resolves.toEqual([
      { mint, name: 'Frog #8699', symbol: 'FROG' },
    ]);
  });

  it('asks nothing at all when there is nothing to name', async () => {
    const metadata = vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo');

    await expect(heliusService.getCollectibles([])).resolves.toEqual([]);

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

/**
 * The keyless mainnet fallback. The rule these tests exist to hold: Jupiter says
 * *which* mints, and what they are called. Every number a user could act on is read
 * from the chain — `decimals` from the mint account, which `SendModal` converts the
 * typed amount with, and the balance from the owner's own token account, which is
 * what Max fills in and what the insufficient-balance check is made against. A
 * holding the chain will not confirm is dropped, not guessed.
 */
describe('heliusService.getTokenBalances, keyless Jupiter fallback', () => {
  const MINT_B = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

  /** publicnode's real refusal of `getTokenAccountsByOwner`: `-32602`, "Request blocked". */
  const blocked = () =>
    new SolanaJSONRPCError({ code: -32602, message: 'Request blocked' }, 'failed to get token accounts');

  /**
   * An SPL mint account exactly as the chain stores it; bytes 36..43 are the u64
   * supply and byte 44 the decimals a send converts with. Supply defaults to a
   * fungible figure, so a fixture is a token unless it says otherwise.
   */
  function mintAccount(
    decimals: number,
    programId: PublicKey,
    initialized = true,
    supply = 1_000_000n,
  ): AccountInfo<Buffer> {
    const data = Buffer.alloc(82);
    data.writeBigUInt64LE(supply, 36);
    data.writeUInt8(decimals, 44);
    data.writeUInt8(initialized ? 1 : 0, 45);
    return { executable: false, owner: programId, lamports: 1_461_600, data };
  }

  /** The real shape of a regular NFT: one unit, indivisible. */
  const oneOfOneAccount = (programId: PublicKey = TOKEN_PROGRAM_ID): AccountInfo<Buffer> =>
    mintAccount(0, programId, true, 1n);

  /** Jupiter's two endpoints answered from `payload`; every other URL refuses like publicnode. */
  function stubJupiter(options: {
    balances?: unknown;
    search?: unknown;
  }): string[] {
    return stubFetch((url) => {
      if (url.startsWith(`${JUPITER_BALANCES_URL}/`)) return Response.json(options.balances ?? {});
      if (url.startsWith(JUPITER_TOKEN_SEARCH_URL)) return Response.json(options.search ?? []);
      return rpcError(-32601, 'Method not found');
    });
  }

  /** An initialised token account of `mint` held by `owner`, as the chain stores it. */
  function tokenAccountInfo(mint: PublicKey, owner: PublicKey, amount: bigint, programId: PublicKey): AccountInfo<Buffer> {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode(
      {
        mint,
        owner,
        amount,
        delegateOption: 0,
        delegate: PublicKey.default,
        delegatedAmount: 0n,
        state: 1,
        isNativeOption: 0,
        isNative: 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data,
    );
    return { executable: false, owner: programId, lamports: 2_039_280, data };
  }

  /**
   * Answer both `getMultipleAccounts` passes the keyless path makes, and record each
   * batch's size so the 10-account cap can be asserted.
   *
   * `answer` says what a mint address returns. `amount` says what the wallet's own
   * associated token account of that mint holds — `undefined` for "no such account",
   * which is what a holding kept in a non-canonical account looks like from here.
   * The associated addresses are registered as each mint account is served, which
   * works because the mint pass always runs first: its answer is what says which
   * token program the address is derived under.
   */
  function stubMintAccounts(
    answer: (mint: string) => AccountInfo<Buffer> | null,
    amount: (mint: string) => bigint | undefined = () => 1n,
  ): number[] {
    const batchSizes: number[] = [];
    const owner = new PublicKey(TEST_ADDRESS);
    /** Associated token address -> the mint it holds, and the program it lives under. */
    const associated = new Map<string, { mint: PublicKey; programId: PublicKey }>();
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) => {
      batchSizes.push(keys.length);
      return keys.map((key) => {
        const address = key.toBase58();
        const held = associated.get(address);
        if (held) {
          const value = amount(held.mint.toBase58());
          return value === undefined ? null : tokenAccountInfo(held.mint, owner, value, held.programId);
        }
        const info = answer(address);
        if (info) {
          const mint = new PublicKey(address);
          const ata = getAssociatedTokenAddressSync(mint, owner, true, info.owner);
          associated.set(ata.toBase58(), { mint, programId: info.owner });
        }
        return info;
      });
    });
    return batchSizes;
  }

  beforeEach(() => {
    // The shipping keyless shape: mainnet, nothing configured, one public host that
    // serves getBalance and refuses the token-account call.
    runtime.urls = [PUBLICNODE];
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    stubTokenAccounts(() => {
      throw blocked();
    });
  });

  it('lists the mints Jupiter reports, with decimals and token program read from the mint account', async () => {
    const requested = stubJupiter({
      balances: {
        SOL: { amount: '5000', uiAmount: 0.000005 },
        [MINT]: { amount: '1500000', uiAmount: 1.5 },
      },
      search: [{ id: MINT, name: 'USD Coin', symbol: 'USDC', icon: 'https://example.test/usdc.png' }],
    });
    stubMintAccounts(() => mintAccount(6, TOKEN_PROGRAM_ID), () => 1_500_000n);

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBeUndefined();
    expect(balances.tokensSource).toBe('jupiter');
    expect(balances.tokens).toEqual([
      {
        mint: MINT,
        amount: '1500000',
        decimals: 6,
        programId: CLASSIC,
        name: 'USD Coin',
        symbol: 'USDC',
        logoURI: 'https://example.test/usdc.png',
      },
    ]);
    // Jupiter knows mints, not accounts; the send derives the associated token address.
    expect(balances.tokens[0]).not.toHaveProperty('tokenAccount');
    expect(balances.lamports).toBe('5000');
    expect(requested.some((url) => url === `${JUPITER_BALANCES_URL}/${TEST_ADDRESS}`)).toBe(true);
    expect(requested.some((url) => url.startsWith(JUPITER_TOKEN_SEARCH_URL))).toBe(true);
  });

  /**
   * The other half of the rule, and the one that decides what Max fills in. Jupiter's
   * balances are keyed by mint, so a wallet holding the same mint in a second,
   * non-canonical account is reported at its wallet-level total — a figure this
   * wallet cannot spend, because a row with no `source` sends from the associated
   * account. What the row shows is what that account holds.
   */
  it('takes the amount from the wallet\'s own token account, not from Jupiter', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '227000000', uiAmount: 227 } } });
    stubMintAccounts(() => mintAccount(6, TOKEN_PROGRAM_ID), () => 1_000_000n);

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens[0].amount).toBe('1000000');
  });

  it('drops a holding whose associated token account does not exist, and counts it', async () => {
    stubJupiter({
      balances: {
        [MINT]: { amount: '5', uiAmount: 5 },
        // Held somewhere that is not the associated account: nothing here can spend it.
        [MINT_B]: { amount: '227000000', uiAmount: 227 },
      },
    });
    stubMintAccounts(
      () => mintAccount(6, TOKEN_PROGRAM_ID),
      (mint) => (mint === MINT ? 5n : undefined),
    );

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens.map((token) => token.mint)).toEqual([MINT]);
    expect(balances.tokensOmitted).toEqual({ unconfirmed: 1, beyondCap: 0 });
  });

  it('drops a holding whose associated account is empty rather than showing a balance of nothing', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '5', uiAmount: 5 } } });
    stubMintAccounts(() => mintAccount(6, TOKEN_PROGRAM_ID), () => 0n);

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens).toEqual([]);
    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(balances.tokensSource).toBeUndefined();
  });

  it('reads the token accounts at ten a call too, under the same measured cap', async () => {
    const held = Array.from({ length: 12 }, (_, index) => new PublicKey(Buffer.alloc(32, index + 1)).toBase58());
    stubJupiter({ balances: Object.fromEntries(held.map((mint) => [mint, { amount: '1', uiAmount: 1 }])) });
    const batchSizes = stubMintAccounts(() => mintAccount(9, TOKEN_PROGRAM_ID));

    await heliusService.getTokenBalances(TEST_ADDRESS);

    // Twelve mints, then twelve associated accounts, neither pass over the cap.
    expect(batchSizes).toEqual([MINT_INFO_BATCH, 2, MINT_INFO_BATCH, 2]);
  });

  it('takes decimals from the chain even when Jupiter states a different number', async () => {
    stubJupiter({
      balances: { [MINT]: { amount: '1500000', uiAmount: 1.5 } },
      // A wrong 2 here would show 15,000.00 instead of 1.5 and send 750x the intended amount.
      search: [{ id: MINT, name: 'USD Coin', symbol: 'USDC', decimals: 2 }],
    });
    stubMintAccounts(() => mintAccount(6, TOKEN_PROGRAM_ID));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens[0].decimals).toBe(6);
  });

  it('takes the token program from the mint account owner, not from the search row', async () => {
    stubJupiter({
      balances: { [MINT]: { amount: '7', uiAmount: 7 } },
      search: [{ id: MINT, symbol: 'T22', tokenProgram: TOKEN_PROGRAM_ID.toBase58() }],
    });
    stubMintAccounts(() => mintAccount(0, TOKEN_2022_PROGRAM_ID));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens[0].programId).toBe(TOKEN_2022);
  });

  it('drops a mint the chain will not confirm, and counts it rather than hiding it', async () => {
    stubJupiter({
      balances: {
        [MINT]: { amount: '1500000', uiAmount: 1.5 },
        // No account at this address: nothing says what its decimals are.
        [MINT_B]: { amount: '99', uiAmount: 99 },
      },
    });
    stubMintAccounts((mint) => (mint === MINT ? mintAccount(6, TOKEN_PROGRAM_ID) : null));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens.map((token) => token.mint)).toEqual([MINT]);
    expect(balances.tokensOmitted).toEqual({ unconfirmed: 1, beyondCap: 0 });
  });

  it('drops a mint whose account is owned by something that is not a token program', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '5', uiAmount: 5 } } });
    stubMintAccounts(() => mintAccount(6, SystemProgram.programId));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens).toEqual([]);
    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(balances.tokensSource).toBeUndefined();
  });

  /**
   * The defect SHIP-15 shipped: Jupiter's balances carry the wallet's NFTs, and
   * a collector on a keyless Mainnet install read one token row of "1" for each
   * one. The mint account says supply 1 at 0 decimals; that is enough to know.
   */
  it('keeps a one-of-one out of the token list entirely', async () => {
    stubJupiter({
      balances: {
        [MINT]: { amount: '1500000', uiAmount: 1.5 },
        [MINT_B]: { amount: '1', uiAmount: 1 },
      },
    });
    stubMintAccounts(
      (mint) => (mint === MINT_B ? oneOfOneAccount() : mintAccount(6, TOKEN_PROGRAM_ID)),
      () => 1_500_000n,
    );

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens.map((token) => token.mint)).toEqual([MINT]);
  });

  /**
   * "Unconfirmed" is a sentence about the endpoint — the line under the list tells
   * the user the chain would not back a holding up. The chain backed this one up
   * perfectly well; it is simply not a token, and saying otherwise would send the
   * user looking for an endpoint problem that is not there.
   */
  it('does not count a one-of-one as a holding the chain would not confirm', async () => {
    stubJupiter({
      balances: {
        [MINT]: { amount: '1500000', uiAmount: 1.5 },
        [MINT_B]: { amount: '1', uiAmount: 1 },
      },
    });
    stubMintAccounts(
      (mint) => (mint === MINT_B ? oneOfOneAccount() : mintAccount(6, TOKEN_PROGRAM_ID)),
      () => 1_500_000n,
    );

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensOmitted).toBeUndefined();
  });

  it('still calls a supply-1 mint with decimals a token', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '1', uiAmount: 0.000001 } } });
    // One whole unit of a six-decimal mint: divisible, so a token however small the supply.
    stubMintAccounts(() => mintAccount(6, TOKEN_PROGRAM_ID, true, 1n), () => 1n);

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens.map((token) => token.mint)).toEqual([MINT]);
    expect(balances.tokens[0].decimals).toBe(6);
  });

  it('still calls a zero-decimal mint with a real supply a token', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '3', uiAmount: 3 } } });
    stubMintAccounts(() => mintAccount(0, TOKEN_PROGRAM_ID, true, 21_000_000n), () => 3n);

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens.map((token) => token.mint)).toEqual([MINT]);
  });

  /** Fewer accounts asked about, never more: the token path gets cheaper, not slower. */
  it('never reads a token account for a one-of-one', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '1', uiAmount: 1 } } });
    const batchSizes = stubMintAccounts(() => oneOfOneAccount());

    await heliusService.getTokenBalances(TEST_ADDRESS);

    // The mint pass, and no token-account pass at all.
    expect(batchSizes).toEqual([1]);
  });

  /**
   * A wallet of nothing but collectibles read correctly is an empty token list,
   * not an unreadable one: the endpoint answered every question it was asked.
   */
  it('reports an empty token list, not an unavailable one, for a wallet of only collectibles', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '1', uiAmount: 1 } } });
    stubMintAccounts(() => oneOfOneAccount());

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens).toEqual([]);
    expect(balances.tokensError).toBeUndefined();
    expect(balances.tokensSource).toBe('jupiter');
    expect(balances.tokensOmitted).toBeUndefined();
    expect(balances.collectibles).toEqual([MINT]);
  });

  it('hands the one-of-ones back as mints, without asking anything about them', async () => {
    const requested = stubJupiter({
      balances: {
        [MINT]: { amount: '1500000', uiAmount: 1.5 },
        [MINT_B]: { amount: '1', uiAmount: 1 },
      },
    });
    stubMintAccounts(
      (mint) => (mint === MINT_B ? oneOfOneAccount() : mintAccount(6, TOKEN_PROGRAM_ID)),
      () => 1_500_000n,
    );

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.collectibles).toEqual([MINT_B]);
    // Nothing was fetched about it: no metadata host, no image host, no second discovery call.
    expect(requested.filter((url) => url.startsWith(`${JUPITER_BALANCES_URL}/`))).toHaveLength(1);
    expect(requested.some((url) => url.includes('arweave') || url.includes('ipfs'))).toBe(false);
  });

  it('leaves collectibles off a list the RPC served itself', async () => {
    runtime.urls = [A];
    stubTokenAccounts(() => oneClassic());

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensSource).toBe('rpc');
    expect(balances.collectibles).toBeUndefined();
  });

  it('leaves today\'s unavailable state exactly as it was when no mint can be confirmed', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '5', uiAmount: 5 } } });
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockRejectedValue(new Error('503 Service Unavailable: {}'));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens).toEqual([]);
    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(balances.lamports).toBe('5000');
  });

  it('batches the mint reads at ten, the measured publicnode cap', async () => {
    const held = Array.from({ length: 25 }, (_, index) => new PublicKey(Buffer.alloc(32, index + 1)).toBase58());
    stubJupiter({ balances: Object.fromEntries(held.map((mint) => [mint, { amount: '1', uiAmount: 1 }])) });
    const batchSizes = stubMintAccounts(() => mintAccount(9, TOKEN_PROGRAM_ID));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    // Twenty-five mints in three batches, then their twenty-five token accounts.
    expect(batchSizes).toEqual([MINT_INFO_BATCH, MINT_INFO_BATCH, 5, MINT_INFO_BATCH, MINT_INFO_BATCH, 5]);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(MINT_INFO_BATCH);
    expect(balances.tokens).toHaveLength(25);
  });

  it('stops at the cap and says how many holdings it did not read', async () => {
    const held = Array.from({ length: JUPITER_MAX_TOKENS + 12 }, (_, index) => {
      const bytes = Buffer.alloc(32);
      bytes.writeUInt32BE(index + 1, 0);
      return new PublicKey(bytes).toBase58();
    });
    stubJupiter({ balances: Object.fromEntries(held.map((mint) => [mint, { amount: '1', uiAmount: 1 }])) });
    const batchSizes = stubMintAccounts(() => mintAccount(9, TOKEN_PROGRAM_ID));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens).toHaveLength(JUPITER_MAX_TOKENS);
    // The twelve past the cap were never asked about, so nothing is claimed about them.
    expect(balances.tokensOmitted).toEqual({ unconfirmed: 0, beyondCap: 12 });
    // The cap bounds both passes: 200 mint accounts and 200 token accounts, no more.
    expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(2 * JUPITER_MAX_TOKENS);
  });

  /**
   * The privacy gate has to fail closed. `runtimeSettings`' build defaults carry no
   * `rpcUrl` and no `heliusApiKey`, which is exactly the shape `jupiterEnabledFor`
   * says yes to — so a worker that did not answer must not be what sends a
   * configured user's address to a third party.
   */
  it('is not asked when the settings read itself failed', async () => {
    runtime.settingsUnavailable = true;
    const requested = stubJupiter({ balances: { [MINT]: { amount: '1', uiAmount: 1 } } });
    stubMintAccounts(() => mintAccount(6, TOKEN_PROGRAM_ID));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(balances.tokens).toEqual([]);
    expect(requested.some((url) => url.includes('jup.ag'))).toBe(false);
  });

  it('is not asked at all on devnet', async () => {
    runtime.settings.cluster = 'devnet';
    runtime.urls = [PUBLIC_DEVNET];
    const requested = stubJupiter({ balances: { [MINT]: { amount: '1', uiAmount: 1 } } });
    stubMintAccounts(() => mintAccount(6, TOKEN_PROGRAM_ID));

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(balances.tokens).toEqual([]);
    expect(requested.some((url) => url.includes('jup.ag'))).toBe(false);
  });

  it('is not asked when the user configured their own RPC URL', async () => {
    runtime.settings.rpcUrl = CUSTOM;
    runtime.urls = [CUSTOM, PUBLICNODE];
    const requested = stubJupiter({ balances: { [MINT]: { amount: '1', uiAmount: 1 } } });

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(requested.some((url) => url.includes('jup.ag'))).toBe(false);
  });

  it('is not asked when the user entered a Helius key', async () => {
    runtime.settings.heliusApiKey = FAKE_KEY;
    runtime.urls = [HELIUS, PUBLICNODE];
    const requested = stubJupiter({ balances: { [MINT]: { amount: '1', uiAmount: 1 } } });

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(requested.some((url) => url.includes('jup.ag'))).toBe(false);
  });

  it('is not asked when the RPC served the token accounts itself', async () => {
    vi.restoreAllMocks();
    vi.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(5_000);
    stubTokenAccounts((_url, program) => (program === CLASSIC ? oneClassic() : none()));
    const requested = stubJupiter({ balances: { [MINT_B]: { amount: '1', uiAmount: 1 } } });

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokensSource).toBe('rpc');
    expect(balances.tokens.map((token) => token.mint)).toEqual([MINT]);
    expect(balances.tokens[0].tokenAccount).toBe(TOKEN_ACCOUNT);
    expect(requested.some((url) => url.includes('jup.ag'))).toBe(false);
  });

  it('degrades to today\'s state when Jupiter itself refuses', async () => {
    stubFetch((url) => (url.includes('jup.ag') ? new Response('slow down', { status: 429 }) : rpcError(-32601, 'no')));
    const mintReads = vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo');

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens).toEqual([]);
    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
    expect(balances.tokensSource).toBeUndefined();
    // Nothing discovered means nothing to confirm; the chain is not asked for nothing.
    expect(mintReads).not.toHaveBeenCalled();
  });

  it('shows a mint the search could not name, for the on-chain metadata lookup to name later', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '42', uiAmount: 42 } }, search: [] });
    stubMintAccounts(() => mintAccount(0, TOKEN_PROGRAM_ID), () => 42n);

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens[0]).toEqual({ mint: MINT, amount: '42', decimals: 0, programId: CLASSIC });
  });

  it('confirms nothing when the token-account pass fails, leaving today\'s state', async () => {
    stubJupiter({ balances: { [MINT]: { amount: '5', uiAmount: 5 } } });
    let call = 0;
    vi.spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockImplementation(async (keys) => {
      // The mints read fine; the token accounts are what this endpoint gives up on.
      if (++call > 1) throw new Error('503 Service Unavailable: {}');
      return keys.map(() => mintAccount(6, TOKEN_PROGRAM_ID));
    });

    const balances = await heliusService.getTokenBalances(TEST_ADDRESS);

    expect(balances.tokens).toEqual([]);
    expect(balances.tokensError).toBe(TOKENS_UNAVAILABLE);
  });
});

describe('mintFactsFrom', () => {
  const MINT_KEY = new PublicKey(MINT);

  function account(owner: PublicKey, fill: (data: Buffer) => void, size = 82): AccountInfo<Buffer> {
    const data = Buffer.alloc(size);
    fill(data);
    return { executable: false, owner, lamports: 1, data };
  }

  it('reads decimals, supply and the owning token program from an initialised mint', () => {
    const info = account(TOKEN_PROGRAM_ID, (data) => {
      data.writeBigUInt64LE(1_000_000_000_000n, 36);
      data.writeUInt8(9, 44);
      data.writeUInt8(1, 45);
    });

    expect(mintFactsFrom(MINT_KEY, info)).toEqual({
      decimals: 9,
      programId: CLASSIC,
      supply: 1_000_000_000_000n,
      isOneOfOne: false,
    });
  });

  it('reads a Token-2022 mint whose account carries extensions past the base layout', () => {
    const info = account(
      TOKEN_2022_PROGRAM_ID,
      (data) => {
        data.writeBigUInt64LE(500n, 36);
        data.writeUInt8(2, 44);
        data.writeUInt8(1, 45);
        data.writeUInt8(1, 165); // account type: mint
      },
      300,
    );

    expect(mintFactsFrom(MINT_KEY, info)).toEqual({
      decimals: 2,
      programId: TOKEN_2022,
      supply: 500n,
      isOneOfOne: false,
    });
  });

  /** The real Frog #8699 shape, read from mainnet: supply 1, decimals 0, and not a token. */
  it('calls a supply-1 zero-decimal mint a one-of-one', () => {
    const info = account(TOKEN_PROGRAM_ID, (data) => {
      data.writeBigUInt64LE(1n, 36);
      data.writeUInt8(0, 44);
      data.writeUInt8(1, 45);
    });

    expect(mintFactsFrom(MINT_KEY, info)).toEqual({
      decimals: 0,
      programId: CLASSIC,
      supply: 1n,
      isOneOfOne: true,
    });
  });

  it.each([
    ['supply 1 with decimals', 1n, 6],
    ['supply 2 without decimals', 2n, 0],
    ['a burned one-of-one, supply 0', 0n, 0],
    ['a whole fungible supply at 0 decimals', 1_000_000n, 0],
  ])('does not call %s a one-of-one', (_label, supply, decimals) => {
    const info = account(TOKEN_PROGRAM_ID, (data) => {
      data.writeBigUInt64LE(supply, 36);
      data.writeUInt8(decimals, 44);
      data.writeUInt8(1, 45);
    });

    expect(mintFactsFrom(MINT_KEY, info)?.isOneOfOne).toBe(false);
  });

  it.each([
    ['no account at all', null],
    [
      'an uninitialised mint',
      account(TOKEN_PROGRAM_ID, (data) => {
        data.writeUInt8(6, 44);
        data.writeUInt8(0, 45);
      }),
    ],
    [
      'an account owned by the system program',
      account(SystemProgram.programId, (data) => {
        data.writeUInt8(6, 44);
        data.writeUInt8(1, 45);
      }),
    ],
    ['an account too short to be a mint', account(TOKEN_PROGRAM_ID, () => {}, 40)],
  ])('confirms nothing from %s', (_label, info) => {
    expect(mintFactsFrom(MINT_KEY, info as AccountInfo<Buffer> | null)).toBeUndefined();
  });
});
