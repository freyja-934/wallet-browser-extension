import { DAP_MESSAGE_TYPES } from './messages';

/** Message types a content script (any web page) may send. Everything else is popup / approval only. */
export const PAGE_ALLOWED_TYPES: ReadonlySet<string> = new Set([...DAP_MESSAGE_TYPES, 'POLL_APPROVAL']);

export interface SenderLike {
  origin?: string;
  url?: string;
}

/**
 * True when a message comes from one of our own extension pages (popup, approval window).
 * `extensionBase` is `chrome.runtime.getURL('')`, i.e. `chrome-extension://<id>/`.
 * The browser sets `sender.origin`; an opaque (`"null"`) or missing origin fails closed.
 */
export function isExtensionSender(sender: SenderLike, extensionBase: string): boolean {
  const origin = extensionBase.endsWith('/') ? extensionBase.slice(0, -1) : extensionBase;
  if (sender.origin) return sender.origin === origin;
  return typeof sender.url === 'string' && sender.url.startsWith(`${origin}/`);
}

/** Extension pages may send anything; web pages only the dApp surface plus approval polling. */
export function isRequestAllowed(type: string, sender: SenderLike, extensionBase: string): boolean {
  return isExtensionSender(sender, extensionBase) || PAGE_ALLOWED_TYPES.has(type);
}
