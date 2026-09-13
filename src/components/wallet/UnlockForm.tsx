import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/errors';
import type { WalletPublicState } from '../../lib/messages';
import { extensionClient } from '../../messaging/client';
import { Banner } from '../ui/EmptyState';
import { PrimaryButton } from '../ui/Button';
import { FieldLabel, PasswordField } from '../ui/Input';

/**
 * Password field plus Unlock button. Presentational: talks to the worker
 * directly so the approval window (which has no Redux store) can use it too.
 */
export function UnlockForm({ onUnlocked }: { onUnlocked: (state: WalletPublicState) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = await extensionClient.unlock(password);
      setPassword('');
      onUnlocked(state);
    } catch (error) {
      // Whatever the worker said: 'Unsupported vault format' must not be shown
      // as a wrong password, or the user retypes a password that was right.
      setError(errorMessage(error, 'Invalid password'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <FieldLabel htmlFor="unlock-password">Password</FieldLabel>
        <PasswordField
          id="unlock-password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          autoFocus
          disabled={busy}
          data-testid="unlock-password"
        />
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <PrimaryButton type="submit" disabled={busy || !password} className="w-full" data-testid="unlock-submit">
        {busy ? 'Unlocking…' : 'Unlock'}
      </PrimaryButton>
    </form>
  );
}
