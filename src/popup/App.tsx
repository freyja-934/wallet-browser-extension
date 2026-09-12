import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { Dashboard } from '../components/Dashboard';
import { LoadingScreen } from '../components/common/LoadingScreen';
import { UnlockScreen } from '../components/wallet/UnlockScreen';
import { WalletCreationFlow } from '../components/wallet/WalletCreationFlow';
import { syncSettings } from '../hooks/useSettings';
import { initializeWallet } from '../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../store/store';

const toasterConfig = {
  position: 'top-center' as const,
  toastOptions: {
    duration: 4000,
    style: {
      background: '#171413',
      color: '#ebeae9',
      border: '1px solid rgba(235,234,233,0.12)',
      borderRadius: '16px',
      padding: '12px 16px',
      fontSize: '14px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
    },
    success: {
      iconTheme: { primary: '#7DAB7A', secondary: '#171413' },
      style: { borderLeft: '3px solid #7DAB7A' },
    },
    error: {
      iconTheme: { primary: '#E07070', secondary: '#171413' },
      style: { borderLeft: '3px solid #E07070' },
    },
  },
};

function App() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const { isInitialized, isLocked, hasVault } = useAppSelector((state) => state.wallet);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        await dispatch(initializeWallet()).unwrap();
        await syncSettings(queryClient, dispatch);
      } catch (error) {
        console.error('Failed to initialize wallet:', error);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [dispatch, queryClient]);

  if (!isInitialized || isLoading) {
    return <LoadingScreen />;
  }

  if (!hasVault) {
    return (
      <>
        <Toaster {...toasterConfig} />
        <WalletCreationFlow />
      </>
    );
  }

  if (isLocked) {
    return (
      <>
        <Toaster {...toasterConfig} />
        <UnlockScreen />
      </>
    );
  }

  return (
    <>
      <Toaster {...toasterConfig} />
      <Dashboard />
    </>
  );
}

export default App;
