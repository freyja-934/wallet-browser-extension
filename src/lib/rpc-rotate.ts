import { Connection } from '@solana/web3.js';
import {
  isHeliusRpcUrl,
  rpcUrlsFor,
  type Cluster,
} from '../config/constants';

const COOLDOWN_MS = 30_000;
const cooldownUntil = new Map<string, number>();

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

function shouldRotateStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function rpcJson<T>(
  cluster: Cluster,
  method: string,
  params: unknown,
  options: { das?: boolean; urls?: string[] } = {},
): Promise<T> {
  let urls = options.urls ?? rpcUrlsFor(cluster);
  if (options.das) {
    urls = urls.filter(isHeliusRpcUrl);
  }
  if (urls.length === 0) {
    throw new Error(`${method} needs Helius`);
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
        const httpError = new Error(`${method} failed: ${response.status}`);
        if (!shouldRotateStatus(response.status)) {
          throw httpError;
        }
        markRpcUnhealthy(url);
        lastError = httpError;
        continue;
      }
      const json = await response.json() as {
        result?: T;
        error?: { message?: string };
      };
      if (json.error) {
        lastError = new Error(json.error.message || `${method} failed`);
        markRpcUnhealthy(url);
        continue;
      }
      return json.result as T;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${method} failed: `)) {
        const status = Number(error.message.slice(`${method} failed: `.length));
        if (!Number.isNaN(status) && !shouldRotateStatus(status)) {
          throw error;
        }
      }
      lastError = error instanceof Error ? error : new Error(`${method} failed`);
      markRpcUnhealthy(url);
    }
  }
  throw lastError ?? new Error(`${method} failed`);
}

export async function withRotatedConnection<T>(
  cluster: Cluster,
  fn: (connection: Connection) => Promise<T>,
): Promise<T> {
  const urls = prioritizeRpcUrls(rpcUrlsFor(cluster));
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await fn(new Connection(url, 'confirmed'));
    } catch (error) {
      markRpcUnhealthy(url);
      lastError = error;
    }
  }
  throw lastError ?? new Error('RPC failed');
}

export function connectionForCluster(cluster: Cluster): Connection {
  const url = prioritizeRpcUrls(rpcUrlsFor(cluster))[0];
  return new Connection(url, 'confirmed');
}

/** Probe endpoints until getLatestBlockhash works. Do not reuse this to retry a broadcast. */
export async function readyConnection(cluster: Cluster): Promise<Connection> {
  const urls = prioritizeRpcUrls(rpcUrlsFor(cluster));
  let lastError: unknown;
  for (const url of urls) {
    const connection = new Connection(url, 'confirmed');
    try {
      await connection.getLatestBlockhash('confirmed');
      return connection;
    } catch (error) {
      markRpcUnhealthy(url);
      lastError = error;
    }
  }
  throw lastError ?? new Error('No RPC endpoint');
}
