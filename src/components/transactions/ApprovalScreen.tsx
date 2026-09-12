import { useEffect, useState } from 'react';
import type { PendingApproval } from '../../lib/messages';
import type { PreviewResult } from '../../lib/preview';
import { extensionClient } from '../../messaging/client';
import { PopupFrame } from '../ui/Atmosphere';
import { Banner } from '../ui/EmptyState';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { GlowMark } from '../ui/GlowMark';

type Preview = PreviewResult;

const KIND_LABEL: Record<string, string> = {
  connect: 'Connect',
  signMessage: 'Sign message',
  signTransaction: 'Sign transaction',
  signAndSendTransaction: 'Send transaction',
};

export function ApprovalScreen() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || '';
  const [request, setRequest] = useState<PendingApproval | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewSettled, setPreviewSettled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
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
        const pending = await extensionClient.getPendingRequest(id);
        if (cancelled) return;
        setRequest(pending);
        if (!pending?.transactionBytes) return;
        try {
          const result = await extensionClient.previewTransaction(pending.transactionBytes);
          if (!cancelled) setPreview(result);
        } catch (err) {
          // Error and settle land in the same handler so Approve never enables before the banner renders.
          if (!cancelled) setError(err instanceof Error ? err.message : 'Preview failed');
        } finally {
          if (!cancelled) setPreviewSettled(true);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Request failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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
  const danger = preview?.warnings?.some((warning) => warning.level === 'danger');
  const isSend = request?.kind === 'signAndSendTransaction';
  // Never let a transaction be approved before its preview has settled.
  const awaitingPreview = Boolean(request?.transactionBytes) && !previewSettled;

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
          {request && (
            <Card className="mb-4">
              <CardContent className="space-y-2 text-sm">
                <Row label="Origin" value={originHost || request.origin} />
                <Row label="Type" value={KIND_LABEL[request.kind] || request.kind} />
              </CardContent>
            </Card>
          )}

        {preview && (
          <Card className="mb-4">
            <CardContent className="space-y-3">
              <p
                className={`text-sm ${preview.success ? 'text-ui-success' : 'text-ui-danger'}`}
                data-testid="approval-preview"
              >
                {preview.success ? 'Simulation succeeded' : preview.error || 'Simulation failed'}
              </p>
              {preview.warnings?.map((warning, i) => (
                <Banner key={i} tone={warning.level === 'danger' ? 'danger' : 'warning'}>
                  {warning.message}
                </Banner>
              ))}
              {preview.instructions && preview.instructions.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowInstructions((v) => !v)}
                    className="text-xs text-fg-2 hover:text-fg-0"
                  >
                    {showInstructions ? 'Hide' : 'Show'} instructions
                  </button>
                  {showInstructions && (
                    <div className="mt-2 space-y-1">
                      {preview.instructions.map((ix, i) => (
                        <div key={i} className="text-xs text-fg-1">
                          {ix.label} <span className="text-fg-3">({ix.programName})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {request?.kind === 'signMessage' && (
          <Card className="mb-4">
            <CardContent>
              <p className="break-all font-mono text-xs text-fg-2">
                {new TextDecoder().decode(Uint8Array.from(request.messageBytes || []))}
              </p>
            </CardContent>
          </Card>
        )}

        {isSend && danger && (
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
            disabled={busy || !request || awaitingPreview}
            data-testid="approval-approve"
            className={isSend && danger ? 'bg-ui-danger text-[#010000] shadow-none' : ''}
          >
            Approve
          </PrimaryButton>
        </div>
      </div>
    </PopupFrame>
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
