import React from 'react';
import { lockWallet } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';

export function AppShell({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const activeAccount = accounts[activeAccountIndex];

  const handleLock = () => {
    dispatch(lockWallet());
  };

  return (
    <div className="popup-container bg-bg-0 text-fg-0 flex flex-col">
      <header className="sticky top-0 z-20 bg-bg-1/80 backdrop-blur-md border-b border-ui-border">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-full grad-solana shadow-press" />
            <div>
              <span className="text-sm font-medium text-fg-0">Lumen</span>
              {activeAccount && (
                <p className="text-[11px] text-fg-2">
                  {activeAccount.address.slice(0, 4)}...{activeAccount.address.slice(-4)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Network pill */}
            <div className="px-2.5 h-6 rounded-md bg-bg-2 border border-ui-border text-xs text-fg-1 flex items-center">
              Mainnet
            </div>
            {/* Lock button */}
            <button
              onClick={handleLock}
              aria-label="Lock wallet"
              className="p-2 rounded-md hover:bg-bg-2 transition-colors duration-fast"
            >
              <svg className="h-5 w-5 text-fg-1" viewBox="0 0 24 24" fill="none">
                <path d="M12 17a2 2 0 100-4 2 2 0 000 4z" fill="currentColor"/>
                <path d="M12 17v3M6 21h12a1 1 0 001-1v-7a1 1 0 00-1-1H6a1 1 0 00-1 1v7a1 1 0 001 1zM8 12V8a4 4 0 118 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-x-hidden overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
