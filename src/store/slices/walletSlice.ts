/**
 * Public wallet state only. Creating, unlocking, changing the password and
 * exporting a secret all call `extensionClient` from the component that asks:
 * a thunk would put the password or the mnemonic in an action, where the store
 * (and anything watching it) keeps a copy. No thunk here carries a secret, and
 * `walletSlice.test.ts` fails if one starts to.
 */

import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { WalletAccountInfo } from '../../lib/messages';
import { extensionClient, type TransferRequest } from '../../messaging/client';

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

export const lockWallet = createAsyncThunk('wallet/lock', async () => {
  return extensionClient.lock();
});

export const clearWalletData = createAsyncThunk('wallet/clearData', async () => {
  return extensionClient.clearWallet();
});

export const sendTransaction = createAsyncThunk(
  'wallet/sendTransaction',
  async ({ to, amountSmallest, mint, source }: TransferRequest, { rejectWithValue }) => {
    try {
      const signature = await extensionClient.sendTransfer({ to, amountSmallest, mint, source });
      return { signature };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Transaction failed');
    }
  },
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
        state.error = typeof action.payload === 'string' ? action.payload : action.error.message || 'Transaction failed';
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
  /** Owning token program, base58: SPL Token or Token-2022. */
  programId: string;
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
  symbol?: string;
  mint?: string;
  fee: number;
  description?: string;
  /** The signature is real but its details could not be fetched; the row shows "Details unavailable". */
  detailsUnavailable?: true;
};
