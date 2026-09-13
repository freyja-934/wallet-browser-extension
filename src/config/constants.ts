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
 * Keyless mainnet default. There is deliberately only one.
 *
 * `api.mainnet-beta.solana.com` answers 403 to any request carrying an `Origin` header,
 * and every extension request carries one, so it could never serve a call from here and
 * is not in the manifest either.
 *
 * The rest of the keyless field was swept on 2026-09-13 with
 * `scripts/probe-mainnet-rpcs.mjs`, which fetches from a real `chrome-extension://` page
 * because curl does not enforce CORS and so reports endpoints as working that a browser
 * refuses. Of the candidates, OnFinality 429s without a key, dRPC answers 400 ("not
 * available on free plan"), Omniatech 521s, and Ankr and BlockEden demand a key. One did
 * serve the extension origin: `solana.leorpc.com/?api_key=FREE`. It is left out on
 * purpose. Every host in this list receives the addresses a user looks up and the
 * transactions they sign, so a shared free-tier credential on a small provider is a trust
 * decision, not a redundancy win, and it would need saying in the privacy policy.
 *
 * The consequence is accepted: when publicnode is blocked or down the wallet has no
 * keyless mainnet endpoint, and it says exactly that rather than showing a balance it
 * cannot read. The fix offered to the user is a custom RPC URL or a Helius key in
 * Settings. Re-run the probe before revisiting this.
 */
export const PUBLIC_MAINNET_RPCS: readonly string[] = ['https://solana-rpc.publicnode.com'];

export const PUBLIC_DEVNET_RPCS: readonly string[] = ['https://api.devnet.solana.com'];

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
