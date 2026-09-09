import { useEffect, useState } from 'react';
import { extensionClient } from '../../messaging/client';
import type { PendingApproval } from '../../lib/messages';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';

interface Preview {
  success?: boolean;
  error?: string;
  logs?: string[];
  unitsConsumed?: number;
  instructions?: Array<{ label: string; programName: string; known: boolean; warning?: string }>;
  warnings?: Array<{ level: string; message: string }>;
}

export function ApprovalScreen() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || '';
  const [request, setRequest] = useState<PendingApproval | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('Missing request id');
      return;
    }
    extensionClient.getPendingRequest(id).then(async (pending) => {
      setRequest(pending);
      if (pending?.transactionBytes) {
        const result = await extensionClient.previewTransaction(pending.transactionBytes);
        setPreview(result as Preview);
      }
    }).catch((err) => setError(err.message));
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

  return (
    <div className="popup-container bg-bg-0 text-fg-0 p-4 space-y-4">
      <div>
        <p className="text-xs text-fg-2">Lumen</p>
        <h1 className="text-xl font-semibold">Approve request</h1>
      </div>

      {error && <p className="text-sm text-ui-danger">{error}</p>}

      {request && (
        <Card>
          <CardContent className="space-y-2 text-sm">
            <Row label="Type" value={request.kind} />
            <Row label="Origin" value={request.origin} />
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-sm font-medium">Simulation</h2>
            <p
              className={`text-sm ${preview.success ? 'text-ui-success' : 'text-ui-danger'}`}
              data-testid="approval-preview"
            >
              {preview.success ? 'Simulation succeeded' : preview.error || 'Simulation failed'}
            </p>
            {preview.unitsConsumed != null && (
              <p className="text-xs text-fg-2">Compute units: {preview.unitsConsumed}</p>
            )}
            {preview.warnings?.map((warning, i) => (
              <p key={i} className={warning.level === 'danger' ? 'text-sm text-ui-danger' : 'text-sm text-ui-warning'}>
                {warning.message}
              </p>
            ))}
            <div className="space-y-1">
              {preview.instructions?.map((ix, i) => (
                <div key={i} className="text-xs text-fg-1">
                  {ix.label} <span className="text-fg-3">({ix.programName})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {request?.kind === 'signMessage' && (
        <Card>
          <CardContent>
            <p className="text-xs text-fg-2 break-all">
              Message: {new TextDecoder().decode(Uint8Array.from(request.messageBytes || []))}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <SecondaryButton onClick={reject} disabled={busy} data-testid="approval-reject">Reject</SecondaryButton>
        <PrimaryButton onClick={approve} disabled={busy || !request} data-testid="approval-approve">Approve</PrimaryButton>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-2">{label}</span>
      <span className="text-fg-0 text-right break-all">{value}</span>
    </div>
  );
}
