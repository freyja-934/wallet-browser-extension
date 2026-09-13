import type { ExtensionMessageType, WalletSettings } from '../lib/messages';
import type { WalletRequestPayload, WalletResponses } from '../lib/protocol';

type Envelope<T extends ExtensionMessageType> =
  | ({ success: true } & WalletResponses[T])
  | { success: false; error?: string };

async function send<T extends ExtensionMessageType>(
  type: T,
  payload: WalletRequestPayload<T>
): Promise<WalletResponses[T]> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Not running as an extension');
  }
  const response = (await chrome.runtime.sendMessage({ type, ...payload })) as Envelope<T> | undefined;
  if (!response?.success) {
    throw new Error(response?.error || 'Request failed');
  }
  return response;
}

export const extensionClient = {
  getState: async () => (await send('GET_STATE', {})).state,
  getSettings: async () => (await send('GET_SETTINGS', {})).settings,
  updateSettings: async (settings: Partial<WalletSettings>) => (await send('UPDATE_SETTINGS', { settings })).settings,
  createWallet: async (password: string, seedPhrase?: string) =>
    (await send('CREATE_WALLET', { password, seedPhrase })).state,
  unlock: async (password: string) => (await send('UNLOCK', { password })).state,
  lock: async () => (await send('LOCK', {})).state,
  clearWallet: async () => (await send('CLEAR_WALLET', {})).state,
  changePassword: async (currentPassword: string, newPassword: string) => {
    await send('CHANGE_PASSWORD', { currentPassword, newPassword });
  },
  exportSeed: async (password: string) => (await send('EXPORT_SEED', { password })).seedPhrase,
  exportPrivateKey: async (password: string, accountIndex: number) =>
    (await send('EXPORT_PRIVATE_KEY', { password, accountIndex })).privateKey,
  sendTransfer: async (params: { to: string; amountSmallest: string; mint?: string }) =>
    (await send('SEND_TRANSFER', params)).signature,
  getPendingRequest: async (id: string) => (await send('GET_PENDING_REQUEST', { id })).request,
  approveRequest: async (id: string) => {
    await send('APPROVE_REQUEST', { id });
  },
  rejectRequest: async (id: string, reason?: string) => {
    await send('REJECT_REQUEST', { id, reason });
  },
  previewTransaction: async (transaction: number[]) =>
    (await send('PREVIEW_TRANSACTION', { transaction })).preview,
  getConnectedSites: async () => (await send('GET_CONNECTED_SITES', {})).sites,
  revokeSite: async (origin: string) => {
    await send('REVOKE_SITE', { origin });
  },
  cancelApproval: async (id: string) => {
    await send('CANCEL_APPROVAL', { id });
  },
};
