import { motion } from 'framer-motion';
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { secureStorage } from '../../services/storage';
import {
    changePassword,
    clearWalletData,
    exportPrivateKey,
    exportSeedPhrase,
    initializeWallet
} from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';

export const Settings: React.FC = () => {
  const dispatch = useAppDispatch();
  const { accounts, activeAccountIndex } = useAppSelector(state => state.wallet);
  const [showSeedPhrase, setShowSeedPhrase] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [seedPhrase, setSeedPhrase] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  // Load auto-lock setting on mount
  React.useEffect(() => {
    secureStorage.getAutoLockTimeout().then(setAutoLockMinutes);
  }, []);

  const handleExportSeedPhrase = async () => {
    try {
      const result = await dispatch(exportSeedPhrase(password)).unwrap();
      setSeedPhrase(result.seedPhrase);
      setPassword('');
      toast.success('Seed phrase retrieved successfully');
    } catch (error) {
      toast.error('Invalid password');
      setPassword('');
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    try {
      await dispatch(changePassword({ 
        currentPassword, 
        newPassword 
      })).unwrap();
      
      setShowChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully');
    } catch (error) {
      toast.error('Current password is incorrect');
    }
  };

  const handleExportPrivateKey = async () => {
    try {
      const result = await dispatch(exportPrivateKey({ 
        password, 
        accountIndex: activeAccountIndex 
      })).unwrap();
      
      setPrivateKey(result.privateKey);
      setPassword('');
      toast.success('Private key exported successfully');
    } catch (error) {
      toast.error('Invalid password');
      setPassword('');
    }
  };

  const handleClearData = async () => {
    if (window.confirm('This will remove all wallet data. Make sure you have backed up your seed phrase! Continue?')) {
      try {
        await dispatch(clearWalletData()).unwrap();
        
        // Reinitialize to go back to welcome screen
        dispatch(initializeWallet());
        
        toast.success('Wallet data cleared');
      } catch (error) {
        toast.error('Failed to clear data');
      }
    }
  };

  const handleAutoLockChange = async (minutes: number) => {
    setAutoLockMinutes(minutes);
    await secureStorage.updateSettings({ autoLockTimeout: minutes });
    toast.success('Auto-lock timeout updated');
  };

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="px-4 py-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Settings</h2>

        {/* Security Section */}
        <div className="mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Security</h3>
          
          <div className="space-y-4">
            {/* Auto-lock */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Auto-lock after
              </label>
              <select
                value={autoLockMinutes}
                onChange={(e) => handleAutoLockChange(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={0}>Never</option>
              </select>
            </div>

            {/* Change Password */}
            <button
              onClick={() => setShowChangePassword(true)}
              className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">Change Password</span>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          </div>
        </div>

        {/* Backup Section */}
        <div className="mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Backup</h3>
          
          <div className="space-y-4">
            {/* Export Seed Phrase */}
            <button
              onClick={() => setShowSeedPhrase(true)}
              className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Show Seed Phrase</p>
                  <p className="text-sm text-gray-500">View your recovery phrase</p>
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>

            {/* Export Private Key */}
            <button
              onClick={() => setShowPrivateKey(true)}
              className="w-full text-left px-4 py-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Export Private Key</p>
                  <p className="text-sm text-gray-500">For current account only</p>
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          </div>
        </div>

        {/* Network Section */}
        <div className="mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Network</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                RPC Endpoint
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                defaultValue="mainnet"
              >
                <option value="mainnet">Mainnet (Helius)</option>
                <option value="devnet">Devnet</option>
                <option value="testnet">Testnet</option>
                <option value="custom">Custom RPC</option>
              </select>
            </div>
          </div>
        </div>

        {/* About Section */}
        <div className="mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">About</h3>
          
          <div className="space-y-2 text-sm text-gray-600">
            <p>Solana Wallet Extension v1.0.0</p>
            <p>Built with ❤️ for the Solana ecosystem</p>
            <a 
              href="https://github.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-700"
            >
              View on GitHub
            </a>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="border-t border-gray-200 pt-6">
          <h3 className="text-lg font-medium text-red-600 mb-4">Danger Zone</h3>
          
          <button
            onClick={handleClearData}
            className="w-full px-4 py-3 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors font-medium"
          >
            Clear All Wallet Data
          </button>
        </div>
      </div>

      {/* Seed Phrase Modal */}
      {showSeedPhrase && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
          >
            {!seedPhrase ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Enter Password to View Seed Phrase
                </h3>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
                  onKeyDown={(e) => e.key === 'Enter' && handleExportSeedPhrase()}
                />
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setShowSeedPhrase(false);
                      setPassword('');
                    }}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExportSeedPhrase}
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                  >
                    Show Seed Phrase
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Your Seed Phrase
                </h3>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-800">
                    ⚠️ Never share your seed phrase with anyone. Store it securely.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {seedPhrase.split(' ').map((word, index) => (
                    <div
                      key={index}
                      className="bg-gray-100 rounded-lg px-3 py-2 text-center"
                    >
                      <span className="text-xs text-gray-500">{index + 1}</span>
                      <p className="font-medium text-gray-900">{word}</p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(seedPhrase);
                    toast.success('Seed phrase copied to clipboard');
                  }}
                  className="w-full mb-3 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={() => {
                    setShowSeedPhrase(false);
                    setSeedPhrase('');
                  }}
                  className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                >
                  Done
                </button>
              </>
            )}
          </motion.div>
        </div>
      )}

      {/* Change Password Modal */}
      {showChangePassword && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Change Password
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowChangePassword(false);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleChangePassword}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                Change Password
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Private Key Modal */}
      {showPrivateKey && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
          >
            {!privateKey ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Enter Password to Export Private Key
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  This will export the private key for: {accounts[activeAccountIndex]?.name}
                </p>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
                  onKeyDown={(e) => e.key === 'Enter' && handleExportPrivateKey()}
                />
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      setShowPrivateKey(false);
                      setPassword('');
                    }}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExportPrivateKey}
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                  >
                    Export Private Key
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Private Key for {accounts[activeAccountIndex]?.name}
                </h3>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-800">
                    ⚠️ Never share your private key. Anyone with this key can access your funds.
                  </p>
                </div>
                <div className="bg-gray-100 rounded-lg p-3 mb-4 break-all">
                  <p className="font-mono text-sm text-gray-900">{privateKey}</p>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(privateKey);
                    toast.success('Private key copied to clipboard');
                  }}
                  className="w-full mb-3 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  Copy to Clipboard
                </button>
                <button
                  onClick={() => {
                    setShowPrivateKey(false);
                    setPrivateKey('');
                  }}
                  className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                >
                  Done
                </button>
              </>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
};
