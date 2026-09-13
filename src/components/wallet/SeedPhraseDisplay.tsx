import { useState } from 'react';
import toast from 'react-hot-toast';
import { Banner, StepHeader, StepScreen } from '../ui/EmptyState';
import { GhostButton, PrimaryButton, SecondaryButton } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export function SeedPhraseDisplay({
  seedPhrase,
  isNewWallet = true,
  onContinue,
  onBack,
}: {
  seedPhrase: string;
  isNewWallet?: boolean;
  onContinue?: () => void;
  onBack?: () => void;
}) {
  const [isBlurred, setIsBlurred] = useState(true);
  const [attested, setAttested] = useState(false);
  const [confirmCopy, setConfirmCopy] = useState(false);
  const words = seedPhrase.split(' ');
  // Revealing is one-way, so "has seen the phrase" is simply the cover being off.
  const hasViewed = !isBlurred;

  return (
    <>
    <StepScreen
      footer={
        <>
          {onBack && (
            <GhostButton type="button" onClick={onBack} className="px-0">
              Back
            </GhostButton>
          )}
          {onContinue && (
            <PrimaryButton
              onClick={onContinue}
              disabled={isNewWallet && (!hasViewed || isBlurred || !attested)}
              className="ml-auto min-w-[140px]"
              data-testid="seed-continue"
            >
              Continue
            </PrimaryButton>
          )}
        </>
      }
    >
      <StepHeader
        title="Secret recovery phrase"
        subtitle="Write these words down offline. Anyone with this phrase can move your funds."
        step={2}
        total={4}
        onBack={onBack}
      />

      <Banner tone="danger">Never share this phrase. Cinder Wallet cannot recover it if it is lost.</Banner>

      <div className="relative mt-4">
        {isBlurred && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/55 backdrop-blur-sm">
            <PrimaryButton type="button" onClick={() => setIsBlurred(false)} className="h-10 px-5 text-sm" data-testid="reveal-seed">
              Reveal phrase
            </PrimaryButton>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
          {words.map((word, index) => (
            <div key={`${word}-${index}`} className="rounded-xl bg-black/40 px-2 py-2">
              <span className="text-[10px] text-fg-3">{index + 1}</span>
              <p data-testid="seed-word" className={`font-mono text-xs ${isBlurred ? 'text-transparent' : 'text-fg-0'}`}>{word}</p>
            </div>
          ))}
        </div>
      </div>

      {!isBlurred && (
        <div className="mt-3 flex justify-center">
          <SecondaryButton type="button" onClick={() => setConfirmCopy(true)} className="h-9 px-4 text-xs">
            Copy all words
          </SecondaryButton>
        </div>
      )}

      {isNewWallet && (
        <label className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-fg-2">
          {/* A real claim by the user, not a checkbox that ticks itself when the phrase is revealed. */}
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            disabled={isBlurred}
            data-testid="seed-attest"
            className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent disabled:opacity-40"
          />
          I stored this phrase somewhere safe and understand I need it to recover this wallet.
        </label>
      )}

    </StepScreen>
    <ConfirmDialog
      isOpen={confirmCopy}
      title="Copy recovery phrase?"
      body="Clipboard apps and screenshots can leak this phrase. Only copy if you understand the risk."
      confirmLabel="Copy"
      danger
      onClose={() => setConfirmCopy(false)}
      onConfirm={() => {
        navigator.clipboard.writeText(seedPhrase);
        toast.success('Seed phrase copied');
        setConfirmCopy(false);
      }}
    />
    </>
  );
}
