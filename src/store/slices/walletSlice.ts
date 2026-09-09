import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { WalletAccountInfo } from '../../lib/messages';
import { extensionClient } from '../../messaging/client';

interface WalletState {
  isInitialized: boolean;
  hasVault: boolean;
  isLocked: boolean;
  isLoading: boolean;
  error: string | null;
  accounts: WalletAccountInfo[];
  activeAccountIndex: number;
}

const initialState: WalletState = {
  isInitialized: false,
  hasVault: false,
  isLocked: true,
  isLoading: false,
  error: null,
  accounts: [],
  activeAccountIndex: 0,
};

function applyState(state: WalletState, next: {
  hasVault: boolean;
  isLocked: boolean;
  accounts: WalletAccountInfo[];
  activeAccountIndex: number;
}) {
  state.hasVault = next.hasVault;
  state.isLocked = next.isLocked;
  state.accounts = next.accounts;
  state.activeAccountIndex = next.activeAccountIndex;
}

export const initializeWallet = createAsyncThunk('wallet/initialize', async () => {
  return extensionClient.getState();
});

export const createWallet = createAsyncThunk(
  'wallet/createWallet',
  async ({ password, seedPhrase }: { password: string; seedPhrase?: string; imported?: boolean }) => {
    return extensionClient.createWallet(password, seedPhrase);
  }
);

export const unlockWallet = createAsyncThunk('wallet/unlock', async (password: string) => {
  return extensionClient.unlock(password);
});

export const lockWallet = createAsyncThunk('wallet/lock', async () => {
  return extensionClient.lock();
});

export const changePassword = createAsyncThunk(
  'wallet/changePassword',
  async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
    await extensionClient.changePassword(currentPassword, newPassword);
    return { success: true };
  }
);

export const exportSeedPhrase = createAsyncThunk('wallet/exportSeedPhrase', async (password: string) => {
  const seedPhrase = await extensionClient.exportSeed(password);
  return { seedPhrase };
});

export const exportPrivateKey = createAsyncThunk(
  'wallet/exportPrivateKey',
  async ({ password, accountIndex }: { password: string; accountIndex: number }) => {
    const privateKey = await extensionClient.exportPrivateKey(password, accountIndex);
    return { privateKey };
  }
);

export const clearWalletData = createAsyncThunk('wallet/clearData', async () => {
  return extensionClient.clearWallet();
});

export const sendTransaction = createAsyncThunk(
  'wallet/sendTransaction',
  async ({ to, amountSmallest, mint }: { to: string; amountSmallest: string; mint?: string }) => {
    const signature = await extensionClient.sendTransfer({ to, amountSmallest, mint });
    return { signature };
  }
);

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setActiveAccount: (state, action: PayloadAction<number>) => {
      state.activeAccountIndex = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeWallet.fulfilled, (state, action) => {
        state.isInitialized = true;
        applyState(state, action.payload);
      })
      .addCase(initializeWallet.rejected, (state) => {
        state.isInitialized = true;
        state.hasVault = false;
        state.isLocked = true;
      })
      .addCase(createWallet.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(createWallet.fulfilled, (state, action) => {
        state.isLoading = false;
        applyState(state, action.payload);
      })
      .addCase(createWallet.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to create wallet';
      })
      .addCase(unlockWallet.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(unlockWallet.fulfilled, (state, action) => {
        state.isLoading = false;
        applyState(state, action.payload);
      })
      .addCase(unlockWallet.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Invalid password';
      })
      .addCase(lockWallet.fulfilled, (state, action) => {
        applyState(state, action.payload);
      })
      .addCase(clearWalletData.fulfilled, (state, action) => {
        applyState(state, action.payload);
        state.isInitialized = true;
      })
      .addCase(sendTransaction.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(sendTransaction.fulfilled, (state) => {
        state.isLoading = false;
      })
      .addCase(sendTransaction.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Transaction failed';
      });
  },
});

export const { setActiveAccount, setError } = walletSlice.actions;
export default walletSlice.reducer;

export type { WalletAccountInfo };
export type Token = {
  mint: string;
  symbol?: string;
  name?: string;
  amount: string;
  decimals: number;
  usdValue?: number;
  logoURI?: string;
  priceChange24h?: number;
};
export type NFT = {
  id: string;
  content: {
    metadata: { name: string; symbol: string; description?: string };
    files?: Array<{ uri: string; mime?: string }>;
    links?: { image?: string; external_url?: string };
  };
  compression?: { compressed: boolean; tree: string; leaf_id: number };
  grouping?: Array<{ group_key: string; group_value: string }>;
  ownership: { owner: string; frozen: boolean };
};
export type Transaction = {
  signature: string;
  timestamp: number;
  type: string;
  status: 'success' | 'failed' | 'pending';
  from?: string;
  to?: string;
  amount?: string;
  fee: number;
  description?: string;
};
