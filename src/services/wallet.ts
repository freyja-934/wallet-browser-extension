import { PublicKey } from '@solana/web3.js';
import { runtimeCluster } from '../lib/runtime-rpc';
import { coinGeckoService } from './coingecko';
import { TokenBalance, heliusService } from './helius';

export interface TokenWithPrice extends TokenBalance {
  usdValue?: number;
  priceChange24h?: number;
}

export interface WalletBalances {
  /** SOL as a float, for the current UI. Prefer `lamports`. */
  solBalance: number;
  /** Exact balance in lamports, as a decimal string. */
  lamports: string;
  tokens: TokenWithPrice[];
  /** Set when the token-account call failed on every endpoint; `tokens` is then empty, not zero. */
  tokensError?: string;
  totalUsdValue: number;
}

class WalletService {
  async getTokenBalances(address: string): Promise<WalletBalances> {
    const { nativeBalance, lamports, tokens, tokensError } = await heliusService.getTokenBalances(address);
    const passthrough = tokensError !== undefined ? { tokensError } : {};
    if ((await runtimeCluster()) === 'devnet') {
      return {
        solBalance: nativeBalance,
        lamports,
        tokens: tokens.map((token) => ({ ...token, usdValue: 0, priceChange24h: 0 })),
        totalUsdValue: 0,
        ...passthrough,
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
      lamports,
      tokens: tokensWithPrices,
      totalUsdValue: solUsdValue + tokensWithPrices.reduce((sum, token) => sum + (token.usdValue || 0), 0),
      ...passthrough,
    };
  }

  async estimateFee(): Promise<number> {
    return 5000;
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
