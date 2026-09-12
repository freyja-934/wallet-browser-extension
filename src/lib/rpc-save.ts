import { clusterForGenesisHash, GENESIS_HASH, labelFor, type Cluster } from '../config/constants';
import type { WalletSettings } from './messages';

/** What one `probe(url)` learned: `getHealth` answered, and which chain `getGenesisHash` named. */
export interface RpcProbeResult {
  ok: boolean;
  genesisHash?: string;
  error?: string;
}

/** The browser and worker calls the save flow needs, injected so the flow itself is a pure unit. */
export interface SaveRpcDeps {
  /** `chrome.permissions.request` for one origin pattern. Called synchronously, inside the click. */
  requestOrigin(pattern: string): Promise<boolean>;
  /** `chrome.permissions.remove` for one origin pattern; must not throw for a required origin. */
  removeOrigin(pattern: string): Promise<void>;
  probe(url: string): Promise<RpcProbeResult>;
  /** `UPDATE_SETTINGS` through the worker. */
  persist(settings: Partial<WalletSettings>): Promise<unknown>;
}

export interface SaveRpcInput {
  rpcUrl: string;
  heliusApiKey: string;
  /** The active cluster; the probed endpoint must serve it. */
  cluster: Cluster;
  /** The URL stored before this save; its origin grant is dropped once nothing points at it. */
  previousRpcUrl?: string;
}

export type SaveRpcOutcome = { ok: true } | { ok: false; error: string };

/** Match pattern for `chrome.permissions` covering every path on the URL's origin. */
export function originPatternFor(url: URL): string {
  return `${url.origin}/*`;
}

export function parseHttpsUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Why a probed endpoint cannot be saved for `cluster`, or `undefined` when it can. */
export function probeRefusal(probe: RpcProbeResult, cluster: Cluster): string | undefined {
  if (!probe.ok) return probe.error ?? 'Could not reach that endpoint';
  if (!probe.genesisHash) return 'That endpoint did not report a genesis hash';
  if (probe.genesisHash === GENESIS_HASH[cluster]) return undefined;
  const other = clusterForGenesisHash(probe.genesisHash);
  return other ? `That endpoint serves ${labelFor(other)}` : 'That endpoint serves a different cluster';
}

/**
 * The Settings "Save" flow. Not `async`: everything up to `deps.requestOrigin`
 * runs synchronously in the caller's click, which is what lets Chrome treat the
 * permission request as user-initiated. An empty URL skips permission and probe
 * and only stores the key.
 */
export function saveRpcSettings(input: SaveRpcInput, deps: SaveRpcDeps): Promise<SaveRpcOutcome> {
  const url = input.rpcUrl.trim();
  const key = input.heliusApiKey.trim();
  let originPattern: string | undefined;
  let permission: Promise<boolean> = Promise.resolve(true);
  if (url) {
    const parsed = parseHttpsUrl(url);
    if (!parsed) return Promise.resolve({ ok: false, error: 'RPC URL must start with https://' });
    originPattern = originPatternFor(parsed);
    permission = deps.requestOrigin(originPattern);
  }
  return finishSave(url, key, input, originPattern, permission, deps);
}

async function finishSave(
  url: string,
  key: string,
  input: SaveRpcInput,
  originPattern: string | undefined,
  permission: Promise<boolean>,
  deps: SaveRpcDeps,
): Promise<SaveRpcOutcome> {
  if (url && originPattern) {
    if (!(await permission)) return { ok: false, error: 'Access to that host was not granted' };
    const refusal = probeRefusal(await deps.probe(url), input.cluster);
    if (refusal) {
      await deps.removeOrigin(originPattern);
      return { ok: false, error: refusal };
    }
  }
  await deps.persist({ rpcUrl: url, heliusApiKey: key, ...(url ? { rpcUrlCluster: input.cluster } : {}) });
  const previous = input.previousRpcUrl ? parseHttpsUrl(input.previousRpcUrl) : undefined;
  if (previous) {
    const previousPattern = originPatternFor(previous);
    if (previousPattern !== originPattern) await deps.removeOrigin(previousPattern);
  }
  return { ok: true };
}
