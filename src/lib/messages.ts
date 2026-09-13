export const WALLET_CHANNEL = 'cinder-wallet';

/**
 * How long the injected script waits for any reply before rejecting with
 * `Request timeout`. The content script gives up strictly earlier than this and
 * withdraws the request, and the worker refuses to approve anything past
 * `createdAt + PAGE_TIMEOUT_MS`, so an Approve the page has stopped waiting for
 * can never sign or broadcast.
 */
export const PAGE_TIMEOUT_MS = 120_000;

export const DAP_MESSAGE_TYPES = [
  'WALLET_CONNECT',
  'WALLET_DISCONNECT',
  'GET_ACCOUNTS',
  'SIGN_TRANSACTION',
  'SIGN_AND_SEND_TRANSACTION',
  'SIGN_MESSAGE',
] as const;

export const EXTENSION_MESSAGE_TYPES = [
  ...DAP_MESSAGE_TYPES,
  'GET_STATE',
  'CREATE_WALLET',
  'UNLOCK',
  'LOCK',
  'APPROVE_REQUEST',
  'REJECT_REQUEST',
  'GET_PENDING_REQUEST',
  'POLL_APPROVAL',
  'PREVIEW_TRANSACTION',
  'SEND_TRANSFER',
  'ESTIMATE_FEE',
  'CHANGE_PASSWORD',
  'EXPORT_SEED',
  'EXPORT_PRIVATE_KEY',
  'UPDATE_SETTINGS',
  'GET_SETTINGS',
  'CLEAR_WALLET',
  'SWITCH_ACCOUNT',
  'ADD_ACCOUNT',
  'RENAME_ACCOUNT',
  'CANCEL_APPROVAL',
  'GET_CONNECTED_SITES',
  'REVOKE_SITE',
] as const;

export type DappMessageType = (typeof DAP_MESSAGE_TYPES)[number];
export type ExtensionMessageType = (typeof EXTENSION_MESSAGE_TYPES)[number];

export function isDappMessageType(type: string): type is DappMessageType {
  return (DAP_MESSAGE_TYPES as readonly string[]).includes(type);
}

export function isExtensionMessageType(type: string): type is ExtensionMessageType {
  return (EXTENSION_MESSAGE_TYPES as readonly string[]).includes(type);
}

/** Longest account label the popup stores. Long enough to be useful, short enough for the header. */
export const MAX_ACCOUNT_NAME_LENGTH = 32;

export interface WalletAccountInfo {
  address: string;
  name: string;
  derivationPath: string;
  index: number;
}

export interface WalletPublicState {
  hasVault: boolean;
  isLocked: boolean;
  accounts: WalletAccountInfo[];
  activeAccountIndex: number;
}

export interface WalletSettings {
  autoLockTimeout: number;
  preferredCurrency: string;
  theme: 'light' | 'dark' | 'system';
  hideSmallBalances: boolean;
  smallBalanceThreshold: number;
  cluster: 'mainnet-beta' | 'devnet';
  /** User-supplied https JSON-RPC endpoint, tried first. Absent when unset. */
  rpcUrl?: string;
  /**
   * The cluster `rpcUrl` was probed against (its `getGenesisHash`). While the active
   * cluster differs the URL is kept but not used. Absent for a URL stored before this
   * field existed, which is used on either cluster as before.
   */
  rpcUrlCluster?: 'mainnet-beta' | 'devnet';
  /** User-supplied Helius key, stored on this device in plaintext. Absent when unset. */
  heliusApiKey?: string;
}

export type ApprovalKind = 'connect' | 'signTransaction' | 'signAndSendTransaction' | 'signMessage';

/** The Wallet Standard chains Cinder can sign for; one per `WalletSettings['cluster']`. */
export const SUPPORTED_CHAINS = ['solana:mainnet', 'solana:devnet'] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];
/** Chains a Solana dApp may name that Cinder knows about but has no cluster for. */
export const UNSUPPORTED_CHAINS = ['solana:testnet', 'solana:localnet'] as const;
export type KnownChain = SupportedChain | (typeof UNSUPPORTED_CHAINS)[number];

export const CHAIN_FOR_CLUSTER: Record<WalletSettings['cluster'], SupportedChain> = {
  'mainnet-beta': 'solana:mainnet',
  devnet: 'solana:devnet',
};

export type Commitment = 'processed' | 'confirmed' | 'finalized';

/**
 * What a dApp may pass with `signAndSendTransaction` (and the subset
 * `signTransaction` allows). The first four go to `sendRawTransaction`;
 * `commitment` makes the worker wait for that level before answering.
 */
export interface SendOptions {
  skipPreflight?: boolean;
  preflightCommitment?: Commitment;
  maxRetries?: number;
  minContextSlot?: number;
  commitment?: Commitment;
}

export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  origin: string;
  createdAt: number;
  /** `createdAt + PAGE_TIMEOUT_MS`: the worker refuses to approve after this, whatever the page is doing. */
  deadline: number;
  /** The approval window `chrome.windows.create` opened for it; closing that window rejects the request. */
  windowId?: number;
  /** The tab and frame that asked; closing that tab rejects the request and closes its window. */
  tabId?: number;
  frameId?: number;
  /** Every transaction of one `signTransaction` / `signAndSendTransaction` call, in the order the page gave them. */
  transactions?: number[][];
  /** Every message of one `signMessage` call, in order. */
  messages?: number[][];
  /** The chain the page named, when it named one; already checked against the active cluster. */
  chain?: string;
  /**
   * The active cluster when a transaction request was enqueued. When the page named
   * no chain this is what its transaction was built for; a cluster change rejects it.
   */
  clusterAtEnqueue?: WalletSettings['cluster'];
  options?: SendOptions;
}

/** One entry of the Settings "Connected sites" list. */
export interface ConnectedSite {
  origin: string;
  connectedAt: number;
  accountIndexes: number[];
}

/**
 * Pushed from the worker to connected pages (via the content script) and to the
 * popup. `unlocked` goes to extension pages only, never to a tab.
 */
export type WalletEventName =
  | 'locked'
  | 'unlocked'
  | 'disconnected'
  | 'revoked'
  | 'cleared'
  | 'accountsChanged'
  | 'clusterChanged';

export const DEFAULT_SETTINGS: WalletSettings = {
  autoLockTimeout: 15,
  preferredCurrency: 'USD',
  theme: 'system',
  hideSmallBalances: false,
  smallBalanceThreshold: 1,
  cluster: 'mainnet-beta',
};
