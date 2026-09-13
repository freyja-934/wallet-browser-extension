import { initializeWallet } from '../../store/slices/walletSlice';
import { useAppDispatch } from '../../store/store';
import { PopupFrame } from '../ui/Atmosphere';
import { GlowMark } from '../ui/GlowMark';
import { UnlockForm } from './UnlockForm';

export function UnlockScreen() {
  const dispatch = useAppDispatch();

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

        {/* The worker already holds the session; re-read public state so routing flips to the dashboard. */}
        <UnlockForm onUnlocked={() => void dispatch(initializeWallet())} />
      </div>
    </PopupFrame>
  );
}
