import { AnimatePresence, motion } from 'framer-motion';
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { generateSeedPhrase } from '../../lib/wallet';
import { createWallet } from '../../store/slices/walletSlice';
import { useAppDispatch } from '../../store/store';
import { PasswordCreate } from './PasswordCreate';
import { SeedPhraseDisplay } from './SeedPhraseDisplay';
import { SeedPhraseImport } from './SeedPhraseImport';
import { SeedPhraseVerification } from './SeedPhraseVerification';

type FlowStep = 
  | 'choice'
  | 'generate-seed'
  | 'verify-seed'
  | 'import-seed'
  | 'create-password'
  | 'complete';

interface WalletCreationFlowProps {
  onComplete?: () => void;
}

export const WalletCreationFlow: React.FC<WalletCreationFlowProps> = ({
  onComplete
}) => {
  const dispatch = useAppDispatch();
  const [currentStep, setCurrentStep] = useState<FlowStep>('choice');
  const [seedPhrase, setSeedPhrase] = useState<string>('');
  const [isImported, setIsImported] = useState(false);
  
  const handleCreateNew = () => {
    const { mnemonic } = generateSeedPhrase(12);
    setSeedPhrase(mnemonic);
    setIsImported(false);
    setCurrentStep('generate-seed');
  };
  
  const handleImportExisting = () => {
    setIsImported(true);
    setCurrentStep('import-seed');
  };
  
  const handleImportSeed = (importedPhrase: string) => {
    setSeedPhrase(importedPhrase);
    setCurrentStep('create-password');
  };
  
  const handlePasswordCreate = async (password: string) => {
    try {
      await dispatch(createWallet({
        password,
        seedPhrase,
        imported: isImported
      })).unwrap();
      
      toast.success(
        isImported 
          ? 'Wallet imported successfully!' 
          : 'Wallet created successfully!'
      );
      
      setCurrentStep('complete');
      onComplete?.();
    } catch (error) {
      toast.error('Failed to create wallet. Please try again.');
      console.error('Wallet creation error:', error);
    }
  };
  
  const handleBack = () => {
    switch (currentStep) {
      case 'generate-seed':
      case 'import-seed':
        setCurrentStep('choice');
        break;
      case 'verify-seed':
        setCurrentStep('generate-seed');
        break;
      case 'create-password':
        setCurrentStep(isImported ? 'import-seed' : 'verify-seed');
        break;
    }
  };
  
  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 1000 : -1000,
      opacity: 0
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 1000 : -1000,
      opacity: 0
    })
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-8 py-6">
            <h1 className="text-3xl font-bold text-white">
              Solana Wallet
            </h1>
            <p className="text-indigo-100 mt-1">
              Your gateway to the Solana ecosystem
            </p>
          </div>
          
          <div className="p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: { type: "spring", stiffness: 300, damping: 30 },
                  opacity: { duration: 0.2 }
                }}
                custom={1}
              >
                {currentStep === 'choice' && (
                  <div className="space-y-6">
                    <div className="text-center">
                      <h2 className="text-2xl font-bold text-gray-900 mb-2">
                        Welcome to Solana Wallet
                      </h2>
                      <p className="text-gray-600">
                        Create a new wallet or import an existing one
                      </p>
                    </div>
                    
                    <div className="space-y-4">
                      <button
                        onClick={handleCreateNew}
                        className="w-full bg-indigo-600 text-white py-4 px-6 rounded-lg hover:bg-indigo-700 transition-colors font-medium text-lg flex items-center justify-center space-x-3"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        <span>Create New Wallet</span>
                      </button>
                      
                      <button
                        onClick={handleImportExisting}
                        className="w-full bg-white text-gray-900 py-4 px-6 rounded-lg border-2 border-gray-300 hover:border-gray-400 transition-colors font-medium text-lg flex items-center justify-center space-x-3"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <span>Import Existing Wallet</span>
                      </button>
                    </div>
                    
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="font-medium text-gray-900 mb-2">
                        New to crypto wallets?
                      </h3>
                      <p className="text-sm text-gray-600">
                        A crypto wallet allows you to store, send, and receive digital assets like SOL and NFTs. 
                        Your wallet is secured by a seed phrase that only you know.
                      </p>
                    </div>
                  </div>
                )}
                
                {currentStep === 'generate-seed' && (
                  <SeedPhraseDisplay
                    seedPhrase={seedPhrase}
                    isNewWallet={true}
                    onContinue={() => setCurrentStep('verify-seed')}
                    onBack={handleBack}
                  />
                )}
                
                {currentStep === 'verify-seed' && (
                  <SeedPhraseVerification
                    seedPhrase={seedPhrase}
                    onVerified={() => setCurrentStep('create-password')}
                    onBack={handleBack}
                  />
                )}
                
                {currentStep === 'import-seed' && (
                  <SeedPhraseImport
                    onImport={handleImportSeed}
                    onBack={handleBack}
                  />
                )}
                
                {currentStep === 'create-password' && (
                  <PasswordCreate
                    onSubmit={handlePasswordCreate}
                    onBack={handleBack}
                    title={isImported ? 'Secure Your Imported Wallet' : 'Secure Your New Wallet'}
                    subtitle="Create a strong password to encrypt your wallet data"
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            By creating a wallet, you agree to our{' '}
            <a href="#" className="text-indigo-600 hover:underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#" className="text-indigo-600 hover:underline">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};
