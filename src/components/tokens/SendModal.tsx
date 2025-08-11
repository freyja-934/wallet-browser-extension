import { PublicKey } from '@solana/web3.js';
import { AnimatePresence, motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { hideSend } from '../../store/slices/uiSlice';
import { fetchBalances, sendTransaction } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';

interface SendModalProps {
  preselectedToken?: {
    mint?: string;
    symbol: string;
    balance: number;
    decimals: number;
  };
}

export const SendModal: React.FC<SendModalProps> = ({ preselectedToken }) => {
  const dispatch = useAppDispatch();
  const { showSendModal } = useAppSelector(state => state.ui);
  const { solBalance, tokens, isLoading } = useAppSelector(state => state.wallet);
  
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState(preselectedToken || {
    symbol: 'SOL',
    balance: solBalance,
    decimals: 9
  });
  const [isValidAddress, setIsValidAddress] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // Validate recipient address
    if (recipient) {
      try {
        new PublicKey(recipient);
        setIsValidAddress(true);
        setAddressError('');
      } catch {
        setIsValidAddress(false);
        setAddressError('Invalid Solana address');
      }
    } else {
      setIsValidAddress(false);
      setAddressError('');
    }
  }, [recipient]);

  const handleSend = async () => {
    if (!isValidAddress || !amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid recipient and amount');
      return;
    }

    const amountNum = parseFloat(amount);
    if (amountNum > selectedToken.balance) {
      toast.error('Insufficient balance');
      return;
    }

    setSending(true);
    
    try {
      const result = await dispatch(sendTransaction({
        to: recipient,
        amount: amountNum,
        mint: selectedToken.mint
      })).unwrap();
      
      toast.success(`Transaction sent! Signature: ${result.signature.slice(0, 8)}...`);
      
      // Refresh balances
      dispatch(fetchBalances());
      
      // Close modal
      handleClose();
    } catch (error) {
      console.error('Send error:', error);
      toast.error(error instanceof Error ? error.message : 'Transaction failed');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    dispatch(hideSend());
    setRecipient('');
    setAmount('');
  };

  const handleMaxAmount = () => {
    // Leave some SOL for fees if sending SOL
    const max = selectedToken.symbol === 'SOL' 
      ? Math.max(0, selectedToken.balance - 0.01)
      : selectedToken.balance;
    setAmount(max.toString());
  };

  if (!showSendModal) return null;

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
              <h2 className="text-xl font-semibold">Send {selectedToken.symbol}</h2>
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
          <div className="p-6 space-y-4">
            {/* Token Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Token
              </label>
              <select
                value={selectedToken.mint || 'SOL'}
                onChange={(e) => {
                  if (e.target.value === 'SOL') {
                    setSelectedToken({
                      symbol: 'SOL',
                      balance: solBalance,
                      decimals: 9
                    });
                  } else {
                    const token = tokens.find(t => t.mint === e.target.value);
                    if (token) {
                      setSelectedToken({
                        mint: token.mint,
                        symbol: token.symbol || 'Unknown',
                        balance: parseFloat(token.amount) / Math.pow(10, token.decimals),
                        decimals: token.decimals
                      });
                    }
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="SOL">SOL - {solBalance.toFixed(4)}</option>
                {tokens.map(token => (
                  <option key={token.mint} value={token.mint}>
                    {token.symbol} - {(parseFloat(token.amount) / Math.pow(10, token.decimals)).toFixed(4)}
                  </option>
                ))}
              </select>
            </div>

            {/* Recipient */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Recipient Address
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Enter Solana address"
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${
                  addressError 
                    ? 'border-red-300 focus:ring-red-500' 
                    : 'border-gray-300 focus:ring-indigo-500'
                }`}
              />
              {addressError && (
                <p className="mt-1 text-sm text-red-600">{addressError}</p>
              )}
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  step="any"
                  min="0"
                  max={selectedToken.balance}
                  className="w-full px-3 py-2 pr-16 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleMaxAmount}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  MAX
                </button>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Available: {selectedToken.balance.toFixed(6)} {selectedToken.symbol}
              </p>
            </div>

            {/* Transaction Fee Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                Network fee: ~0.000005 SOL ($0.001)
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="px-6 py-4 bg-gray-50 flex justify-end space-x-3">
            <button
              onClick={handleClose}
              disabled={sending}
              className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={!isValidAddress || !amount || parseFloat(amount) <= 0 || sending || isLoading}
              className={`px-6 py-2 rounded-lg font-medium transition-all ${
                !isValidAddress || !amount || parseFloat(amount) <= 0 || sending || isLoading
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {sending ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Sending...
                </span>
              ) : (
                'Send'
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
