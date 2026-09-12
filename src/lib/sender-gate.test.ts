import { describe, expect, it } from 'vitest';
import { DAP_MESSAGE_TYPES, EXTENSION_MESSAGE_TYPES } from './messages';
import { isExtensionSender, isRequestAllowed, PAGE_ALLOWED_TYPES } from './sender-gate';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const BASE = `chrome-extension://${ID}/`;

const extensionSenders = [
  { origin: `chrome-extension://${ID}`, url: `${BASE}index.html` },
  { origin: `chrome-extension://${ID}`, url: `${BASE}approve.html?id=x` },
  { url: `${BASE}index.html` },
];

const pageSenders = [
  { origin: 'https://evil.example', url: 'https://evil.example/' },
  { origin: 'http://localhost:5174', url: 'http://localhost:5174/' },
  { origin: 'null' },
  {},
  { url: `https://evil.example/chrome-extension://${ID}/` },
  { origin: `chrome-extension://${'z'.repeat(32)}` },
  { origin: 'https://evil.example', url: `${BASE}index.html` },
];

const privileged = EXTENSION_MESSAGE_TYPES.filter((type) => !PAGE_ALLOWED_TYPES.has(type));

describe('sender gate', () => {
  it('has something to protect', () => {
    expect(privileged).toEqual(expect.arrayContaining(['UNLOCK', 'EXPORT_SEED', 'SEND_TRANSFER', 'CLEAR_WALLET', 'APPROVE_REQUEST']));
    expect([...PAGE_ALLOWED_TYPES]).toEqual([...DAP_MESSAGE_TYPES, 'POLL_APPROVAL', 'CANCEL_APPROVAL']);
  });

  it('recognises extension pages, with and without a trailing slash on the base', () => {
    for (const sender of extensionSenders) {
      expect(isExtensionSender(sender, BASE)).toBe(true);
      expect(isExtensionSender(sender, BASE.slice(0, -1))).toBe(true);
    }
    for (const sender of pageSenders) {
      expect(isExtensionSender(sender, BASE)).toBe(false);
    }
  });

  it('refuses every privileged type from a page and allows it from an extension page', () => {
    for (const type of privileged) {
      for (const sender of pageSenders) expect(isRequestAllowed(type, sender, BASE)).toBe(false);
      for (const sender of extensionSenders) expect(isRequestAllowed(type, sender, BASE)).toBe(true);
    }
  });

  it('allows the dApp surface and approval polling from anyone', () => {
    for (const type of PAGE_ALLOWED_TYPES) {
      for (const sender of [...pageSenders, ...extensionSenders]) {
        expect(isRequestAllowed(type, sender, BASE)).toBe(true);
      }
    }
  });
});
