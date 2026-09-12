import type { ApprovalKind, PendingApproval } from '../lib/messages';
import { sessionArea, withLock } from './session-store';

/** Both maps live in `chrome.storage.session`, so a worker restart mid-approval is survivable. */
const PENDING_KEY = 'cinder_pending';
const RESULT_KEY = 'cinder_approval_results';
/** One queue for both maps: every resolve / reject touches both. */
const LOCK = 'cinder_approvals';

/** Worker-side backstop; the page's own 120 s timeout is the binding limit. */
export const APPROVAL_TTL_MS = 5 * 60 * 1000;

export type ApprovalResult =
  | { status: 'pending' }
  | { status: 'approved'; value: Record<string, unknown> }
  | { status: 'rejected'; error: string }
  | { status: 'unknown' };

type PendingMap = Record<string, PendingApproval>;

async function readMap<T>(key: string): Promise<Record<string, T>> {
  const data = await sessionArea().get(key);
  return (data[key] as Record<string, T> | undefined) ?? {};
}

async function writeMap<T>(key: string, map: Record<string, T>): Promise<void> {
  await sessionArea().set({ [key]: map });
}

/** Move `requestId` from pending to results. Caller holds the lock. */
async function settle(pending: PendingMap, requestId: string, result: ApprovalResult): Promise<void> {
  delete pending[requestId];
  const results = await readMap<ApprovalResult>(RESULT_KEY);
  results[requestId] = result;
  await writeMap(PENDING_KEY, pending);
  await writeMap(RESULT_KEY, results);
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

    const request: PendingApproval = {
      id: crypto.randomUUID(),
      kind,
      origin,
      createdAt: Date.now(),
      ...extra,
    };

    const url = chrome.runtime.getURL(`approve.html?id=${encodeURIComponent(request.id)}`);
    const created = await chrome.windows.create({
      url,
      type: 'popup',
      width: 400,
      height: 720,
      focused: true,
    });
    if (typeof created?.id === 'number') request.windowId = created.id;

    pending[request.id] = request;
    await writeMap(PENDING_KEY, pending);
    return request.id;
  });
}

export async function getPending(requestId: string): Promise<PendingApproval | null> {
  return (await readMap<PendingApproval>(PENDING_KEY))[requestId] ?? null;
}

export async function resolveApproval(
  requestId: string,
  value: Record<string, unknown>
): Promise<void> {
  await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    if (!pending[requestId]) {
      throw new Error('Approval expired — unlock and retry the dApp request');
    }
    await settle(pending, requestId, { status: 'approved', value });
  });
}

export async function rejectApproval(requestId: string, reason = 'User rejected'): Promise<void> {
  await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    if (!pending[requestId]) {
      throw new Error('Approval expired — unlock and retry the dApp request');
    }
    await settle(pending, requestId, { status: 'rejected', error: reason });
  });
}

/**
 * One-shot: a delivered result is deleted, so a second poll for the same id
 * answers `unknown` and nothing accumulates in session storage.
 */
export async function getApprovalResult(requestId: string): Promise<ApprovalResult> {
  return withLock(LOCK, async () => {
    const results = await readMap<ApprovalResult>(RESULT_KEY);
    const result = results[requestId];
    if (result) {
      delete results[requestId];
      await writeMap(RESULT_KEY, results);
      return result;
    }
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    return pending[requestId] ? { status: 'pending' } : { status: 'unknown' };
  });
}

/**
 * The approval window went away. Reject the request it was showing, but only
 * if it is still pending: Approve resolves first and then calls `window.close()`.
 */
export async function onWindowRemoved(windowId: number): Promise<void> {
  await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const request = Object.values(pending).find((entry) => entry.windowId === windowId);
    if (!request) return;
    await settle(pending, request.id, { status: 'rejected', error: 'Approval window closed' });
  });
}

/** Reject every request older than `APPROVAL_TTL_MS` as of `now`. Returns the ids it expired. */
export async function expirePending(now = Date.now()): Promise<string[]> {
  return withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    const expired = Object.values(pending).filter((request) => now - request.createdAt >= APPROVAL_TTL_MS);
    for (const request of expired) {
      await settle(pending, request.id, { status: 'rejected', error: 'Approval expired' });
    }
    return expired.map((request) => request.id);
  });
}

/** Lock and clear: nothing queued before may be approved after. */
export async function rejectAll(reason: string): Promise<void> {
  await withLock(LOCK, async () => {
    const pending = await readMap<PendingApproval>(PENDING_KEY);
    for (const id of Object.keys(pending)) {
      await settle(pending, id, { status: 'rejected', error: reason });
    }
  });
}

export async function openUnlockWindow(): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL('index.html'),
    type: 'popup',
    width: 400,
    height: 640,
    focused: true,
  });
}
