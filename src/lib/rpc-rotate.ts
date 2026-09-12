import { Connection } from '@solana/web3.js';

const COOLDOWN_MS = 30_000;
const cooldownUntil = new Map<string, number>();

/**
 * HTTP statuses that say "this endpoint will not serve this call" rather than
 * "this endpoint is unwell": try the next URL for this call only, no cooldown.
 */
export const SKIP_HTTP_STATUSES: readonly number[] = [401, 403];

/**
 * JSON-RPC codes a public endpoint returns for a method it refuses to serve
 * (`-32601` method not found; `-32600` / `-32000` are what the fallback fixture
 * pins for a blocked method, see rpc-rotate.test.ts). Same rule: skip, no cooldown.
 */
export const SKIP_RPC_CODES: readonly number[] = [-32601, -32600, -32000];

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

function isSkipRpcCode(code: unknown): boolean {
  return typeof code === 'number' && SKIP_RPC_CODES.includes(code);
}

export function makeConnection(url: string): Connection {
  // React Query owns retries; web3.js's own 429 backoff logs console.error and hides latency.
  return new Connection(url, { commitment: 'confirmed', disableRetryOnRateLimit: true });
}

/** `${status} ${statusText}: ${body}` is how web3.js reports a non-2xx response, possibly wrapped. */
const WEB3_HTTP_STATUS = /(?:^|: |Error: )(\d{3}) [A-Za-z][A-Za-z ]*:/;

type Verdict = 'skip' | 'cooldown';

/**
 * Classify an error thrown by a web3.js `Connection` call. HTTP 401/403 and a
 * refused method skip the URL without cooling it down; anything else (429, 5xx,
 * transport failures, and errors we cannot read) cools the URL down as before.
 */
export function classifyConnectionError(error: unknown): Verdict {
  if (error && typeof error === 'object') {
    if (isSkipRpcCode((error as { code?: unknown }).code)) return 'skip';
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = Number(WEB3_HTTP_STATUS.exec(message)?.[1]);
  if (!Number.isNaN(status) && isSkipStatus(status)) return 'skip';
  if (/method not found/i.test(message)) return 'skip';
  return 'cooldown';
}

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
 * One JSON-RPC call over the URL list, healthy endpoints first.
 * - 401 / 403 and a refused method (`SKIP_RPC_CODES`) skip to the next URL for this call only.
 * - 408 / 429 / 5xx and transport errors mark the URL unhealthy and move on.
 * - Any other HTTP status or JSON-RPC error is the caller's problem and throws at once.
 */
export async function rpcJson<T>(urls: string[], method: string, params: unknown): Promise<T> {
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
      if (error instanceof RpcHttpError) {
        if (isSkipStatus(error.status)) {
          lastError = error;
          continue;
        }
        if (!isCooldownStatus(error.status)) throw error;
        markRpcUnhealthy(url);
        lastError = error;
        continue;
      }
      if (error instanceof RpcApplicationError) {
        if (isSkipRpcCode(error.code)) {
          lastError = error;
          continue;
        }
        throw error;
      }
      // fetch rejected: DNS, TLS, CORS, offline.
      lastError = error instanceof Error ? error : new Error(`${method} failed`);
      markRpcUnhealthy(url);
    }
  }
  throw lastError ?? new Error(`${method} failed`);
}

/** Run `fn` against each URL in turn until one succeeds; see `classifyConnectionError` for the rotation rule. */
export async function withRotatedConnection<T>(
  urls: string[],
  fn: (connection: Connection) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const url of prioritizeRpcUrls(urls)) {
    try {
      return await fn(makeConnection(url));
    } catch (error) {
      if (classifyConnectionError(error) === 'cooldown') markRpcUnhealthy(url);
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
      if (classifyConnectionError(error) === 'cooldown') markRpcUnhealthy(url);
      lastError = error;
    }
  }
  throw lastError ?? new Error('No RPC endpoint');
}
