/// <reference types="chrome" />

import { buildRuntimeMessage } from '../lib/bridge';
import { isDappMessageType, WALLET_CHANNEL } from '../lib/messages';

const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content/injected.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

function reply(
  id: number,
  payload: { response?: unknown; error?: string }
): void {
  window.postMessage({ channel: WALLET_CHANNEL, id, ...payload }, window.location.origin);
}

/** 600 polls at 200 ms: the 120 s page timeout is the binding limit on an approval. */
const APPROVAL_POLLS = 600;
const APPROVAL_POLL_MS = 200;

async function awaitApproval(pendingId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < APPROVAL_POLLS; i += 1) {
    const poll = await chrome.runtime.sendMessage({ type: 'POLL_APPROVAL', id: pendingId }) as {
      success?: boolean;
      status?: string;
      value?: Record<string, unknown>;
      error?: string;
    };
    if (poll?.status === 'approved') {
      return { success: true, ...(poll.value ?? {}) };
    }
    if (poll?.status === 'rejected') {
      throw new Error(poll.error || 'User rejected');
    }
    await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_MS));
  }
  // Withdraw the request so a late Approve in the window cannot sign or broadcast.
  try {
    await chrome.runtime.sendMessage({ type: 'CANCEL_APPROVAL', id: pendingId });
  } catch {
    /* worker gone; the request expires on its own */
  }
  throw new Error('Request timeout');
}

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
      reply(event.data.id, { response: await awaitApproval(response.pendingId) });
      return;
    }
    reply(event.data.id, { response });
  } catch (error) {
    reply(event.data.id, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
