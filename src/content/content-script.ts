/// <reference types="chrome" />

import { awaitApproval, type PollMessage, type PollReply } from '../lib/approval-poll';
import { buildRuntimeMessage } from '../lib/bridge';
import { isDappMessageType, WALLET_CHANNEL } from '../lib/messages';

// The Wallet Standard provider (`src/content/injected.js`) is a MAIN-world
// content script declared in the manifest, so it runs before any page script
// and nothing is appended to the page's DOM. This isolated-world script only
// bridges its postMessage requests to the service worker.

function reply(
  id: number,
  payload: { response?: unknown; error?: string }
): void {
  window.postMessage({ channel: WALLET_CHANNEL, id, ...payload }, window.location.origin);
}

/** Requests this page is still waiting on; withdrawn if the page goes away. */
const inflight = new Set<string>();

const sendToWorker = (message: PollMessage) =>
  chrome.runtime.sendMessage(message) as Promise<PollReply | undefined>;

/**
 * Poll until the worker settles the request. The loop lives in
 * `lib/approval-poll` and gives up strictly before the page's own timeout,
 * withdrawing the request so a late Approve in the window cannot sign.
 */
async function waitForApproval(pendingId: string): Promise<Record<string, unknown>> {
  inflight.add(pendingId);
  try {
    return await awaitApproval(pendingId, { send: sendToWorker });
  } finally {
    inflight.delete(pendingId);
  }
}

// The page is navigating away or closing: nobody will read the answer, so
// withdraw what is pending and let the worker close the approval windows.
window.addEventListener('pagehide', () => {
  for (const id of inflight) {
    try {
      void sendToWorker({ type: 'CANCEL_APPROVAL', id }).catch(() => undefined);
    } catch {
      /* extension context gone */
    }
  }
  inflight.clear();
});

interface WalletEventMessage {
  type?: unknown;
  event?: unknown;
  origin?: unknown;
  accounts?: unknown;
  cluster?: unknown;
}

// Worker-to-page events. Only this origin's events are forwarded, and the post
// carries no `id` and no `type`, so neither bridge filter mistakes it for a reply.
chrome.runtime.onMessage.addListener((message: WalletEventMessage) => {
  if (message?.type !== 'WALLET_EVENT') return;
  if (message.origin !== window.location.origin) return;
  if (typeof message.event !== 'string') return;
  window.postMessage(
    {
      channel: WALLET_CHANNEL,
      event: message.event,
      accounts: Array.isArray(message.accounts) ? message.accounts : [],
      cluster: typeof message.cluster === 'string' ? message.cluster : undefined,
    },
    window.location.origin
  );
});

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (event.data?.channel !== WALLET_CHANNEL) return;
  if (typeof event.data.id !== 'number') return;
  // Ignore our own response/error posts so we don't echo "Unknown message type".
  if (event.data.response !== undefined || event.data.error !== undefined) return;
  if (!isDappMessageType(event.data.type)) {
    reply(event.data.id, { error: 'Unknown message type' });
    return;
  }

  try {
    // Copy only the fields this dApp type accepts. Never spread the page's
    // payload: it could override `type` and reach popup-only handlers.
    const request = buildRuntimeMessage(event.data.type, event.data.payload, window.location.origin);
    const response = await chrome.runtime.sendMessage(request) as
      | { success?: boolean; pendingId?: string; error?: string }
      | undefined;

    if (!response) {
      throw new Error('No response from Cinder Wallet');
    }
    if (response.pendingId) {
      reply(event.data.id, { response: await waitForApproval(response.pendingId) });
      return;
    }
    reply(event.data.id, { response });
  } catch (error) {
    reply(event.data.id, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
