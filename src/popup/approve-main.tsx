// First import on purpose: chain libraries below read `Buffer` while they load.
import '../lib/buffer-global';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { ApprovalScreen } from '../components/transactions/ApprovalScreen';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import '../styles/index.css';

if (typeof window !== 'undefined') {
  window.global = window;
}

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#171413',
              color: '#ebeae9',
              border: '1px solid rgba(235,234,233,0.12)',
              borderRadius: '16px',
              padding: '12px 16px',
              fontSize: '14px',
            },
          }}
        />
        <ApprovalScreen />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
