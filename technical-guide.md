# 🔧 Technical Implementation Guide

## Architecture Decisions

### 1. Multi-Chain Adapter Pattern
We'll use the existing adapter pattern from the codebase to support multiple blockchains:

```typescript
// Enhanced blockchain adapter interface
export interface BlockchainAdapter {
  // Core wallet functions
  generateKeypair(mnemonic: string, derivationPath: string): Keypair;
  getPublicKey(): string;
  
  // Balance and token functions  
  getBalances(address: string): Promise<TokenBalance[]>;
  getNativeBalance(address: string): Promise<number>;
  
  // Transaction functions
  getTransactions(address: string, limit?: number): Promise<Transaction[]>;
  signTransaction(transaction: any): Promise<string>;
  sendTransaction(signedTx: string): Promise<string>;
  simulateTransaction(transaction: any): Promise<SimulationResult>;
  
  // NFT functions (optional for non-NFT chains)
  getNFTs?(address: string): Promise<NFT[]>;
  transferNFT?(nft: NFT, recipient: string): Promise<string>;
  
  // Chain-specific functions
  estimateFee(transaction: any): Promise<number>;
  getRecentBlockhash?(): Promise<string>;
}
```

### 2. Enhanced Solana Adapter Implementation

```typescript
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { Helius } from 'helius-sdk';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

export class EnhancedSolanaAdapter implements BlockchainAdapter {
  private connection: Connection;
  private helius: Helius;
  
  constructor(rpcUrl: string, heliusApiKey: string) {
    this.connection = new Connection(rpcUrl);
    this.helius = new Helius(heliusApiKey);
  }
  
  generateKeypair(mnemonic: string, derivationPath: string = "m/44'/501'/0'/0'"): Keypair {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const derivedSeed = derivePath(derivationPath, seed.toString('hex')).key;
    return Keypair.fromSeed(derivedSeed);
  }
  
  async getNFTs(address: string): Promise<NFT[]> {
    const response = await this.helius.getAssetsByOwner({
      ownerAddress: address,
      page: 1,
      limit: 1000,
      displayOptions: {
        showFungible: false,
        showNativeBalance: false,
      }
    });
    
    return response.items.map(this.parseNFTMetadata);
  }
  
  async getTokenBalances(address: string): Promise<TokenBalance[]> {
    const balances = await this.helius.getBalances(address);
    return balances.tokens.map(token => ({
      mint: token.mint,
      symbol: token.symbol || 'Unknown',
      name: token.name || 'Unknown Token',
      amount: token.amount,
      decimals: token.decimals,
      usdValue: 0, // Will be populated by price service
      logoURI: token.logoURI
    }));
  }
}
```

### 3. Secure Storage Architecture

```typescript
// Enhanced encrypted storage using IndexedDB + Chrome Storage
import { openDB, IDBPDatabase } from 'idb';
import * as argon2 from 'argon2-browser';

interface EncryptedVault {
  id: string;
  data: string; // Encrypted JSON
  nonce: string;
  salt: string;
  timestamp: number;
}

class SecureStorage {
  private db: IDBPDatabase;
  private sessionKey: CryptoKey | null = null;
  
  async initialize() {
    this.db = await openDB('SolanaWalletVault', 1, {
      upgrade(db) {
        db.createObjectStore('vaults', { keyPath: 'id' });
        db.createObjectStore('session', { keyPath: 'id' });
      },
    });
  }
  
  async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const hash = await argon2.hash({
      pass: password,
      salt,
      time: 3,
      mem: 4096,
      hashLen: 32,
      type: argon2.ArgonType.Argon2id,
    });
    
    return crypto.subtle.importKey(
      'raw',
      hash.hash,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  async encryptVault(data: any, password: string): Promise<EncryptedVault> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      new TextEncoder().encode(JSON.stringify(data))
    );
    
    return {
      id: 'primary',
      data: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
      nonce: btoa(String.fromCharCode(...nonce)),
      salt: btoa(String.fromCharCode(...salt)),
      timestamp: Date.now()
    };
  }
}
```

### 4. Message Passing Architecture

```typescript
// Background script message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.type) {
        case 'CONNECT_WALLET':
          const accounts = await handleConnect(request.origin);
          sendResponse({ success: true, accounts });
          break;
          
        case 'SIGN_TRANSACTION':
          const signature = await handleSignTransaction(
            request.transaction,
            request.origin
          );
          sendResponse({ success: true, signature });
          break;
          
        case 'GET_NFTS':
          const nfts = await getNFTsWithCache(request.address);
          sendResponse({ success: true, nfts });
          break;
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep channel open for async response
});

// Content script provider
class SolanaProvider {
  private pendingRequests = new Map();
  
  async connect() {
    return this.request({ method: 'connect' });
  }
  
  async signTransaction(transaction: Transaction) {
    return this.request({ 
      method: 'signTransaction',
      params: { transaction: transaction.serialize() }
    });
  }
  
  private request(args: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pendingRequests.set(id, { resolve, reject });
      
      chrome.runtime.sendMessage({
        type: 'PROVIDER_REQUEST',
        id,
        ...args
      });
    });
  }
}

// Inject into window
const provider = new SolanaProvider();
Object.defineProperty(window, 'solana', {
  value: provider,
  writable: false,
  configurable: false
});
```

### 5. API Service Layer

```typescript
// Centralized API service with caching
class WalletAPIService {
  private helius: Helius;
  private priceCache = new Map<string, PriceData>();
  private nftCache = new Map<string, NFT[]>();
  
  constructor(heliusApiKey: string) {
    this.helius = new Helius(heliusApiKey);
  }
  
  async getTokenPrices(mints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();
    const uncached = [];
    
    // Check cache first
    for (const mint of mints) {
      const cached = this.priceCache.get(mint);
      if (cached && Date.now() - cached.timestamp < 300000) { // 5 min cache
        prices.set(mint, cached.price);
      } else {
        uncached.push(mint);
      }
    }
    
    // Fetch uncached prices
    if (uncached.length > 0) {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${uncached.join(',')}&vs_currencies=usd`
      );
      const data = await response.json();
      
      for (const [mint, priceData] of Object.entries(data)) {
        const price = priceData.usd;
        prices.set(mint, price);
        this.priceCache.set(mint, { price, timestamp: Date.now() });
      }
    }
    
    return prices;
  }
  
  async getCompressedNFTs(owner: string): Promise<cNFT[]> {
    const response = await this.helius.getAssetsByOwner({
      ownerAddress: owner,
      page: 1,
      limit: 1000,
      options: {
        showFungible: false,
        showNativeBalance: false,
        showCollectionMetadata: true,
        showCompressed: true // Important for cNFTs
      }
    });
    
    return response.items
      .filter(item => item.compression?.compressed)
      .map(this.parsecNFT);
  }
  
  async transferCompressedNFT(
    nft: cNFT,
    from: PublicKey,
    to: PublicKey
  ): Promise<string> {
    // Get merkle proof
    const proof = await this.helius.getAssetProof({ id: nft.id });
    
    // Build transfer instruction
    const transferIx = createTransferInstruction({
      tree: new PublicKey(proof.tree_id),
      leafOwner: from,
      leafDelegate: from,
      newLeafOwner: to,
      proof: proof.proof,
      // ... other required fields
    });
    
    // Send transaction
    return await this.sendTransaction([transferIx]);
  }
}
```

### 6. React Component Architecture

```typescript
// Main wallet context with all features
interface WalletContextValue {
  // Wallet state
  isLocked: boolean;
  accounts: Account[];
  activeAccount: Account | null;
  
  // Balances and tokens
  solBalance: number;
  tokens: TokenBalance[];
  nfts: NFT[];
  totalUSDValue: number;
  
  // Actions
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  createWallet: (mnemonic: string, password: string) => Promise<void>;
  importWallet: (seedOrKey: string, password: string) => Promise<void>;
  
  // Transactions
  sendSOL: (to: string, amount: number) => Promise<string>;
  sendToken: (token: Token, to: string, amount: number) => Promise<string>;
  sendNFT: (nft: NFT, to: string) => Promise<string>;
  
  // Account management
  addAccount: () => Promise<Account>;
  switchAccount: (address: string) => void;
  renameAccount: (address: string, name: string) => void;
}

// NFT Gallery Component
const NFTGallery: React.FC = () => {
  const { nfts, sendNFT } = useWallet();
  const [selectedNFTs, setSelectedNFTs] = useState<Set<string>>(new Set());
  const [showSendModal, setShowSendModal] = useState(false);
  
  const groupedNFTs = useMemo(() => {
    return nfts.reduce((acc, nft) => {
      const collection = nft.collection?.name || 'No Collection';
      if (!acc[collection]) acc[collection] = [];
      acc[collection].push(nft);
      return acc;
    }, {} as Record<string, NFT[]>);
  }, [nfts]);
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Object.entries(groupedNFTs).map(([collection, items]) => (
        <CollectionGroup
          key={collection}
          name={collection}
          nfts={items}
          onSelect={handleSelect}
          selected={selectedNFTs}
        />
      ))}
    </div>
  );
};
```

### 7. Testing Strategy

```typescript
// Unit tests for critical functions
describe('Wallet Security', () => {
  test('encrypts and decrypts wallet correctly', async () => {
    const wallet = { 
      mnemonic: 'test seed phrase...',
      accounts: [{ address: '...', name: 'Account 1' }]
    };
    const password = 'strongPassword123!';
    
    const encrypted = await secureStorage.encryptVault(wallet, password);
    const decrypted = await secureStorage.decryptVault(encrypted, password);
    
    expect(decrypted).toEqual(wallet);
  });
  
  test('derives correct addresses from seed', () => {
    const mnemonic = 'test wallet seed phrase twelve words long enough here now today';
    const adapter = new EnhancedSolanaAdapter();
    
    const account0 = adapter.generateKeypair(mnemonic, "m/44'/501'/0'/0'");
    const account1 = adapter.generateKeypair(mnemonic, "m/44'/501'/1'/0'");
    
    expect(account0.publicKey.toString()).not.toBe(account1.publicKey.toString());
  });
});

// E2E tests
describe('Wallet User Flows', () => {
  test('complete wallet creation flow', async () => {
    await page.goto('chrome-extension://[id]/index.html');
    
    // Click create wallet
    await page.click('[data-testid="create-wallet"]');
    
    // Enter password
    await page.fill('[data-testid="password"]', 'TestPassword123!');
    await page.fill('[data-testid="confirm-password"]', 'TestPassword123!');
    await page.click('[data-testid="continue"]');
    
    // Verify seed phrase shown
    const seedWords = await page.$$('[data-testid="seed-word"]');
    expect(seedWords).toHaveLength(12);
    
    // Complete verification
    // ... rest of flow
  });
});
```

## Implementation Priorities

1. **Security First**: All crypto operations must be audited
2. **Performance**: Cache aggressively, minimize RPC calls
3. **User Experience**: Clear feedback, no silent failures
4. **Extensibility**: Easy to add new chains/features

## Development Workflow

1. Feature branch from `main`
2. Implement with tests
3. Security review for crypto changes
4. Performance testing
5. UI/UX review
6. Merge to `main`

This technical guide should be referenced throughout development to ensure consistent architecture and implementation patterns.
