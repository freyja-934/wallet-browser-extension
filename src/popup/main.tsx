// First import on purpose: chain libraries below read `Buffer` while they load.
import '../lib/buffer-global';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { store } from '../store/store';
import '../styles/index.css';
import App from './App';

if (typeof window !== 'undefined') {
  window.global = window;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // A failed read shows an error card with Retry; only `useBalances` opts into one automatic retry.
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </Provider>
    </ErrorBoundary>
  </React.StrictMode>
);
