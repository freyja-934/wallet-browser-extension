import React from 'react';
import toast from 'react-hot-toast';
import { setActiveView, showReceive, showSend } from '../store/slices/uiSlice';
import { lockWallet } from '../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../store/store';
import { NFTGallery } from './nfts/NFTGallery';
import { Settings } from './settings/Settings';
import { ReceiveModal } from './tokens/ReceiveModal';
import { SendModal } from './tokens/SendModal';
import { TokenList } from './tokens/TokenList';
import { TransactionHistory } from './transactions/TransactionHistory';

export const Dashboard: React.FC = () => {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const { activeView } = useAppSelector(state => state.ui);
  const activeAccount = accounts[activeAccountIndex];
  
  const handleLock = async () => {
    await dispatch(lockWallet());
    toast.success('Wallet locked');
  };

  const handleCopyAddress = () => {
    if (activeAccount) {
      navigator.clipboard.writeText(activeAccount.address);
      toast.success('Address copied to clipboard');
    }
  };
  
  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-indigo-600 to-blue-600 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">
                {activeAccount?.name.charAt(0) || 'W'}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {activeAccount?.name || 'Wallet'}
              </p>
              <button
                onClick={handleCopyAddress}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center space-x-1"
              >
                <span>{activeAccount?.address.slice(0, 4)}...{activeAccount?.address.slice(-4)}</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
          
          <button
            onClick={handleLock}
            className="p-2 text-gray-500 hover:text-gray-700 transition-colors"
            title="Lock wallet"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2">
          <button
            onClick={() => dispatch(showSend())}
            className="flex-1 bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm flex items-center justify-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            <span>Send</span>
          </button>
          <button
            onClick={() => dispatch(showReceive())}
            className="flex-1 bg-white text-gray-900 py-2 px-4 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors font-medium text-sm flex items-center justify-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <span>Receive</span>
          </button>
        </div>
      </div>
      
      {/* Navigation Tabs */}
      <div className="bg-white border-b border-gray-200 px-4">
        <div className="flex space-x-8">
          <button
            onClick={() => dispatch(setActiveView('tokens'))}
            className={`py-3 border-b-2 font-medium text-sm transition-colors ${
              activeView === 'tokens'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Tokens
          </button>
          <button
            onClick={() => dispatch(setActiveView('nfts'))}
            className={`py-3 border-b-2 font-medium text-sm transition-colors ${
              activeView === 'nfts'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            NFTs
          </button>
          <button
            onClick={() => dispatch(setActiveView('activity'))}
            className={`py-3 border-b-2 font-medium text-sm transition-colors ${
              activeView === 'activity'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Activity
          </button>
          <button
            onClick={() => dispatch(setActiveView('settings'))}
            className={`py-3 border-b-2 font-medium text-sm transition-colors ${
              activeView === 'settings'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Settings
          </button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'tokens' && <TokenList />}
        {activeView === 'nfts' && <NFTGallery />}
        {activeView === 'activity' && <TransactionHistory />}
        {activeView === 'settings' && <Settings />}
      </div>

      {/* Modals */}
      <SendModal />
      <ReceiveModal />
    </div>
  );
};
