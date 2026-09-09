/// <reference types="chrome" />

import { isDappMessageType, WALLET_CHANNEL } from '../lib/messages';

const script = document.createElement('script');
script.src = chrome.runtime.getURL('src/content/injected.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

function keepAlive(): void {
  const port = chrome.runtime.connect({ name: 'lumen-keepalive' });
  port.onDisconnect.addListener(() => keepAlive());
}
keepAlive();

function reply(
  id: number,
  payload: { response?: unknown; error?: string }
): void {
  window.postMessage({ channel: WALLET_CHANNEL, id, ...payload }, window.location.origin);
}

async function awaitApproval(pendingId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 600; i += 1) {
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Request timeout');
}

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
    const response = await chrome.runtime.sendMessage({
      type: event.data.type,
      ...event.data.payload,
      origin: window.location.origin,
    }) as { success?: boolean; pendingId?: string; error?: string } | undefined;

    if (!response) {
      throw new Error('No response from Lumen');
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
