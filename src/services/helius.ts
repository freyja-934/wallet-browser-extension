import { Connection, PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getHeliusApiKey, getRpcUrl } from '../config/constants';
import { activityFromParsedTx, normalizeHeliusTransfers } from '../lib/parse-history';
import { runtimeCluster, runtimeRpcUrl } from '../lib/runtime-rpc';

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

class HeliusService {
  private connection: Connection;
  private apiKey: string;
  private baseUrl: string = 'https://api.helius.xyz/v0';

  constructor() {
    this.apiKey = getHeliusApiKey();
    this.connection = new Connection(getRpcUrl(), 'confirmed');
  }

  private async conn(): Promise<Connection> {
    return new Connection(await runtimeRpcUrl(), 'confirmed');
  }

  private async das<T>(method: string, params: unknown): Promise<T> {
    const response = await fetch(await runtimeRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'cinder', method, params }),
    });
    if (!response.ok) {
      throw new Error(`DAS ${method} failed: ${response.status}`);
    }
    const json = await response.json() as { result?: T; error?: { message?: string } };
    if (json.error) {
      throw new Error(json.error.message || `DAS ${method} failed`);
    }
    return json.result as T;
  }

  async getTokenBalances(address: string): Promise<{
    nativeBalance: number;
    tokens: TokenBalance[];
  }> {
    const pubkey = new PublicKey(address);
    const connection = await this.conn();
    const [lamports, parsed] = await Promise.all([
      connection.getBalance(pubkey),
      connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
    ]);

    const tokens: TokenBalance[] = parsed.value
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

    if (this.apiKey) {
      try {
        const das = await this.das<{ items?: Array<{
          id: string;
          interface?: string;
          content?: { metadata?: { name?: string; symbol?: string }; links?: { image?: string } };
          token_info?: { decimals?: number; balance?: number; symbol?: string };
        }> }>('getAssetsByOwner', {
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
        /* keep RPC token list */
      }
    }

    return {
      nativeBalance: lamports / 1e9,
      tokens,
    };
  }

  async getNFTs(address: string, page: number = 1, limit: number = 100): Promise<{
    items: NFTAsset[];
    total: number;
    page: number;
    limit: number;
  }> {
    try {
      const das = await this.das<{ items?: NFTAsset[]; total?: number }>('getAssetsByOwner', {
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
    } catch (error) {
      console.error('Error fetching NFTs:', error);
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

      if (this.apiKey && (await runtimeCluster()) === 'mainnet-beta') {
        let url = `${this.baseUrl}/addresses/${address}/transactions?api-key=${this.apiKey}&limit=${limit}`;
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

      const connection = await this.conn();
      const sigs = await connection.getSignaturesForAddress(new PublicKey(address), {
        limit,
        before,
      });
      const parsed = await fetchParsedTransactions(connection, sigs.map((sig) => sig.signature));
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
    } catch (error) {
      console.error('Error fetching transaction history:', error);
      return [];
    }
  }

  /**
   * Get asset proof for compressed NFT transfers
   */
  async getAssetProof(assetId: string): Promise<{
    root: string;
    proof: string[];
    nodeIndex: number;
    leaf: string;
    treeId: string;
  }> {
    try {
      const url = `${this.baseUrl}/assets/${assetId}/proof?api-key=${this.apiKey}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Helius API error: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error fetching asset proof:', error);
      throw error;
    }
  }

  /**
   * Get RPC connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get current slot
   */
  async getCurrentSlot(): Promise<number> {
    return this.connection.getSlot();
  }

  /**
   * Get recent blockhash
   */
  async getRecentBlockhash() {
    return this.connection.getLatestBlockhash();
  }

  /**
   * Send transaction
   */
  async sendTransaction(signedTx: Buffer | Uint8Array): Promise<string> {
    const signature = await this.connection.sendRawTransaction(signedTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    
    // Wait for confirmation
    const latestBlockhash = await this.connection.getLatestBlockhash();
    await this.connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    });
    
    return signature;
  }

  /**
   * Simulate transaction
   */
  async simulateTransaction(transaction: any) {
    return this.connection.simulateTransaction(transaction);
  }
}

// Export singleton instance
export const heliusService = new HeliusService();
