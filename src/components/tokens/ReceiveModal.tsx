import { AnimatePresence, motion } from 'framer-motion';
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { hideReceive } from '../../store/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';

export const ReceiveModal: React.FC = () => {
  const dispatch = useAppDispatch();
  const { showReceiveModal } = useAppSelector(state => state.ui);
  const { accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const [showQR, setShowQR] = useState(false);
  
  const activeAccount = accounts[activeAccountIndex];
  const address = activeAccount?.address || '';

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    toast.success('Address copied to clipboard');
  };

  const handleClose = () => {
    dispatch(hideReceive());
    setShowQR(false);
  };

  if (!showReceiveModal) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-4 text-white">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Receive</h2>
              <button
                onClick={handleClose}
                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            <div className="text-center mb-6">
              <p className="text-sm text-gray-600 mb-4">
                Share your address to receive SOL or tokens
              </p>
              
              {/* QR Code Placeholder */}
              {showQR ? (
                <div className="mb-4">
                  <div className="w-48 h-48 bg-gray-200 rounded-lg mx-auto flex items-center justify-center">
                    <span className="text-gray-500">QR Code</span>
                  </div>
                  <button
                    onClick={() => setShowQR(false)}
                    className="mt-2 text-sm text-indigo-600 hover:text-indigo-700"
                  >
                    Hide QR Code
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowQR(true)}
                  className="mb-4 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Show QR Code
                </button>
              )}
            </div>

            {/* Address Display */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <p className="text-xs text-gray-500 mb-1">Your Solana Address</p>
              <p className="font-mono text-sm text-gray-900 break-all">{address}</p>
            </div>

            {/* Copy Button */}
            <button
              onClick={handleCopy}
              className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium flex items-center justify-center space-x-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>Copy Address</span>
            </button>

            {/* Warning */}
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                ⚠️ Only send Solana (SOL) and SPL tokens to this address. Sending other assets may result in permanent loss.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
