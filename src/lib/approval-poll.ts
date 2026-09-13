import { PAGE_TIMEOUT_MS } from './messages';

/**
 * The content script's side of an approval: poll the worker until the request
 * settles, and give up strictly before the page's own `PAGE_TIMEOUT_MS` so the
 * request is withdrawn while the page is still listening. Pure apart from the
 * injected `send`, clock and sleep, so a unit test can drive it without waiting.
 */

export const APPROVAL_POLL_MS = 200;
/** How much earlier than the page the content script gives up. */
export const APPROVAL_GRACE_MS = 10_000;

export interface PollMessage {
  type: 'POLL_APPROVAL' | 'CANCEL_APPROVAL';
  id: string;
}

export interface PollReply {
  status?: string;
  value?: Record<string, unknown>;
  error?: string;
}

export interface PollDeps {
  send: (message: PollMessage) => Promise<PollReply | undefined>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolve with the approved value (plus `success: true`), or throw the rejection
 * reason. Past `now() + PAGE_TIMEOUT_MS - APPROVAL_GRACE_MS` on the wall clock —
 * not after a fixed number of polls, since a poll can itself take a long time —
 * send `CANCEL_APPROVAL` so a late Approve cannot sign, then throw `Request timeout`.
 */
export async function awaitApproval(pendingId: string, deps: PollDeps): Promise<Record<string, unknown>> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = now() + PAGE_TIMEOUT_MS - APPROVAL_GRACE_MS;

  while (now() < deadline) {
    const poll = await deps.send({ type: 'POLL_APPROVAL', id: pendingId });
    if (poll?.status === 'approved') {
      return { success: true, ...(poll.value ?? {}) };
    }
    if (poll?.status === 'rejected') {
      throw new Error(poll.error || 'User rejected');
    }
    await sleep(APPROVAL_POLL_MS);
  }

  try {
    await deps.send({ type: 'CANCEL_APPROVAL', id: pendingId });
  } catch {
    /* worker gone; the request expires on its own */
  }
  throw new Error('Request timeout');
}
