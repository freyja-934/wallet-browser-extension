import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Buffer } from 'buffer';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { store } from '../store/store';
import '../styles/index.css';
import App from './App';

if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  window.global = window;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
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
