import { PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBalances, useInvalidateWalletData } from '../../hooks/useWalletQueries';
import { errorMessage } from '../../lib/errors';
import { formatLamports, fromSmallestUnit, toSmallestUnit } from '../../lib/units';
import { hideSend, type SendAsset } from '../../store/slices/uiSlice';
import { sendTransaction } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { AddressText, Banner } from '../ui/EmptyState';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { FieldLabel, Select, TextField } from '../ui/Input';
import { Modal, ModalContent, ModalFooter, ModalHeader } from '../ui/Modal';
import { AmountInput } from './AmountInput';

type SelectedToken = { mint?: string; symbol: string; balance: number; decimals: number };

/** Interim float view of a `SendAsset`; the next slice moves the modal onto smallest units. */
function asSelected(asset: SendAsset): SelectedToken {
  return {
    mint: asset.mint,
    symbol: asset.symbol,
    balance: Number(fromSmallestUnit(BigInt(asset.balanceSmallest), asset.decimals)),
    decimals: asset.decimals,
  };
}

export function SendModal() {
  const dispatch = useAppDispatch();
  const { showSendModal, sendAsset } = useAppSelector((state) => state.ui);
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const address = accounts[activeAccountIndex]?.address;
  const { data } = useBalances(address);
  const invalidate = useInvalidateWalletData();
  const solBalance = data?.solBalance ?? 0;
  const tokens = data?.tokens ?? [];
  const feeLamports = 5000;

  const [step, setStep] = useState<'amount' | 'review'>('amount');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState<SelectedToken>(
    sendAsset ? asSelected(sendAsset) : { symbol: 'SOL', balance: solBalance, decimals: 9 },
  );
  const [isValidAddress, setIsValidAddress] = useState(false);
  const [addressError, setAddressError] = useState('');
  const [sending, setSending] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState(false);

  useEffect(() => {
    if (sendAsset) {
      setSelectedToken(asSelected(sendAsset));
    } else {
      setSelectedToken({ symbol: 'SOL', balance: solBalance, decimals: 9 });
    }
  }, [sendAsset, solBalance, showSendModal]);

  useEffect(() => {
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

  const handleClose = () => {
    dispatch(hideSend());
    setRecipient('');
    setAmount('');
    setStep('amount');
    setAcknowledgement(false);
  };

  const handleSend = async () => {
    if (!isValidAddress || !amount) {
      toast.error('Enter a valid recipient and amount');
      return;
    }
    const amountNum = parseFloat(amount);
    if (amountNum > selectedToken.balance) {
      toast.error('Insufficient balance');
      return;
    }
    setSending(true);
    try {
      const amountSmallest = toSmallestUnit(amount, selectedToken.decimals).toString();
      const result = await dispatch(
        sendTransaction({ to: recipient, amountSmallest, mint: selectedToken.mint }),
      ).unwrap();
      toast.success(`Transaction sent! ${result.signature.slice(0, 8)}…`);
      invalidate(address);
      handleClose();
    } catch (error) {
      toast.error(errorMessage(error, 'Transaction failed'));
    } finally {
      setSending(false);
    }
  };

  const handleMaxAmount = () => {
    const max = selectedToken.symbol === 'SOL' ? Math.max(0, selectedToken.balance - 0.01) : selectedToken.balance;
    setAmount(max.toString());
  };

  return (
    <Modal isOpen={showSendModal} onClose={handleClose}>
      {step === 'amount' && (
        <>
          <ModalHeader onClose={handleClose}>Send {selectedToken.symbol}</ModalHeader>
          <ModalContent className="space-y-4">
            <div>
              <FieldLabel>Token</FieldLabel>
              <Select
                value={selectedToken.mint || 'SOL'}
                onChange={(e) => {
                  if (e.target.value === 'SOL') {
                    setSelectedToken({ symbol: 'SOL', balance: solBalance, decimals: 9 });
                  } else {
                    const token = tokens.find((t) => t.mint === e.target.value);
                    if (token) {
                      setSelectedToken({
                        mint: token.mint,
                        symbol: token.symbol || 'Unknown',
                        balance: parseFloat(token.amount) / Math.pow(10, token.decimals),
                        decimals: token.decimals,
                      });
                    }
                  }
                }}
              >
                <option value="SOL">SOL — {solBalance.toFixed(4)}</option>
                {tokens.map((token) => (
                  <option key={token.mint} value={token.mint}>
                    {token.symbol} — {(parseFloat(token.amount) / Math.pow(10, token.decimals)).toFixed(4)}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <FieldLabel>Recipient</FieldLabel>
              <TextField
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Solana address"
                className={addressError && recipient ? 'border-ui-danger' : ''}
                data-testid="send-recipient"
              />
              {addressError && recipient && <p className="mt-1 text-xs text-ui-danger">{addressError}</p>}
            </div>

            <AmountInput
              value={amount}
              onChange={setAmount}
              balance={`${selectedToken.balance.toFixed(6)} ${selectedToken.symbol}`}
              symbol={selectedToken.symbol}
              onMaxClick={handleMaxAmount}
            />

            <label className="grid grid-cols-[1rem_1fr] gap-2 text-xs leading-relaxed text-fg-2">
              <input
                type="checkbox"
                checked={acknowledgement}
                onChange={(e) => setAcknowledgement(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent"
                data-testid="send-ack"
              />
              I understand that an incorrect address can result in loss of funds.
            </label>
          </ModalContent>
          <ModalFooter>
            <div className="flex gap-3">
              <SecondaryButton onClick={handleClose} className="flex-1">
                Cancel
              </SecondaryButton>
              <PrimaryButton
                onClick={() => setStep('review')}
                disabled={!isValidAddress || !amount || parseFloat(amount) <= 0 || !acknowledgement}
                className="flex-1"
                data-testid="send-continue"
              >
                Continue
              </PrimaryButton>
            </div>
          </ModalFooter>
        </>
      )}

      {step === 'review' && (
        <>
          <ModalHeader>Review</ModalHeader>
          <ModalContent>
            <div data-testid="send-review">
            <Card>
              <CardContent className="space-y-3">
                <Row k="Send" v={`${amount} ${selectedToken.symbol}`} />
                <div className="flex items-start justify-between gap-3 text-[15px]">
                  <span className="text-fg-2">To</span>
                  <AddressText address={recipient} truncate={false} />
                </div>
                <Row k="Network fee" v={`${formatLamports(feeLamports)} SOL`} />
                <p className="pt-2 text-xs text-fg-3">Once processed, this cannot be reversed.</p>
              </CardContent>
            </Card>
            </div>
            <div className="mt-3">
              <Banner>Double-check the full destination address before confirming.</Banner>
            </div>
          </ModalContent>
          <ModalFooter>
            <div className="grid grid-cols-2 gap-3">
              <SecondaryButton onClick={() => setStep('amount')}>Back</SecondaryButton>
              <PrimaryButton onClick={handleSend} disabled={sending}>
                {sending ? 'Sending…' : 'Confirm'}
              </PrimaryButton>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-[15px]">
      <span className="text-fg-2">{k}</span>
      <span className="tabular text-fg-0">{v}</span>
    </div>
  );
}
