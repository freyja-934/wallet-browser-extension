import { afterEach, describe, expect, it, vi } from 'vitest';
import { JUPITER_SEARCH_BATCH } from '../config/constants';
import { TEST_ADDRESS } from '../test/fixtures';
import {
  JUPITER_MAX_RESPONSE,
  JUPITER_TIMEOUT_MS,
  fetchJupiterBalances,
  fetchJupiterTokenInfo,
  logoUrl,
} from './jupiter';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** `count` distinct 43-character base58 strings — mint-shaped, and far cheaper than keygen. */
function mints(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    let n = index;
    let tail = '';
    do {
      tail = BASE58[n % 58] + tail;
      n = Math.floor(n / 58);
    } while (n > 0);
    return `Mint${'1'.repeat(43)}`.slice(0, 43 - tail.length) + tail;
  });
}

/** Record every request, and answer it. `init` is kept so the call's own shape can be asserted. */
function stubFetch(respond: (url: string) => Response | Promise<Response>): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return respond(String(input));
    }),
  );
  return calls;
}

/** A body the service has to read itself, with whatever headers the test wants on it. */
function body(text: string, init: ResponseInit = {}): Response {
  return new Response(text, { status: 200, ...init });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchJupiterBalances', () => {
  it('reads the integer amount per mint and ignores the native SOL key', async () => {
    const calls = stubFetch(() =>
      Response.json({
        SOL: { amount: '2114588590', uiAmount: 2.11458859, slot: 447075442, isFrozen: false },
        [USDC]: { amount: '1500000', uiAmount: 1.5, slot: 447075442, isFrozen: false },
      }),
    );

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toEqual([{ mint: USDC, amount: '1500000' }]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://lite-api.jup.ag/ultra/v1/balances/${TEST_ADDRESS}`);
    // No cookie ever rides along with the address.
    expect(calls[0].init?.credentials).toBe('omit');
    expect(calls[0].init?.method).toBe('GET');
  });

  it('never reads the float uiAmount, even when it disagrees with the integer amount', async () => {
    stubFetch(() => Response.json({ [USDC]: { amount: '1', uiAmount: 999.999 } }));

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toEqual([{ mint: USDC, amount: '1' }]);
  });

  it('carries a whale-shaped payload through without losing or inventing a holding', async () => {
    const held = mints(4198);
    const payload: Record<string, unknown> = { SOL: { amount: '12280725860', uiAmount: 12.28 } };
    for (const [index, mint] of held.entries()) payload[mint] = { amount: String(index + 1), uiAmount: index + 1 };
    stubFetch(() => Response.json(payload));

    const holdings = await fetchJupiterBalances(TEST_ADDRESS);
    expect(holdings).toBeDefined();
    if (holdings === undefined) throw new Error('Jupiter answered; holdings must be defined');

    expect(holdings).toHaveLength(held.length);
    expect(new Set(holdings.map((holding) => holding.mint))).toEqual(new Set(held));
    expect(holdings.at(-1)).toEqual({ mint: held.at(-1)!, amount: '4198' });
  });

  it('is empty for a wallet holding nothing but SOL', async () => {
    stubFetch(() => Response.json({ SOL: { amount: '0', uiAmount: 0, slot: 1, isFrozen: false } }));

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toEqual([]);
  });

  it('treats a JSON-RPC error envelope as no document, not as an empty wallet', async () => {
    stubFetch(() => Response.json({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: 'cinder' }));

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toBeUndefined();
  });

  it.each([
    ['a zero balance', { [USDC]: { amount: '0', uiAmount: 0 } }],
    ['a key that is not an address', { 'not-a-mint': { amount: '5' } }],
    ['an amount that is a number, not an integer string', { [USDC]: { amount: 1500000 } }],
    ['an amount with a decimal point', { [USDC]: { amount: '1.5' } }],
    ['a negative amount', { [USDC]: { amount: '-5' } }],
    ['an amount past what a u64 holds', { [USDC]: { amount: '99999999999999999999' } }],
    ['a value that is not an object', { [USDC]: 'plenty' }],
    ['a null value', { [USDC]: null }],
    ['a body that is an array', [{ id: USDC, amount: '5' }]],
    ['a body that is a string', 'nope'],
    ['a body that is null', null],
  ])('drops %s rather than passing it on', async (_label, payload) => {
    stubFetch(() => Response.json(payload));

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toEqual([]);
  });

  it.each([
    ['malformed JSON', () => body('{"SOL": {"amount": ')],
    ['a body truncated mid-object', () => body(`{"${USDC}":{"amount":"15000`)],
    ['HTML from a proxy', () => body('<html><body>429</body></html>')],
    ['429', () => new Response('slow down', { status: 429 })],
    ['500', () => new Response('boom', { status: 500 })],
    ['404', () => new Response('nope', { status: 404 })],
    [
      'a rejected fetch',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('resolves undefined, never throwing, on %s', async (_label, respond) => {
    stubFetch(respond as () => Response);

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toBeUndefined();
  });

  it('refuses a body larger than the size guard before parsing it', async () => {
    const huge = `{"${USDC}":{"amount":"1","pad":"${'x'.repeat(JUPITER_MAX_RESPONSE)}"}}`;
    stubFetch(() => body(huge));

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toBeUndefined();
  });

  it('refuses a body whose declared content-length is over the guard, without reading it', async () => {
    const text = vi.fn();
    stubFetch(
      () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-length': String(JUPITER_MAX_RESPONSE + 1) }),
          text,
        }) as unknown as Response,
    );

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toBeUndefined();
    expect(text).not.toHaveBeenCalled();
  });

  /**
   * A chunked response declares no `content-length`, so the cheap pre-check cannot
   * see it coming. The guard has to bound the download, not just the parse: without
   * the reader the whole body is materialised as a string first, which is a 50 MB
   * allocation in the popup for a body that is then thrown away.
   */
  it('stops reading a chunked body the moment it passes the guard, and cancels the transfer', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(100_000));
    let pushed = 0;
    let cancelled = false;
    stubFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pushed += 1;
              // Finite, so that without the guard `response.text()` completes and the
              // test fails on the assertions rather than hanging: 3 MB against a 2 MB cap.
              if (pushed > 30) return controller.close();
              controller.enqueue(chunk);
            },
            cancel() {
              cancelled = true;
            },
          }),
          // No content-length: exactly what `Transfer-Encoding: chunked` looks like.
          { status: 200 },
        ),
    );

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toBeUndefined();

    expect(cancelled).toBe(true);
    // It gave up just past the cap rather than reading everything the host sent; the
    // slack is the one chunk the stream queues ahead of the reader.
    expect(pushed * chunk.byteLength).toBeLessThanOrEqual(JUPITER_MAX_RESPONSE + 2 * chunk.byteLength);
  });

  it('reads a chunked body that stays under the guard', async () => {
    const text = JSON.stringify({ [USDC]: { amount: '1500000', uiAmount: 1.5 } });
    const halves = [text.slice(0, 10), text.slice(10)].map((part) => new TextEncoder().encode(part));
    stubFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const part of halves) controller.enqueue(part);
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );

    await expect(fetchJupiterBalances(TEST_ADDRESS)).resolves.toEqual([{ mint: USDC, amount: '1500000' }]);
  });

  it('gives up on a request that never answers, and does not throw', async () => {
    vi.useFakeTimers();
    // A host that accepts the connection and then says nothing: the only thing that
    // ends this request is the service's own abort, exactly as with a real `fetch`.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );

    const pending = fetchJupiterBalances(TEST_ADDRESS);
    await vi.advanceTimersByTimeAsync(JUPITER_TIMEOUT_MS + 1);

    await expect(pending).resolves.toBeUndefined();
  });

  it('asks nothing at all for an address that is not base58', async () => {
    const calls = stubFetch(() => Response.json({}));

    await expect(fetchJupiterBalances('../../etc/passwd')).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it('does not fetch once the caller has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const calls = stubFetch(() => Response.json({}));

    await expect(fetchJupiterBalances(TEST_ADDRESS, controller.signal)).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});

describe('fetchJupiterTokenInfo', () => {
  it('keeps name, symbol and icon, and nothing else the row carries', async () => {
    stubFetch(() =>
      Response.json([
        {
          id: USDC,
          name: 'USD Coin',
          symbol: 'USDC',
          icon: 'https://example.test/usdc.png',
          // Every number below is read from the chain or not at all; none may survive this call.
          decimals: 2,
          tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          usdPrice: 0.9998,
        },
      ]),
    );

    const info = await fetchJupiterTokenInfo([USDC]);

    expect(info.get(USDC)).toEqual({
      mint: USDC,
      name: 'USD Coin',
      symbol: 'USDC',
      logoURI: 'https://example.test/usdc.png',
    });
    expect(info.get(USDC)).not.toHaveProperty('decimals');
  });

  it('batches at the endpoint cap of 100 mints per call', async () => {
    const wanted = mints(250);
    const calls = stubFetch(() => Response.json([]));

    await fetchJupiterTokenInfo(wanted);

    expect(calls).toHaveLength(3);
    const asked = calls.map((call) => decodeURIComponent(new URL(call.url).searchParams.get('query')!).split(','));
    expect(asked.map((batch) => batch.length)).toEqual([JUPITER_SEARCH_BATCH, JUPITER_SEARCH_BATCH, 50]);
    expect(asked.flat()).toEqual(wanted);
  });

  it('asks once for a mint listed twice', async () => {
    const calls = stubFetch(() => Response.json([]));

    await fetchJupiterTokenInfo([USDC, USDC, WSOL]);

    expect(decodeURIComponent(new URL(calls[0].url).searchParams.get('query')!)).toBe(`${USDC},${WSOL}`);
  });

  it('ignores a row for a mint nobody asked about', async () => {
    stubFetch(() => Response.json([{ id: WSOL, name: 'Wrapped SOL', symbol: 'SOL' }]));

    const info = await fetchJupiterTokenInfo([USDC]);

    expect(info.size).toBe(0);
  });

  it.each([
    ['a row that is not an object', ['USDC']],
    ['a row with no id', [{ name: 'USD Coin' }]],
    ['a body that is an object', { [USDC]: { name: 'USD Coin' } }],
    ['a body that is null', null],
  ])('drops %s', async (_label, payload) => {
    stubFetch(() => Response.json(payload));

    await expect(fetchJupiterTokenInfo([USDC])).resolves.toEqual(new Map());
  });

  it('resolves an empty map, never throwing, when the search refuses', async () => {
    stubFetch(() => new Response('slow down', { status: 429 }));

    await expect(fetchJupiterTokenInfo([USDC])).resolves.toEqual(new Map());
  });

  it('leaves an unnamed mint absent, for the on-chain metadata fallback to name', async () => {
    stubFetch(() => Response.json([{ id: USDC, name: '   ', symbol: '' }]));

    const info = await fetchJupiterTokenInfo([USDC]);

    expect(info.get(USDC)).toEqual({ mint: USDC });
  });

  it('strips the control and bidi characters a hostile symbol could hide in', async () => {
    stubFetch(() => Response.json([{ id: USDC, symbol: 'US‮DC ', name: 'x'.repeat(200) }]));

    const info = await fetchJupiterTokenInfo([USDC]);

    expect(info.get(USDC)?.symbol).toBe('US DC');
    expect(info.get(USDC)?.name).toHaveLength(64);
  });

  it('asks nothing for a mint that is not base58', async () => {
    const calls = stubFetch(() => Response.json([]));

    await expect(fetchJupiterTokenInfo(['<script>'])).resolves.toEqual(new Map());
    expect(calls).toEqual([]);
  });
});

describe('logoUrl', () => {
  it('keeps an https URL as it stands', () => {
    expect(logoUrl('https://example.test/a.png')).toBe('https://example.test/a.png');
  });

  it('rewrites ipfs:// onto a gateway that is not ipfs.io, which 403s an extension origin', () => {
    expect(logoUrl('ipfs://bafyabc123/logo.png')).toBe('https://dweb.link/ipfs/bafyabc123/logo.png');
    expect(logoUrl('ipfs://ipfs/bafyabc123')).toBe('https://dweb.link/ipfs/bafyabc123');
    expect(logoUrl('https://dweb.link/ipfs/bafyabc123')).not.toContain('ipfs.io');
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['http://example.test/a.png'],
    ['/relative.png'],
    ['ipfs://../../etc/passwd'],
    // Starts with an alphanumeric, so the character class lets it through: the
    // browser normalises this to `https://dweb.link/evil.svg`, off the gateway's
    // content-addressed prefix and at a path the token's author chose.
    ['ipfs://a/../../evil.svg'],
    ['ipfs://bafyabc123/./evil.svg'],
    ['ipfs://bafyabc123//evil.svg'],
    [''],
  ])('drops %s', (value) => {
    expect(logoUrl(value)).toBeUndefined();
  });

  it('drops a non-string and an over-long URL', () => {
    expect(logoUrl(42)).toBeUndefined();
    expect(logoUrl(`https://example.test/${'a'.repeat(3000)}.png`)).toBeUndefined();
  });
});
