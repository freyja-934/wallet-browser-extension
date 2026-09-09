import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { generateSeedPhrase } from '../../lib/wallet';
import { createWallet } from '../../store/slices/walletSlice';
import { useAppDispatch } from '../../store/store';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
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
  
  const renderStep = () => {
    switch (currentStep) {
      case 'choice':
        return (
          <div className="animate-fadeIn">
            <Card>
              <CardContent className="p-8">
                <div className="text-center mb-8">
                  <div className="w-20 h-20 grad-solana rounded-full mx-auto mb-4 shadow-card"></div>
                  <h1 className="text-2xl font-bold text-fg-0">Solana Wallet</h1>
                  <p className="text-fg-2 mt-2 text-sm">
                    Create a new wallet or import an existing one
                  </p>
                </div>
                
                <div className="space-y-4">
                  <PrimaryButton 
                    onClick={handleCreateNew}
                    className="w-full"
                    data-testid="create-new-wallet"
                  >
                    Create New Wallet
                  </PrimaryButton>
                  
                  <SecondaryButton
                    onClick={handleImportExisting}
                    className="w-full"
                    data-testid="import-existing-wallet"
                  >
                    Import Existing Wallet
                  </SecondaryButton>
                </div>
                
                <p className="text-xs text-fg-3 text-center mt-6">
                  By continuing, you agree to our Terms of Service
                </p>
              </CardContent>
            </Card>
          </div>
        );
        
      case 'generate-seed':
        return (
          <div className="animate-fadeIn">
            <SeedPhraseDisplay
              seedPhrase={seedPhrase}
              onContinue={() => setCurrentStep('verify-seed')}
              onBack={handleBack}
            />
          </div>
        );
        
      case 'verify-seed':
        return (
          <div className="animate-fadeIn">
            <SeedPhraseVerification
              seedPhrase={seedPhrase}
              onVerified={() => setCurrentStep('create-password')}
              onBack={handleBack}
            />
          </div>
        );
        
      case 'import-seed':
        return (
          <div className="animate-fadeIn">
            <SeedPhraseImport
              onImport={handleImportSeed}
              onBack={handleBack}
            />
          </div>
        );
        
      case 'create-password':
        return (
          <div className="animate-fadeIn">
            <PasswordCreate
              onSubmit={handlePasswordCreate}
              onBack={handleBack}
            />
          </div>
        );
        
      default:
        return null;
    }
  };
  
  return (
    <div className="popup-container bg-bg-0 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {renderStep()}
      </div>
    </div>
  );
};