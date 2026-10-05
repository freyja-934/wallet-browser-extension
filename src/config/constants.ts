import pkg from '../../package.json';
import type { WalletSettings } from '../lib/messages';

const rawNetwork = (import.meta.env.VITE_NETWORK as string | undefined) || 'mainnet-beta';

/**
 * Build-time Helius key (`VITE_HELIUS_API_KEY`). A dev convenience only: it seeds
 * `settings.heliusApiKey` when the stored settings have none (see `keyring.getSettings`).
 * The store build sets it empty, and `just store` refuses a zip that contains a key literal.
 */
export const BUILD_HELIUS_API_KEY = (import.meta.env.VITE_HELIUS_API_KEY as string | undefined) || '';

export type Cluster = 'mainnet-beta' | 'devnet';

/**
 * First-party Mainnet RPC. The Helius key lives on this Worker, not in the zip.
 * See `docs/adr/0006-keyless-rpc-proxy.md`. The host must be the one `wrangler deploy`
 * prints; the manifest grants the same origin.
 */
export const CINDER_MAINNET_RPC = 'https://cinder-rpc.freyja-934.workers.dev';

/**
 * publicnode, kept as the degraded keyless host. It accepts a browser origin and
 * refuses `getTokenAccountsByOwner` and DAS. `api.mainnet-beta.solana.com` answers
 * 403 to any request carrying an `Origin` header, so it is not in this list and
 * not in the manifest.
 */
export const PUBLICNODE_MAINNET_RPC = 'https://solana-rpc.publicnode.com';

/**
 * Keyless mainnet order: the proxy, then publicnode.
 *
 * A custom URL or a Helius key the user entered is tried ahead of this list
 * (`rpcUrlsFor`), and a user who named one never hits the proxy. When the proxy
 * is up it serves balances, token accounts and DAS. When it is down or resting,
 * publicnode still serves SOL, sends and history. Jupiter runs only when every
 * URL has refused token enumeration, which a mere proxy outage is not.
 *
 * The free field was swept on 2026-09-13 (`scripts/probe-mainnet-rpcs.mjs`) and
 * again against newer public hosts on 2026-10-04. None of them is an indexed,
 * browser-safe default. The proxy is how a keyless install gets those reads
 * without a key in the zip. ADR 0003 and ADR 0006.
 */
export const PUBLIC_MAINNET_RPCS: readonly string[] = [CINDER_MAINNET_RPC, PUBLICNODE_MAINNET_RPC];

export const PUBLIC_DEVNET_RPCS: readonly string[] = ['https://api.devnet.solana.com'];

/**
 * Jupiter's free public API: the keyless fallback for *discovering* which mints a
 * mainnet address holds, and for their names, symbols and logos. Nothing else.
 *
 * Measured on 2026-09-14 from a real `chrome-extension://` page, for the same CORS
 * reason as the RPC sweep above (curl does not enforce CORS and reports endpoints as
 * working that a browser refuses):
 *
 * - `GET {JUPITER_BALANCES_URL}/{owner}` answered 200 with
 *   `access-control-allow-origin` echoing the extension origin, and returned an object
 *   keyed by mint (plus a `SOL` key): 1 entry for the public fixture, 4,198 for
 *   Binance's hot wallet, about 460 KB.
 * - `GET {JUPITER_TOKEN_SEARCH_URL}?query=<comma-separated mints>` takes up to 100 mints
 *   per call and returned name, symbol and icon for each in about 200 ms.
 *
 * The load-bearing rule: **Jupiter supplies discovery and cosmetics only.** Every number
 * the user acts on is read from the chain — `decimals` in particular comes from the mint
 * account through the rotated connection, never from a Jupiter response, because
 * `SendModal` feeds the displayed decimals into the smallest-unit conversion. A mint
 * whose decimals cannot be confirmed on-chain is dropped, not guessed.
 *
 * It is a third party with no SLA, so it is fallback-only: when it rate-limits, changes
 * shape or vanishes, the wallet is back to exactly today's "tokens unavailable" state.
 * Nothing in signing, sending, history or dApp connection may depend on it.
 */
export const JUPITER_BALANCES_URL = 'https://lite-api.jup.ag/ultra/v1/balances';
export const JUPITER_TOKEN_SEARCH_URL = 'https://lite-api.jup.ag/tokens/v2/search';

/** Mints per `tokens/v2/search` call; the endpoint's own documented cap. */
export const JUPITER_SEARCH_BATCH = 100;

export function getCluster(): Cluster {
  return rawNetwork === 'devnet' ? 'devnet' : 'mainnet-beta';
}

export function labelFor(cluster: Cluster): string {
  return cluster === 'devnet' ? 'Devnet' : 'Mainnet';
}

export function publicRpcUrlsFor(cluster: Cluster): readonly string[] {
  return cluster === 'devnet' ? PUBLIC_DEVNET_RPCS : PUBLIC_MAINNET_RPCS;
}

export function heliusRpcUrlFor(cluster: Cluster, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const host = cluster === 'devnet' ? 'devnet' : 'mainnet';
  return `https://${host}.helius-rpc.com/?api-key=${key}`;
}

/** `getGenesisHash` per cluster; Settings refuses a custom URL whose hash belongs to the other one. */
export const GENESIS_HASH: Readonly<Record<Cluster, string>> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};

export function clusterForGenesisHash(hash: string): Cluster | undefined {
  return (Object.keys(GENESIS_HASH) as Cluster[]).find((cluster) => GENESIS_HASH[cluster] === hash);
}

export type RpcSettings = Pick<WalletSettings, 'rpcUrl' | 'heliusApiKey' | 'rpcUrlCluster'>;

/** `new URL(u).href`, so `https://host` and `https://host/` are the same endpoint; unparsable input stays as is. */
function normalizedUrlKey(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/**
 * Endpoint list for one cluster: the user's custom URL, then Helius when a key is
 * set, then the public defaults. A custom URL tagged with the other cluster
 * (`rpcUrlCluster`) is left out; a legacy entry without the tag is used as before.
 * Pure; duplicates removed by normalised URL, first occurrence wins.
 */
export function rpcUrlsFor(cluster: Cluster, settings: Partial<RpcSettings> = {}): string[] {
  const customUrl =
    settings.rpcUrlCluster && settings.rpcUrlCluster !== cluster ? undefined : settings.rpcUrl;
  const candidates = [
    customUrl,
    heliusRpcUrlFor(cluster, settings.heliusApiKey),
    ...publicRpcUrlsFor(cluster),
  ];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const url of candidates) {
    if (!url) continue;
    const key = normalizedUrlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

/**
 * May this install ask Jupiter which mints an address holds?
 *
 * Only on mainnet, and only when the user has configured no endpoint of their own.
 * A devnet address is not in Jupiter's index at all, and a user who entered a custom
 * RPC URL or a Helius API key chose where their address goes: that choice must never
 * be quietly widened to a third party they did not name. Either value set — whichever
 * cluster it was tagged for — turns this off.
 */
export function jupiterEnabledFor(cluster: Cluster, settings: Partial<RpcSettings> = {}): boolean {
  if (cluster !== 'mainnet-beta') return false;
  return !settings.rpcUrl && !settings.heliusApiKey;
}

export const API_ENDPOINTS = {
  COINGECKO_PRICE: 'https://api.coingecko.com/api/v3/simple/price',
  COINGECKO_TOKEN_PRICE: 'https://api.coingecko.com/api/v3/simple/token_price/solana',
};

export const WALLET_NAME = 'Cinder Wallet';
/**
 * The app version the popup shows, read from `package.json`, which is the single
 * source of truth: `scripts/sync-version.mjs` writes it into the *built* manifest
 * on every `just ext`. The `manifest.json` in the repo keeps its own literal so a
 * reader of the tree sees the real number, and `version.test.ts` is what stops
 * that literal drifting from `package.json`.
 */
export const WALLET_VERSION: string = pkg.version;
