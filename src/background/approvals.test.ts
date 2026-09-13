import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAGE_TIMEOUT_MS } from '../lib/messages';
import { installChromeStub, STUB_EXTENSION_ID, uninstallChromeStub, type ChromeStub } from '../test/chrome-stub';
import {
  APPROVAL_TTL_MS,
  cancelApproval,
  claimApproval,
  enqueueApproval,
  expirePending,
  getApprovalResult,
  getPending,
  installApprovalLifecycle,
  onCluster,
  onTabRemoved,
  onWindowRemoved,
  rejectAll,
  rejectApproval,
  rejectForClusterChange,
  rejectForOrigin,
  settleClaimed,
} from './approvals';
import * as origins from './origins';
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

type StoredPending = { origin: string; windowId?: number; createdAt: number; deadline: number; tabId?: number };

function pendingMap(): Record<string, StoredPending> {
  return (chromeStub.storage.session.snapshot().cinder_pending as Record<string, StoredPending>) ?? {};
}

function inflightMap(): Record<string, StoredPending> {
  return (chromeStub.storage.session.snapshot().cinder_inflight as Record<string, StoredPending>) ?? {};
}

function resultMap(): Record<string, { origin: string; settledAt: number }> {
  return (chromeStub.storage.session.snapshot().cinder_approval_results as Record<string, { origin: string; settledAt: number }>) ?? {};
}

/** Rewrite one pending entry's timestamps in place, as if it had been created earlier. */
async function ageRequest(id: string, patch: Partial<StoredPending>): Promise<void> {
  const map = pendingMap();
  map[id] = { ...map[id], ...patch };
  await chromeStub.storage.session.set({ cinder_pending: map });
}

describe('enqueueApproval', () => {
  it('opens the approval window and records its id, the deadline and the tab on the pending request', async () => {
    const before = Date.now();
    const id = await enqueueApproval('connect', A, { tabId: 7, frameId: 0 });
    const [window] = chromeStub.windows.created();
    expect(window?.options).toMatchObject({
      url: `chrome-extension://${STUB_EXTENSION_ID}/approve.html?id=${encodeURIComponent(id)}`,
      type: 'popup',
    });
    const pending = await getPending(id);
    expect(pending).toMatchObject({ id, kind: 'connect', origin: A, windowId: window.id, tabId: 7, frameId: 0 });
    expect(pending!.createdAt).toBeGreaterThanOrEqual(before);
    expect(pending!.deadline).toBe(pending!.createdAt + PAGE_TIMEOUT_MS);
    expect(pendingMap()[id]?.windowId).toBe(window.id);
    expect(chromeStub.storage.local.snapshot()).toEqual({});
  });

  it('allows one pending request per origin', async () => {
    await enqueueApproval('connect', A);
    await expect(enqueueApproval('signMessage', A, { messages: [[1]] })).rejects.toThrow(
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

  it('writes the pending record before opening the window, so a failed write opens nothing', async () => {
    // The window sees its own request already stored.
    const create = chromeStub.windows.create;
    let storedWhenOpened: StoredPending | undefined;
    chromeStub.windows.create = async (options) => {
      storedWhenOpened = Object.values(pendingMap())[0];
      return create(options);
    };
    const id = await enqueueApproval('connect', A, { tabId: 7 });
    expect(storedWhenOpened).toMatchObject({ origin: A, tabId: 7 });
    expect(storedWhenOpened?.windowId).toBeUndefined();
    expect(pendingMap()[id]?.windowId).toBe(chromeStub.windows.created()[0].id);

    // A write that fails: no window.
    chromeStub.windows.create = create;
    const set = chromeStub.storage.session.set;
    chromeStub.storage.session.set = async () => {
      throw new Error('QUOTA_BYTES exceeded');
    };
    await expect(enqueueApproval('connect', B)).rejects.toThrow('QUOTA_BYTES exceeded');
    chromeStub.storage.session.set = set;
    expect(chromeStub.windows.created()).toHaveLength(1);
    expect(Object.values(pendingMap()).map((request) => request.origin)).toEqual([A]);
  });

  it('a window that fails to open leaves no record behind', async () => {
    chromeStub.windows.create = async () => {
      throw new Error('No current window');
    };
    await expect(enqueueApproval('connect', A)).rejects.toThrow('No current window');
    expect(pendingMap()).toEqual({});
    // The origin may ask again once the browser can open windows.
    chromeStub.windows.create = async () => ({ id: 1 });
    await expect(enqueueApproval('connect', A)).resolves.toEqual(expect.any(String));
  });
});

describe('onCluster / rejectForClusterChange', () => {
  it('a transaction request follows the chain it named, else the cluster it was enqueued on', () => {
    const base = { id: 'x', origin: A, createdAt: 0, deadline: 1 };
    const sign = { ...base, kind: 'signTransaction' as const, transactions: [[1]] };
    expect(onCluster({ ...sign, chain: 'solana:mainnet' }, 'mainnet-beta')).toBe(true);
    expect(onCluster({ ...sign, chain: 'solana:mainnet' }, 'devnet')).toBe(false);
    expect(onCluster({ ...sign, clusterAtEnqueue: 'devnet' }, 'devnet')).toBe(true);
    expect(onCluster({ ...sign, clusterAtEnqueue: 'devnet' }, 'mainnet-beta')).toBe(false);
    // The chain wins over the enqueue cluster when both are present.
    expect(onCluster({ ...sign, chain: 'solana:devnet', clusterAtEnqueue: 'mainnet-beta' }, 'devnet')).toBe(true);
    // A record from before the field existed is not rejected.
    expect(onCluster(sign, 'devnet')).toBe(true);
    expect(onCluster({ ...sign, kind: 'signAndSendTransaction', clusterAtEnqueue: 'mainnet-beta' }, 'devnet')).toBe(false);
    // Connect and message requests are not chain-bound.
    expect(onCluster({ ...base, kind: 'connect' }, 'devnet')).toBe(true);
    expect(onCluster({ ...base, kind: 'signMessage', messages: [[1]], clusterAtEnqueue: 'mainnet-beta' }, 'devnet')).toBe(true);
  });

  it('rejects the pending transaction requests built for another cluster and closes their windows', async () => {
    const byChain = await enqueueApproval('signTransaction', A, { transactions: [[1]], chain: 'solana:mainnet' });
    const byEnqueue = await enqueueApproval('signAndSendTransaction', B, { transactions: [[1]], clusterAtEnqueue: 'mainnet-beta' });
    const message = await enqueueApproval('signMessage', 'https://c.example', { messages: [[1]], clusterAtEnqueue: 'mainnet-beta' });
    const connect = await enqueueApproval('connect', 'https://d.example');
    const [chainWindow, enqueueWindow] = chromeStub.windows.created();

    expect(await rejectForClusterChange('devnet')).toEqual([byChain, byEnqueue]);
    await expect(getApprovalResult(byChain)).resolves.toEqual({ status: 'rejected', error: 'Network changed' });
    await expect(getApprovalResult(byEnqueue)).resolves.toEqual({ status: 'rejected', error: 'Network changed' });
    await expect(getApprovalResult(message)).resolves.toEqual({ status: 'pending' });
    await expect(getApprovalResult(connect)).resolves.toEqual({ status: 'pending' });
    expect(chromeStub.windows.removed()).toEqual([chainWindow.id, enqueueWindow.id]);
    // Switching back changes nothing that is still pending.
    expect(await rejectForClusterChange('mainnet-beta')).toEqual([]);
  });

  it('leaves a claimed request alone', async () => {
    const id = await enqueueApproval('signTransaction', A, { transactions: [[1]], chain: 'solana:mainnet' });
    await claimApproval(id);
    expect(await rejectForClusterChange('devnet')).toEqual([]);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });
  });
});

describe('claimApproval / settleClaimed', () => {
  it('moves a pending request to inflight, where nothing but settleClaimed can end it', async () => {
    const id = await enqueueApproval('signMessage', A, { messages: [[1]], tabId: 7 });
    const [window] = chromeStub.windows.created();
    const claimed = await claimApproval(id);
    expect(claimed).toMatchObject({ id, kind: 'signMessage', origin: A });
    expect(pendingMap()).toEqual({});
    expect(inflightMap()[id]).toMatchObject({ origin: A });
    expect(await getPending(id)).toBeNull();
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });

    // Every other way of ending a request ignores it.
    await expect(rejectApproval(id)).rejects.toThrow('Approval expired');
    await cancelApproval(id, A);
    await onWindowRemoved(window.id);
    await onTabRemoved(7);
    await rejectForOrigin(A, 'Site revoked');
    await rejectAll('Wallet locked');
    expect(await expirePending(Date.now() + APPROVAL_TTL_MS * 2)).toEqual([]);
    expect(inflightMap()[id]).toMatchObject({ origin: A });
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });
    expect(chromeStub.windows.removed()).toEqual([]);

    await settleClaimed(id, { status: 'approved', value: { signature: [9] } });
    expect(inflightMap()).toEqual({});
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'approved', value: { signature: [9] } });
  });

  it('can be claimed once only', async () => {
    const id = await enqueueApproval('connect', A);
    await claimApproval(id);
    await expect(claimApproval(id)).rejects.toThrow('Approval expired');
    await expect(settleClaimed(id, { status: 'approved', value: {} })).resolves.toBeUndefined();
    await expect(settleClaimed(id, { status: 'approved', value: {} })).rejects.toThrow('Approval expired');
    await expect(claimApproval(id)).rejects.toThrow('Approval expired');
  });

  it('records a fulfilment failure as rejected so the request can never be approved later', async () => {
    const id = await enqueueApproval('signMessage', A, { messages: [[1]] });
    await claimApproval(id);
    await settleClaimed(id, { status: 'rejected', error: 'Broadcast failed' });
    await expect(claimApproval(id)).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'rejected', error: 'Broadcast failed' });
  });

  it('refuses a request past its page deadline and settles it as expired', async () => {
    const id = await enqueueApproval('connect', A);
    const { createdAt, deadline } = (await getPending(id))!;
    await expect(claimApproval(id, { now: deadline })).resolves.toMatchObject({ id });
    // Fresh request, same deadline arithmetic, one millisecond too late.
    const late = await enqueueApproval('connect', B);
    await ageRequest(late, { createdAt, deadline });
    await expect(claimApproval(late, { now: deadline + 1 })).rejects.toThrow('Approval expired');
    expect(pendingMap()).toEqual({});
    expect(inflightMap()[late]).toBeUndefined();
    await expect(getApprovalResult(late)).resolves.toEqual({ status: 'rejected', error: 'Approval expired' });
  });

  it('refuses a request older than the TTL even with a forged deadline', async () => {
    const id = await enqueueApproval('connect', A);
    const { createdAt } = (await getPending(id))!;
    await ageRequest(id, { deadline: createdAt + APPROVAL_TTL_MS * 10 });
    await expect(claimApproval(id, { now: createdAt + APPROVAL_TTL_MS })).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'rejected', error: 'Approval expired' });
  });

  it("with origin, a page may only claim its own request", async () => {
    const id = await enqueueApproval('connect', A);
    await expect(claimApproval(id, { origin: B })).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });
    await expect(claimApproval(id, { origin: A })).resolves.toMatchObject({ id });
  });

  it('with requireConnected, a sign request needs a still-connected site; connect never does', async () => {
    const connect = await enqueueApproval('connect', A);
    await expect(claimApproval(connect, { requireConnected: true })).resolves.toMatchObject({ kind: 'connect' });

    const sign = await enqueueApproval('signMessage', B, { messages: [[1]] });
    await expect(claimApproval(sign, { requireConnected: true })).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(sign)).resolves.toEqual({ status: 'rejected', error: 'Not connected' });

    await origins.connect(B, [0]);
    const again = await enqueueApproval('signMessage', B, { messages: [[1]] });
    await expect(claimApproval(again, { requireConnected: true })).resolves.toMatchObject({ id: again });
  });
});

describe('results', () => {
  it('delivers a result once, then forgets it', async () => {
    const id = await enqueueApproval('connect', A);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });
    await claimApproval(id);
    await settleClaimed(id, { status: 'approved', value: { connected: true } });
    expect(pendingMap()).toEqual({});
    expect(resultMap()[id]).toMatchObject({ origin: A, settledAt: expect.any(Number) });
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'approved', value: { connected: true } });
    expect(resultMap()).toEqual({});
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'unknown' });
  });

  it('cannot reject a request twice, or claim it after a rejection', async () => {
    const id = await enqueueApproval('connect', A);
    await rejectApproval(id, 'nope');
    await expect(claimApproval(id)).rejects.toThrow('Approval expired');
    await expect(rejectApproval(id)).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'rejected', error: 'nope' });
  });

  it('answers unknown for an id it never saw, whoever asks', async () => {
    await expect(getApprovalResult('nope')).resolves.toEqual({ status: 'unknown' });
    await expect(getApprovalResult('nope', A)).resolves.toEqual({ status: 'unknown' });
  });

  it('with origin, a page may only poll its own request, pending or settled', async () => {
    const id = await enqueueApproval('connect', A);
    await expect(getApprovalResult(id, B)).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(id, A)).resolves.toEqual({ status: 'pending' });
    await claimApproval(id);
    await expect(getApprovalResult(id, B)).rejects.toThrow('Approval expired');
    await settleClaimed(id, { status: 'approved', value: { connected: true } });
    await expect(getApprovalResult(id, B)).rejects.toThrow('Approval expired');
    // The mismatch did not consume it.
    await expect(getApprovalResult(id, A)).resolves.toEqual({ status: 'approved', value: { connected: true } });
  });
});

describe('cancelApproval', () => {
  it("rejects the page's own pending request as a timeout and closes its window", async () => {
    const id = await enqueueApproval('connect', A);
    const [window] = chromeStub.windows.created();
    await cancelApproval(id, A);
    await expect(getApprovalResult(id, A)).resolves.toEqual({ status: 'rejected', error: 'Request timeout' });
    expect(chromeStub.windows.removed()).toEqual([window.id]);
  });

  it("refuses another origin's request, pending or settled, and leaves it be", async () => {
    const id = await enqueueApproval('connect', A);
    await expect(cancelApproval(id, B)).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(id, A)).resolves.toEqual({ status: 'pending' });
    expect(chromeStub.windows.removed()).toEqual([]);
    await rejectApproval(id, 'nope');
    await expect(cancelApproval(id, B)).rejects.toThrow('Approval expired');
    await expect(getApprovalResult(id, A)).resolves.toEqual({ status: 'rejected', error: 'nope' });
  });

  it('is a no-op for an own request already settled, and for an unknown id', async () => {
    const id = await enqueueApproval('connect', A);
    await rejectApproval(id, 'nope');
    await expect(cancelApproval(id, A)).resolves.toBeUndefined();
    await expect(cancelApproval('nope', A)).resolves.toBeUndefined();
    await expect(getApprovalResult(id, A)).resolves.toEqual({ status: 'rejected', error: 'nope' });
    expect(chromeStub.windows.removed()).toEqual([]);
  });

  it('survives a window that is already gone', async () => {
    const id = await enqueueApproval('connect', A);
    const [window] = chromeStub.windows.created();
    await chromeStub.windows.remove(window.id);
    await expect(cancelApproval(id, A)).resolves.toBeUndefined();
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'rejected', error: 'Request timeout' });
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

  it('is a no-op after Approve claimed it (Approve closes its own window)', async () => {
    const id = await enqueueApproval('connect', A);
    const [window] = chromeStub.windows.created();
    await claimApproval(id);
    await onWindowRemoved(window.id);
    await settleClaimed(id, { status: 'approved', value: { connected: true } });
    await onWindowRemoved(window.id);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'approved', value: { connected: true } });
  });

  it('ignores unrelated windows', async () => {
    const id = await enqueueApproval('connect', A);
    await onWindowRemoved(12345);
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'pending' });
  });
});

describe('onTabRemoved', () => {
  it("rejects that tab's pending requests as Page closed and closes their windows", async () => {
    const closing = await enqueueApproval('connect', A, { tabId: 7, frameId: 0 });
    const staying = await enqueueApproval('connect', B, { tabId: 8, frameId: 0 });
    const [closingWindow] = chromeStub.windows.created();
    await onTabRemoved(7);
    await expect(getApprovalResult(closing)).resolves.toEqual({ status: 'rejected', error: 'Page closed' });
    await expect(getApprovalResult(staying)).resolves.toEqual({ status: 'pending' });
    expect(chromeStub.windows.removed()).toEqual([closingWindow.id]);
  });

  it('swallows a window that is already gone and ignores tabs with nothing pending', async () => {
    const id = await enqueueApproval('connect', A, { tabId: 7 });
    const [window] = chromeStub.windows.created();
    await chromeStub.windows.remove(window.id);
    await expect(onTabRemoved(7)).resolves.toBeUndefined();
    await expect(onTabRemoved(99)).resolves.toBeUndefined();
    await expect(getApprovalResult(id)).resolves.toEqual({ status: 'rejected', error: 'Page closed' });
  });

  it('installApprovalLifecycle wires tabs.onRemoved (and forgets the tab) and windows.onRemoved', async () => {
    installApprovalLifecycle();
    await origins.remember({ tab: { id: 7 }, frameId: 0 }, A);
    const byTab = await enqueueApproval('connect', A, { tabId: 7, frameId: 0 });
    const byWindow = await enqueueApproval('connect', B);
    const [, bWindow] = chromeStub.windows.created();

    chromeStub.tabs.onRemoved.emit(7);
    chromeStub.windows.onRemoved.emit(bWindow.id);
    // The listeners are fire-and-forget; let their locked writes finish.
    await withLock('cinder_approvals', async () => undefined);
    await withLock(origins.TABS_KEY, async () => undefined);

    await expect(getApprovalResult(byTab)).resolves.toEqual({ status: 'rejected', error: 'Page closed' });
    await expect(getApprovalResult(byWindow)).resolves.toEqual({ status: 'rejected', error: 'Approval window closed' });
    expect(await origins.tabsFor(A)).toEqual([]);
  });
});

describe('rejectForOrigin', () => {
  it('rejects only that origin’s pending requests with the given reason', async () => {
    const a = await enqueueApproval('signMessage', A, { messages: [[1]] });
    const b = await enqueueApproval('signMessage', B, { messages: [[1]] });
    expect(await rejectForOrigin(A, 'Site revoked')).toEqual([a]);
    await expect(getApprovalResult(a)).resolves.toEqual({ status: 'rejected', error: 'Site revoked' });
    await expect(getApprovalResult(b)).resolves.toEqual({ status: 'pending' });
    expect(await rejectForOrigin(A, 'Site revoked')).toEqual([]);
  });
});

describe('expirePending', () => {
  it('rejects requests older than the TTL and leaves younger ones', async () => {
    const old = await enqueueApproval('connect', A);
    const fresh = await enqueueApproval('connect', B);
    const createdAt = (await getPending(old))!.createdAt;
    // Both were created within the same millisecond; age the first one explicitly.
    await ageRequest(old, { createdAt: createdAt - 1000 });
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

  it('drops a result nobody polled once it is as old as the TTL, and keeps younger ones', async () => {
    const stale = await enqueueApproval('connect', A);
    const recent = await enqueueApproval('connect', B);
    await rejectApproval(stale, 'nope');
    const settledAt = resultMap()[stale].settledAt;
    await claimApproval(recent);
    await settleClaimed(recent, { status: 'approved', value: { connected: true } });
    const results = resultMap();
    results[recent].settledAt = settledAt + 1000;
    await chromeStub.storage.session.set({ cinder_approval_results: results });

    expect(await expirePending(settledAt + APPROVAL_TTL_MS)).toEqual([]);
    await expect(getApprovalResult(stale)).resolves.toEqual({ status: 'unknown' });
    await expect(getApprovalResult(recent)).resolves.toEqual({ status: 'approved', value: { connected: true } });
  });
});

describe('rejectAll', () => {
  it('rejects every pending request with the given reason', async () => {
    const a = await enqueueApproval('connect', A);
    const b = await enqueueApproval('signMessage', B, { messages: [[1]] });
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
