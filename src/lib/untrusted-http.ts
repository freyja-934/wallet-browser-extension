/**
 * Reading a body this wallet did not author.
 *
 * Two callers, one set of rules. `src/services/jupiter.ts` reads a third party's
 * idea of which mints an address holds; `src/services/collectibles.ts` reads a
 * JSON document at whatever host an NFT's creator wrote into its metadata
 * account — an address no allowlist can anticipate. Both are untrusted HTTP, and
 * the difference between them is only how big and how slow a body is worth
 * waiting for, which is why every limit here is an argument rather than a
 * constant.
 *
 * What this file guarantees: nothing throws, no cookie is sent, no request
 * outlives its timeout, no body is *downloaded* past its cap (not merely parsed
 * past it), and no string taken out of one reaches the interface carrying
 * control codes or bidirectional overrides.
 */

/** Longest name or symbol kept; a hostile response does not get to own the row. */
const TEXT_MAX = 64;

/** Longest URL kept. */
const URL_MAX = 2048;

/**
 * `ipfs.io` answers 403 to an extension origin, so an `ipfs://` URI is rewritten
 * onto Protocol Labs' own public gateway instead.
 */
const IPFS_GATEWAY = 'https://dweb.link/ipfs/';

/**
 * Trimmed, length-capped, and stripped of every Unicode "other" character —
 * control codes, and the bidirectional overrides that would let a returned
 * symbol rewrite the line it is printed on. Empty becomes undefined.
 */
export function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\p{C}/gu, ' ').trim().slice(0, TEXT_MAX).trim();
  return text.length > 0 ? text : undefined;
}

/**
 * A URL safe to hand an `<img src>` or to fetch: https as returned, `ipfs://`
 * rewritten to a gateway. Anything else — `data:`, `javascript:`, `http:`, a
 * relative path, an over-long string — is dropped, and the caller shows a
 * placeholder instead.
 */
export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > URL_MAX) return undefined;
  if (value.startsWith('ipfs://')) {
    const path = value.slice('ipfs://'.length).replace(/^ipfs\//, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9./_-]*$/.test(path)) return undefined;
    // The character class above allows `.` and `/` anywhere after the first
    // character, so `ipfs://a/../../evil.svg` would concatenate cleanly and then
    // normalise to `https://dweb.link/evil.svg` — outside the gateway's
    // content-addressed prefix, at a path the token's author chose. No segment
    // may be a traversal, and none may be empty.
    if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return undefined;
    }
    return `${IPFS_GATEWAY}${path}`;
  }
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** How long one request may take, and how many bytes of it may arrive. */
export interface GuardedFetch {
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
}

/**
 * The body as text, or `undefined` when it is larger than `maxBytes`.
 *
 * A declared `content-length` is the cheap path and is checked before anything is
 * read. A chunked response declares no length, so the body is read through its own
 * reader and the request is aborted the moment the running byte count passes the
 * cap: the guard bounds what the popup downloads and holds, not merely what it
 * parses. A response with no readable stream — a runtime or a test double that
 * only offers `text()` — falls back to the length check it can still make.
 */
export async function textWithinGuard(
  response: Response,
  abort: () => void,
  maxBytes: number,
): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;

  const stream = response.body;
  if (!stream || typeof stream.getReader !== 'function') {
    const text = await response.text();
    return text.length > maxBytes ? undefined : text;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      // Stop the transfer itself, not just the parse.
      void reader.cancel().catch(() => undefined);
      abort();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * One GET of one JSON document, or `undefined`. Never throws, never sends a
 * cookie, never waits past `timeoutMs`, and never downloads or parses a body
 * past `maxBytes`. A refusal, a rejected fetch, an abort, a truncated body and a
 * body that is not JSON at all are one answer: nothing was read.
 */
export async function fetchGuardedJson(url: string, guard: GuardedFetch): Promise<unknown> {
  const { timeoutMs, maxBytes, signal } = guard;
  if (signal?.aborted) return undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort);
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const text = await textWithinGuard(response, abort, maxBytes);
    if (text === undefined) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    // A refusal, a rejected fetch, an abort, a truncated body: all the same answer.
    return undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
