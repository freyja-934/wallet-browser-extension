import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { errorMessage } from '../../lib/errors';
import { generateSeedPhrase } from '../../lib/wallet';
import { extensionClient } from '../../messaging/client';
import { initializeWallet } from '../../store/slices/walletSlice';
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
  /** A create is in flight: the password screen's submit stays disabled until it settles. */
  const [busy, setBusy] = useState(false);

  // The phrase does not outlive the flow: closing the popup mid-onboarding drops it.
  useEffect(() => () => setSeedPhrase(''), []);

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

  /**
   * The worker is told the phrase directly: a Redux action carrying a mnemonic
   * would sit in the store's action history (and any devtools attached to it).
   * The phrase lives in this component's state and nowhere else; Redux only ever
   * learns the public state.
   *
   * It is held in a local const for the whole call and cleared only once the
   * flow has finished. Clearing it early made a retry after any failure here
   * send an empty phrase, which the worker read as "generate a fresh one" — a
   * wallet the user had already written down, replaced by one nobody had seen.
   * Reading the state back is a separate try for the same reason: the vault
   * exists by then, and a failed read is not a failed create.
   */
  const handlePasswordCreate = async (password: string) => {
    if (busy) return;
    const phrase = seedPhrase;
    setBusy(true);
    try {
      await extensionClient.createWallet(password, phrase);
    } catch (error) {
      setBusy(false);
      toast.error(errorMessage(error, 'Failed to create wallet. Please try again.'));
      return;
    }

    let refreshed = true;
    try {
      await dispatch(initializeWallet()).unwrap();
    } catch {
      refreshed = false;
    }
    setSeedPhrase('');
    setCurrentStep('complete');
    setBusy(false);
    if (refreshed) toast.success(isImported ? 'Wallet imported' : 'Wallet created');
    else toast.error('Wallet created. Reopen the popup to continue.');
    onComplete?.();
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
        return <PasswordCreate onSubmit={handlePasswordCreate} onBack={handleBack} busy={busy} />;
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
