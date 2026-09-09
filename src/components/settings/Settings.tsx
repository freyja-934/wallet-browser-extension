import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { extensionClient } from '../../messaging/client';
import {
    changePassword,
    clearWalletData,
    exportPrivateKey,
    exportSeedPhrase,
    initializeWallet
} from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { Select, TextField } from '../ui/Input';
import { Modal, ModalContent, ModalFooter, ModalHeader } from '../ui/Modal';

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
    extensionClient.getSettings().then((settings) => setAutoLockMinutes(settings.autoLockTimeout));
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
    await extensionClient.updateSettings({ autoLockTimeout: minutes });
    toast.success('Auto-lock timeout updated');
  };

  return (
    <div className="px-4 pb-4 space-y-4">
      {/* Security Section */}
      <Card>
        <CardContent className="space-y-4">
          <h3 className="text-sm font-medium text-fg-1">Security</h3>
          
          {/* Auto-lock */}
          <div>
            <label className="block text-sm text-fg-2 mb-2">
              Auto-lock after
            </label>
            <Select
              value={autoLockMinutes}
              onChange={(e) => handleAutoLockChange(Number(e.target.value))}
            >
              <option value={5}>5 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={0}>Never</option>
            </Select>
          </div>

          {/* Change Password */}
          <SettingRow
            onClick={() => setShowChangePassword(true)}
            title="Change Password"
          />
        </CardContent>
      </Card>

      {/* Backup Section */}
      <Card>
        <CardContent className="space-y-4">
          <h3 className="text-sm font-medium text-fg-1">Backup</h3>
          
          <SettingRow
            onClick={() => setShowSeedPhrase(true)}
            title="Show Seed Phrase"
            description="View your recovery phrase"
          />

          <SettingRow
            onClick={() => setShowPrivateKey(true)}
            title="Export Private Key"
            description="For current account only"
          />
        </CardContent>
      </Card>

      {/* Network Section */}
      <Card>
        <CardContent className="space-y-4">
          <h3 className="text-sm font-medium text-fg-1">Network</h3>
          
          <div>
            <label className="block text-sm text-fg-2 mb-2">
              RPC Endpoint
            </label>
            <Select defaultValue="mainnet">
              <option value="mainnet">Mainnet (Helius)</option>
              <option value="devnet">Devnet</option>
              <option value="testnet">Testnet</option>
              <option value="custom">Custom RPC</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* About Section */}
      <Card>
        <CardContent className="space-y-4">
          <h3 className="text-sm font-medium text-fg-1">About</h3>
          
          <div className="space-y-2 text-xs text-fg-2">
            <p>Lumen 0.2.0</p>
            <p>Solana wallet extension</p>
            <div className="flex gap-4 pt-2">
              <a href="#" className="text-brand-b hover:text-brand-a transition-colors">Terms</a>
              <a href="#" className="text-brand-b hover:text-brand-a transition-colors">Privacy</a>
              <a href="#" className="text-brand-b hover:text-brand-a transition-colors">GitHub</a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card>
        <CardContent className="space-y-4">
          <h3 className="text-sm font-medium text-ui-danger">Danger Zone</h3>
          
          <button
            onClick={handleClearData}
            className="px-4 py-2 bg-ui-danger/10 text-ui-danger rounded-lg hover:bg-ui-danger/20 transition-colors font-medium text-sm"
          >
            Clear All Wallet Data
          </button>
        </CardContent>
      </Card>

      {/* Seed Phrase Modal */}
      <Modal isOpen={showSeedPhrase} onClose={() => { setShowSeedPhrase(false); setSeedPhrase(''); setPassword(''); }}>
        {!seedPhrase ? (
          <>
            <ModalHeader>Enter Password to View Seed Phrase</ModalHeader>
            <ModalContent>
              <TextField
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                onKeyDown={(e) => e.key === 'Enter' && handleExportSeedPhrase()}
              />
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3 w-full">
                <SecondaryButton 
                  onClick={() => { setShowSeedPhrase(false); setPassword(''); }}
                  className="flex-1"
                >
                  Cancel
                </SecondaryButton>
                <PrimaryButton onClick={handleExportSeedPhrase} className="flex-1">
                  Show Seed Phrase
                </PrimaryButton>
              </div>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader>Your Seed Phrase</ModalHeader>
            <ModalContent className="space-y-4">
              <div className="bg-ui-danger/10 border border-ui-danger/20 rounded-lg p-3">
                <p className="text-sm text-ui-danger">
                  ⚠️ Never share your seed phrase with anyone. Store it securely.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {seedPhrase.split(' ').map((word, index) => (
                  <div
                    key={index}
                    className="bg-bg-2 rounded-lg px-3 py-2 text-center"
                  >
                    <span className="text-xs text-fg-3">{index + 1}</span>
                    <p className="font-medium text-fg-0">{word}</p>
                  </div>
                ))}
              </div>
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3 w-full">
                <SecondaryButton
                  onClick={() => {
                    navigator.clipboard.writeText(seedPhrase);
                    toast.success('Seed phrase copied to clipboard');
                  }}
                  className="flex-1"
                >
                  Copy to Clipboard
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => { setShowSeedPhrase(false); setSeedPhrase(''); }}
                  className="flex-1"
                >
                  Done
                </PrimaryButton>
              </div>
            </ModalFooter>
          </>
        )}
      </Modal>

      {/* Change Password Modal */}
      <Modal isOpen={showChangePassword} onClose={() => { setShowChangePassword(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}>
        <ModalHeader>Change Password</ModalHeader>
        <ModalContent className="space-y-4">
          <div>
            <label className="block text-sm text-fg-2 mb-1">Current Password</label>
            <TextField
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-fg-2 mb-1">New Password</label>
            <TextField
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-fg-2 mb-1">Confirm New Password</label>
            <TextField
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </ModalContent>
        <ModalFooter>
          <div className="flex gap-3 w-full">
            <SecondaryButton
              onClick={() => { setShowChangePassword(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}
              className="flex-1"
            >
              Cancel
            </SecondaryButton>
            <PrimaryButton onClick={handleChangePassword} className="flex-1">
              Change Password
            </PrimaryButton>
          </div>
        </ModalFooter>
      </Modal>

      {/* Private Key Modal */}
      <Modal isOpen={showPrivateKey} onClose={() => { setShowPrivateKey(false); setPrivateKey(''); setPassword(''); }}>
        {!privateKey ? (
          <>
            <ModalHeader>Enter Password to Export Private Key</ModalHeader>
            <ModalContent className="space-y-4">
              <p className="text-sm text-fg-2">
                This will export the private key for: {accounts[activeAccountIndex]?.name}
              </p>
              <TextField
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                onKeyDown={(e) => e.key === 'Enter' && handleExportPrivateKey()}
              />
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3 w-full">
                <SecondaryButton 
                  onClick={() => { setShowPrivateKey(false); setPassword(''); }}
                  className="flex-1"
                >
                  Cancel
                </SecondaryButton>
                <PrimaryButton onClick={handleExportPrivateKey} className="flex-1">
                  Export Private Key
                </PrimaryButton>
              </div>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader>Private Key for {accounts[activeAccountIndex]?.name}</ModalHeader>
            <ModalContent className="space-y-4">
              <div className="bg-ui-danger/10 border border-ui-danger/20 rounded-lg p-3">
                <p className="text-sm text-ui-danger">
                  ⚠️ Never share your private key. Anyone with this key can access your funds.
                </p>
              </div>
              <div className="bg-bg-2 rounded-lg p-3 break-all">
                <p className="font-mono text-sm text-fg-0">{privateKey}</p>
              </div>
            </ModalContent>
            <ModalFooter>
              <div className="flex gap-3 w-full">
                <SecondaryButton
                  onClick={() => {
                    navigator.clipboard.writeText(privateKey);
                    toast.success('Private key copied to clipboard');
                  }}
                  className="flex-1"
                >
                  Copy to Clipboard
                </SecondaryButton>
                <PrimaryButton
                  onClick={() => { setShowPrivateKey(false); setPrivateKey(''); }}
                  className="flex-1"
                >
                  Done
                </PrimaryButton>
              </div>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
};

function SettingRow({ title, description, onClick }: { title: string; description?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 bg-bg-2 rounded-lg hover:bg-bg-1 border border-transparent hover:border-ui-border transition-all duration-fast"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-fg-0">{title}</p>
          {description && <p className="text-sm text-fg-2">{description}</p>}
        </div>
        <svg className="w-5 h-5 text-fg-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}
