import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getHeliusApiKey, getRpcUrl } from '../config/constants';

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

  async getTokenBalances(address: string): Promise<{
    nativeBalance: number;
    tokens: TokenBalance[];
  }> {
    if (this.apiKey) {
      try {
        const url = `${this.baseUrl}/addresses/${address}/balances?api-key=${this.apiKey}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          return {
            nativeBalance: data.nativeBalance / 1e9,
            tokens: data.tokens.map((token: any) => ({
              mint: token.mint,
              amount: token.amount,
              decimals: token.decimals,
              symbol: token.symbol,
              name: token.name,
              logoURI: token.logoURI,
              tokenAccount: token.tokenAccount
            }))
          };
        }
      } catch {
        /* fall through to RPC */
      }
    }

    const pubkey = new PublicKey(address);
    const [lamports, parsed] = await Promise.all([
      this.connection.getBalance(pubkey),
      this.connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
    ]);

    return {
      nativeBalance: lamports / 1e9,
      tokens: parsed.value.map((entry) => {
        const info = entry.account.data.parsed.info;
        return {
          mint: info.mint,
          amount: String(info.tokenAmount.amount),
          decimals: info.tokenAmount.decimals,
          tokenAccount: entry.pubkey.toBase58(),
        };
      }),
    };
  }

  /**
   * Get NFTs for a wallet including compressed NFTs
   */
  async getNFTs(address: string, page: number = 1, limit: number = 100): Promise<{
    items: NFTAsset[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!this.apiKey) {
      return { items: [], total: 0, page, limit };
    }
    try {
      const url = `${this.baseUrl}/addresses/${address}/assets?api-key=${this.apiKey}&page=${page}&limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Helius API error: ${response.statusText}`);
      }
      const data = await response.json();
      const nfts = data.items.filter((item: any) =>
        !item.token_info || item.token_info.supply === '1'
      );
      return {
        items: nfts,
        total: data.total,
        page: data.page,
        limit: data.limit
      };
    } catch (error) {
      console.error('Error fetching NFTs:', error);
      return { items: [], total: 0, page, limit };
    }
  }

  /**
   * Get transaction history with enhanced details
   */
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

      if (!this.apiKey) {
        const sigs = await this.connection.getSignaturesForAddress(new PublicKey(address), { limit });
        return sigs.map((sig) => ({
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
        }));
      }

      let url = `${this.baseUrl}/addresses/${address}/transactions?api-key=${this.apiKey}&limit=${limit}`;
      if (before) url += `&before=${before}`;
      if (type) url += `&type=${type}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Helius API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.map((tx: any) => ({
        signature: tx.signature,
        timestamp: tx.timestamp * 1000,
        type: tx.type,
        status: tx.err ? 'failed' : 'success',
        fee: tx.fee,
        feePayer: tx.feePayer,
        instructions: tx.instructions,
        events: tx.events || [],
        tokenTransfers: tx.tokenTransfers,
        nativeTransfers: tx.nativeTransfers
      }));
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
