// API Configuration
export const HELIUS_API_KEY = '0991e593-a2d1-4db3-8685-e00494fb96cd';
export const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Network Configuration
export const NETWORKS = {
  'mainnet-beta': {
    name: 'Mainnet Beta',
    endpoint: HELIUS_RPC_URL,
    chainId: 101,
  },
  'testnet': {
    name: 'Testnet',
    endpoint: 'https://api.testnet.solana.com',
    chainId: 102,
  },
  'devnet': {
    name: 'Devnet',
    endpoint: 'https://api.devnet.solana.com',
    chainId: 103,
  },
} as const;

// API Endpoints
export const API_ENDPOINTS = {
  COINGECKO_PRICE: 'https://api.coingecko.com/api/v3/simple/price',
  COINGECKO_TOKEN_PRICE: 'https://api.coingecko.com/api/v3/simple/token_price/solana',
  JUPITER_QUOTE: 'https://quote-api.jup.ag/v6/quote',
  JUPITER_SWAP: 'https://quote-api.jup.ag/v6/swap',
};

// Token Constants
export const NATIVE_SOL_MINT = '11111111111111111111111111111111';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

// UI Constants
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

// Transaction Constants
export const DEFAULT_COMMITMENT = 'confirmed';
export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000; // milliseconds

// Storage Keys
export const STORAGE_KEYS = {
  VAULT: 'wallet_vault',
  SETTINGS: 'wallet_settings',
  CACHE: 'wallet_cache',
  SESSION: 'wallet_session',
};
