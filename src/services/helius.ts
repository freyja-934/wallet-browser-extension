import { PublicKey, type Connection, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { rpcUrlsFor } from '../config/constants';
import { errorMessage } from '../lib/errors';
import { activityFromParsedTx, normalizeHeliusTransfers } from '../lib/parse-history';
import { rpcJson, withRotatedConnection } from '../lib/rpc-rotate';
import { runtimeRpcUrls, runtimeSettings } from '../lib/runtime-rpc';

const NFT_INTERFACES = new Set([
  'V1_NFT',
  'LEGACY_NFT',
  'ProgrammableNFT',
  'MplCoreAsset',
]);

const PARSE_BATCH = 5;

/** Public Solana RPC has getTransaction(jsonParsed), not getParsedTransactions. */
async function fetchParsedTransactions(
  connection: Connection,
  signatures: string[],
): Promise<Array<ParsedTransactionWithMeta | null>> {
  const out: Array<ParsedTransactionWithMeta | null> = [];
  for (let i = 0; i < signatures.length; i += PARSE_BATCH) {
    const chunk = signatures.slice(i, i + PARSE_BATCH);
    const rows = await Promise.all(
      chunk.map((signature) =>
        connection
          .getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed',
          })
          .catch(() => null),
      ),
    );
    out.push(...rows);
  }
  return out;
}

export interface TokenBalance {
  mint: string;
  amount: string;
  decimals: number;
  symbol?: string;
  name?: string;
  logoURI?: string;
  tokenAccount: string;
}

export interface TokenBalances {
  /** SOL as a float, for the current UI. Prefer `lamports`. */
  nativeBalance: number;
  /** Exact balance in lamports, as a decimal string. */
  lamports: string;
  tokens: TokenBalance[];
  /** Set when the token-account call failed on every endpoint; `tokens` is then empty, not zero. */
  tokensError?: string;
}

export interface NFTAsset {
  id: string;
  content: {
    metadata: {
      name: string;
      symbol: string;
      description?: string;
    };
    files?: Array<{
      uri: string;
      mime?: string;
    }>;
    links?: {
      image?: string;
      external_url?: string;
    };
  };
  compression?: {
    compressed: boolean;
    tree: string;
    leaf_id: number;
  };
  grouping?: Array<{
    group_key: string;
    group_value: string;
  }>;
  ownership: {
    owner: string;
    frozen: boolean;
  };
  royalty?: {
    basis_points: number;
    primary_sale_happened: boolean;
  };
}

export interface Transaction {
  signature: string;
  timestamp: number;
  type: string;
  status: 'success' | 'failed';
  fee: number;
  feePayer: string;
  instructions: any[];
  events: TransactionEvent[];
  tokenTransfers?: TokenTransfer[];
  nativeTransfers?: NativeTransfer[];
}

export interface TransactionEvent {
  type: string;
  data: any;
}

export interface TokenTransfer {
  mint: string;
  from: string;
  to: string;
  amount: string;
  decimals: number;
}

export interface NativeTransfer {
  from: string;
  to: string;
  amount: number;
}

interface DasAssetsPage<Item> {
  items?: Item[];
  total?: number;
}

interface DasFungibleItem {
  id: string;
  interface?: string;
  content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } };
  token_info?: { decimals?: number; balance?: number; symbol?: string };
}

/**
 * Chain reads for the popup. Every call resolves its endpoint list from the live
 * settings (`runtimeRpcUrls`), so nothing here holds a `Connection` across calls.
 */
class HeliusService {
  private baseUrl: string = 'https://api.helius.xyz/v0';

  /** DAS is a method, not a host: try it on every URL in order. */
  private async das<T>(method: string, params: unknown): Promise<T> {
    return rpcJson<T>(await runtimeRpcUrls(), method, params);
  }

  async getTokenBalances(address: string): Promise<TokenBalances> {
    const pubkey = new PublicKey(address);
    const urls = await runtimeRpcUrls();

    // Two independent rotated calls: a public endpoint that refuses
    // getTokenAccountsByOwner must never discard the SOL balance.
    const lamports = await withRotatedConnection(urls, (connection) => connection.getBalance(pubkey));

    let tokens: TokenBalance[] = [];
    let tokensError: string | undefined;
    try {
      const parsed = await withRotatedConnection(urls, (connection) =>
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
      );
      tokens = parsed.value
        .map((entry) => {
          const info = entry.account.data.parsed.info;
          return {
            mint: info.mint,
            amount: String(info.tokenAmount.amount),
            decimals: info.tokenAmount.decimals,
            tokenAccount: entry.pubkey.toBase58(),
          };
        })
        .filter((token) => token.amount !== '0');
    } catch (error) {
      tokensError = errorMessage(error, 'Token accounts unavailable');
    }

    if (tokens.length > 0) {
      try {
        const das = await this.das<DasAssetsPage<DasFungibleItem>>('getAssetsByOwner', {
          ownerAddress: address,
          page: 1,
          limit: 1000,
          displayOptions: { showFungible: true },
        });
        const meta = new Map((das.items ?? [])
          .filter((item) => item.interface === 'FungibleToken' || item.interface === 'FungibleAsset')
          .map((item) => [item.id, item]));
        for (const token of tokens) {
          const item = meta.get(token.mint);
          if (!item) continue;
          token.name = item.content?.metadata?.name || token.name;
          token.symbol = item.token_info?.symbol || item.content?.metadata?.symbol || token.symbol;
          token.logoURI = item.content?.links?.image || token.logoURI;
        }
      } catch {
        // No endpoint served DAS: the list stands without names, that is not an error.
      }
    }

    return {
      nativeBalance: lamports / 1e9,
      lamports: String(lamports),
      tokens,
      ...(tokensError !== undefined ? { tokensError } : {}),
    };
  }

  async getNFTs(address: string, page: number = 1, limit: number = 100): Promise<{
    items: NFTAsset[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const das = await this.das<DasAssetsPage<NFTAsset>>('getAssetsByOwner', {
        ownerAddress: address,
        page,
        limit,
        displayOptions: { showFungible: false },
      });
      const items = (das.items ?? []).filter((item) => {
        const kind = (item as NFTAsset & { interface?: string }).interface;
        return !kind || NFT_INTERFACES.has(kind);
      });
      return {
        items,
        total: das.total ?? items.length,
        page,
        limit,
      };
    } catch {
      // No endpoint served DAS. Do not console.error — Chrome lists that as an extension error.
      return { items: [], total: 0, page, limit };
    }
  }

  async getTransactionHistory(
    address: string,
    options: {
      limit?: number;
      before?: string;
      type?: string;
    } = {}
  ): Promise<Transaction[]> {
    try {
      const { limit = 100, before, type } = options;
      const settings = await runtimeSettings();
      const apiKey = settings.heliusApiKey;

      if (apiKey && settings.cluster === 'mainnet-beta') {
        let url = `${this.baseUrl}/addresses/${address}/transactions?api-key=${apiKey}&limit=${limit}`;
        if (before) url += `&before=${before}`;
        if (type) url += `&type=${type}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          return data.map((tx: any) => {
            const transfers = normalizeHeliusTransfers(tx);
            return {
              signature: tx.signature,
              timestamp: tx.timestamp * 1000,
              type: tx.type,
              status: tx.err ? 'failed' : 'success',
              fee: tx.fee,
              feePayer: tx.feePayer,
              instructions: tx.instructions,
              events: tx.events || [],
              tokenTransfers: transfers.tokenTransfers,
              nativeTransfers: transfers.nativeTransfers,
            };
          });
        }
      }

      const urls = rpcUrlsFor(settings.cluster, settings);
      const { sigs, parsed } = await withRotatedConnection(urls, async (connection) => {
        const sigs = await connection.getSignaturesForAddress(new PublicKey(address), {
          limit,
          before,
        });
        const parsed = await fetchParsedTransactions(connection, sigs.map((sig) => sig.signature));
        return { sigs, parsed };
      });
      return sigs.map((sig, index) => {
        const tx = parsed[index];
        if (!tx) {
          return {
            signature: sig.signature,
            timestamp: (sig.blockTime ?? 0) * 1000,
            type: 'unknown',
            status: sig.err ? 'failed' : 'success',
            fee: 0,
            feePayer: address,
            instructions: [],
            events: [],
            nativeTransfers: [],
            tokenTransfers: [],
          };
        }
        const activity = activityFromParsedTx(tx, address);
        return {
          signature: sig.signature,
          timestamp: (tx.blockTime ?? sig.blockTime ?? 0) * 1000,
          type: activity.type,
          status: tx.meta?.err || sig.err ? 'failed' : 'success',
          fee: tx.meta?.fee ?? 0,
          feePayer: address,
          instructions: [],
          events: [],
          nativeTransfers: activity.nativeTransfers,
          tokenTransfers: activity.tokenTransfers,
        };
      });
    } catch {
      return [];
    }
  }
}

// Export singleton instance
export const heliusService = new HeliusService();
