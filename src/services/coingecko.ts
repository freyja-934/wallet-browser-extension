import { API_ENDPOINTS } from '../config/constants';

export interface TokenPrice {
  mint: string;
  price: number;
  priceChange24h: number;
  lastUpdated: number;
}

interface PriceCache {
  [mint: string]: TokenPrice;
}

/** CoinGecko lists at most 50 contract addresses per request. */
const TOKEN_PRICE_CHUNK = 50;

/**
 * USD prices from CoinGecko's public API. Every failure throws for the caller
 * (the prices query) to render as "—"; nothing here logs, sleeps, or returns
 * a stale price as though it were current. Prices are cached for five minutes.
 */
class CoinGeckoService {
  private priceCache: PriceCache = {};
  private cacheTimeout = 5 * 60 * 1000;

  async getSolanaPrice(): Promise<TokenPrice> {
    const cached = this.getCachedPrice('solana');
    if (cached) return cached;

    const response = await fetch(
      `${API_ENDPOINTS.COINGECKO_PRICE}?ids=solana&vs_currencies=usd&include_24hr_change=true`,
    );
    if (!response.ok) {
      throw new Error(`CoinGecko ${response.status}`);
    }
    const data = (await response.json()) as { solana?: { usd?: number; usd_24h_change?: number } };
    if (typeof data.solana?.usd !== 'number') {
      throw new Error('CoinGecko returned no SOL price');
    }
    const price: TokenPrice = {
      mint: 'solana',
      price: data.solana.usd,
      priceChange24h: data.solana.usd_24h_change || 0,
      lastUpdated: Date.now(),
    };
    this.priceCache['solana'] = price;
    return price;
  }

  /** Prices by mint; mints CoinGecko does not know are simply absent from the map. */
  async getTokenPrices(mints: string[]): Promise<Map<string, TokenPrice>> {
    const prices = new Map<string, TokenPrice>();
    const uncached: string[] = [];
    for (const mint of mints) {
      const cached = this.getCachedPrice(mint);
      if (cached) prices.set(mint, cached);
      else uncached.push(mint);
    }
    if (uncached.length === 0) return prices;

    for (const chunk of this.chunkArray(uncached, TOKEN_PRICE_CHUNK)) {
      const response = await fetch(
        `${API_ENDPOINTS.COINGECKO_TOKEN_PRICE}?contract_addresses=${chunk.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      );
      if (!response.ok) {
        throw new Error(`CoinGecko ${response.status}`);
      }
      const data = (await response.json()) as Record<string, { usd?: number; usd_24h_change?: number } | null>;
      for (const [mint, row] of Object.entries(data)) {
        if (!row || typeof row.usd !== 'number') continue;
        const price: TokenPrice = {
          mint,
          price: row.usd,
          priceChange24h: row.usd_24h_change || 0,
          lastUpdated: Date.now(),
        };
        this.priceCache[mint] = price;
        prices.set(mint, price);
      }
    }
    return prices;
  }

  private getCachedPrice(mint: string): TokenPrice | null {
    const cached = this.priceCache[mint];
    if (!cached) return null;
    return Date.now() - cached.lastUpdated > this.cacheTimeout ? null : cached;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

export const coinGeckoService = new CoinGeckoService();
