import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installChromeStub, STUB_EXTENSION_ID, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import {
  APPROVAL_TTL_MS,
  enqueueApproval,
  expirePending,
  getApprovalResult,
  getPending,
  onWindowRemoved,
  rejectAll,
  rejectApproval,
  resolveApproval,
} from './approvals';
import { withLock } from './session-store';

let chromeStub: ChromeStub;

beforeEach(() => {
  chromeStub = installChromeStub();
});

afterEach(() => {
  uninstallChromeStub();
});

const A = 'https://a.example';
const B = 'https://b.example';

type StoredPending = { origin: string; windowId?: number; createdAt: number };

function pendingMap(): Record<string, StoredPending> {
  return (chromeStub.storage.session.snapshot().cinder_pending as Record<string, StoredPending>) ?? {};
}

function resultMap(): Record<string, unknown> {
  return (chromeStub.storage.session.snapshot().cinder_approval_results as Record<string, unknown>) ?? {};
}

describe('enqueueApproval', () => {
  it('opens the approval window and records its id on the pending request', async () => {
    const id = await enqueueApproval('connect', A);
    const [window] = chromeStub.windows.created();
    expect(window?.options).toMatchObject({
      url: `chrome-extension://${STUB_EXTENSION_ID}/approve.html?id=${encodeURIComponent(id)}`,
      type: 'popup',
    });
    expect(await getPending(id)).toMatchObject({ id, kind: 'connect', origin: A, windowId: window.id });
    expect(pendingMap()[id]?.windowId).toBe(window.id);
    expect(chromeStub.storage.local.snapshot()).toEqual({});
  });

  it('allows one pending request per origin', async () => {
    await enqueueApproval('connect', A);
    await expect(enqueueApproval('signMessage', A, { messageBytes: [1] })).rejects.toThrow(
      'A request is already pending for this site',
    );
    expect(chromeStub.windows.created()).toHaveLength(1);
    // Another site is unaffected, and A may ask again once its request settles.
    await enqueueApproval('connect', B);
    expect(chromeStub.windows.created()).toHaveLength(2);
  });

  it('does not let two concurrent requests from one origin both open a window', async () => {
    const results = await Promise.allSettled([enqueueApproval('connect', A), enqueueApproval('connect', A)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(chromeStub.windows.created()).toHaveLength(1);
  });

  it('throws rather than using local storage when session storage is missing', async () => {
    delete (chromeStub.storage as { session?: unknown }).session;
    await expect(enqueueApproval('connect', A)).rejects.toThrow('Session storage unavailable');
    expect(chromeStub.windows.created()).toEqual([]);
    expect(chromeStub.storage.local.snapshot()).toEqual({});
  });
});

describe('results', () => {
  it('delivers a result once, then forgets it', async () => {
    const id = await enqueueApproval('connect', A);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });
    await resolveApproval(id, { connected: true });
    expect(pendingMap()).toEqual({});
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'approved', value: { connected: true } });
    expect(resultMap()).toEqual({});
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'unknown' });
  });

  it('cannot resolve or reject a request twice', async () => {
    const id = await enqueueApproval('connect', A);
    await rejectApproval(id, 'nope');
    await expect(resolveApproval(id, {})).rejects.toThrow('Approval expired');
    await expect(rejectApproval(id)).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'rejected', error: 'nope' });
  });

  it('answers unknown for an id it never saw', async () => {
    await expect(getApprovalResult('nope')).resolves.toEqual({ status: 'unknown' });
  });
});

describe('onWindowRemoved', () => {
  it('rejects the request whose window closed while still pending', async () => {
    const id = await enqueueApproval('connect', A);
    const [window] = chromeStub.windows.created();
    await onWindowRemoved(window.id);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'rejected', error: 'Approval window closed' });
    expect(pendingMap()).toEqual({});
  });

  it('is a no-op after Approve resolved (Approve closes its own window)', async () => {
    const id = await enqueueApproval('connect', A);
    const [window] = chromeStub.windows.created();
    await resolveApproval(id, { connected: true });
    await onWindowRemoved(window.id);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'approved', value: { connected: true } });
  });

  it('ignores unrelated windows', async () => {
    const id = await enqueueApproval('connect', A);
    await onWindowRemoved(12345);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });
  });
});

describe('expirePending', () => {
  it('rejects requests older than the TTL and leaves younger ones', async () => {
    const old = await enqueueApproval('connect', A);
    const fresh = await enqueueApproval('connect', B);
    const createdAt = (await getPending(old))!.createdAt;
    // Both were created within the same millisecond; age the first one explicitly.
    const map = pendingMap();
    map[old].createdAt = createdAt - 1000;
    await chromeStub.storage.session.set({ cinder_pending: map });
    const expired = await expirePending(createdAt - 1000 + APPROVAL_TTL_MS);
    expect(expired).toEqual([old]);
    await expect(getApprovalResult(old)).resolves.toEqual({ status: 'rejected', error: 'Approval expired' });
    await expect(getApprovalResult(fresh)).resolves.toEqual({ status: 'pending' });
  });

  it('does nothing when nothing is old enough', async () => {
    const id = await enqueueApproval('connect', A);
    expect(await expirePending()).toEqual([]);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });
  });
});

describe('rejectAll', () => {
  it('rejects every pending request with the given reason', async () => {
    const a = await enqueueApproval('connect', A);
    const b = await enqueueApproval('signMessage', B, { messageBytes: [1] });
    await rejectAll('Wallet locked');
    expect(pendingMap()).toEqual({});
    await expect(getApprovalResult(a)).resolves.toEqual({ status: 'rejected', error: 'Wallet locked' });
    await expect(getApprovalResult(b)).resolves.toEqual({ status: 'rejected', error: 'Wallet locked' });
    // The sites may ask again straight away.
    await enqueueApproval('connect', A);
  });
});

describe('withLock', () => {
  it('runs callers for one key in order and keeps going after a rejection', async () => {
    const order: string[] = [];
    const first = withLock('k', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('first');
      throw new Error('boom');
    });
    const second = withLock('k', async () => {
      order.push('second');
      return 2;
    });
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(['first', 'second']);
  });

  it('does not serialise different keys', async () => {
    let release: () => void = () => {};
    const blocked = withLock('slow', () => new Promise<void>((resolve) => { release = resolve; }));
    await expect(withLock('fast', async () => 'ok')).resolves.toBe('ok');
    release();
    await blocked;
  });
});
