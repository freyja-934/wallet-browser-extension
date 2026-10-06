import {
  HELIUS_RPC_ORIGIN,
  MAX_BODY_BYTES,
  isAllowedMethod,
  multipleAccountsTooWide,
} from './policy';

/**
 * Bindings declared in `wrangler.jsonc`. `HELIUS_API_KEY` is a Worker secret
 * (`wrangler secret put`), never a var in that file. `RPC_RATE_LIMIT` is the
 * rate-limit binding of the same name.
 */
export interface RpcProxyEnv {
  HELIUS_API_KEY: string;
  RPC_RATE_LIMIT: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

const CORS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

function json(status: number, body: unknown): Response {
  return withCors(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

/** Status only. Never the body, the address, or the upstream URL (it carries the key). */
function logStatus(status: number): void {
  console.log(JSON.stringify({ status }));
}

function respond(response: Response): Response {
  logStatus(response.status);
  return response;
}

function requestId(body: unknown): string | number | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function rpcError(status: number, id: string | number | null, code: number, message: string): Response {
  return json(status, { jsonrpc: '2.0', id, error: { code, message } });
}

/** Read at most `max` bytes. A longer body is rejected before it is buffered. */
export async function readLimited(request: Request, max = MAX_BODY_BYTES): Promise<Uint8Array | 'too-large' | 'empty'> {
  const reader = request.body?.getReader();
  if (!reader) return 'empty';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return 'too-large';
    }
    chunks.push(value);
  }
  if (total === 0) return 'empty';
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function clientAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/**
 * One JSON-RPC POST, forwarded to Helius when the method is on the allowlist.
 * `fetchImpl` is the outbound fetch, so tests never leave the process.
 */
export async function handleRpc(
  request: Request,
  env: RpcProxyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'POST') {
    return respond(json(405, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'POST only' } }));
  }

  let allowed = false;
  try {
    allowed = (await env.RPC_RATE_LIMIT.limit({ key: clientAddress(request) })).success;
  } catch {
    return respond(rpcError(503, null, -32005, 'upstream unavailable'));
  }
  if (!allowed) {
    return respond(rpcError(429, null, -32005, 'Too many requests'));
  }

  const bytes = await readLimited(request);
  if (bytes === 'too-large') {
    return respond(rpcError(413, null, -32600, 'Request too large'));
  }
  if (bytes === 'empty') {
    return respond(rpcError(400, null, -32700, 'Parse error'));
  }

  let text: string;
  let body: unknown;
  try {
    text = new TextDecoder().decode(bytes);
    body = JSON.parse(text);
  } catch {
    return respond(rpcError(400, null, -32700, 'Parse error'));
  }
  if (Array.isArray(body)) {
    return respond(rpcError(400, null, -32600, 'Batch requests are not accepted'));
  }
  const id = requestId(body);
  const method = body !== null && typeof body === 'object' ? (body as { method?: unknown }).method : undefined;
  if (typeof method !== 'string' || method.length === 0) {
    return respond(rpcError(400, id, -32600, 'Invalid request'));
  }
  if (!isAllowedMethod(method)) {
    return respond(rpcError(200, id, -32601, 'Method not allowed'));
  }
  const params = (body as { params?: unknown }).params;
  if (multipleAccountsTooWide(method, params)) {
    return respond(rpcError(200, id, -32602, 'Too many accounts'));
  }

  if (!env.HELIUS_API_KEY) {
    return respond(rpcError(503, id, -32005, 'upstream unavailable'));
  }

  const upstreamUrl = new URL(HELIUS_RPC_ORIGIN);
  upstreamUrl.searchParams.set('api-key', env.HELIUS_API_KEY);

  let upstream: Response;
  try {
    upstream = await fetchImpl(upstreamUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    });
  } catch {
    return respond(rpcError(503, id, -32005, 'upstream unavailable'));
  }

  // A bad or rejected key is our misconfiguration, not the caller's. Rest this
  // proxy (503 cools it down in the extension) instead of telling every client
  // the method does not exist, and do not forward a body that could name the key.
  if (upstream.status === 401 || upstream.status === 403) {
    return respond(rpcError(503, id, -32005, 'upstream unavailable'));
  }

  const headers = new Headers(CORS);
  headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  return respond(withCors(new Response(upstream.body, { status: upstream.status, headers })));
}
