const optionalHeliusKey = (import.meta.env.VITE_HELIUS_API_KEY as string | undefined) || '';
const rawNetwork = (import.meta.env.VITE_NETWORK as string | undefined) || 'mainnet-beta';

export const PUBLIC_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
export const PUBLIC_DEVNET_RPC = 'https://api.devnet.solana.com';

export type Cluster = 'mainnet-beta' | 'devnet';

export function getCluster(): Cluster {
  return rawNetwork === 'devnet' ? 'devnet' : 'mainnet-beta';
}

export function labelFor(cluster: Cluster): string {
  return cluster === 'devnet' ? 'Devnet' : 'Mainnet';
}

export function getNetworkLabel(): string {
  return labelFor(getCluster());
}

export function rpcUrlFor(cluster: Cluster): string {
  if (optionalHeliusKey) {
    const host = cluster === 'devnet' ? 'devnet' : 'mainnet';
    return `https://${host}.helius-rpc.com/?api-key=${optionalHeliusKey}`;
  }
  return cluster === 'devnet' ? PUBLIC_DEVNET_RPC : PUBLIC_SOLANA_RPC;
}

export function getRpcUrl(): string {
  return rpcUrlFor(getCluster());
}

export function getHeliusApiKey(): string {
  return optionalHeliusKey;
}

export const HELIUS_RPC_URL = getRpcUrl();

export const NETWORKS = {
  'mainnet-beta': {
    name: 'Mainnet Beta',
    endpoint: getRpcUrl(),
    chainId: 101,
  },
  'testnet': {
    name: 'Testnet',
    endpoint: 'https://api.testnet.solana.com',
    chainId: 102,
  },
  'devnet': {
    name: 'Devnet',
    endpoint: PUBLIC_DEVNET_RPC,
    chainId: 103,
  },
} as const;

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
