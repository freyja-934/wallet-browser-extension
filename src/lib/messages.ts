export const WALLET_CHANNEL = 'cinder-wallet';

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
  'CHANGE_PASSWORD',
  'EXPORT_SEED',
  'EXPORT_PRIVATE_KEY',
  'UPDATE_SETTINGS',
  'GET_SETTINGS',
  'CLEAR_WALLET',
  'SWITCH_ACCOUNT',
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

export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  origin: string;
  createdAt: number;
  /** The approval window `chrome.windows.create` opened for it; closing that window rejects the request. */
  windowId?: number;
  transactionBytes?: number[];
  messageBytes?: number[];
}

/** One entry of the Settings "Connected sites" list. */
export interface ConnectedSite {
  origin: string;
  connectedAt: number;
  accountIndexes: number[];
}

/** Pushed from the worker to connected pages (via the content script) and to the popup. */
export type WalletEventName =
  | 'locked'
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
