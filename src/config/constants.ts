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
 * Keyless mainnet defaults, in order. `api.mainnet-beta.solana.com` returns 403 to any
 * request carrying an `Origin` header, so the extension needs publicnode first; the
 * Solana Foundation host stays as a fallback for the day publicnode is down.
 */
export const PUBLIC_MAINNET_RPCS: readonly string[] = [
  'https://solana-rpc.publicnode.com',
  'https://api.mainnet-beta.solana.com',
];

export const PUBLIC_DEVNET_RPCS: readonly string[] = ['https://api.devnet.solana.com'];

export function getCluster(): Cluster {
  return rawNetwork === 'devnet' ? 'devnet' : 'mainnet-beta';
}

export function labelFor(cluster: Cluster): string {
  return cluster === 'devnet' ? 'Devnet' : 'Mainnet';
}

export function getNetworkLabel(): string {
  return labelFor(getCluster());
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
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBA',
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

export const NATIVE_SOL_MINT = '11111111111111111111111111111111';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

export const AUTO_LOCK_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 1440, label: '1 day' },
  { value: 0, label: 'Never' },
];

export const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
];

export const DEFAULT_COMMITMENT = 'confirmed';
export const WALLET_NAME = 'Cinder Wallet';
export const WALLET_VERSION = '0.2.0';
