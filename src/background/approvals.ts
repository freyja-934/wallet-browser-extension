import {
  CHAIN_FOR_CLUSTER,
  PAGE_TIMEOUT_MS,
  type ApprovalKind,
  type PendingApproval,
  type WalletSettings,
} from '../lib/messages';
import * as origins from './origins';
import { sessionArea, withLock } from './session-store';

/**
 * Approval lifecycle. Three maps in `chrome.storage.session`, so a worker
 * restart mid-approval is survivable:
 *
 * - `cinder_pending`: waiting for the user. Anything here may still be rejected
 *   by the window closing, the tab closing, a lock, a revoke, a cancel from the
 *   page, or the sweep.
 * - `cinder_inflight`: claimed by Approve and being fulfilled (signed, maybe
 *   broadcast). Nothing but `settleClaimed` touches an entry here: the page
 *   must learn the real outcome of a broadcast, never a `rejected` that raced it.
 * - `cinder_approval_results`: delivered once to the page's poll, then dropped;
 *   swept after `APPROVAL_TTL_MS` if never polled.
 */
const PENDING_KEY = 'cinder_pending';
const INFLIGHT_KEY = 'cinder_inflight';
const RESULT_KEY = 'cinder_approval_results';
/** One queue for all three maps: every transition touches two of them. */
const LOCK = 'cinder_approvals';

/** Worker-side backstop; the page's own `PAGE_TIMEOUT_MS` is the binding limit. */
export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export const EXPIRED_MESSAGE = 'Approval expired — unlock and retry the dApp request';
/** A transaction request whose cluster changed underneath it, pending or at Approve. */
export const NETWORK_CHANGED_MESSAGE = 'Network changed';
/** A signature request whose account the user moved off while it was waiting. */
export const ACCOUNT_CHANGED_MESSAGE = 'Account changed';

export type ApprovalResult =
  | { status: 'pending' }
  | { status: 'approved'; value: Record<string, unknown> }
  | { status: 'rejected'; error: string }
  | { status: 'unknown' };

/** A settled outcome, kept with who may poll it and when it settled. */
interface StoredResult {
  result: Extract<ApprovalResult, { status: 'approved' | 'rejected' }>;
  origin: string;
  settledAt: number;
}

type PendingMap = Record<string, PendingApproval>;

async function readMap<T>(key: string): Promise<Record<string, T>> {
  const data = await sessionArea().get(key);
  return (data[key] as Record<string, T> | undefined) ?? {};
}

async function writeMap<T>(key: string, map: Record<string, T>): Promise<void> {
  await sessionArea().set({ [key]: map });
}

function expired(): Error {
  return new Error(EXPIRED_MESSAGE);
}

/** Move `requestId` out of `map` (stored under `key`) into results. Caller holds the lock. */
async function settle(
  key: string,
  map: PendingMap,
  requestId: string,
  result: StoredResult['result'],
  now = Date.now(),
): Promise<void> {
  const request = map[requestId];
  delete map[requestId];
  const results = await readMap<StoredResult>(RESULT_KEY);
  results[requestId] = { result, origin: request?.origin ?? '', settledAt: now };
  await writeMap(key, map);
  await writeMap(RESULT_KEY, results);
}

/** Close the approval windows of `requests`, outside the lock; a window already gone is fine. */
async function closeWindows(requests: PendingApproval[]): Promise<void> {
  await Promise.all(
    requests.map(async (request) => {
      if (typeof request.windowId !== 'number') return;
      try {
        await chrome.windows.remove(request.windowId);
      } catch {
        /* already closed */
      }
    }),
  );
}

export async function enqueueApproval(
  kind: ApprovalKind,
  origin: string,
  extra: Partial<PendingApproval> = {}
): Promise<string> {
  return withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    if (Object.values(pending).some((request) => request.origin === origin)) {
      throw new Error('A request is already pending for this site');
    }

    const createdAt = Date.now();
    const request: PendingApproval = {
      id: crypto.randomUUID(),
      kind,
      origin,
      createdAt,
      deadline: createdAt + PAGE_TIMEOUT_MS,
      ...extra,
    };

    // The record first: a write that fails opens nothing, and a window that
    // fails to open leaves no record behind for the origin to trip over.
    pending[request.id] = request;
    await writeMap(PENDING_KEY, pending);

    const url = chrome.runtime.getURL(`approve.html?id=${encodeURIComponent(request.id)}`);
    let created: { id?: number } | undefined;
    try {
      created = await chrome.windows.create({
        url,
        type: 'popup',
        width: 400,
        height: 720,
        focused: true,
      });
    } catch (error) {
      delete pending[request.id];
      await writeMap(PENDING_KEY, pending);
      throw error;
    }
    if (typeof created?.id === 'number') {
      request.windowId = created.id;
      await writeMap(PENDING_KEY, pending);
    }
    return request.id;
  });
}

/** The request if it is still waiting for the user; `null` once claimed, settled, or unknown. */
export async function getPending(requestId: string): Promise<PendingApproval | null> {
  return (await readMap<PendingApproval>(PENDING_KEY))[requestId] ?? null;
}

export interface ClaimOptions {
  /** A page's own request only: the stored origin must match. */
  origin?: string;
  /** Sign requests need a still-connected origin at approval time, not just at enqueue. */
  requireConnected?: boolean;
  now?: number;
}

function isPastDue(request: PendingApproval, now: number): boolean {
  return now - request.createdAt >= APPROVAL_TTL_MS || now > request.deadline;
}

/**
 * Atomically take `requestId` out of pending for fulfilment. After this nothing
 * else can settle it: the window closing, a lock, a revoke, a cancel from the
 * page and the sweep all leave inflight entries alone, so whatever Approve
 * signs or broadcasts is what the page is told about. Throws `EXPIRED_MESSAGE`
 * when the request is not pending, is past its deadline or TTL, belongs to
 * another origin, or (with `requireConnected`) its site has since been revoked.
 */
export async function claimApproval(requestId: string, options: ClaimOptions = {}): Promise<PendingApproval> {
  return withLock(LOCK, async () => {
    const now = options.now ?? Date.now();
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const request = pending[requestId];
    if (!request) throw expired();
    if (options.origin !== undefined && request.origin !== options.origin) throw expired();
    if (isPastDue(request, now)) {
      // A stuck page never withdrew it; the sweep would have caught it a little later.
      await settle(PENDING_KEY, pending, requestId, { status: 'rejected', error: 'Approval expired' }, now);
      throw expired();
    }
    if (options.requireConnected && request.kind !== 'connect' && !(await origins.isConnected(request.origin))) {
      await settle(PENDING_KEY, pending, requestId, { status: 'rejected', error: 'Not connected' }, now);
      throw expired();
    }

    delete pending[requestId];
    const inflight = await readMap<PendingApproval>(INFLIGHT_KEY);
    inflight[requestId] = request;
    await writeMap(PENDING_KEY, pending);
    await writeMap(INFLIGHT_KEY, inflight);
    return request;
  });
}

/** Record the real outcome of a claimed request. Throws `EXPIRED_MESSAGE` if it was never claimed. */
export async function settleClaimed(requestId: string, result: StoredResult['result']): Promise<void> {
  await withLock(LOCK, async () => {
    const inflight = await readMap<PendingApproval>(INFLIGHT_KEY);
    if (!inflight[requestId]) throw expired();
    await settle(INFLIGHT_KEY, inflight, requestId, result);
  });
}

/**
 * Reject in the window. Only a request still waiting for the user; a claimed
 * or settled one is left alone and throws `EXPIRED_MESSAGE` like an unknown id.
 */
export async function rejectApproval(requestId: string, reason = 'User rejected'): Promise<void> {
  await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    if (!pending[requestId]) throw expired();
    await settle(PENDING_KEY, pending, requestId, { status: 'rejected', error: reason });
  });
}

/**
 * The page gave up (its timeout, or it navigated away). Reject the request if
 * it is still pending and close its window; a claimed or settled request is
 * not disturbed, and an id the page does not own throws `EXPIRED_MESSAGE`.
 */
export async function cancelApproval(requestId: string, origin: string): Promise<void> {
  const withdrawn = await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const request = pending[requestId];
    if (!request) {
      await assertOwnRecord(requestId, origin);
      return null;
    }
    if (request.origin !== origin) throw expired();
    await settle(PENDING_KEY, pending, requestId, { status: 'rejected', error: 'Request timeout' });
    return request;
  });
  if (withdrawn) await closeWindows([withdrawn]);
}

/** Caller holds the lock. Throws `EXPIRED_MESSAGE` if `requestId` is claimed or settled under a different origin. */
async function assertOwnRecord(requestId: string, origin: string): Promise<void> {
  const inflight = (await readMap<PendingApproval>(INFLIGHT_KEY))[requestId];
  if (inflight && inflight.origin !== origin) throw expired();
  const result = (await readMap<StoredResult>(RESULT_KEY))[requestId];
  if (result && result.origin !== origin) throw expired();
}

/**
 * One-shot: a delivered result is deleted, so a second poll for the same id
 * answers `unknown` and nothing accumulates in session storage. With `origin`,
 * a page may only poll its own request; a mismatch throws `EXPIRED_MESSAGE`.
 */
export async function getApprovalResult(requestId: string, origin?: string): Promise<ApprovalResult> {
  return withLock(LOCK, async () => {
    const results = await readMap<StoredResult>(RESULT_KEY);
    const stored = results[requestId];
    if (stored) {
      if (origin !== undefined && stored.origin !== origin) throw expired();
      delete results[requestId];
      await writeMap(RESULT_KEY, results);
      return stored.result;
    }
    const pending = (await readMap<PendingApproval>(PENDING_KEY))[requestId]
      ?? (await readMap<PendingApproval>(INFLIGHT_KEY))[requestId];
    if (!pending) return { status: 'unknown' };
    if (origin !== undefined && pending.origin !== origin) throw expired();
    return { status: 'pending' };
  });
}

/**
 * The approval window went away. Reject the request it was showing, but only
 * if it is still pending: Approve claims first and then calls `window.close()`.
 */
export async function onWindowRemoved(windowId: number): Promise<void> {
  await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const request = Object.values(pending).find((entry) => entry.windowId === windowId);
    if (!request) return;
    await settle(PENDING_KEY, pending, request.id, { status: 'rejected', error: 'Approval window closed' });
  });
}

/**
 * The page's tab closed. Reject every request it had pending and close their
 * approval windows; nothing is left showing a request nobody is waiting for.
 */
export async function onTabRemoved(tabId: number): Promise<void> {
  const closed = await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const requests = Object.values(pending).filter((entry) => entry.tabId === tabId);
    for (const request of requests) {
      await settle(PENDING_KEY, pending, request.id, { status: 'rejected', error: 'Page closed' });
    }
    return requests;
  });
  await closeWindows(closed);
}

/** The site disconnected or was revoked: reject what it still has pending. Returns the ids. */
export async function rejectForOrigin(origin: string, reason: string): Promise<string[]> {
  return withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const requests = Object.values(pending).filter((entry) => entry.origin === origin);
    for (const request of requests) {
      await settle(PENDING_KEY, pending, request.id, { status: 'rejected', error: reason });
    }
    return requests.map((request) => request.id);
  });
}

/**
 * True when `request` can still be signed on `cluster`: connect and message
 * requests always (a message signature is not chain-bound); a transaction
 * request only when the chain the page named, or failing that the cluster it
 * was enqueued on, is the active one.
 */
export function onCluster(request: PendingApproval, cluster: WalletSettings['cluster']): boolean {
  if (request.kind !== 'signTransaction' && request.kind !== 'signAndSendTransaction') return true;
  if (request.chain !== undefined) return request.chain === CHAIN_FOR_CLUSTER[cluster];
  return request.clusterAtEnqueue === undefined || request.clusterAtEnqueue === cluster;
}

/**
 * The active cluster changed: reject every pending transaction request that
 * was built for the old one and close its window. Returns the ids.
 */
export async function rejectForClusterChange(cluster: WalletSettings['cluster']): Promise<string[]> {
  const rejected = await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const requests = Object.values(pending).filter((entry) => !onCluster(entry, cluster));
    for (const request of requests) {
      await settle(PENDING_KEY, pending, request.id, { status: 'rejected', error: NETWORK_CHANGED_MESSAGE });
    }
    return requests;
  });
  await closeWindows(rejected);
  return rejected.map((request) => request.id);
}

/**
 * True when `request` can still be signed with `index` as the active account:
 * connect always (it shares every account, not just the active one), and a
 * signature request only when it is pinned to that account. A request that
 * pinned nothing signs with whatever is active at Approve, which is exactly
 * what an account change makes wrong, so it does not survive one either.
 */
export function onAccount(request: PendingApproval, index: number): boolean {
  if (request.kind === 'connect') return true;
  return request.accountAtEnqueue === index;
}

/**
 * The active account changed: reject every pending signature request bound to
 * another one and close its window. The approval was built for a key the user
 * has just moved off — its preview, its balance diff and its `signerOk` all
 * describe that key — so it is withdrawn rather than re-pointed. Returns the ids.
 */
export async function rejectForAccountChange(index: number): Promise<string[]> {
  const rejected = await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const requests = Object.values(pending).filter((entry) => !onAccount(entry, index));
    for (const request of requests) {
      await settle(PENDING_KEY, pending, request.id, { status: 'rejected', error: ACCOUNT_CHANGED_MESSAGE });
    }
    return requests;
  });
  await closeWindows(rejected);
  return rejected.map((request) => request.id);
}

/**
 * Reject every pending request older than `APPROVAL_TTL_MS` as of `now`, and
 * drop results that old which nobody polled. Returns the ids it expired. (A
 * request past its shorter page deadline but younger than the TTL stays until
 * Approve refuses it or this catches it; either way it cannot be fulfilled.)
 */
export async function expirePending(now = Date.now()): Promise<string[]> {
  return withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const stale = Object.values(pending).filter((request) => now - request.createdAt >= APPROVAL_TTL_MS);
    for (const request of stale) {
      await settle(PENDING_KEY, pending, request.id, { status: 'rejected', error: 'Approval expired' }, now);
    }

    const results = await readMap<StoredResult>(RESULT_KEY);
    let dropped = false;
    for (const [id, stored] of Object.entries(results)) {
      if (now - stored.settledAt >= APPROVAL_TTL_MS) {
        delete results[id];
        dropped = true;
      }
    }
    if (dropped) await writeMap(RESULT_KEY, results);

    return stale.map((request) => request.id);
  });
}

/** Lock and clear: nothing queued before may be approved after. Claimed requests finish on their own. */
export async function rejectAll(reason: string): Promise<void> {
  await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    for (const id of Object.keys(pending)) {
      await settle(PENDING_KEY, pending, id, { status: 'rejected', error: reason });
    }
  });
}

/**
 * Wire the browser events that end an approval without the user answering it.
 * Called synchronously at worker start so Chrome wakes the worker for them.
 */
export function installApprovalLifecycle(): void {
  chrome.windows.onRemoved.addListener((windowId) => {
    void onWindowRemoved(windowId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void origins.forget(tabId);
    void onTabRemoved(tabId);
  });
}
