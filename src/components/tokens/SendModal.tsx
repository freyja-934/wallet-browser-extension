import { PublicKey } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getCluster } from '../../config/constants';
import { accountAt } from '../../lib/messages';
import { useSettings } from '../../hooks/useSettings';
import { useBalances, useInvalidateWalletData } from '../../hooks/useWalletQueries';
import { errorMessage } from '../../lib/errors';
import { parseSendError } from '../../lib/protocol';
import { formatLamports, fromSmallestUnit, maxForAsset, parseAmount, SOL_DECIMALS } from '../../lib/units';
import { extensionClient } from '../../messaging/client';
import { hideSend, type SendAsset } from '../../store/slices/uiSlice';
import { sendTransaction } from '../../store/slices/walletSlice';
import { useAppDispatch, useAppSelector } from '../../store/store';
import { AddressText, Banner } from '../ui/EmptyState';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { FieldLabel, Select, TextField } from '../ui/Input';
import { Modal, ModalContent, ModalFooter, ModalHeader } from '../ui/Modal';
import { AmountInput } from './AmountInput';

const SOL_KEY = 'SOL';
/** How long an estimate counts as fresh: stepping between Amount and Review inside this window does not re-ask the worker. */
const FEE_STALE_MS = 15_000;

/** The asset the modal is on: the selector's choice resolved against the balances query. */
interface Selected {
  /** What the selector holds: `SOL`, or the token account this balance sits in. */
  key: string;
  mint?: string;
  source?: string;
  symbol: string;
  decimals: number;
  programId?: string;
  /** Integer smallest units, or null while the balances query has nothing. */
  balanceSmallest: string | null;
}

/** One row, one key: a wallet can hold several accounts of the same mint, so the mint will not do. */
function assetKey(asset: SendAsset | null): string {
  if (!asset?.mint) return SOL_KEY;
  return asset.source ?? asset.mint;
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
  // The worker's own guard lines, word for word, are already written for the screen.
  const ownLine =
    /^(Leave at least|New accounts need|Insufficient balance|Transaction expired|Confirmation timed out|A send is already in progress|Invalid recipient address|Invalid mint address|Invalid source address|Token account mismatch|Unknown token program|Mint not found|Wallet is locked)/;
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

/** What a send left behind when it did not confirm: a line, the raw text, and the signature if it got that far. */
interface SendFailureView {
  headline: string;
  details?: string;
  signature?: string;
}

export function SendModal() {
  const dispatch = useAppDispatch();
  const { showSendModal, sendAsset } = useAppSelector((state) => state.ui);
  const { data: settings } = useSettings();
  const cluster = settings?.cluster ?? getCluster();
  const { accounts, activeAccountIndex } = useAppSelector((state) => state.wallet);
  const address = accountAt(accounts, activeAccountIndex)?.address;
  const { data, isPending: balancesPending, isError: balancesError } = useBalances(address);
  const invalidate = useInvalidateWalletData();
  const tokens = useMemo(() => data?.tokens ?? [], [data]);

  const [step, setStep] = useState<'amount' | 'review'>('amount');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [maxError, setMaxError] = useState('');
  const [selectedKey, setSelectedKey] = useState(assetKey(sendAsset));
  const [sending, setSending] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState(false);
  const [failure, setFailure] = useState<SendFailureView | null>(null);
  // Confirm is one-shot per Review: a send that failed may still land, so a second
  // click has to go back through Amount rather than sign the same funds again.
  const submittedRef = useRef(false);
  const [submitted, setSubmitted] = useState(false);

  // The row the user clicked picks the asset; a plain "Send" starts on SOL. The
  // selector is the user's own afterwards, so the opening asset is not derived
  // from the prop — it is adjusted during render each time the modal opens on
  // something new, which React re-runs before painting rather than after.
  const openedOn = `${showSendModal}:${assetKey(sendAsset)}`;
  const [lastOpenedOn, setLastOpenedOn] = useState(openedOn);
  if (lastOpenedOn !== openedOn) {
    setLastOpenedOn(openedOn);
    setSelectedKey(assetKey(sendAsset));
  }

  const selected = useMemo<Selected>(() => {
    if (selectedKey === SOL_KEY) {
      return { key: SOL_KEY, symbol: 'SOL', decimals: SOL_DECIMALS, balanceSmallest: data?.lamports ?? null };
    }
    const token = tokens.find((candidate) => candidate.tokenAccount === selectedKey);
    if (token) {
      return {
        key: token.tokenAccount,
        mint: token.mint,
        source: token.tokenAccount,
        symbol: token.symbol || token.name || shortMint(token.mint),
        decimals: token.decimals,
        programId: token.programId,
        balanceSmallest: token.amount,
      };
    }
    // The balances query has not caught up with the row that opened the modal; it carried the same figures.
    if (sendAsset && assetKey(sendAsset) === selectedKey) {
      return { ...sendAsset, key: selectedKey, balanceSmallest: data ? null : sendAsset.balanceSmallest };
    }
    // The row is gone (a refresh emptied it). Fall back to SOL rather than to a token nothing describes.
    return { key: SOL_KEY, symbol: 'SOL', decimals: SOL_DECIMALS, balanceSmallest: data?.lamports ?? null };
  }, [selectedKey, data, tokens, sendAsset]);

  const recipientState = useMemo(() => {
    const trimmed = recipient.trim();
    if (!trimmed) return { valid: false, error: '', offCurve: false };
    try {
      const key = new PublicKey(trimmed);
      // Computed here, not read off the estimate: a PDA is a fact about the address,
      // and the warning must stand even when the RPC cannot price the send.
      return { valid: true, error: '', offCurve: !PublicKey.isOnCurve(key.toBytes()) };
    } catch {
      return { valid: false, error: 'Invalid Solana address', offCurve: false };
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
    queryKey: ['send-fee', address, recipientState.valid ? recipient.trim() : address, selected.key],
    enabled: showSendModal && step === 'amount' && !!address && !selected.mint,
    queryFn: () => extensionClient.estimateFee({ to: recipientState.valid ? recipient.trim() : address!, amountSmallest: '1' }),
    staleTime: FEE_STALE_MS,
    retry: false,
  });

  // The Review figures: the exact message the send will broadcast, priced by the worker.
  const amountSmallest = amountState.value?.toString();
  const estimate = useQuery({
    queryKey: ['send-estimate', address, recipient.trim(), amountSmallest, selected.key],
    enabled: showSendModal && step === 'review' && !!address && recipientState.valid && amountSmallest !== undefined,
    queryFn: () =>
      extensionClient.estimateFee({
        to: recipient.trim(),
        amountSmallest: amountSmallest!,
        mint: selected.mint,
        source: selected.source,
      }),
    staleTime: FEE_STALE_MS,
    retry: false,
  });

  const clearAttempt = () => {
    setFailure(null);
    setSubmitted(false);
    submittedRef.current = false;
  };

  const handleClose = () => {
    dispatch(hideSend());
    setRecipient('');
    setAmount('');
    setMaxError('');
    setStep('amount');
    setAcknowledgement(false);
    clearAttempt();
  };

  const handleAmountChange = (value: string) => {
    setMaxError('');
    setAmount(value);
  };

  const handleMaxAmount = () => {
    if (selected.balanceSmallest === null) return;
    const fee = feeProbe.data ? BigInt(feeProbe.data.feeLamports) : null;
    const max = maxForAsset(BigInt(selected.balanceSmallest), fee, Boolean(selected.mint));
    if (max === 0n) {
      // Filling in `0` would only earn an "Enter an amount"; say what is actually wrong.
      setMaxError('Balance does not cover the network fee');
      return;
    }
    setMaxError('');
    setAmount(fromSmallestUnit(max, selected.decimals));
  };

  const handleSend = async () => {
    if (submittedRef.current) return;
    if (!recipientState.valid || amountState.value === null || amountState.error) {
      toast.error('Enter a valid recipient and amount');
      return;
    }
    submittedRef.current = true;
    setSubmitted(true);
    setSending(true);
    try {
      const result = await dispatch(
        sendTransaction({
          to: recipient.trim(),
          amountSmallest: amountState.value.toString(),
          mint: selected.mint,
          source: selected.source,
        }),
      ).unwrap();
      toast.success(`Transaction sent! ${result.signature.slice(0, 8)}…`);
      invalidate(address);
      handleClose();
    } catch (error) {
      const { message, signature } = parseSendError(errorMessage(error, 'Transaction failed'));
      const { headline, details } = friendlyError(message);
      setFailure({ headline, details, signature });
      toast.error(<ErrorToast headline={headline} details={details} />, { duration: details ? 10_000 : 6_000 });
      // A send that expired or timed out may still have landed: re-read rather than trust the old figures.
      invalidate(address);
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
  // A token transfer names the owner's wallet; sending one to a token account credits nobody.
  const tokenToTokenAccount = Boolean(selected.mint) && recipientInfo?.isTokenAccount === true;
  const explorer = failure?.signature
    ? `https://solana.fm/tx/${failure.signature}${cluster === 'devnet' ? '?cluster=devnet-solana' : ''}`
    : null;

  return (
    <Modal isOpen={showSendModal} onClose={handleClose}>
      {step === 'amount' && (
        <>
          <ModalHeader onClose={handleClose}>Send {selected.symbol}</ModalHeader>
          <ModalContent className="space-y-4">
            <div>
              <FieldLabel>Token</FieldLabel>
              <Select value={selected.key} onChange={(e) => setSelectedKey(e.target.value)} data-testid="send-asset">
                <option value={SOL_KEY}>SOL — {data ? formatUnits(data.lamports, SOL_DECIMALS) : '—'}</option>
                {tokens.map((token) => (
                  <option key={token.tokenAccount} value={token.tokenAccount}>
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
              onChange={handleAmountChange}
              balance={balanceLine}
              symbol={selected.symbol}
              onMaxClick={handleMaxAmount}
              maxDisabled={!balanceKnown}
              error={amountState.error || maxError}
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
                  {selected.mint && recipientInfo && !recipientInfo.exists && (
                    <p className="text-xs text-fg-2" data-testid="send-ata-rent">
                      plus {formatLamports(BigInt(estimate.data!.rentExemptMin))} SOL to create the token account
                    </p>
                  )}
                  <p className="pt-2 text-xs text-fg-3">Once processed, this cannot be reversed.</p>
                </CardContent>
              </Card>
            </div>
            <div className="mt-3 space-y-2">
              {failure && (
                <div className="rounded-2xl border border-ui-danger/30 bg-ui-danger/10 px-3 py-2.5 text-xs leading-relaxed" data-testid="send-failure">
                  <p className="text-ui-danger">{failure.headline}</p>
                  {failure.signature && (
                    <>
                      <p className="mt-1 break-all font-mono text-[11px] text-fg-2" data-testid="send-failure-signature">
                        {failure.signature}
                      </p>
                      <a
                        href={explorer!}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-fg-1 underline"
                        data-testid="send-failure-explorer"
                      >
                        View on the explorer
                      </a>
                    </>
                  )}
                  {failure.details && <p className="mt-1 break-all font-mono text-[11px] text-fg-2">{failure.details}</p>}
                  <p className="mt-1 text-fg-2">Go back to change the amount before trying again.</p>
                </div>
              )}
              {recipientState.offCurve && (
                <Banner tone="danger">
                  This address is a program-derived address; no private key controls it. Only send here if you know the program can
                  move the funds.
                </Banner>
              )}
              {recipientInfo?.isTokenAccount && (
                <Banner tone="danger">
                  {selected.mint
                    ? "This is a token account, not a wallet. A token transfer has to name the owner's wallet — Cinder derives the token account from it — so this send is blocked."
                    : "This is a token account, not a wallet. Send to the owner's wallet address instead."}
                </Banner>
              )}
              <Banner>Double-check the full destination address before confirming.</Banner>
            </div>
          </ModalContent>
          <ModalFooter>
            <div className="grid grid-cols-2 gap-3">
              <SecondaryButton
                onClick={() => {
                  setStep('amount');
                  clearAttempt();
                }}
              >
                Back
              </SecondaryButton>
              <PrimaryButton
                onClick={handleSend}
                disabled={sending || estimate.isPending || submitted || tokenToTokenAccount}
                data-testid="send-confirm"
              >
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
