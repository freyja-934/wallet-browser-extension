import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UiState {
  // Modals
  showSeedPhraseModal: boolean;
  showSendModal: boolean;
  showReceiveModal: boolean;
  showSettingsModal: boolean;
  showTransactionDetails: string | null; // transaction signature
  
  // Views
  activeView: 'tokens' | 'nfts' | 'activity' | 'settings';
  nftViewMode: 'grid' | 'list';
  
  // Filters
  hideSmallBalances: boolean;
  searchQuery: string;
  
  // Theme
  theme: 'light' | 'dark' | 'system';
  
  // Loading states
  isRefreshing: boolean;
  loadingMessage: string | null;
}

const initialState: UiState = {
  showSeedPhraseModal: false,
  showSendModal: false,
  showReceiveModal: false,
  showSettingsModal: false,
  showTransactionDetails: null,
  activeView: 'tokens',
  nftViewMode: 'grid',
  hideSmallBalances: false,
  searchQuery: '',
  theme: 'system',
  isRefreshing: false,
  loadingMessage: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    // Modal actions
    showSeedPhrase: (state) => {
      state.showSeedPhraseModal = true;
    },
    hideSeedPhrase: (state) => {
      state.showSeedPhraseModal = false;
    },
    
    showSend: (state) => {
      state.showSendModal = true;
    },
    hideSend: (state) => {
      state.showSendModal = false;
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
    
    // View actions
    setActiveView: (state, action: PayloadAction<UiState['activeView']>) => {
      state.activeView = action.payload;
    },
    
    setNftViewMode: (state, action: PayloadAction<UiState['nftViewMode']>) => {
      state.nftViewMode = action.payload;
    },
    
    // Filter actions
    toggleHideSmallBalances: (state) => {
      state.hideSmallBalances = !state.hideSmallBalances;
    },
    
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    
    // Theme
    setTheme: (state, action: PayloadAction<UiState['theme']>) => {
      state.theme = action.payload;
    },
    
    // Loading
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
  setSearchQuery,
  setTheme,
  setRefreshing,
  setLoadingMessage,
} = uiSlice.actions;

export default uiSlice.reducer;
