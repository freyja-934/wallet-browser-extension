import { Buffer } from 'buffer';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { store } from '../store/store';
import '../styles/index.css';
import App from './App';

// Polyfills for crypto
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  window.global = window;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <App />
      </Provider>
    </ErrorBoundary>
  </React.StrictMode>
);
