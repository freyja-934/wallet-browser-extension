/**
 * What the keyless Mainnet proxy is willing to forward.
 *
 * These are the JSON-RPC names the extension actually sends. web3.js method
 * names differ from a few of them: `sendRawTransaction` is `sendTransaction`,
 * `getParsedTransaction` is `getTransaction`, `getParsedTokenAccountsByOwner`
 * is `getTokenAccountsByOwner`, and `getMultipleAccountsInfo` is
 * `getMultipleAccounts`. `getAssetsByOwner` is Helius DAS, called directly.
 *
 * `getProgramAccounts` and the other account-index scans are absent on purpose.
 * A copied Worker URL must not be a public firehose.
 */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'getAccountInfo',
  'getAssetsByOwner',
  'getBalance',
  'getBlockHeight',
  'getFeeForMessage',
  'getGenesisHash',
  'getHealth',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getMultipleAccounts',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getTokenAccountsByOwner',
  'getTransaction',
  'sendTransaction',
  'simulateTransaction',
]);

/** JSON-RPC limit, and the most `getMultipleAccounts` this proxy will forward. */
export const MAX_MULTIPLE_ACCOUNTS = 100;

/** A signed transaction is about a kilobyte. Anything past this is not one of ours. */
export const MAX_BODY_BYTES = 64 * 1024;

export const HELIUS_RPC_ORIGIN = 'https://mainnet.helius-rpc.com/';

export function isAllowedMethod(method: string): boolean {
  return ALLOWED_METHODS.has(method);
}

/**
 * `getMultipleAccounts` params are `[keys, config]`. More than
 * `MAX_MULTIPLE_ACCOUNTS` keys, or a shape that is not that, is refused here
 * and never forwarded. Other methods are not inspected: their addresses stay
 * in the body the upstream receives, and nowhere else.
 */
export function multipleAccountsTooWide(method: string, params: unknown): boolean {
  if (method !== 'getMultipleAccounts') return false;
  if (!Array.isArray(params)) return true;
  const keys = params[0];
  return !Array.isArray(keys) || keys.length > MAX_MULTIPLE_ACCOUNTS;
}
