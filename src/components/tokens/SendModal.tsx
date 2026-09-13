import { PublicKey } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useBalances, useInvalidateWalletData } from '../../hooks/useWalletQueries';
import { errorMessage } from '../../lib/errors';
import { formatLamports, fromSmallestUnit, maxSendable, parseAmount, SOL_DECIMALS } from '../../lib/units';
import { extensionClient } from '../../messaging/client';
import { hideSend } from '../../store/slices/uiSlice';
import { sendTransaction } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { AddressText, Banner } from '../ui/EmptyState';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { FieldLabel, Select, TextField } from '../ui/Input';
import { Modal, ModalContent, ModalFooter, ModalHeader } from '../ui/Modal';
import { AmountInput } from './AmountInput';

/** What the fixed fee was before the worker could price a message; used for Max until the estimate lands. */
const FALLBACK_FEE_LAMPORTS = 5000n;
const SOL_KEY = 'SOL';
/** A fee estimate is good for this long; a Review that lingers re-prices. */
const FEE_STALE_MS = 15_000;

/** The asset the modal is on: the selector's choice resolved against the balances query. */
interface Selected {
  mint?: string;
  symbol: string;
  decimals: number;
  programId?: string;
  /** Integer smallest units, or null while the balances query has nothing. */
  balanceSmallest: string | null;
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** Exact, never rounded: a balance the user can type back in. */
function formatUnits(smallest: string, decimals: number): string {
  return fromSmallestUnit(BigInt(smallest), decimals);
}

/** The line the toast shows, and the raw text kept behind Details when the line had to be softened. */
export function friendlyError(raw: string): { headline: string; details?: string } {
  const onChain = 'Transaction failed on-chain: ';
  if (raw.startsWith(onChain)) return { headline: 'Transaction failed on-chain', details: raw.slice(onChain.length) };
  // The worker's own guard lines are already written for the screen.
  const ownLine =
    /^(Leave at least|New accounts need|Insufficient balance|Transaction expired|Confirmation timed out|Invalid |Unknown token program|Mint not found|Amount too large|Wallet is locked)/;
  if (ownLine.test(raw)) return { headline: raw };
  return { headline: 'Transaction failed', details: raw };
}

function ErrorToast({ headline, details }: { headline: string; details?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <p>{headline}</p>
      {details && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="mt-1 text-xs text-fg-2 underline"
            data-testid="send-error-details"
          >
            {open ? 'Hide details' : 'Details'}
          </button>
          {open && <p className="mt-1 break-all font-mono text-[11px] text-fg-2">{details}</p>}
        </>
      )}
    </div>
  );
}

export function SendModal() {
  const dispatch = useAppDispatch();
  const { showSendModal, sendAsset } = useAppSelector((state) => state.ui);
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const address = accounts[activeAccountIndex]?.address;
  const { data, isPending: balancesPending, isError: balancesError } = useBalances(address);
  const invalidate = useInvalidateWalletData();
  const tokens = useMemo(() => data?.tokens ?? [], [data]);

  const [step, setStep] = useState<'amount' | 'review'>('amount');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedKey, setSelectedKey] = useState(sendAsset?.mint ?? SOL_KEY);
  const [sending, setSending] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState(false);

  // The row the user clicked picks the asset; a plain "Send" starts on SOL.
  useEffect(() => {
    setSelectedKey(sendAsset?.mint ?? SOL_KEY);
  }, [sendAsset, showSendModal]);

  const selected = useMemo<Selected>(() => {
    if (selectedKey === SOL_KEY) {
      return { symbol: 'SOL', decimals: SOL_DECIMALS, balanceSmallest: data?.lamports ?? null };
    }
    const token = tokens.find((candidate) => candidate.mint === selectedKey);
    if (token) {
      return {
        mint: token.mint,
        symbol: token.symbol || token.name || shortMint(token.mint),
        decimals: token.decimals,
        programId: token.programId,
        balanceSmallest: token.amount,
      };
    }
    // The balances query has not caught up with the row that opened the modal; it carried the same figures.
    if (sendAsset?.mint === selectedKey) return { ...sendAsset, balanceSmallest: data ? null : sendAsset.balanceSmallest };
    return { mint: selectedKey, symbol: shortMint(selectedKey), decimals: 0, balanceSmallest: null };
  }, [selectedKey, data, tokens, sendAsset]);

  const recipientState = useMemo(() => {
    const trimmed = recipient.trim();
    if (!trimmed) return { valid: false, error: '' };
    try {
      new PublicKey(trimmed);
      return { valid: true, error: '' };
    } catch {
      return { valid: false, error: 'Invalid Solana address' };
    }
  }, [recipient]);

  const amountState = useMemo<{ value: bigint | null; error: string }>(() => {
    if (!amount.trim()) return { value: null, error: '' };
    try {
      const value = parseAmount(amount, selected.decimals);
      if (selected.balanceSmallest !== null && value > BigInt(selected.balanceSmallest)) {
        return { value, error: 'Insufficient balance' };
      }
      return { value, error: '' };
    } catch (error) {
      return { value: null, error: errorMessage(error, 'Enter a valid number') };
    }
  }, [amount, selected]);

  const balanceKnown = selected.balanceSmallest !== null && !balancesError;
  const canContinue =
    recipientState.valid && amountState.value !== null && !amountState.error && acknowledgement && balanceKnown && !balancesPending;

  // Priced against the recipient once there is one; a SOL fee does not depend on the amount, so
  // `1` stands in while the user is still typing. Max reads this so it can leave exactly the fee.
  const feeProbe = useQuery({
    queryKey: ['send-fee', address, recipientState.valid ? recipient.trim() : address, selected.mint ?? SOL_KEY],
    enabled: showSendModal && step === 'amount' && !!address && !selected.mint,
    queryFn: () => extensionClient.estimateFee({ to: recipientState.valid ? recipient.trim() : address!, amountSmallest: '1' }),
    staleTime: FEE_STALE_MS,
    retry: false,
  });
  const feeForMax = feeProbe.data ? BigInt(feeProbe.data.feeLamports) : FALLBACK_FEE_LAMPORTS;

  // The Review figures: the exact message the send will broadcast, priced by the worker.
  const amountSmallest = amountState.value?.toString();
  const estimate = useQuery({
    queryKey: ['send-estimate', address, recipient.trim(), amountSmallest, selected.mint ?? SOL_KEY],
    enabled: showSendModal && step === 'review' && !!address && recipientState.valid && amountSmallest !== undefined,
    queryFn: () => extensionClient.estimateFee({ to: recipient.trim(), amountSmallest: amountSmallest!, mint: selected.mint }),
    staleTime: FEE_STALE_MS,
    retry: false,
  });

  const handleClose = () => {
    dispatch(hideSend());
    setRecipient('');
    setAmount('');
    setStep('amount');
    setAcknowledgement(false);
  };

  const handleMaxAmount = () => {
    if (selected.balanceSmallest === null) return;
    const balance = BigInt(selected.balanceSmallest);
    const max = selected.mint ? balance : maxSendable(balance, feeForMax);
    setAmount(fromSmallestUnit(max, selected.decimals));
  };

  const handleSend = async () => {
    if (!recipientState.valid || amountState.value === null || amountState.error) {
      toast.error('Enter a valid recipient and amount');
      return;
    }
    setSending(true);
    try {
      const result = await dispatch(
        sendTransaction({ to: recipient.trim(), amountSmallest: amountState.value.toString(), mint: selected.mint }),
      ).unwrap();
      toast.success(`Transaction sent! ${result.signature.slice(0, 8)}…`);
      invalidate(address);
      handleClose();
    } catch (error) {
      const { headline, details } = friendlyError(errorMessage(error, 'Transaction failed'));
      toast.error(<ErrorToast headline={headline} details={details} />, { duration: details ? 10_000 : 6_000 });
    } finally {
      setSending(false);
    }
  };

  const balanceLine = selected.balanceSmallest === null ? '—' : `${formatUnits(selected.balanceSmallest, selected.decimals)} ${selected.symbol}`;
  const amountLine = amountState.value === null ? amount : `${fromSmallestUnit(amountState.value, selected.decimals)} ${selected.symbol}`;
  const feeLine = estimate.data
    ? `${formatLamports(BigInt(estimate.data.feeLamports))} SOL`
    : estimate.isError
      ? 'Unavailable'
      : '…';
  const recipientInfo = estimate.data?.recipient;

  return (
    <Modal isOpen={showSendModal} onClose={handleClose}>
      {step === 'amount' && (
        <>
          <ModalHeader onClose={handleClose}>Send {selected.symbol}</ModalHeader>
          <ModalContent className="space-y-4">
            <div>
              <FieldLabel>Token</FieldLabel>
              <Select value={selected.mint ?? SOL_KEY} onChange={(e) => setSelectedKey(e.target.value)} data-testid="send-asset">
                <option value={SOL_KEY}>SOL — {data ? formatUnits(data.lamports, SOL_DECIMALS) : '—'}</option>
                {tokens.map((token) => (
                  <option key={token.mint} value={token.mint}>
                    {token.symbol || token.name || shortMint(token.mint)} — {formatUnits(token.amount, token.decimals)}
                  </option>
                ))}
              </Select>
              {balancesError && (
                <p className="mt-1 text-xs text-ui-danger" data-testid="send-balance-error">
                  Could not load your balance. Refresh before sending.
                </p>
              )}
            </div>

            <div>
              <FieldLabel>Recipient</FieldLabel>
              <TextField
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Solana address"
                className={recipientState.error ? 'border-ui-danger' : ''}
                data-testid="send-recipient"
              />
              {recipientState.error && <p className="mt-1 text-xs text-ui-danger">{recipientState.error}</p>}
            </div>

            <AmountInput
              value={amount}
              onChange={setAmount}
              balance={balanceLine}
              symbol={selected.symbol}
              onMaxClick={handleMaxAmount}
              maxDisabled={!balanceKnown}
              error={amountState.error}
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
              <PrimaryButton onClick={() => setStep('review')} disabled={!canContinue} className="flex-1" data-testid="send-continue">
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
                  <Row k="Send" v={amountLine} />
                  <div className="flex items-start justify-between gap-3 text-[15px]">
                    <span className="text-fg-2">To</span>
                    <AddressText address={recipient.trim()} truncate={false} />
                  </div>
                  <Row k="Network fee" v={feeLine} testId="send-fee" />
                  {estimate.isError && (
                    <p className="text-xs text-ui-danger">
                      Could not estimate the fee: {friendlyError(errorMessage(estimate.error, 'RPC did not answer')).headline}
                    </p>
                  )}
                  {recipientInfo && !recipientInfo.exists && (
                    <p className="text-xs text-fg-2" data-testid="send-creates-account">
                      {selected.mint
                        ? "Creates the recipient's token account"
                        : `Creates the recipient account (needs at least ${formatLamports(BigInt(estimate.data!.rentExemptMin))} SOL)`}
                    </p>
                  )}
                  <p className="pt-2 text-xs text-fg-3">Once processed, this cannot be reversed.</p>
                </CardContent>
              </Card>
            </div>
            <div className="mt-3 space-y-2">
              {recipientInfo?.offCurve && (
                <Banner tone="danger">
                  This address is a program-derived address; no private key controls it. Only send here if you know the program can
                  move the funds.
                </Banner>
              )}
              {recipientInfo?.isTokenAccount && (
                <Banner tone="danger">
                  This is a token account, not a wallet. Send to the owner&apos;s wallet address instead.
                </Banner>
              )}
              <Banner>Double-check the full destination address before confirming.</Banner>
            </div>
          </ModalContent>
          <ModalFooter>
            <div className="grid grid-cols-2 gap-3">
              <SecondaryButton onClick={() => setStep('amount')}>Back</SecondaryButton>
              <PrimaryButton onClick={handleSend} disabled={sending || estimate.isPending} data-testid="send-confirm">
                {sending ? 'Sending…' : 'Confirm'}
              </PrimaryButton>
            </div>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

function Row({ k, v, testId }: { k: string; v: string; testId?: string }) {
  return (
    <div className="flex items-center justify-between text-[15px]" data-testid={testId}>
      <span className="text-fg-2">{k}</span>
      <span className="tabular text-fg-0">{v}</span>
    </div>
  );
}
