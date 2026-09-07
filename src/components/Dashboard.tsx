import React from 'react';
import { setActiveView, showReceive, showSend } from '../store/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '../store/store';
import { NFTGallery } from './nfts/NFTGallery';
import { Settings } from './settings/Settings';
import { AppShell } from './shell/AppShell';
import { ReceiveModal } from './tokens/ReceiveModal';
import { SendModal } from './tokens/SendModal';
import { TokenList } from './tokens/TokenList';
import { TransactionHistory } from './transactions/TransactionHistory';
import { PrimaryButton, SecondaryButton } from './ui/Button';
import { BalanceCard } from './wallet/BalanceCard';

export const Dashboard: React.FC = () => {
  const dispatch = useAppDispatch();
  const { activeView } = useAppSelector(state => state.ui);
  
  return (
    <AppShell>
      <div className="space-y-4">
        {/* Balance Card with Action Buttons */}
        <div className="p-4 pb-0">
          <BalanceCard />
          
          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <SecondaryButton onClick={() => dispatch(showReceive())}>
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                Receive
              </span>
            </SecondaryButton>
            <PrimaryButton onClick={() => dispatch(showSend())}>
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Send
              </span>
            </PrimaryButton>
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <div className="sticky top-14 z-10 bg-bg-0 border-b border-ui-border">
          <div className="flex px-4">
            <TabButton 
              active={activeView === 'tokens'} 
              onClick={() => dispatch(setActiveView('tokens'))}
            >
              Assets
            </TabButton>
            <TabButton 
              active={activeView === 'nfts'} 
              onClick={() => dispatch(setActiveView('nfts'))}
            >
              NFTs
            </TabButton>
            <TabButton 
              active={activeView === 'activity'} 
              onClick={() => dispatch(setActiveView('activity'))}
            >
              Activity
            </TabButton>
            <TabButton 
              active={activeView === 'settings'} 
              onClick={() => dispatch(setActiveView('settings'))}
            >
              Settings
            </TabButton>
          </div>
        </div>
        
        {/* Content Area */}
        <div className="animate-fadeIn">
          {activeView === 'tokens' && <TokenList />}
          {activeView === 'nfts' && <NFTGallery />}
          {activeView === 'activity' && <TransactionHistory />}
          {activeView === 'settings' && <Settings />}
        </div>
      </div>

      {/* Modals */}
      <SendModal />
      <ReceiveModal />
    </AppShell>
  );
};

function TabButton({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 text-sm font-medium border-b-2 transition-all duration-base ${
        active
          ? 'border-brand-b text-fg-0'
          : 'border-transparent text-fg-2 hover:text-fg-1'
      }`}
    >
      {children}
    </button>
  );
}
