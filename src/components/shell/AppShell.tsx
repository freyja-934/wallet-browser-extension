import type { ReactNode } from 'react';
import toast from 'react-hot-toast';
import { labelFor } from '../../config/constants';
import { useSettings } from '../../hooks/useSettings';
import { hideSettings, setActiveView, showSettings } from '../../store/slices/uiSlice';
import { lockWallet } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { PopupFrame } from '../ui/Atmosphere';
import { IconButton } from '../ui/Button';
import { GlowMark } from '../ui/GlowMark';
import { Icon, type IconName } from '../ui/Icon';

export function AppShell({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const { activeView, showSettingsModal, cluster: reduxCluster } = useAppSelector((state) => state.ui);
  const { data: settings } = useSettings();
  const cluster = settings?.cluster ?? reduxCluster;
  const activeAccount = accounts[activeAccountIndex];
  const atmosphere = !showSettingsModal && activeView === 'tokens' ? 'video' : 'still';

  const handleCopy = async () => {
    if (!activeAccount) return;
    await navigator.clipboard.writeText(activeAccount.address);
    toast.success('Address copied');
  };

  return (
    <PopupFrame atmosphere={atmosphere} heavy={showSettingsModal}>
      <header className="z-20 shrink-0 border-b border-white/8 bg-black/30 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <GlowMark size={28} />
            <div>
              <p className="text-sm font-semibold tracking-tight">Cinder</p>
              {activeAccount && (
                <button type="button" onClick={handleCopy} className="font-mono text-[11px] text-fg-2 hover:text-fg-0">
                  {activeAccount.address.slice(0, 4)}…{activeAccount.address.slice(-4)}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-fg-2">
              {labelFor(cluster)}
            </span>
            <IconButton
              aria-label={showSettingsModal ? 'Close settings' : 'Settings'}
              data-testid="open-settings"
              onClick={() => dispatch(showSettingsModal ? hideSettings() : showSettings())}
            >
              <Icon name={showSettingsModal ? 'close' : 'gear'} className="h-4 w-4" />
            </IconButton>
            <IconButton aria-label="Lock wallet" onClick={() => dispatch(lockWallet())}>
              <Icon name="lock" className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
      {!showSettingsModal && (
        <nav className="z-20 shrink-0 border-t border-white/8 bg-black/55 px-4 py-2 backdrop-blur-md">
          <div className="grid grid-cols-3">
            <NavTab testId="nav-home" icon="home" label="Home" active={activeView === 'tokens'} onClick={() => dispatch(setActiveView('tokens'))} />
            <NavTab testId="nav-nfts" icon="nft" label="NFTs" active={activeView === 'nfts'} onClick={() => dispatch(setActiveView('nfts'))} />
            <NavTab testId="nav-activity" icon="activity" label="Activity" active={activeView === 'activity'} onClick={() => dispatch(setActiveView('activity'))} />
          </div>
        </nav>
      )}
    </PopupFrame>
  );
}

function NavTab({
  icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 py-1 text-[10px] uppercase tracking-[0.14em] ${
        active ? 'text-brand-a' : 'text-fg-3 hover:text-fg-1'
      }`}
    >
      <Icon name={icon} className="h-5 w-5" />
      {label}
    </button>
  );
}
