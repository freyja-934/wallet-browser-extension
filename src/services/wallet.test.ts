import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletService } from './wallet';

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Stub `fetch` with a per-URL responder; returns the URLs requested, in order. */
function stubFetch(respond: (url: string) => Response): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      requested.push(url);
      return respond(url);
    }),
  );
  return requested;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('walletService.getPrices', () => {
  // CoinGecko caches a SOL price for five minutes, so the failing case runs before one is cached.
  it('rejects when the SOL price itself fails, so the total shows a dash', async () => {
    stubFetch(() => new Response('slow down', { status: 429 }));

    await expect(walletService.getPrices([MINT])).rejects.toThrow('CoinGecko 429');
  });

  it('keeps the SOL price when the token-price call is rate limited', async () => {
    const requested = stubFetch((url) =>
      url.includes('/token_price/')
        ? new Response('slow down', { status: 429 })
        : Response.json({ solana: { usd: 150.5, usd_24h_change: 1.25 } }),
    );

    const prices = await walletService.getPrices([MINT]);

    expect(prices.sol).toMatchObject({ mint: 'solana', price: 150.5, priceChange24h: 1.25 });
    expect(prices.tokens).toEqual(new Map());
    expect(requested).toHaveLength(2);
  });
});
