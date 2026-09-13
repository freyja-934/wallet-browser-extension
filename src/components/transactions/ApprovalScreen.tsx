import { useEffect, useState } from 'react';
import { accountAt, type PendingApproval, type WalletPublicState, type WalletSettings } from '../../lib/messages';
import type { PreviewResult } from '../../lib/preview';
import { extensionClient } from '../../messaging/client';
import { PopupFrame } from '../ui/Atmosphere';
import { AddressText, Banner } from '../ui/EmptyState';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { GlowMark } from '../ui/GlowMark';
import { UnlockForm } from '../wallet/UnlockForm';
import { BalanceDiff } from './BalanceDiff';

const KIND_LABEL: Record<string, string> = {
  connect: 'Connect',
  signMessage: 'Sign message',
  signTransaction: 'Sign transaction',
  signAndSendTransaction: 'Send transaction',
};

const CLUSTER_LABEL: Record<WalletSettings['cluster'], string> = {
  'mainnet-beta': 'Solana Mainnet',
  devnet: 'Solana Devnet',
};

/**
 * What a connect grant is and is not, in the order a reader needs it. This is a
 * description of the grant the worker already makes — sharing the addresses and
 * letting the site ask — not a new one: every signature still opens its own
 * approval window.
 */
const CONNECT_CAN = ['See your wallet address and its on-chain activity', 'Ask you to sign transactions and messages'];
const CONNECT_CANNOT = [
  'Move any SOL or token without a separate approval, every time',
  'See your recovery phrase, your private keys or your password',
];

/** A preview that could not be fetched at all (the worker threw): shown in place, never approvable. */
interface PreviewFailure {
  failed: true;
  error: string;
}

type ItemPreview = PreviewResult | PreviewFailure;

function isFailure(preview: ItemPreview): preview is PreviewFailure {
  return 'failed' in preview;
}

export function ApprovalScreen() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || '';
  const [request, setRequest] = useState<PendingApproval | null>(null);
  // null until GET_STATE answers; the request summary renders either way.
  const [locked, setLocked] = useState<boolean | null>(null);
  // Who would be shared, and on which cluster. Both are read-only context for the
  // reader: neither changes what Approve grants.
  const [accounts, setAccounts] = useState<WalletPublicState | null>(null);
  const [cluster, setCluster] = useState<WalletSettings['cluster'] | null>(null);
  // The worker settled the request while this window was open (a lock rejected it, the page gave up).
  const [expired, setExpired] = useState(false);
  // One entry per transaction of the request, in order, once all of them have settled.
  const [previews, setPreviews] = useState<ItemPreview[] | null>(null);
  const [showInstructions, setShowInstructions] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('Missing request id');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [state, pending, settings] = await Promise.all([
          extensionClient.getState(),
          extensionClient.getPendingRequest(id),
          // Context only: a settings read that fails must not stop the request rendering.
          extensionClient.getSettings().catch(() => null),
        ]);
        if (cancelled) return;
        setLocked(state.isLocked);
        setAccounts(state);
        if (settings) setCluster(settings.cluster);
        setRequest(pending);
        if (!pending) setError('This request has expired. Retry it from the site.');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Request failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The wallet locked underneath this window (auto-lock, or Lock in the popup): ask for the
  // password again. The lock rejected the request, which the re-fetch after unlock reports.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const onMessage = (message: unknown) => {
      const event = message as { type?: unknown; event?: unknown } | null;
      if (event?.type === 'WALLET_EVENT' && event.event === 'locked') setLocked(true);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  // Unlocked inline: the request may have been settled meanwhile, so read it again before
  // enabling Approve. A request that is gone renders as expired with Approve disabled.
  const onUnlocked = async () => {
    setLocked(false);
    // A locked wallet reports no accounts, so the account this connect would share
    // is only knowable now.
    try {
      setAccounts(await extensionClient.getState());
    } catch {
      /* the account row stays unknown */
    }
    try {
      const pending = await extensionClient.getPendingRequest(id);
      if (pending) {
        setRequest(pending);
        return;
      }
    } catch {
      /* treated as gone */
    }
    setExpired(true);
    setError('This request has expired. Retry it from the site.');
  };

  // The preview needs the RPC and a readable request; it runs once the wallet is unlocked,
  // one item at a time, and settles only when every item has an answer.
  useEffect(() => {
    const transactions = request?.transactions ?? [];
    if (locked !== false || transactions.length === 0 || previews) return;
    let cancelled = false;
    (async () => {
      const results: ItemPreview[] = [];
      for (const transaction of transactions) {
        try {
          results.push(await extensionClient.previewTransaction(transaction, request?.accountAtEnqueue));
        } catch (err) {
          results.push({ failed: true, error: err instanceof Error ? err.message : 'Preview failed' });
        }
        if (cancelled) return;
      }
      // Settle in one update so Approve never enables before every banner renders.
      setPreviews(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [locked, request, previews]);

  const approve = async () => {
    setBusy(true);
    try {
      await extensionClient.approveRequest(id);
      window.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await extensionClient.rejectRequest(id);
      window.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  };

  const originHost = request?.origin ? safeHost(request.origin) : '';
  const isSend = request?.kind === 'signAndSendTransaction';
  const isConnect = request?.kind === 'connect';
  // The account the site is told is active. A locked wallet reports none, so this is
  // undefined until the inline unlock; the row says so rather than guessing.
  const sharedAccount = accounts ? accountAt(accounts.accounts, accounts.activeAccountIndex) : undefined;
  // For a signature, the account the request was pinned to at enqueue — the key that
  // will actually sign, whatever the popup is showing now. A connect shares the active
  // one, and so would a request that pinned nothing; an account change withdraws that
  // request rather than letting this row go stale.
  const signingAccount =
    accounts && request?.accountAtEnqueue !== undefined
      ? accountAt(accounts.accounts, request.accountAtEnqueue)
      : sharedAccount;
  // Connecting shares every account in the wallet, not only the active one (see
  // `fulfillApproval`): when there is more than one, the screen has to say so.
  const sharedCount = accounts?.accounts.length ?? 0;
  const transactionCount = request?.transactions?.length ?? 0;
  // Never let a transaction be approved before every preview has settled.
  const awaitingPreview = transactionCount > 0 && previews === null;
  const settled = previews ?? [];
  // A preview the worker could not produce at all, or bytes it could not read: no approving that.
  const anyUnreadable = settled.some((preview) => isFailure(preview) || preview.unreadable);
  const notSigner = settled.find((preview) => !isFailure(preview) && !preview.signerOk);
  const anyFailedSimulation = settled.some((preview) => !isFailure(preview) && !preview.success);
  const anyDanger = settled.some((preview) => !isFailure(preview) && preview.warnings.some((w) => w.level === 'danger'));
  // Simulation failed but the bytes are readable and ours to sign: the user may still go ahead, warned.
  const approveAnyway = !anyUnreadable && !notSigner && anyFailedSimulation;
  const approveDisabled =
    busy || !request || expired || locked !== false || awaitingPreview || anyUnreadable || Boolean(notSigner);
  const danger = approveAnyway || (isSend && anyDanger);

  return (
    <PopupFrame atmosphere="still" heavy>
      <div className="flex h-full min-h-0 flex-col p-5">
        <div className="mb-4 flex shrink-0 items-center gap-3">
          <GlowMark size={36} />
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-fg-2">Cinder</p>
            <h1 className="text-xl font-semibold tracking-tight">
              {request ? KIND_LABEL[request.kind] || 'Approve request' : 'Approve request'}
            </h1>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <Banner tone="danger">{error}</Banner>}
          {locked && (
            <Card className="mb-4" data-testid="approval-unlock">
              <CardContent className="space-y-4">
                <p className="text-sm text-fg-2">Unlock Cinder Wallet to review this request.</p>
                <UnlockForm onUnlocked={() => void onUnlocked()} />
              </CardContent>
            </Card>
          )}
          {request && (
            <Card className="mb-4">
              <CardContent className="space-y-2 text-sm">
                <Row label="Origin" value={originHost || request.origin} />
                <Row label="Type" value={KIND_LABEL[request.kind] || request.kind} />
                {/* Which key is about to sign — or, for a connect, which account is named active. */}
                <div className="flex justify-between gap-3">
                  <span className="text-fg-2">Account</span>
                  {signingAccount ? (
                    <span className="text-right" data-testid="approval-account">
                      <span className="text-fg-0">{signingAccount.name}</span>{' '}
                      <AddressText address={signingAccount.address} />
                    </span>
                  ) : (
                    <span className="text-right text-fg-2">Unlock to see which account</span>
                  )}
                </div>
                {transactionCount > 1 && <Row label="Transactions" value={String(transactionCount)} />}
                {request.chain && <Row label="Chain" value={request.chain} />}
                {expired && (
                  <p className="text-ui-danger" data-testid="approval-expired">
                    Expired — the site is no longer waiting for this request.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {isConnect && (
            <Card className="mb-4">
              <CardContent>
                {/* Card does not forward attributes; the marker lives on this wrapper. */}
                <div className="space-y-3 text-sm" data-testid="approval-connect">
                  <Row
                    label="Network"
                    value={cluster ? CLUSTER_LABEL[cluster] : 'Unknown'}
                  />
                  {sharedCount > 1 && (
                    <p className="text-xs text-fg-2">
                      All {sharedCount} accounts in this wallet are shared, with the one above named as active.
                    </p>
                  )}
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-fg-2">This site will be able to</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-fg-1">
                      {CONNECT_CAN.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-fg-2">It will not be able to</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-fg-1">
                      {CONNECT_CANNOT.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {notSigner && (
            <div className="mb-4">
              <Banner tone="danger">{notSigner.error}</Banner>
            </div>
          )}

          {previews?.map((preview, i) => (
            <Card className="mb-4" key={i}>
              <CardContent className="space-y-3">
                {/* Card does not forward attributes; the item marker lives on this wrapper. */}
                <div data-testid="approval-item" data-index={i} className="space-y-3">
                {transactionCount > 1 && (
                  <p className="text-[11px] uppercase tracking-[0.18em] text-fg-2">
                    Transaction {i + 1} of {transactionCount}
                  </p>
                )}
                {isFailure(preview) ? (
                  <p className="text-sm text-ui-danger" data-testid="approval-preview">
                    {preview.error}
                  </p>
                ) : (
                  <>
                    <p
                      className={`text-sm ${preview.success ? 'text-ui-success' : 'text-ui-danger'}`}
                      data-testid="approval-preview"
                    >
                      {preview.success ? 'Simulation succeeded' : preview.error || 'Simulation failed'}
                    </p>
                    {preview.diff && <BalanceDiff diff={preview.diff} />}
                    {preview.warnings.map((warning, j) => (
                      <Banner key={j} tone={warning.level === 'danger' ? 'danger' : 'warning'}>
                        {warning.message}
                      </Banner>
                    ))}
                    {preview.instructions.length > 0 && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowInstructions((v) => ({ ...v, [i]: !v[i] }))}
                          className="text-xs text-fg-2 hover:text-fg-0"
                        >
                          {showInstructions[i] ? 'Hide' : 'Show'} instructions
                        </button>
                        {showInstructions[i] && (
                          <div className="mt-2 space-y-1">
                            {preview.instructions.map((ix, j) => (
                              <div key={j} className="text-xs text-fg-1">
                                {ix.label} <span className="text-fg-3">({ix.programName})</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                </div>
              </CardContent>
            </Card>
          ))}

          {request?.kind === 'signMessage' && (
            <Card className="mb-4">
              <CardContent className="space-y-3">
                {(request.messages ?? []).map((message, i) => (
                  <MessageBody key={i} bytes={Uint8Array.from(message)} index={i} total={request.messages?.length ?? 1} />
                ))}
              </CardContent>
            </Card>
          )}

          {isSend && anyDanger && (
            <div className="mb-4">
              <Banner tone="danger">This request can move funds. Review the simulation before approving.</Banner>
            </div>
          )}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-3 pt-4">
          <SecondaryButton onClick={reject} disabled={busy} data-testid="approval-reject">
            Reject
          </SecondaryButton>
          <PrimaryButton
            onClick={approve}
            disabled={approveDisabled}
            data-testid="approval-approve"
            className={danger ? 'bg-ui-danger text-[#010000] shadow-none hover:bg-ui-danger' : ''}
          >
            {approveAnyway ? 'Approve anyway' : 'Approve'}
          </PrimaryButton>
        </div>
      </div>
    </PopupFrame>
  );
}

/** Most bytes of a message shown as hex before the rest is elided. */
const HEX_PREVIEW_BYTES = 512;

/** UTF-8 when the bytes are valid text; otherwise hex with the byte count, so nothing is guessed at. */
function MessageBody({ bytes, index, total }: { bytes: Uint8Array; index: number; total: number }) {
  let text: string | null = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = null;
  }
  const heading = total > 1 ? `Message ${index + 1} of ${total}` : undefined;
  if (text !== null) {
    return (
      <div data-testid="approval-message" data-encoding="utf-8">
        {heading && <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-fg-2">{heading}</p>}
        <p className="whitespace-pre-wrap break-all font-mono text-xs text-fg-2">{text}</p>
      </div>
    );
  }
  const shown = bytes.subarray(0, HEX_PREVIEW_BYTES);
  const hex = Array.from(shown, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return (
    <div data-testid="approval-message" data-encoding="hex">
      {heading && <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-fg-2">{heading}</p>}
      <p className="mb-1 text-xs text-fg-2">Binary message, {bytes.length} bytes (hex)</p>
      <p className="break-all font-mono text-xs text-fg-2">
        {hex}
        {bytes.length > HEX_PREVIEW_BYTES && '…'}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-2">{label}</span>
      <span className="text-right text-fg-0 break-all">{value}</span>
    </div>
  );
}

function safeHost(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
