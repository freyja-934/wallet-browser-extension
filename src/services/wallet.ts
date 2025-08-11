import {
    TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createTransferInstruction,
    getAccount,
    getAssociatedTokenAddress
} from '@solana/spl-token';
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import { deriveKeypairFromSeed } from '../lib/wallet';
import { coinGeckoService } from './coingecko';
import { TokenBalance, heliusService } from './helius';
import { secureStorage } from './storage';


export interface SendTransactionParams {
  to: string;
  amount: number;
  mint?: string; // If not provided, sends SOL
  priorityFee?: number;
}

export interface TokenWithPrice extends TokenBalance {
  usdValue?: number;
  priceChange24h?: number;
}

class WalletService {
  private connection: Connection;
  private currentKeypair: Keypair | null = null;

  constructor() {
    this.connection = heliusService.getConnection();
  }

  /**
   * Initialize wallet with the active account
   */
  async initialize(accountIndex: number = 0): Promise<void> {
    const vaultData = await secureStorage.getDecryptedVault();
    if (!vaultData) {
      throw new Error('Wallet is locked');
    }

    const { keypair } = deriveKeypairFromSeed(
      Buffer.from(vaultData.seedPhrase),
      accountIndex
    );
    
    this.currentKeypair = keypair;
  }

  /**
   * Get current wallet address
   */
  getAddress(): string {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }
    return this.currentKeypair.publicKey.toBase58();
  }

  /**
   * Get SOL balance
   */
  async getSolBalance(): Promise<number> {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }

    const balance = await this.connection.getBalance(this.currentKeypair.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  /**
   * Get all token balances with USD values
   */
  async getTokenBalances(): Promise<{
    solBalance: number;
    tokens: TokenWithPrice[];
    totalUsdValue: number;
  }> {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }

    const address = this.currentKeypair.publicKey.toBase58();
    
    // Get balances from Helius
    const { nativeBalance, tokens } = await heliusService.getTokenBalances(address);
    
    // Get SOL price
    const solPrice = await coinGeckoService.getSolanaPrice();
    const solUsdValue = nativeBalance * solPrice.price;
    
    // Get token prices
    const mints = tokens.map(t => t.mint);
    const prices = await coinGeckoService.getTokenPrices(mints);
    
    // Combine token data with prices
    const tokensWithPrices: TokenWithPrice[] = tokens.map(token => {
      const price = prices.get(token.mint);
      const balance = parseFloat(token.amount) / Math.pow(10, token.decimals);
      
      return {
        ...token,
        usdValue: price ? balance * price.price : 0,
        priceChange24h: price?.priceChange24h || 0
      };
    });
    
    // Calculate total USD value
    const totalUsdValue = solUsdValue + tokensWithPrices.reduce(
      (sum, token) => sum + (token.usdValue || 0),
      0
    );
    
    return {
      solBalance: nativeBalance,
      tokens: tokensWithPrices,
      totalUsdValue
    };
  }

  /**
   * Send SOL
   */
  async sendSol(params: SendTransactionParams): Promise<string> {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }

    const { to, amount, priorityFee = 0 } = params;
    
    // Create transaction
    const transaction = new Transaction();
    
    // Add priority fee if specified
    if (priorityFee > 0) {
      // TODO: Add compute budget instruction
    }
    
    // Add transfer instruction
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: this.currentKeypair.publicKey,
        toPubkey: new PublicKey(to),
        lamports: amount * LAMPORTS_PER_SOL
      })
    );
    
    // Get recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.currentKeypair.publicKey;
    
    // Sign and send
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.currentKeypair]
    );
    
    return signature;
  }

  /**
   * Send SPL token
   */
  async sendToken(params: SendTransactionParams): Promise<string> {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }

    const { to, amount, mint } = params;
    
    if (!mint) {
      throw new Error('Mint address is required for token transfers');
    }
    
    const fromPubkey = this.currentKeypair.publicKey;
    const toPubkey = new PublicKey(to);
    const mintPubkey = new PublicKey(mint);
    
    // Get token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      fromPubkey
    );
    
    const toTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      toPubkey
    );
    
    // Create transaction
    const transaction = new Transaction();
    
    // Check if recipient token account exists
    try {
      await getAccount(this.connection, toTokenAccount);
    } catch (error) {
      // Create associated token account for recipient
      transaction.add(
        createAssociatedTokenAccountInstruction(
          fromPubkey,
          toTokenAccount,
          toPubkey,
          mintPubkey
        )
      );
    }
    
    // Get token decimals
    const tokenBalance = await this.connection.getTokenAccountBalance(fromTokenAccount);
    const decimals = tokenBalance.value.decimals;
    
    // Add transfer instruction
    transaction.add(
      createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromPubkey,
        amount * Math.pow(10, decimals),
        [],
        TOKEN_PROGRAM_ID
      )
    );
    
    // Get recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPubkey;
    
    // Sign and send
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.currentKeypair]
    );
    
    return signature;
  }

  /**
   * Simulate transaction
   */
  async simulateTransaction(transaction: Transaction): Promise<{
    success: boolean;
    error?: string;
    logs?: string[];
  }> {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }

    transaction.feePayer = this.currentKeypair.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    
    // Partially sign for simulation
    transaction.partialSign(this.currentKeypair);
    
    const result = await this.connection.simulateTransaction(transaction);
    
    return {
      success: !result.value.err,
      error: result.value.err ? JSON.stringify(result.value.err) : undefined,
      logs: result.value.logs || []
    };
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(options?: {
    limit?: number;
    before?: string;
  }) {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }

    const address = this.currentKeypair.publicKey.toBase58();
    return heliusService.getTransactionHistory(address, options);
  }

  /**
   * Get estimated transaction fee
   */
  async estimateFee(transaction: Transaction): Promise<number> {
    const fee = await transaction.getEstimatedFee(this.connection);
    return fee || 5000; // Default to 5000 lamports
  }

  /**
   * Sign message
   */
  async signMessage(_message: Uint8Array): Promise<Uint8Array> {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }

    return this.currentKeypair.secretKey.slice(0, 64); // Return signature
  }

  /**
   * Sign transaction
   */
  async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (!this.currentKeypair) {
      throw new Error('Wallet not initialized');
    }

    transaction.sign(this.currentKeypair);
    return transaction;
  }
}

// Export singleton instance
export const walletService = new WalletService();
