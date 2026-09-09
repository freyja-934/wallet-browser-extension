import { GlowMark } from '../ui/GlowMark';
import { PopupFrame } from '../ui/Atmosphere';

export function LoadingScreen() {
  return (
    <PopupFrame atmosphere="still" focus="mark">
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-6">
        <GlowMark size={88} dashed />
        <p className="mt-8 font-sans text-2xl font-semibold tracking-tight text-fg-0">Cinder Wallet</p>
        <p className="mt-2 text-xs uppercase tracking-[0.22em] text-fg-2">Loading wallet</p>
      </div>
    </PopupFrame>
  );
}
