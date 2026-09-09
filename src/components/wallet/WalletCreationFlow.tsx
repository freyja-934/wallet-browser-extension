import { useState } from 'react';
import toast from 'react-hot-toast';
import { generateSeedPhrase } from '../../lib/wallet';
import { createWallet } from '../../store/slices/walletSlice';
import { useAppDispatch } from '../../store/store';
import { PopupFrame } from '../ui/Atmosphere';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { GlowMark } from '../ui/GlowMark';
import { PasswordCreate } from './PasswordCreate';
import { SeedPhraseDisplay } from './SeedPhraseDisplay';
import { SeedPhraseImport } from './SeedPhraseImport';
import { SeedPhraseVerification } from './SeedPhraseVerification';

type FlowStep = 'choice' | 'generate-seed' | 'verify-seed' | 'import-seed' | 'create-password' | 'complete';

export function WalletCreationFlow({ onComplete }: { onComplete?: () => void }) {
  const dispatch = useAppDispatch();
  const [currentStep, setCurrentStep] = useState<FlowStep>('choice');
  const [seedPhrase, setSeedPhrase] = useState('');
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
      await dispatch(createWallet({ password, seedPhrase, imported: isImported })).unwrap();
      toast.success(isImported ? 'Wallet imported' : 'Wallet created');
      setCurrentStep('complete');
      onComplete?.();
    } catch {
      toast.error('Failed to create wallet. Please try again.');
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
          <div className="flex h-full min-h-0 flex-col px-6 pb-8 pt-6">
            <div className="flex flex-1 flex-col items-center justify-end pb-8 text-center">
              <GlowMark size={96} dashed className="mx-auto" />
              <h1 className="mt-6 text-3xl font-semibold tracking-tight">Cinder Wallet</h1>
              <p className="mt-2 text-sm text-fg-2">A Solana wallet for the browser</p>
              <p className="mt-3 max-w-[18rem] text-xs leading-relaxed text-fg-3">
                You are the only one who can recover this wallet. Do not store funds you cannot afford to lose.
              </p>
            </div>
            <div className="space-y-3">
              <PrimaryButton onClick={handleCreateNew} className="w-full" data-testid="create-new-wallet">
                Create new wallet
              </PrimaryButton>
              <SecondaryButton onClick={handleImportExisting} className="w-full" data-testid="import-existing-wallet">
                Import existing wallet
              </SecondaryButton>
            </div>
          </div>
        );
      case 'generate-seed':
        return (
          <SeedPhraseDisplay
            seedPhrase={seedPhrase}
            onContinue={() => setCurrentStep('verify-seed')}
            onBack={handleBack}
          />
        );
      case 'verify-seed':
        return (
          <SeedPhraseVerification
            seedPhrase={seedPhrase}
            onVerified={() => setCurrentStep('create-password')}
            onBack={handleBack}
          />
        );
      case 'import-seed':
        return <SeedPhraseImport onImport={handleImportSeed} onBack={handleBack} />;
      case 'create-password':
        return <PasswordCreate onSubmit={handlePasswordCreate} onBack={handleBack} />;
      default:
        return null;
    }
  };

  return (
    <PopupFrame atmosphere="still" heavy={currentStep !== 'choice'} focus={currentStep === 'choice' ? 'mark' : 'stage'}>
      {renderStep()}
    </PopupFrame>
  );
}
