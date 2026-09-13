import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/** What the send modal opens on. Balances are integer smallest units (lamports or token base units) as decimal strings. */
export type SendAsset = {
  mint?: string;
  symbol: string;
  balanceSmallest: string;
  decimals: number;
  /** Owning token program, base58; absent for SOL. */
  programId?: string;
  /**
   * The token account this balance sits in, base58; absent for SOL. A wallet can
   * hold several accounts of one mint, so the row the user clicked — not the
   * mint — is what the send spends from.
   */
  source?: string;
};

/**
 * Popup chrome only: which modal is open, which tab is showing, and whether a
 * manual refresh is running. Settings belong to the worker and reach the screen
 * through `useSettings()`; chain data belongs to React Query. Nothing here is
 * a copy of either.
 */
interface UiState {
  showSendModal: boolean;
  showReceiveModal: boolean;
  showSettingsModal: boolean;
  sendAsset: SendAsset | null;
  activeView: 'tokens' | 'nfts' | 'activity';
  nftViewMode: 'grid' | 'list';
  isRefreshing: boolean;
}

const initialState: UiState = {
  showSendModal: false,
  showReceiveModal: false,
  showSettingsModal: false,
  sendAsset: null,
  activeView: 'tokens',
  nftViewMode: 'grid',
  isRefreshing: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    showSend: (state, action: PayloadAction<SendAsset | undefined>) => {
      state.showSendModal = true;
      state.sendAsset = action.payload ?? null;
    },
    hideSend: (state) => {
      state.showSendModal = false;
      state.sendAsset = null;
    },
    showReceive: (state) => {
      state.showReceiveModal = true;
    },
    hideReceive: (state) => {
      state.showReceiveModal = false;
    },
    showSettings: (state) => {
      state.showSettingsModal = true;
    },
    hideSettings: (state) => {
      state.showSettingsModal = false;
    },
    setActiveView: (state, action: PayloadAction<UiState['activeView']>) => {
      state.activeView = action.payload;
      state.showSettingsModal = false;
    },
    setNftViewMode: (state, action: PayloadAction<UiState['nftViewMode']>) => {
      state.nftViewMode = action.payload;
    },
    setRefreshing: (state, action: PayloadAction<boolean>) => {
      state.isRefreshing = action.payload;
    },
  },
});

export const {
  showSend,
  hideSend,
  showReceive,
  hideReceive,
  showSettings,
  hideSettings,
  setActiveView,
  setNftViewMode,
  setRefreshing,
} = uiSlice.actions;

export default uiSlice.reducer;
