import { motion } from 'framer-motion';
import { useEffect, useState, type FormEvent } from 'react';
import { validatePasswordStrength } from '../../lib/encryption-simple';
import { Banner, StepHeader } from '../ui/EmptyState';
import { GhostButton, PrimaryButton } from '../ui/Button';
import { FieldLabel, PasswordField } from '../ui/Input';

export function PasswordCreate({
  onSubmit,
  onBack,
  title = 'Create a password',
  subtitle = 'This password encrypts your wallet on this device. There is no recovery if you forget it.',
}: {
  onSubmit: (password: string) => void;
  onBack?: () => void;
  title?: string;
  subtitle?: string;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStrength, setPasswordStrength] = useState<ReturnType<typeof validatePasswordStrength>>({
    isValid: false,
    score: 0,
    feedback: [],
  });
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (password) {
      setPasswordStrength(validatePasswordStrength(password));
    } else {
      setPasswordStrength({ isValid: false, score: 0, feedback: [] });
    }
  }, [password]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setErrors([]);
    if (!passwordStrength.isValid) {
      setErrors(['Please create a stronger password']);
      return;
    }
    if (password !== confirmPassword) {
      setErrors(['Passwords do not match']);
      return;
    }
    onSubmit(password);
  };

  const strengthLabel = ['Weak', 'Fair', 'Good', 'Strong', 'Very strong'][Math.max(0, passwordStrength.score - 1)] || 'Weak';

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col px-5 py-5">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StepHeader title={title} subtitle={subtitle} step={4} total={4} onBack={onBack} />
        <div className="space-y-5">
          <div>
            <FieldLabel>Password</FieldLabel>
            <PasswordField
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong password"
              autoComplete="new-password"
              data-testid="password-input"
            />
            {password && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-brand-a"
                      style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-fg-2">{strengthLabel}</span>
                </div>
                {passwordStrength.feedback.length > 0 && (
                  <ul className="space-y-1 text-xs text-fg-2">
                    {passwordStrength.feedback.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </div>

          <div>
            <FieldLabel>Confirm password</FieldLabel>
            <PasswordField
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrors([]);
              }}
              placeholder="Confirm your password"
              autoComplete="new-password"
              data-testid="password-confirm"
            />
            {confirmPassword && password !== confirmPassword && (
              <p className="mt-2 text-xs text-ui-danger">Passwords do not match</p>
            )}
          </div>

          {errors.length > 0 && <Banner tone="danger">{errors[0]}</Banner>}
          <Banner>If you forget this password you will need your seed phrase to restore the wallet.</Banner>
        </div>
      </div>
      <div className="mt-4 flex shrink-0 items-center justify-between">
        {onBack && (
          <GhostButton type="button" onClick={onBack} className="px-0">
            Back
          </GhostButton>
        )}
        <PrimaryButton
          type="submit"
          disabled={!passwordStrength.isValid || password !== confirmPassword}
          className="ml-auto min-w-[140px]"
          data-testid="password-submit"
        >
          Create wallet
        </PrimaryButton>
      </div>
    </form>
  );
}
