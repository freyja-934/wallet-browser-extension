import { Connection } from '@solana/web3.js';

const COOLDOWN_MS = 30_000;
const cooldownUntil = new Map<string, number>();

/**
 * What to do with one endpoint's error:
 * - `skip`: this endpoint will not serve this call (auth, missing method). Try the next URL, no cooldown.
 * - `cooldown`: this endpoint is unwell. Rest it for `COOLDOWN_MS` and try the next URL.
 * - `throw`: the request itself is wrong, or the chain rejected it. Every endpoint would say the same;
 *   rethrow at once, no cooldown, no rotation.
 */
export type RpcVerdict = 'skip' | 'cooldown' | 'throw';

/** HTTP statuses that say "not for you" rather than "not now". */
export const SKIP_HTTP_STATUSES: readonly number[] = [401, 403];

/**
 * JSON-RPC codes for a method the endpoint refuses or cannot serve, from
 * web3.js's `SolanaJSONRPCErrorCode`: `-32601` method not found, `-32010`
 * KEY_EXCLUDED_FROM_SECONDARY_INDEX, `-32011` TRANSACTION_HISTORY_NOT_AVAILABLE.
 */
export const SKIP_RPC_CODES: readonly number[] = [-32601, -32010, -32011];

/**
 * JSON-RPC codes about the node's own health, from `SolanaJSONRPCErrorCode`:
 * `-32004` BLOCK_NOT_AVAILABLE, `-32005` NODE_UNHEALTHY, `-32007` SLOT_SKIPPED,
 * `-32009` LONG_TERM_STORAGE_SLOT_SKIPPED, `-32014` BLOCK_STATUS_NOT_AVAILABLE_YET,
 * `-32016` MIN_CONTEXT_SLOT_NOT_REACHED.
 */
export const COOLDOWN_RPC_CODES: readonly number[] = [-32004, -32005, -32007, -32009, -32014, -32016];

/**
 * Providers do not agree on codes for a blocked method, a missing index, or a
 * key-gated call, so the message decides when the code does not. Matches skip.
 */
export const SKIP_RPC_MESSAGE =
  /method (is )?not (found|available|supported|allowed)|not supported|disabled|forbidden|api ?key|rate limit|blocked|indexed|personal token/i;

/**
 * `Connection.getBalance` and `getLatestBlockhash` wrap the JSON-RPC error in a
 * plain `Error` and drop its code, so the node-health texts web3.js itself uses
 * are matched by message as well. Matches cooldown.
 */
export const COOLDOWN_RPC_MESSAGE =
  /node is (unhealthy|behind)|block not available|slot (was )?skipped|minimum context slot has not been reached/i;

export function resetRpcCooldowns(): void {
  cooldownUntil.clear();
}

export function markRpcUnhealthy(url: string, now = Date.now()): void {
  cooldownUntil.set(url, now + COOLDOWN_MS);
}

/** Healthy endpoints first; cooled ones last so we still try them if nothing else works. */
export function prioritizeRpcUrls(urls: string[], now = Date.now()): string[] {
  const healthy = urls.filter((url) => (cooldownUntil.get(url) ?? 0) <= now);
  const resting = urls.filter((url) => (cooldownUntil.get(url) ?? 0) > now);
  return healthy.length > 0 ? [...healthy, ...resting] : [...urls];
}

/** Endpoint trouble: rotate and rest this URL for `COOLDOWN_MS`. */
function isCooldownStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isSkipStatus(status: number): boolean {
  return SKIP_HTTP_STATUSES.includes(status);
}

/** Verdict for a non-2xx HTTP response. Anything outside the two lists is the caller's problem. */
export function classifyHttpStatus(status: number): RpcVerdict {
  if (isSkipStatus(status)) return 'skip';
  if (isCooldownStatus(status)) return 'cooldown';
  return 'throw';
}

/**
 * Verdict for a JSON-RPC error envelope. Code lists first, then the message
 * heuristics; everything else (`-32602` invalid params, `-32002` preflight
 * failure, `-32003` signature verification, ...) throws.
 */
export function classifyJsonRpcError(code: unknown, message: string): RpcVerdict {
  if (typeof code === 'number') {
    if (SKIP_RPC_CODES.includes(code)) return 'skip';
    if (COOLDOWN_RPC_CODES.includes(code)) return 'cooldown';
  }
  if (SKIP_RPC_MESSAGE.test(message)) return 'skip';
  if (COOLDOWN_RPC_MESSAGE.test(message)) return 'cooldown';
  return 'throw';
}

export function makeConnection(url: string): Connection {
  // React Query owns retries; web3.js's own 429 backoff logs console.error and hides latency.
  return new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true });
}

/**
 * `${status} ${statusText}: ${body}` is how web3.js reports a non-2xx response,
 * possibly wrapped in `failed to ...: Error: `. Chrome leaves `statusText` empty
 * on HTTP/2, so the reason phrase is optional: `403 : {...}`.
 */
const WEB3_HTTP_STATUS = /(?:^|: |Error: )(\d{3}) [A-Za-z ]*:/;

/**
 * Classify an error thrown by a web3.js `Connection` call. A `SolanaJSONRPCError`
 * carries the server's code; a wrapped HTTP failure carries the status in its
 * message. Transport errors and anything unreadable cool the URL down; a
 * `TypeError` that is not a transport error is our own bug and throws.
 */
export function classifyConnectionError(error: unknown): RpcVerdict {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  // JSON-RPC codes are negative; a DOMException (AbortError 20, TimeoutError 23) also has a numeric `code`.
  if (typeof code === 'number' && Number.isInteger(code) && code < 0) {
    return classifyJsonRpcError(code, message);
  }
  const status = connectionErrorHttpStatus(error);
  if (status !== undefined) return classifyHttpStatus(status);
  if (SKIP_RPC_MESSAGE.test(message)) return 'skip';
  if (COOLDOWN_RPC_MESSAGE.test(message)) return 'cooldown';
  return classifyThrownError(error);
}

/** The HTTP status behind a failed `Connection` call or `rpcJson` call, when there was one. */
export function connectionErrorHttpStatus(error: unknown): number | undefined {
  const status = error && typeof error === 'object' ? (error as { status?: unknown }).status : undefined;
  if (typeof status === 'number' && status >= 400 && status <= 599) return status;
  const message = error instanceof Error ? error.message : String(error);
  const parsed = Number(WEB3_HTTP_STATUS.exec(message)?.[1]);
  return parsed >= 400 && parsed <= 599 ? parsed : undefined;
}

/**
 * How `fetch` says no server answered: Chrome's `Failed to fetch`, Safari's
 * `Load failed`, Node's `fetch failed`, Chromium's `net::ERR_*` codes, libc errno
 * names, and abort or timeout phrasing. `Connection.getBalance` stringifies the
 * cause into its message (`...: TypeError: Failed to fetch`), so the message is
 * matched, not the class: a `TypeError` from a bug in our own code is not a
 * network failure.
 */
export const TRANSPORT_ERROR_MESSAGE =
  /failed to fetch|fetch failed|load failed|network ?error|ERR_|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|AbortError|TimeoutError|timed? ?out|aborted/i;

export function isTransportError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return TRANSPORT_ERROR_MESSAGE.test(message);
}

/**
 * Verdict for an error with no HTTP status and no JSON-RPC code: a transport
 * failure cools the URL down, a `TypeError` that is not one is our own bug and
 * would recur on every endpoint, and anything else unreadable cools down.
 */
export function classifyThrownError(error: unknown): RpcVerdict {
  if (isTransportError(error)) return 'cooldown';
  if (error instanceof TypeError) return 'throw';
  return 'cooldown';
}

/** Nothing at this URL will serve us from here: a transport failure, or 401/403 at the door. */
export function isUnreachableFailure(error: unknown): boolean {
  if (isTransportError(error)) return true;
  const status = connectionErrorHttpStatus(error);
  return status !== undefined && SKIP_HTTP_STATUSES.includes(status);
}

/** One endpoint's failure during a rotated call, as seen by `onFailure`. */
export interface RpcFailure {
  url: string;
  error: unknown;
  verdict: RpcVerdict;
}

export type RpcFailureObserver = (failure: RpcFailure) => void;

class RpcHttpError extends Error {
  constructor(method: string, readonly status: number) {
    super(`${method} failed: ${status}`);
    this.name = 'RpcHttpError';
  }
}

class RpcApplicationError extends Error {
  constructor(message: string, readonly code: number | undefined) {
    super(message);
    this.name = 'RpcApplicationError';
  }
}

/**
 * One JSON-RPC call over the URL list, healthy endpoints first. Same verdicts as
 * `classifyConnectionError`: `skip` moves on, `cooldown` rests the URL and moves
 * on, `throw` rethrows at once. A rejected `fetch` (DNS, TLS, CORS, offline) cools down.
 * `onFailure` sees every endpoint's failure and verdict, so a caller can tell
 * "no URL serves this method" from "the call is broken".
 */
export async function rpcJson<T>(
  urls: string[],
  method: string,
  params: unknown,
  onFailure?: RpcFailureObserver,
): Promise<T> {
  if (urls.length === 0) {
    throw new Error(`${method} failed: no RPC endpoint`);
  }

  let lastError: Error | undefined;
  for (const url of prioritizeRpcUrls(urls)) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'cinder', method, params }),
      });
      if (!response.ok) {
        throw new RpcHttpError(method, response.status);
      }
      const json = (await response.json()) as {
        result?: T;
        error?: { code?: number; message?: string };
      };
      if (json.error) {
        throw new RpcApplicationError(json.error.message || `${method} failed`, json.error.code);
      }
      return json.result as T;
    } catch (error) {
      let verdict: RpcVerdict;
      if (error instanceof RpcHttpError) {
        verdict = classifyHttpStatus(error.status);
      } else if (error instanceof RpcApplicationError) {
        verdict = classifyJsonRpcError(error.code, error.message);
      } else {
        verdict = classifyThrownError(error);
      }
      onFailure?.({ url, error, verdict });
      if (verdict === 'throw') throw error;
      if (verdict === 'cooldown') markRpcUnhealthy(url);
      lastError = error instanceof Error ? error : new Error(`${method} failed`);
    }
  }
  throw lastError ?? new Error(`${method} failed`);
}

/**
 * Run `fn` against each URL in turn until one succeeds; see `classifyConnectionError`
 * for the rotation rule. `onFailure` sees every endpoint's failure and verdict.
 */
export async function withRotatedConnection<T>(
  urls: string[],
  fn: (connection: Connection) => Promise<T>,
  onFailure?: RpcFailureObserver,
): Promise<T> {
  let lastError: unknown;
  for (const url of prioritizeRpcUrls(urls)) {
    try {
      return await fn(makeConnection(url));
    } catch (error) {
      const verdict = classifyConnectionError(error);
      onFailure?.({ url, error, verdict });
      if (verdict === 'throw') throw error;
      if (verdict === 'cooldown') markRpcUnhealthy(url);
      lastError = error;
    }
  }
  throw lastError ?? new Error('RPC failed');
}

/** Probe endpoints until getLatestBlockhash works. Do not reuse this to retry a broadcast. */
export async function readyConnection(urls: string[]): Promise<Connection> {
  let lastError: unknown;
  for (const url of prioritizeRpcUrls(urls)) {
    const connection = makeConnection(url);
    try {
      await connection.getLatestBlockhash('confirmed');
      return connection;
    } catch (error) {
      const verdict = classifyConnectionError(error);
      if (verdict === 'throw') throw error;
      if (verdict === 'cooldown') markRpcUnhealthy(url);
      lastError = error;
    }
  }
  throw lastError ?? new Error('No RPC endpoint');
}
