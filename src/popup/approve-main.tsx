import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Buffer } from 'buffer';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { ApprovalScreen } from '../components/transactions/ApprovalScreen';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import '../styles/index.css';

if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  window.global = window;
}

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Toaster position="top-center" />
        <ApprovalScreen />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
