import { PublicKey } from '@solana/web3.js';
import { coinGeckoService, type TokenPrice } from './coingecko';
import { heliusService, type TokenBalance } from './helius';

export interface WalletBalances {
  /** SOL as a float, for the current UI. Prefer `lamports`. */
  solBalance: number;
  /** Exact balance in lamports, as a decimal string. */
  lamports: string;
  tokens: TokenBalance[];
  /** Set when the token-account call failed on every endpoint; `tokens` is then empty, not zero. See `TOKENS_UNAVAILABLE`. */
  tokensError?: string;
  /** The token-account call found no endpoint reachable at all. */
  endpointsUnreachable?: boolean;
}

/** USD prices, fetched apart from balances so a CoinGecko failure never hides a balance. */
export interface WalletPrices {
  sol: TokenPrice;
  tokens: Map<string, TokenPrice>;
}

class WalletService {
  /** Balances only; rejects (with `EndpointsUnreachableError` when nothing answered) rather than resolving zeros. */
  async getTokenBalances(address: string): Promise<WalletBalances> {
    const { nativeBalance, lamports, tokens, tokensError, endpointsUnreachable } =
      await heliusService.getTokenBalances(address);
    return {
      solBalance: nativeBalance,
      lamports,
      tokens,
      ...(tokensError !== undefined ? { tokensError } : {}),
      ...(endpointsUnreachable ? { endpointsUnreachable: true } : {}),
    };
  }

  /** SOL and per-mint prices, or throws; the caller decides what an absent price looks like. */
  async getPrices(mints: string[]): Promise<WalletPrices> {
    const [sol, tokens] = await Promise.all([
      coinGeckoService.getSolanaPrice(),
      coinGeckoService.getTokenPrices(mints),
    ]);
    return { sol, tokens };
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
