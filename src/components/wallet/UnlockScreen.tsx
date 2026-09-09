import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { unlockWallet } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { PrimaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { TextField } from '../ui/Input';

export const UnlockScreen: React.FC = () => {
  const dispatch = useAppDispatch();
  const { isLoading, error } = useAppSelector(state => state.wallet);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password) {
      toast.error('Please enter your password');
      return;
    }
    
    try {
      await dispatch(unlockWallet(password)).unwrap();
      toast.success('Wallet unlocked successfully!');
    } catch (err) {
      toast.error('Invalid password. Please try again.');
    }
  };
  
  return (
    <div className="popup-container bg-bg-0 flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-scaleIn">
        <Card>
          <CardContent className="p-8">
            {/* Logo */}
            <div className="text-center mb-8">
              <div className="w-20 h-20 grad-solana rounded-full mx-auto mb-4 flex items-center justify-center shadow-card">
                <svg className="w-10 h-10 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-fg-0">Welcome Back</h1>
              <p className="text-fg-2 mt-2 text-sm">Enter your password to unlock your wallet</p>
            </div>

            {/* Unlock Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-fg-1 mb-2">
                  Password
                </label>
                <div className="relative">
                  <TextField
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoFocus
                    disabled={isLoading}
                    className="pr-12"
                    data-testid="unlock-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-2 hover:text-fg-1"
                    disabled={isLoading}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              
              {error && (
                <div className="bg-ui-danger/10 border border-ui-danger/20 rounded-lg p-3">
                  <p className="text-sm text-ui-danger">{error}</p>
                </div>
              )}

              <PrimaryButton
                type="submit"
                disabled={isLoading || !password}
                className="w-full"
                data-testid="unlock-submit"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Unlocking...
                  </span>
                ) : (
                  'Unlock Wallet'
                )}
              </PrimaryButton>
              
              <div className="text-center">
                <button
                  type="button"
                  className="text-xs text-brand-b hover:text-brand-a font-medium transition-colors"
                  onClick={() => {
                    toast('You can restore your wallet using your seed phrase', {
                      icon: 'ℹ️',
                    });
                  }}
                >
                  Forgot password?
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
        
        <div className="mt-6 text-center">
          <p className="text-xs text-fg-3">
            Need help?{' '}
            <a href="#" className="text-brand-b hover:text-brand-a transition-colors">
              Contact Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};