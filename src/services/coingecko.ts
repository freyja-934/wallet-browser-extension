import { API_ENDPOINTS } from '../config/constants';

export interface TokenPrice {
  mint: string;
  price: number;
  priceChange24h: number;
  lastUpdated: number;
}

export interface CoinData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
}

interface PriceCache {
  [mint: string]: TokenPrice;
}

class CoinGeckoService {
  private priceCache: PriceCache = {};
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes
  private rateLimitDelay = 1200; // 50 requests per minute = 1.2s between requests
  private lastRequestTime = 0;

  /**
   * Get SOL price in USD
   */
  async getSolanaPrice(): Promise<TokenPrice> {
    const cachedPrice = this.getCachedPrice('solana');
    if (cachedPrice) return cachedPrice;

    await this.enforceRateLimit();

    try {
      const response = await fetch(
        `${API_ENDPOINTS.COINGECKO_PRICE}?ids=solana&vs_currencies=usd&include_24hr_change=true`
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.statusText}`);
      }

      const data = await response.json();
      const price: TokenPrice = {
        mint: 'solana',
        price: data.solana.usd,
        priceChange24h: data.solana.usd_24h_change || 0,
        lastUpdated: Date.now()
      };

      this.priceCache['solana'] = price;
      return price;
    } catch (error) {
      console.error('Error fetching Solana price:', error);
      // Return cached price if available, even if expired
      const expired = this.priceCache['solana'];
      if (expired) return expired;
      throw error;
    }
  }

  /**
   * Get token prices by contract addresses
   */
  async getTokenPrices(mints: string[]): Promise<Map<string, TokenPrice>> {
    const prices = new Map<string, TokenPrice>();
    const uncachedMints: string[] = [];

    // Check cache first
    for (const mint of mints) {
      const cached = this.getCachedPrice(mint);
      if (cached) {
        prices.set(mint, cached);
      } else {
        uncachedMints.push(mint);
      }
    }

    if (uncachedMints.length === 0) {
      return prices;
    }

    await this.enforceRateLimit();

    try {
      // CoinGecko expects contract addresses in chunks
      const chunks = this.chunkArray(uncachedMints, 50); // Max 50 addresses per request
      
      for (const chunk of chunks) {
        const response = await fetch(
          `${API_ENDPOINTS.COINGECKO_TOKEN_PRICE}?contract_addresses=${chunk.join(',')}&vs_currencies=usd&include_24hr_change=true`
        );

        if (!response.ok) {
          console.error(`CoinGecko API error: ${response.statusText}`);
          continue;
        }

        const data = await response.json();
        
        for (const [mint, priceData] of Object.entries(data)) {
          if (priceData && typeof priceData === 'object' && 'usd' in priceData) {
            const price: TokenPrice = {
              mint,
              price: (priceData as any).usd || 0,
              priceChange24h: (priceData as any).usd_24h_change || 0,
              lastUpdated: Date.now()
            };
            
            this.priceCache[mint] = price;
            prices.set(mint, price);
          }
        }
        
        // Rate limit between chunks
        if (chunks.length > 1) {
          await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
        }
      }
    } catch (error) {
      console.error('Error fetching token prices:', error);
    }

    return prices;
  }

  /**
   * Get historical price data for charts
   */
  async getHistoricalPrice(
    tokenId: string,
    days: number = 7
  ): Promise<{
    prices: [number, number][];
    market_caps: [number, number][];
    total_volumes: [number, number][];
  }> {
    await this.enforceRateLimit();

    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/${tokenId}/market_chart?vs_currency=usd&days=${days}`
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching historical prices:', error);
      throw error;
    }
  }

  /**
   * Search for tokens by name or symbol
   */
  async searchTokens(query: string): Promise<CoinData[]> {
    await this.enforceRateLimit();

    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.coins || [];
    } catch (error) {
      console.error('Error searching tokens:', error);
      return [];
    }
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache = {};
  }

  /**
   * Get cached price if not expired
   */
  private getCachedPrice(mint: string): TokenPrice | null {
    const cached = this.priceCache[mint];
    if (!cached) return null;

    const isExpired = Date.now() - cached.lastUpdated > this.cacheTimeout;
    return isExpired ? null : cached;
  }

  /**
   * Enforce rate limiting
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// Export singleton instance
export const coinGeckoService = new CoinGeckoService();
