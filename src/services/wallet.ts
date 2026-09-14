import type { TokenNames } from '../lib/token-metadata';
import { coinGeckoService, type TokenPrice } from './coingecko';
import { heliusService, type OmittedHoldings, type TokenBalance, type TokenNameRef } from './helius';

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
  /** Which source listed the mints: the RPC's token accounts, or the keyless Jupiter fallback. */
  tokensSource?: 'rpc' | 'jupiter';
  /** Holdings discovered but not shown, split by reason: not confirmed on-chain, or past the per-refresh cap. */
  tokensOmitted?: OmittedHoldings;
  /**
   * Mints the keyless path found to be one-of-ones, kept out of `tokens` and
   * handed to the collectibles tab. Addresses only: naming and picturing them is
   * that tab's work, and none of it happens here.
   */
  collectibles?: string[];
}

/** USD prices, fetched apart from balances so a CoinGecko failure never hides a balance. */
export interface WalletPrices {
  sol: TokenPrice;
  tokens: Map<string, TokenPrice>;
}

class WalletService {
  /** Balances only; rejects (with `EndpointsUnreachableError` when nothing answered) rather than resolving zeros. */
  async getTokenBalances(address: string): Promise<WalletBalances> {
    const {
      nativeBalance,
      lamports,
      tokens,
      tokensError,
      endpointsUnreachable,
      tokensSource,
      tokensOmitted,
      collectibles,
    } = await heliusService.getTokenBalances(address);
    return {
      solBalance: nativeBalance,
      lamports,
      tokens,
      ...(tokensError !== undefined ? { tokensError } : {}),
      ...(endpointsUnreachable ? { endpointsUnreachable: true } : {}),
      ...(tokensSource !== undefined ? { tokensSource } : {}),
      ...(tokensOmitted !== undefined ? { tokensOmitted } : {}),
      ...(collectibles !== undefined ? { collectibles } : {}),
    };
  }

  /**
   * SOL and per-mint prices. The two reads are independent: a failed token-price
   * call leaves `tokens` empty, while a failed SOL price still throws so the UI
   * shows `—` rather than a total that is missing its largest part.
   */
  async getPrices(mints: string[]): Promise<WalletPrices> {
    const [sol, tokens] = await Promise.all([
      coinGeckoService.getSolanaPrice(),
      coinGeckoService.getTokenPrices(mints).catch(() => new Map<string, TokenPrice>()),
    ]);
    return { sol, tokens };
  }

  /** Names for the tokens DAS left unnamed, keyed by mint; see `heliusService.getTokenNames`. */
  async getTokenNames(tokens: TokenNameRef[]): Promise<Record<string, TokenNames>> {
    return heliusService.getTokenNames(tokens);
  }
}

export const walletService = new WalletService();
