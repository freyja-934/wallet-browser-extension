import { describe, expect, it } from 'vitest';
import { APPROVAL_GRACE_MS, APPROVAL_POLL_MS, awaitApproval, type PollMessage, type PollReply } from './approval-poll';
import { PAGE_TIMEOUT_MS } from './messages';

/** A fake clock the fake sleep advances, so the loop runs on wall-clock time without waiting. */
function harness(reply: (message: PollMessage, at: number) => PollReply | undefined | Promise<PollReply | undefined>) {
  let clock = 1_000_000;
  const sent: { message: PollMessage; at: number }[] = [];
  return {
    sent,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
    deps: {
      send: async (message: PollMessage) => {
        sent.push({ message, at: clock });
        return reply(message, clock);
      },
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    },
  };
}

describe('awaitApproval', () => {
  it('returns the approved value with success once the worker settles it', async () => {
    let polls = 0;
    const h = harness(() => (++polls < 3 ? { status: 'pending' } : { status: 'approved', value: { signature: [1] } }));
    await expect(awaitApproval('id', h.deps)).resolves.toEqual({ success: true, signature: [1] });
    expect(h.sent.map((s) => s.message.type)).toEqual(['POLL_APPROVAL', 'POLL_APPROVAL', 'POLL_APPROVAL']);
  });

  it('throws the rejection reason and never cancels', async () => {
    const h = harness(() => ({ status: 'rejected', error: 'Approval window closed' }));
    await expect(awaitApproval('id', h.deps)).rejects.toThrow('Approval window closed');
    expect(h.sent.some((s) => s.message.type === 'CANCEL_APPROVAL')).toBe(false);
  });

  it('gives up strictly before the page does, cancels once, then throws Request timeout', async () => {
    const h = harness((message) => (message.type === 'POLL_APPROVAL' ? { status: 'pending' } : undefined));
    const started = h.now();
    await expect(awaitApproval('id', h.deps)).rejects.toThrow('Request timeout');
    const cancels = h.sent.filter((s) => s.message.type === 'CANCEL_APPROVAL');
    expect(cancels).toHaveLength(1);
    expect(cancels[0].message.id).toBe('id');
    // The cancel is sent while the page is still listening.
    expect(cancels[0].at - started).toBeLessThan(PAGE_TIMEOUT_MS);
    expect(cancels[0].at - started).toBeGreaterThanOrEqual(PAGE_TIMEOUT_MS - APPROVAL_GRACE_MS);
    // ...and it is the last thing sent: no poll after the deadline.
    expect(h.sent.at(-1)?.message.type).toBe('CANCEL_APPROVAL');
  });

  it('is bound by the wall clock, not a poll count: slow polls do not extend the wait', async () => {
    const h = harness((message) => {
      // Each poll takes 30 s of worker time.
      if (message.type === 'POLL_APPROVAL') h.advance(30_000);
      return { status: 'pending' };
    });
    const started = h.now();
    const deadline = started + PAGE_TIMEOUT_MS - APPROVAL_GRACE_MS;
    await expect(awaitApproval('id', h.deps)).rejects.toThrow('Request timeout');
    const polls = h.sent.filter((s) => s.message.type === 'POLL_APPROVAL');
    // Four 30 s polls, not the 550 a fixed poll count would allow.
    expect(polls.length).toBeLessThan((PAGE_TIMEOUT_MS - APPROVAL_GRACE_MS) / APPROVAL_POLL_MS);
    // No poll starts once the deadline has passed; the cancel follows the last one straight away.
    expect(polls.every((poll) => poll.at < deadline)).toBe(true);
    const cancel = h.sent.find((s) => s.message.type === 'CANCEL_APPROVAL')!;
    expect(cancel.at).toBe(polls.at(-1)!.at + 30_000 + APPROVAL_POLL_MS);
  });

  it('still throws Request timeout when the cancel itself fails', async () => {
    const h = harness((message) => {
      if (message.type === 'CANCEL_APPROVAL') throw new Error('Receiving end does not exist');
      return { status: 'unknown' };
    });
    await expect(awaitApproval('id', h.deps)).rejects.toThrow('Request timeout');
  });
});
