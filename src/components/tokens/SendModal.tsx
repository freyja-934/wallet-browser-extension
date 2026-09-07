import { PublicKey } from '@solana/web3.js';
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { hideSend } from '../../store/slices/uiSlice';
import { fetchBalances, sendTransaction } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { Select, TextField } from '../ui/Input';
import { Modal, ModalContent, ModalFooter, ModalHeader } from '../ui/Modal';
import { AmountInput } from './AmountInput';

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
  const { solBalance, tokens } = useAppSelector(state => state.wallet);
  
  const [step, setStep] = useState<'select' | 'amount' | 'review'>('amount');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [usdMode, setUsdMode] = useState(false);
  const [selectedToken, setSelectedToken] = useState(preselectedToken || {
    symbol: 'SOL',
    balance: solBalance,
    decimals: 9
  });
  const [isValidAddress, setIsValidAddress] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [sending, setSending] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState(false);

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
    setStep('amount');
    setAcknowledgement(false);
  };

  const handleMaxAmount = () => {
    // Leave some SOL for fees if sending SOL
    const max = selectedToken.symbol === 'SOL' 
      ? Math.max(0, selectedToken.balance - 0.01)
      : selectedToken.balance;
    setAmount(max.toString());
  };

  const handleNext = () => {
    if (step === 'amount' && isValidAddress && amount && parseFloat(amount) > 0 && acknowledgement) {
      setStep('review');
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <Modal isOpen={showSendModal} onClose={handleClose}>
      {step === 'amount' && (
        <>
          <ModalHeader onClose={handleClose}>Send {selectedToken.symbol}</ModalHeader>
          <ModalContent className="space-y-4">
            {/* Token Selection */}
            <div>
              <label className="block text-sm text-fg-2 mb-2">Token</label>
              <Select
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
              >
                <option value="SOL">SOL - {solBalance.toFixed(4)}</option>
                {tokens.map(token => (
                  <option key={token.mint} value={token.mint}>
                    {token.symbol} - {(parseFloat(token.amount) / Math.pow(10, token.decimals)).toFixed(4)}
                  </option>
                ))}
              </Select>
            </div>

            {/* Recipient Address */}
            <div>
              <label className="block text-sm text-fg-2 mb-2">Recipient address</label>
              <TextField
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Enter Solana address"
                className={addressError && recipient ? 'border-ui-danger' : ''}
              />
              {addressError && recipient && (
                <p className="mt-1 text-sm text-ui-danger">{addressError}</p>
              )}
            </div>

            {/* Amount Input */}
            <AmountInput
              value={amount}
              onChange={setAmount}
              balance={`${selectedToken.balance.toFixed(6)} ${selectedToken.symbol}`}
              symbol={selectedToken.symbol}
              onMaxClick={handleMaxAmount}
              usdMode={usdMode}
              onModeToggle={() => setUsdMode(!usdMode)}
            />

            {/* Acknowledgement */}
            <div className="grid grid-cols-[1rem_1fr] gap-2 text-xs text-fg-2">
              <input 
                id="ack" 
                type="checkbox" 
                checked={acknowledgement}
                onChange={(e) => setAcknowledgement(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-ui-border bg-bg-2" 
              />
              <label htmlFor="ack">
                I understand that incorrect addresses can result in loss of funds.
              </label>
            </div>
          </ModalContent>
          <ModalFooter>
            <div className="flex gap-3">
              <SecondaryButton onClick={handleClose} className="flex-1">
                Cancel
              </SecondaryButton>
              <PrimaryButton 
                onClick={handleNext}
                disabled={!isValidAddress || !amount || parseFloat(amount) <= 0 || !acknowledgement}
                className="flex-1"
              >
                Continue
              </PrimaryButton>
            </div>
          </ModalFooter>
        </>
      )}

      {step === 'review' && (
        <>
          <ModalHeader>Review Transaction</ModalHeader>
          <ModalContent>
            <Card>
              <CardContent className="space-y-3">
                <Row k="Send" v={`${amount} ${selectedToken.symbol}`} />
                <Row k="From" v={`Main wallet`} />
                <Row k="To" v={formatAddress(recipient)} />
                <Row k="Network fee" v="~0.000005 SOL" />
                <div className="pt-2 border-t border-ui-border">
                  <Row k="Total" v={`${amount} ${selectedToken.symbol} + fees`} bold />
                </div>
                <p className="text-xs text-fg-3 pt-2">
                  Once processed, transactions cannot be canceled or reversed.
                </p>
              </CardContent>
            </Card>
          </ModalContent>
          <ModalFooter>
            <div className="grid grid-cols-2 gap-3">
              <SecondaryButton onClick={() => setStep('amount')}>
                Back
              </SecondaryButton>
              <PrimaryButton onClick={handleSend} disabled={sending}>
                {sending ? 'Sending...' : 'Confirm & Send'}
              </PrimaryButton>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
};

function Row({ k, v, bold = false }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-[15px] ${bold ? 'font-medium' : ''}`}>
      <span className="text-fg-2">{k}</span>
      <span className="text-fg-0">{v}</span>
    </div>
  );
}
