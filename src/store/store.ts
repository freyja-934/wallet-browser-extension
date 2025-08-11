import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import uiReducer from './slices/uiSlice';
import walletReducer from './slices/walletSlice';

export const store = configureStore({
  reducer: {
    wallet: walletReducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types
        ignoredActions: ['wallet/unlock/fulfilled', 'wallet/createWallet/fulfilled'],
        // Ignore these field paths in all actions
        ignoredActionPaths: ['payload.publicKey', 'payload.keypair'],
        // Ignore these paths in the state
        ignoredPaths: ['wallet.accounts'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
