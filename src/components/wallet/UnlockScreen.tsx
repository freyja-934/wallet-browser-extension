import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { unlockWallet } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { PopupFrame } from '../ui/Atmosphere';
import { Banner } from '../ui/EmptyState';
import { PrimaryButton } from '../ui/Button';
import { GlowMark } from '../ui/GlowMark';
import { FieldLabel, PasswordField } from '../ui/Input';

export function UnlockScreen() {
  const dispatch = useAppDispatch();
  const { isLoading, error } = useAppSelector((state) => state.wallet);
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      toast.error('Enter your password');
      return;
    }
    try {
      await dispatch(unlockWallet(password)).unwrap();
    } catch {
      toast.error('Invalid password');
    }
  };

  return (
    <PopupFrame atmosphere="still" focus="mark">
      <div className="flex h-full min-h-0 flex-col px-6 pb-8 pt-6">
        <div className="flex flex-1 flex-col items-center justify-end pb-8 text-center">
          <GlowMark size={96} dashed className="mx-auto" />
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">Cinder Wallet</h1>
          <p className="mt-2 text-sm text-fg-2">Unlock to continue</p>
          <p className="mt-3 max-w-[16rem] text-xs leading-relaxed text-fg-3">
            Cinder Wallet cannot reset this password. Recover by importing your seed phrase.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <FieldLabel>Password</FieldLabel>
            <PasswordField
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              disabled={isLoading}
              data-testid="unlock-password"
            />
          </div>

          {error && <Banner tone="danger">{error}</Banner>}

          <PrimaryButton type="submit" disabled={isLoading || !password} className="w-full" data-testid="unlock-submit">
            {isLoading ? 'Unlocking…' : 'Unlock'}
          </PrimaryButton>
        </form>
      </div>
    </PopupFrame>
  );
}
