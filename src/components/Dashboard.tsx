import { showReceive, showSend } from '../store/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '../store/store';
import { NFTGallery } from './nfts/NFTGallery';
import { Settings } from './settings/Settings';
import { AppShell } from './shell/AppShell';
import { ReceiveModal } from './tokens/ReceiveModal';
import { SendModal } from './tokens/SendModal';
import { TokenList } from './tokens/TokenList';
import { TransactionHistory } from './transactions/TransactionHistory';
import { Icon } from './ui/Icon';
import { PrimaryButton, SecondaryButton } from './ui/Button';
import { BalanceCard } from './wallet/BalanceCard';

export function Dashboard() {
  const dispatch = useAppDispatch();
  const { activeView, showSettingsModal } = useAppSelector((state) => state.ui);

  return (
    <AppShell>
      {showSettingsModal ? (
        <Settings />
      ) : (
        <div className="h-full min-h-0 animate-fadeIn">
          {activeView === 'tokens' && (
            <div className="px-4 pt-5">
              <BalanceCard />
              <div className="mt-5 grid grid-cols-2 gap-3">
                <SecondaryButton onClick={() => dispatch(showReceive())} data-testid="open-receive">
                  <Icon name="receive" className="h-4 w-4" />
                  Receive
                </SecondaryButton>
                <PrimaryButton onClick={() => dispatch(showSend())} data-testid="open-send">
                  <Icon name="send" className="h-4 w-4" />
                  Send
                </PrimaryButton>
              </div>
              <div className="mt-6">
                <TokenList />
              </div>
            </div>
          )}
          {activeView === 'nfts' && <NFTGallery />}
          {activeView === 'activity' && <TransactionHistory />}
        </div>
      )}

      <SendModal />
      <ReceiveModal />
    </AppShell>
  );
}
