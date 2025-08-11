import React, { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { Dashboard } from '../components/Dashboard';
import { LoadingScreen } from '../components/common/LoadingScreen';

import { UnlockScreen } from '../components/wallet/UnlockScreen';
import { WalletCreationFlow } from '../components/wallet/WalletCreationFlow';
import { initializeWallet } from '../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../store/store';

function App() {
  const dispatch = useAppDispatch();
  const { isInitialized, isLocked, accounts } = useAppSelector(state => state.wallet);
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
  
  // No wallet exists yet
  if (accounts.length === 0 && isLocked) {
    return (
      <>
        <Toaster position="top-center" />
        <WalletCreationFlow />
      </>
    );
  }
  
  // Wallet exists but is locked
  if (isLocked) {
    return (
      <>
        <Toaster position="top-center" />
        <UnlockScreen />
      </>
    );
  }
  
  // Wallet is unlocked
  return (
    <>
      <Toaster position="top-center" />
      <Dashboard />
    </>
  );
}

export default App;
