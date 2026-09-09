import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Banner, StepHeader, StepScreen } from '../ui/EmptyState';
import { GhostButton, PrimaryButton } from '../ui/Button';
import { TextField } from '../ui/Input';

export function SeedPhraseVerification({
  seedPhrase,
  onVerified,
  onBack,
}: {
  seedPhrase: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  const words = seedPhrase.split(' ');
  const [verificationIndices, setVerificationIndices] = useState<number[]>([]);
  const [userInputs, setUserInputs] = useState<{ [key: number]: string }>({});
  const [errors, setErrors] = useState<{ [key: number]: boolean }>({});
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    const indices: number[] = [];
    const count = words.length === 12 ? 3 : 4;
    while (indices.length < count) {
      const index = Math.floor(Math.random() * words.length);
      if (!indices.includes(index)) indices.push(index);
    }
    setVerificationIndices(indices.sort((a, b) => a - b));
  }, [words.length]);

  const checkCompletion = (inputs: { [key: number]: string }) => {
    const nextErrors: { [key: number]: boolean } = {};
    let hasErrors = false;
    verificationIndices.forEach((index) => {
      const isCorrect = inputs[index]?.trim() === words[index];
      nextErrors[index] = !isCorrect;
      if (!isCorrect) hasErrors = true;
    });
    setErrors(nextErrors);
    setIsComplete(!hasErrors);
    if (hasErrors) toast.error('Some words are incorrect. Please try again.', { id: 'verify-words' });
  };

  const handleInputChange = (index: number, value: string) => {
    const next = { ...userInputs, [index]: value.toLowerCase() };
    setUserInputs(next);
    setErrors({ ...errors, [index]: false });
    const allFilled = verificationIndices.every((idx) => next[idx]?.trim());
    if (allFilled) checkCompletion(next);
  };

  return (
    <StepScreen
      footer={
        <>
          <GhostButton type="button" onClick={onBack} className="px-0">
            Back
          </GhostButton>
          <PrimaryButton
            onClick={() => isComplete && onVerified()}
            disabled={!isComplete}
            className="min-w-[140px]"
            data-testid="seed-verify-submit"
          >
            Verify
          </PrimaryButton>
        </>
      }
    >
      <StepHeader
        title="Verify your phrase"
        subtitle="Enter the requested words to confirm you saved the phrase."
        step={3}
        total={4}
        onBack={onBack}
      />

      <div className="space-y-3">
        {verificationIndices.map((wordIndex, i) => (
          <motion.div key={wordIndex} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <label className="mb-2 block text-xs uppercase tracking-[0.14em] text-fg-2">Word #{wordIndex + 1}</label>
            <TextField
              type="text"
              value={userInputs[wordIndex] || ''}
              onChange={(e) => handleInputChange(wordIndex, e.target.value)}
              placeholder={`Word ${wordIndex + 1}`}
              data-testid={i === 0 ? 'seed-verify-input' : `seed-verify-${wordIndex}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className={
                errors[wordIndex]
                  ? 'border-ui-danger'
                  : userInputs[wordIndex] && !errors[wordIndex]
                    ? 'border-ui-success/50'
                    : ''
              }
            />
          </motion.div>
        ))}
      </div>

      <div className="mt-4">
        <Banner tone="info">Paste a single word into a field. Pasting the full phrase is disabled on purpose.</Banner>
      </div>
    </StepScreen>
  );
}
