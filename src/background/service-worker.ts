/// <reference types="chrome" />

import './buffer-polyfill';
import { expirePending, installApprovalLifecycle } from './approvals';
import { installWalletEvents } from './events';
import { registerAutoLock } from './keyring';
import { handleMessage } from './router';

registerAutoLock();
installWalletEvents();

// Registered synchronously at worker start so Chrome wakes us for them.
// Closing an approval window rejects the request it showed; a closed tab
// rejects its requests, closes their windows, and leaves the delivery registry.
installApprovalLifecycle();

// Worker-side backstop for approvals nobody answered or cancelled (5 minutes).
// Alarms outlive the worker, so only create it when it is not already there:
// re-creating on every wake would reset the period each time.
const APPROVALS_SWEEP_ALARM = 'cinder-approvals-sweep';
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === APPROVALS_SWEEP_ALARM) void expirePending();
});
void (async () => {
  const existing = (await chrome.alarms.get(APPROVALS_SWEEP_ALARM)) as chrome.alarms.Alarm | undefined;
  if (!existing) await chrome.alarms.create(APPROVALS_SWEEP_ALARM, { periodInMinutes: 1 });
})();

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
