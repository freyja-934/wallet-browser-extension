import { DAPP_MESSAGE_TYPES } from './messages';

/** Message types a content script (any web page) may send. Everything else is popup / approval only. */
export const PAGE_ALLOWED_TYPES: ReadonlySet<string> = new Set([
  ...DAPP_MESSAGE_TYPES,
  'POLL_APPROVAL',
  'CANCEL_APPROVAL',
]);

/** The parts of `chrome.runtime.MessageSender` the worker reads; the real one is assignable. */
export interface SenderLike {
  origin?: string;
  url?: string;
  tab?: { id?: number };
  frameId?: number;
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

/** A well-formed `http:` / `https:` origin and nothing more: no path, no `null`, no other scheme. */
function isWebOrigin(candidate: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return parsed.origin === candidate;
}

/**
 * The origin a page message is bound to, or `null` when the sender cannot be
 * trusted with a grant. `sender.origin` wins when present and must be a web
 * origin: an opaque origin (`"null"`, a sandboxed frame), an empty string, a
 * full URL or another extension all fail closed. Only when the browser gave no
 * `origin` at all does `sender.url` stand in, reduced to its origin so `/app`
 * and `/other` on one site share one grant.
 */
export function pageOrigin(sender: SenderLike): string | null {
  if (sender.origin !== undefined) {
    return isWebOrigin(sender.origin) ? sender.origin : null;
  }
  if (typeof sender.url !== 'string') return null;
  let origin: string;
  try {
    origin = new URL(sender.url).origin;
  } catch {
    return null;
  }
  return isWebOrigin(origin) ? origin : null;
}
