import React, { useState } from 'react';
import { hideReceive } from '../../store/slices/uiSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { Select } from '../ui/Input';
import { Modal, ModalContent, ModalHeader } from '../ui/Modal';
import { ReceiveCard } from './ReceiveCard';

export const ReceiveModal: React.FC = () => {
  const dispatch = useAppDispatch();
  const { showReceiveModal } = useAppSelector(state => state.ui);
  const { accounts, activeAccountIndex, tokens } = useAppSelector(state => state.wallet);
  const activeAccount = accounts[activeAccountIndex];
  
  const [selectedToken, setSelectedToken] = useState('SOL');

  const handleClose = () => {
    dispatch(hideReceive());
  };

  if (!activeAccount) return null;

  return (
    <Modal isOpen={showReceiveModal} onClose={handleClose}>
      <ModalHeader onClose={handleClose}>Receive</ModalHeader>
      <ModalContent className="space-y-4">
        {/* Token Selection */}
        <div>
          <label className="block text-sm text-fg-2 mb-2">Select asset</label>
          <Select
            value={selectedToken}
            onChange={(e) => setSelectedToken(e.target.value)}
          >
            <option value="SOL">Solana (SOL)</option>
            {tokens.map(token => (
              <option key={token.mint} value={token.mint}>
                {token.symbol || 'Unknown'} - {token.name || ''}
              </option>
            ))}
          </Select>
        </div>

        {/* Receive Card */}
        <ReceiveCard
          address={activeAccount.address}
          tokenSymbol={selectedToken}
        />
      </ModalContent>
    </Modal>
  );
};