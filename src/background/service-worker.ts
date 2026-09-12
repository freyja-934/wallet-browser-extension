/// <reference types="chrome" />

import './buffer-polyfill';
import { expirePending, onWindowRemoved } from './approvals';
import { installWalletEvents } from './events';
import { registerAutoLock } from './keyring';
import { forget } from './origins';
import { handleMessage } from './router';

registerAutoLock();
installWalletEvents();

// Registered synchronously at worker start so Chrome wakes us for them.
// Closing an approval window rejects the request it showed; a closed tab
// leaves the event delivery registry.
chrome.windows.onRemoved.addListener((windowId) => {
  void onWindowRemoved(windowId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void forget(tabId);
});

// Worker-side backstop for approvals nobody answered or cancelled (5 minutes).
const APPROVALS_SWEEP_ALARM = 'cinder-approvals-sweep';
void chrome.alarms.create(APPROVALS_SWEEP_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === APPROVALS_SWEEP_ALARM) void expirePending();
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
