import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { getCluster, type Cluster } from '../../config/constants';

/** What the send modal opens on. Balances are integer smallest units (lamports or token base units) as decimal strings. */
export type SendAsset = {
  mint?: string;
  symbol: string;
  balanceSmallest: string;
  decimals: number;
  /** Owning token program, base58; absent for SOL. */
  programId?: string;
};

interface UiState {
  showSeedPhraseModal: boolean;
  showSendModal: boolean;
  showReceiveModal: boolean;
  showSettingsModal: boolean;
  showTransactionDetails: string | null;
  sendAsset: SendAsset | null;
  activeView: 'tokens' | 'nfts' | 'activity';
  nftViewMode: 'grid' | 'list';
  hideSmallBalances: boolean;
  cluster: Cluster;
  searchQuery: string;
  theme: 'light' | 'dark' | 'system';
  isRefreshing: boolean;
  loadingMessage: string | null;
}

const initialState: UiState = {
  showSeedPhraseModal: false,
  showSendModal: false,
  showReceiveModal: false,
  showSettingsModal: false,
  showTransactionDetails: null,
  sendAsset: null,
  activeView: 'tokens',
  nftViewMode: 'grid',
  hideSmallBalances: false,
  cluster: getCluster(),
  searchQuery: '',
  theme: 'system',
  isRefreshing: false,
  loadingMessage: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    showSeedPhrase: (state) => {
      state.showSeedPhraseModal = true;
    },
    hideSeedPhrase: (state) => {
      state.showSeedPhraseModal = false;
    },
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
    showTransaction: (state, action: PayloadAction<string>) => {
      state.showTransactionDetails = action.payload;
    },
    hideTransaction: (state) => {
      state.showTransactionDetails = null;
    },
    setActiveView: (state, action: PayloadAction<UiState['activeView']>) => {
      state.activeView = action.payload;
      state.showSettingsModal = false;
    },
    setNftViewMode: (state, action: PayloadAction<UiState['nftViewMode']>) => {
      state.nftViewMode = action.payload;
    },
    toggleHideSmallBalances: (state) => {
      state.hideSmallBalances = !state.hideSmallBalances;
    },
    setHideSmallBalances: (state, action: PayloadAction<boolean>) => {
      state.hideSmallBalances = action.payload;
    },
    setCluster: (state, action: PayloadAction<Cluster>) => {
      state.cluster = action.payload;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setTheme: (state, action: PayloadAction<UiState['theme']>) => {
      state.theme = action.payload;
    },
    setRefreshing: (state, action: PayloadAction<boolean>) => {
      state.isRefreshing = action.payload;
    },
    setLoadingMessage: (state, action: PayloadAction<string | null>) => {
      state.loadingMessage = action.payload;
    },
  },
});

export const {
  showSeedPhrase,
  hideSeedPhrase,
  showSend,
  hideSend,
  showReceive,
  hideReceive,
  showSettings,
  hideSettings,
  showTransaction,
  hideTransaction,
  setActiveView,
  setNftViewMode,
  toggleHideSmallBalances,
  setHideSmallBalances,
  setCluster,
  setSearchQuery,
  setTheme,
  setRefreshing,
  setLoadingMessage,
} = uiSlice.actions;

export default uiSlice.reducer;
