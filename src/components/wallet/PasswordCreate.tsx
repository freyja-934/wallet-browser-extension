import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import { validatePasswordStrength } from '../../lib/encryption-simple';

interface PasswordCreateProps {
  onSubmit: (password: string) => void;
  onBack?: () => void;
  title?: string;
  subtitle?: string;
}

export const PasswordCreate: React.FC<PasswordCreateProps> = ({
  onSubmit,
  onBack,
  title = 'Create a Password',
  subtitle = 'This password will encrypt your wallet locally. Make it strong!'
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<ReturnType<typeof validatePasswordStrength>>({
    isValid: false,
    score: 0,
    feedback: []
  });
  const [errors, setErrors] = useState<string[]>([]);
  
  useEffect(() => {
    if (password) {
      setPasswordStrength(validatePasswordStrength(password));
    } else {
      setPasswordStrength({ isValid: false, score: 0, feedback: [] });
    }
  }, [password]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    
    if (!passwordStrength.isValid) {
      setErrors(['Please create a stronger password']);
      return;
    }
    
    if (password !== confirmPassword) {
      setErrors(['Passwords do not match']);
      return;
    }
    
    onSubmit(password);
  };
  
  const getStrengthColor = (score: number) => {
    if (score <= 1) return 'bg-red-500';
    if (score <= 2) return 'bg-orange-500';
    if (score <= 3) return 'bg-yellow-500';
    if (score <= 4) return 'bg-green-500';
    return 'bg-green-600';
  };
  
  const getStrengthText = (score: number) => {
    if (score <= 1) return 'Weak';
    if (score <= 2) return 'Fair';
    if (score <= 3) return 'Good';
    if (score <= 4) return 'Strong';
    return 'Very Strong';
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {title}
        </h2>
        <p className="text-gray-600">
          {subtitle}
        </p>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter a strong password"
              autoComplete="new-password"
              data-testid="password-input"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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
          
          {password && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-3 space-y-2"
            >
              <div className="flex items-center space-x-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                    className={`h-full rounded-full ${getStrengthColor(passwordStrength.score)}`}
                  />
                </div>
                <span className="text-sm text-gray-600">
                  {getStrengthText(passwordStrength.score)}
                </span>
              </div>
              
              {passwordStrength.feedback.length > 0 && (
                <ul className="text-sm text-gray-600 space-y-1">
                  {passwordStrength.feedback.map((item, index) => (
                    <li key={index} className="flex items-start">
                      <span className="text-gray-400 mr-2">•</span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          )}
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Confirm Password
          </label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrors([]);
              }}
              className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Confirm your password"
              autoComplete="new-password"
              data-testid="password-confirm"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              {showConfirmPassword ? (
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
          
          {confirmPassword && password !== confirmPassword && (
            <p className="mt-2 text-sm text-red-600">
              Passwords do not match
            </p>
          )}
          
          {confirmPassword && password === confirmPassword && (
            <p className="mt-2 text-sm text-green-600">
              ✓ Passwords match
            </p>
          )}
        </div>
        
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            {errors.map((error, index) => (
              <p key={index} className="text-sm text-red-600">
                {error}
              </p>
            ))}
          </div>
        )}
        
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h4 className="text-amber-800 font-medium mb-1">
            Important
          </h4>
          <p className="text-sm text-amber-700">
            There is no way to recover this password. If you forget it, you'll need to restore your wallet using your seed phrase.
          </p>
        </div>
        
        <div className="flex justify-between">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-3 text-gray-700 hover:text-gray-900 font-medium"
            >
              Back
            </button>
          )}
          
          <button
            type="submit"
            disabled={!passwordStrength.isValid || password !== confirmPassword}
            className={`
              px-6 py-3 rounded-lg font-medium transition-all ml-auto
              ${passwordStrength.isValid && password === confirmPassword
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }
            `}
            data-testid="password-submit"
          >
            Create Wallet
          </button>
        </div>
      </form>
    </div>
  );
};
