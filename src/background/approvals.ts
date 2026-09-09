import type { ApprovalKind, PendingApproval } from '../lib/messages';

const SESSION_PENDING_KEY = 'cinder_pending';
const SESSION_RESULT_KEY = 'cinder_approval_results';

export type ApprovalResult =
  | { status: 'pending' }
  | { status: 'approved'; value: Record<string, unknown> }
  | { status: 'rejected'; error: string }
  | { status: 'unknown' };

const pending = new Map<string, PendingApproval>();

function id(): string {
  return crypto.randomUUID();
}

function store() {
  return chrome.storage.session ?? chrome.storage.local;
}

async function readMap<T>(key: string): Promise<Record<string, T>> {
  const data = await store().get(key);
  return (data[key] as Record<string, T> | undefined) ?? {};
}

async function writeMap<T>(key: string, map: Record<string, T>): Promise<void> {
  await store().set({ [key]: map });
}

async function persist(request: PendingApproval): Promise<void> {
  const map = await readMap<PendingApproval>(SESSION_PENDING_KEY);
  map[request.id] = request;
  await writeMap(SESSION_PENDING_KEY, map);
}

async function unpersist(requestId: string): Promise<void> {
  const map = await readMap<PendingApproval>(SESSION_PENDING_KEY);
  delete map[requestId];
  await writeMap(SESSION_PENDING_KEY, map);
}

async function persistResult(requestId: string, result: ApprovalResult): Promise<void> {
  const map = await readMap<ApprovalResult>(SESSION_RESULT_KEY);
  map[requestId] = result;
  await writeMap(SESSION_RESULT_KEY, map);
}

export async function enqueueApproval(
  kind: ApprovalKind,
  origin: string,
  extra: Partial<PendingApproval> = {}
): Promise<string> {
  const request: PendingApproval = {
    id: id(),
    kind,
    origin,
    createdAt: Date.now(),
    ...extra,
  };

  pending.set(request.id, request);
  await persist(request);

  const url = chrome.runtime.getURL(`approve.html?id=${encodeURIComponent(request.id)}`);
  await chrome.windows.create({
    url,
    type: 'popup',
    width: 400,
    height: 680,
    focused: true,
  });

  return request.id;
}

export async function getPending(requestId: string): Promise<PendingApproval | null> {
  return pending.get(requestId) ?? (await readMap<PendingApproval>(SESSION_PENDING_KEY))[requestId] ?? null;
}

export async function resolveApproval(
  requestId: string,
  value: Record<string, unknown>
): Promise<void> {
  const request = await getPending(requestId);
  if (!request) {
    throw new Error('Approval expired — unlock and retry the dApp request');
  }
  pending.delete(requestId);
  await persistResult(requestId, { status: 'approved', value });
  await unpersist(requestId);
}

export async function rejectApproval(requestId: string, reason = 'User rejected'): Promise<void> {
  const request = await getPending(requestId);
  if (!request) {
    throw new Error('Approval expired — unlock and retry the dApp request');
  }
  pending.delete(requestId);
  await persistResult(requestId, { status: 'rejected', error: reason });
  await unpersist(requestId);
}

export async function getApprovalResult(requestId: string): Promise<ApprovalResult> {
  const results = await readMap<ApprovalResult>(SESSION_RESULT_KEY);
  if (results[requestId]) return results[requestId];
  if (await getPending(requestId)) return { status: 'pending' };
  return { status: 'unknown' };
}

export async function openUnlockWindow(): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL('index.html'),
    type: 'popup',
    width: 400,
    height: 680,
    focused: true,
  });
}
