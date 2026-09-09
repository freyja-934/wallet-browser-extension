import { Connection, PublicKey } from '@solana/web3.js';
import { getRpcUrl } from '../config/constants';
import { runtimeCluster } from '../lib/runtime-rpc';
import { coinGeckoService } from './coingecko';
import { TokenBalance, heliusService } from './helius';

export interface TokenWithPrice extends TokenBalance {
  usdValue?: number;
  priceChange24h?: number;
}

class WalletService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(getRpcUrl(), 'confirmed');
  }

  async getTokenBalances(address: string): Promise<{
    solBalance: number;
    tokens: TokenWithPrice[];
    totalUsdValue: number;
  }> {
    const { nativeBalance, tokens } = await heliusService.getTokenBalances(address);
    if ((await runtimeCluster()) === 'devnet') {
      return {
        solBalance: nativeBalance,
        tokens: tokens.map((token) => ({ ...token, usdValue: 0, priceChange24h: 0 })),
        totalUsdValue: 0,
      };
    }
    const solPrice = await coinGeckoService.getSolanaPrice();
    const solUsdValue = nativeBalance * solPrice.price;
    const mints = tokens.map((t) => t.mint);
    const prices = await coinGeckoService.getTokenPrices(mints);

    const tokensWithPrices: TokenWithPrice[] = tokens.map((token) => {
      const price = prices.get(token.mint);
      const balance = parseFloat(token.amount) / Math.pow(10, token.decimals);
      return {
        ...token,
        usdValue: price ? balance * price.price : 0,
        priceChange24h: price?.priceChange24h || 0,
      };
    });

    return {
      solBalance: nativeBalance,
      tokens: tokensWithPrices,
      totalUsdValue: solUsdValue + tokensWithPrices.reduce((sum, token) => sum + (token.usdValue || 0), 0),
    };
  }

  async estimateFee(): Promise<number> {
    return 5000;
  }

  getConnection(): Connection {
    return this.connection;
  }

  isValidAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
}

export const walletService = new WalletService();
