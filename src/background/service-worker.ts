/// <reference types="chrome" />

import './buffer-polyfill';
import { registerAutoLock } from './keyring';
import { handleMessage } from './router';

registerAutoLock();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'lumen-keepalive') return;
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
  });
});

// Registered synchronously at worker start so Chrome wakes us for them.
// SHIP-5 fills these (approval window close, connected-tab teardown).
chrome.windows.onRemoved.addListener(() => {
  // SHIP-5 fills these
});
chrome.tabs.onRemoved.addListener(() => {
  // SHIP-5 fills these
});

/** `chrome-extension://<id>/`, the base every popup and approval page loads from. */
const EXTENSION_BASE = chrome.runtime.getURL('');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, EXTENSION_BASE).then(
    (result) => sendResponse({ success: true, ...result }),
    (error) =>
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
  );
  return true;
});
