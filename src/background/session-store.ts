/**
 * `chrome.storage.session` access for the worker, and a per-key promise queue so
 * read-modify-write cycles on one stored map never interleave.
 *
 * There is deliberately no `chrome.storage.local` fallback: session data (the
 * decrypted seed, pending approvals, the tab registry) must never touch disk.
 */

export function sessionArea(): chrome.storage.StorageArea {
  const area = (globalThis as { chrome?: typeof chrome }).chrome?.storage?.session;
  if (!area) throw new Error('Session storage unavailable');
  return area;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after every earlier `withLock` call for the same `key` has settled.
 * A rejected `fn` rejects its caller only; the queue keeps moving.
 */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  queues.set(key, next);
  next
    .catch(() => undefined)
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  return next;
}
