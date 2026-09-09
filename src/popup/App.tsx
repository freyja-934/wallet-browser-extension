import React, { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Dashboard } from '../components/Dashboard';
import { LoadingScreen } from '../components/common/LoadingScreen';
import { UnlockScreen } from '../components/wallet/UnlockScreen';
import { WalletCreationFlow } from '../components/wallet/WalletCreationFlow';
import { initializeWallet } from '../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../store/store';

const toasterConfig = {
  position: "top-center" as const,
  toastOptions: {
    duration: 4000,
    style: {
      background: '#111214',
      color: '#FFFFFF',
      border: '1px solid #23262B',
      borderRadius: '12px',
      padding: '12px 16px',
      fontSize: '14px',
      boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.40)',
    },
    success: {
      iconTheme: { primary: '#2BD576', secondary: '#111214' },
      style: { borderLeft: '3px solid #2BD576' },
    },
    error: {
      iconTheme: { primary: '#FF5A5A', secondary: '#111214' },
      style: { borderLeft: '3px solid #FF5A5A' },
    },
  },
};

function App() {
  const dispatch = useAppDispatch();
  const { isInitialized, isLocked, hasVault } = useAppSelector(state => state.wallet);
  const [isLoading, setIsLoading] = React.useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        await dispatch(initializeWallet()).unwrap();
      } catch (error) {
        console.error('Failed to initialize wallet:', error);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [dispatch]);

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
