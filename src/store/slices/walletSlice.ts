import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import bs58 from 'bs58';
import {
    deriveKeypairFromSeed,
    generateAccountsFromSeed,
    generateSeedPhrase,
    validateSeedPhrase,
    WalletAccount
} from '../../lib/wallet';
import { heliusService } from '../../services/helius';
import { secureStorage } from '../../services/storage';
import { walletService } from '../../services/wallet';

export interface Token {
  mint: string;
  symbol?: string;
  name?: string;
  amount: string;
  decimals: number;
  usdValue?: number;
  logoURI?: string;
  priceChange24h?: number;
}

export interface NFT {
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
}

export interface Transaction {
  signature: string;
  timestamp: number;
  type: string;
  status: 'success' | 'failed' | 'pending';
  from?: string;
  to?: string;
  amount?: string;
  fee: number;
  description?: string;
}

interface WalletState {
  // Wallet status
  isInitialized: boolean;
  isLocked: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Accounts
  accounts: WalletAccount[];
  activeAccountIndex: number;
  
  // Balances
  solBalance: number;
  totalUsdValue: number;
  tokens: Token[];
  
  // NFTs
  nfts: NFT[];
  nftCollections: Record<string, NFT[]>;
  
  // Transactions
  transactions: Transaction[];
  pendingTransactions: string[];
  
  // Network
  network: 'mainnet-beta' | 'testnet' | 'devnet';
  customRpcUrl?: string;
}

const initialState: WalletState = {
  isInitialized: false,
  isLocked: true,
  isLoading: false,
  error: null,
  accounts: [],
  activeAccountIndex: 0,
  solBalance: 0,
  totalUsdValue: 0,
  tokens: [],
  nfts: [],
  nftCollections: {},
  transactions: [],
  pendingTransactions: [],
  network: 'mainnet-beta',
};

// Async thunks
export const initializeWallet = createAsyncThunk(
  'wallet/initialize',
  async () => {
    await secureStorage.initialize();
    const hasVault = await secureStorage.hasVault();
    return { hasVault };
  }
);

export const createWallet = createAsyncThunk(
  'wallet/createWallet',
  async ({ 
    password, 
    seedPhrase, 
    imported = false 
  }: { 
    password: string; 
    seedPhrase?: string; 
    imported?: boolean;
  }) => {
    // Generate or validate seed phrase
    const seedInfo = seedPhrase 
      ? validateSeedPhrase(seedPhrase)
      : generateSeedPhrase(12);
    
    if (!seedInfo.isValid) {
      throw new Error('Invalid seed phrase');
    }
    
    // Generate initial accounts
    const accounts = generateAccountsFromSeed(seedInfo.seed, 1);
    
    // Create vault
    await secureStorage.createVault(seedInfo.mnemonic, accounts, password);
    
    return {
      accounts,
      seedPhrase: seedInfo.mnemonic,
      imported
    };
  }
);

export const unlockWallet = createAsyncThunk(
  'wallet/unlock',
  async (password: string) => {
    const vaultData = await secureStorage.unlock(password);
    
    if (!vaultData) {
      throw new Error('Invalid password');
    }
    
    // Generate accounts from seed
    const seedInfo = validateSeedPhrase(vaultData.seedPhrase);
    const accounts = generateAccountsFromSeed(
      seedInfo.seed,
      vaultData.accounts?.length || 1
    );
    
    return { accounts };
  }
);

export const lockWallet = createAsyncThunk(
  'wallet/lock',
  async () => {
    await secureStorage.lock();
  }
);

export const addAccount = createAsyncThunk(
  'wallet/addAccount',
  async (_, { getState }) => {
    const state = getState() as { wallet: WalletState };
    const nextIndex = state.wallet.accounts.length;
    
    const vaultData = await secureStorage.getDecryptedVault();
    if (!vaultData) {
      throw new Error('Wallet is locked');
    }
    
    const seedInfo = validateSeedPhrase(vaultData.seedPhrase);
    const newAccounts = generateAccountsFromSeed(seedInfo.seed, 1, nextIndex);
    
    const allAccounts = [...state.wallet.accounts, ...newAccounts];
    await secureStorage.updateAccounts(allAccounts);
    
    return newAccounts[0];
  }
);

export const renameAccount = createAsyncThunk(
  'wallet/renameAccount',
  async ({ index, name }: { index: number; name: string }, { getState }) => {
    const state = getState() as { wallet: WalletState };
    const accounts = [...state.wallet.accounts];
    accounts[index] = { ...accounts[index], name };
    
    await secureStorage.updateAccounts(accounts);
    return { index, name };
  }
);

export const fetchBalances = createAsyncThunk(
  'wallet/fetchBalances',
  async (_, { getState }) => {
    const state = getState() as { wallet: WalletState };
    
    // Initialize wallet service with active account
    await walletService.initialize(state.wallet.activeAccountIndex);
    
    // Fetch balances with prices
    const balanceData = await walletService.getTokenBalances();
    
    // Fetch transaction history
    const transactions = await walletService.getTransactionHistory({ limit: 20 });
    
    return {
      solBalance: balanceData.solBalance,
      tokens: balanceData.tokens,
      totalUsdValue: balanceData.totalUsdValue,
      transactions
    };
  }
);

export const sendTransaction = createAsyncThunk(
  'wallet/sendTransaction',
  async ({ 
    to, 
    amount, 
    mint 
  }: { 
    to: string; 
    amount: number; 
    mint?: string;
  }, { getState }) => {
    const state = getState() as { wallet: WalletState };
    
    // Initialize wallet service
    await walletService.initialize(state.wallet.activeAccountIndex);
    
    // Send transaction
    const signature = mint 
      ? await walletService.sendToken({ to, amount, mint })
      : await walletService.sendSol({ to, amount });
    
    return { signature };
  }
);

export const fetchNFTs = createAsyncThunk(
  'wallet/fetchNFTs',
  async (_, { getState }) => {
    const state = getState() as { wallet: WalletState };
    const address = state.wallet.accounts[state.wallet.activeAccountIndex].address;
    
    const nftData = await heliusService.getNFTs(address);
    
    return {
      nfts: nftData.items
    };
  }
);

export const changePassword = createAsyncThunk(
  'wallet/changePassword',
  async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
    // Verify current password
    const decryptedVault = await secureStorage.unlock(currentPassword);
    if (!decryptedVault) {
      throw new Error('Current password is incorrect');
    }
    
    // Update with new password
    await secureStorage.updatePassword(currentPassword, newPassword);
    
    return { success: true };
  }
);

export const exportSeedPhrase = createAsyncThunk(
  'wallet/exportSeedPhrase',
  async (password: string) => {
    const decryptedVault = await secureStorage.unlock(password);
    
    if (!decryptedVault) {
      throw new Error('Invalid password');
    }
    
    return { seedPhrase: decryptedVault.seedPhrase };
  }
);

export const exportPrivateKey = createAsyncThunk(
  'wallet/exportPrivateKey',
  async ({ password, accountIndex }: { password: string; accountIndex: number }) => {
    const decryptedVault = await secureStorage.unlock(password);
    
    if (!decryptedVault) {
      throw new Error('Invalid password');
    }
    
    // Derive the specific account
    const { keypair } = deriveKeypairFromSeed(
      Buffer.from(decryptedVault.seedPhrase),
      accountIndex
    );
    
    // Convert private key to base58
    const privateKey = bs58.encode(keypair.secretKey);
    
    return { privateKey };
  }
);

export const clearWalletData = createAsyncThunk(
  'wallet/clearData',
  async () => {
    await secureStorage.clear();
    
    // Clear chrome storage too
    if (chrome?.storage?.local) {
      await chrome.storage.local.clear();
    }
    
    return { cleared: true };
  }
);

// Slice
const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setActiveAccount: (state, action: PayloadAction<number>) => {
      state.activeAccountIndex = action.payload;
    },
    
    updateSolBalance: (state, action: PayloadAction<number>) => {
      state.solBalance = action.payload;
    },
    
    updateTokens: (state, action: PayloadAction<Token[]>) => {
      state.tokens = action.payload;
      // Calculate total USD value
      state.totalUsdValue = action.payload.reduce((total, token) => {
        return total + (token.usdValue || 0);
      }, state.solBalance * (state.tokens.find(t => t.symbol === 'SOL')?.usdValue || 0));
    },
    
    updateNFTs: (state, action: PayloadAction<NFT[]>) => {
      state.nfts = action.payload;
      
      // Group by collection
      state.nftCollections = action.payload.reduce((collections, nft) => {
        const collectionName = nft.grouping?.find((g: any) => g.group_key === 'collection')?.group_value || 'Unknown Collection';
        if (!collections[collectionName]) {
          collections[collectionName] = [];
        }
        collections[collectionName].push(nft);
        return collections;
      }, {} as Record<string, NFT[]>);
    },
    
    updateTransactions: (state, action: PayloadAction<Transaction[]>) => {
      state.transactions = action.payload;
    },
    
    addPendingTransaction: (state, action: PayloadAction<string>) => {
      state.pendingTransactions.push(action.payload);
    },
    
    removePendingTransaction: (state, action: PayloadAction<string>) => {
      state.pendingTransactions = state.pendingTransactions.filter(
        sig => sig !== action.payload
      );
    },
    
    setNetwork: (state, action: PayloadAction<WalletState['network']>) => {
      state.network = action.payload;
    },
    
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
  
  extraReducers: (builder) => {
    builder
      // Initialize
      .addCase(initializeWallet.fulfilled, (state, action) => {
        state.isInitialized = true;
        state.isLocked = !action.payload.hasVault || state.isLocked;
      })
      
      // Create wallet
      .addCase(createWallet.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(createWallet.fulfilled, (state, action) => {
        state.isLoading = false;
        state.isLocked = false;
        state.accounts = action.payload.accounts;
        state.activeAccountIndex = 0;
      })
      .addCase(createWallet.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to create wallet';
      })
      
      // Unlock
      .addCase(unlockWallet.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(unlockWallet.fulfilled, (state, action) => {
        state.isLoading = false;
        state.isLocked = false;
        state.accounts = action.payload.accounts;
      })
      .addCase(unlockWallet.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Invalid password';
      })
      
      // Lock
      .addCase(lockWallet.fulfilled, (state) => {
        state.isLocked = true;
        state.accounts = [];
        state.tokens = [];
        state.nfts = [];
        state.transactions = [];
        state.solBalance = 0;
        state.totalUsdValue = 0;
      })
      
      // Add account
      .addCase(addAccount.fulfilled, (state, action) => {
        state.accounts.push(action.payload);
      })
      
      // Rename account
      .addCase(renameAccount.fulfilled, (state, action) => {
        state.accounts[action.payload.index].name = action.payload.name;
      })
      
      // Fetch balances
      .addCase(fetchBalances.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchBalances.fulfilled, (state, action) => {
        state.isLoading = false;
        state.solBalance = action.payload.solBalance;
        state.tokens = action.payload.tokens;
        state.totalUsdValue = action.payload.totalUsdValue;
        state.transactions = action.payload.transactions;
      })
      .addCase(fetchBalances.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch balances';
      })
      
      // Send transaction
      .addCase(sendTransaction.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(sendTransaction.fulfilled, (state, action) => {
        state.isLoading = false;
        state.pendingTransactions.push(action.payload.signature);
      })
      .addCase(sendTransaction.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Transaction failed';
      })
      
      // Fetch NFTs
      .addCase(fetchNFTs.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(fetchNFTs.fulfilled, (state, action) => {
        state.isLoading = false;
        state.nfts = action.payload.nfts;
        
        // Group by collection
        state.nftCollections = action.payload.nfts.reduce((collections, nft) => {
          const collectionName = nft.grouping?.find(g => g.group_key === 'collection')?.group_value || 'Unknown Collection';
          if (!collections[collectionName]) {
            collections[collectionName] = [];
          }
          collections[collectionName].push(nft);
          return collections;
        }, {} as Record<string, NFT[]>);
      })
      .addCase(fetchNFTs.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch NFTs';
      })
      
      // Clear wallet data
      .addCase(clearWalletData.fulfilled, () => {
        // Return to initial state
        return initialState;
      });
  },
});

export const {
  setActiveAccount,
  updateSolBalance,
  updateTokens,
  updateNFTs,
  updateTransactions,
  addPendingTransaction,
  removePendingTransaction,
  setNetwork,
  setError,
} = walletSlice.actions;

export default walletSlice.reducer;
