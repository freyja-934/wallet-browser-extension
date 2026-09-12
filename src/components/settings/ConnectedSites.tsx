import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { errorMessage } from '../../lib/errors';
import { extensionClient } from '../../messaging/client';
import { SecondaryButton } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';

export const CONNECTED_SITES_QUERY_KEY = ['connectedSites'] as const;

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** "Just now", "12 min ago", "3 h ago", otherwise the local date. */
function connectedLabel(connectedAt: number, now = Date.now()): string {
  const minutes = Math.round((now - connectedAt) / 60_000);
  if (minutes < 1) return 'Connected just now';
  if (minutes < 60) return `Connected ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Connected ${hours} h ago`;
  return `Connected ${new Date(connectedAt).toLocaleDateString()}`;
}

/** Sites that may see the account and ask for signatures, with a Revoke per site. */
export function ConnectedSites() {
  const queryClient = useQueryClient();
  const { data: sites, isLoading, error } = useQuery({
    queryKey: CONNECTED_SITES_QUERY_KEY,
    queryFn: () => extensionClient.getConnectedSites(),
  });
  const revoke = useMutation({
    mutationFn: (origin: string) => extensionClient.revokeSite(origin),
    onSuccess: (_result, origin) => {
      void queryClient.invalidateQueries({ queryKey: CONNECTED_SITES_QUERY_KEY });
      toast.success(`Revoked ${hostOf(origin)}`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not revoke that site')),
  });

  return (
    <Card>
      <CardContent className="space-y-3">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-fg-2">Connected sites</h3>
        {error ? (
          <p className="text-xs text-ui-danger">Could not load connected sites.</p>
        ) : isLoading ? (
          <p className="text-xs text-fg-3">Loading…</p>
        ) : !sites || sites.length === 0 ? (
          <p className="text-xs text-fg-3" data-testid="settings-no-sites">
            No sites connected. A site appears here after you approve its connect request.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="settings-connected-sites">
            {sites.map((site) => (
              <li
                key={site.origin}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-2"
                data-testid="settings-site"
                data-origin={site.origin}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg-0" title={site.origin}>
                    {hostOf(site.origin)}
                  </p>
                  <p className="text-xs text-fg-3">{connectedLabel(site.connectedAt)}</p>
                </div>
                <SecondaryButton
                  onClick={() => revoke.mutate(site.origin)}
                  disabled={revoke.isPending}
                  className="shrink-0"
                  data-testid="settings-revoke-site"
                >
                  Revoke
                </SecondaryButton>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-fg-3">
          Revoking makes the site ask to connect again. Locking the wallet keeps sites connected but hides the account until you unlock.
        </p>
      </CardContent>
    </Card>
  );
}
