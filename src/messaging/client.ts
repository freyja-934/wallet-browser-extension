import type { PendingApproval, WalletPublicState, WalletSettings } from '../lib/messages';
import type { PreviewResult } from '../lib/preview';

interface Envelope {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

async function send(type: string, payload: Record<string, unknown> = {}): Promise<Envelope> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Not running as an extension');
  }
  const response = (await chrome.runtime.sendMessage({ type, ...payload })) as Envelope;
  if (!response?.success) {
    throw new Error(response?.error || 'Request failed');
  }
  return response;
}

export const extensionClient = {
  getState: async () => (await send('GET_STATE')).state as WalletPublicState,
  getSettings: async () => (await send('GET_SETTINGS')).settings as WalletSettings,
  updateSettings: async (settings: Partial<WalletSettings>) =>
    (await send('UPDATE_SETTINGS', { settings })).settings as WalletSettings,
  createWallet: async (password: string, seedPhrase?: string) =>
    (await send('CREATE_WALLET', { password, seedPhrase })).state as WalletPublicState,
  unlock: async (password: string) => (await send('UNLOCK', { password })).state as WalletPublicState,
  lock: async () => (await send('LOCK')).state as WalletPublicState,
  clearWallet: async () => (await send('CLEAR_WALLET')).state as WalletPublicState,
  changePassword: async (currentPassword: string, newPassword: string) => {
    await send('CHANGE_PASSWORD', { currentPassword, newPassword });
  },
  exportSeed: async (password: string) => (await send('EXPORT_SEED', { password })).seedPhrase as string,
  exportPrivateKey: async (password: string, accountIndex: number) =>
    (await send('EXPORT_PRIVATE_KEY', { password, accountIndex })).privateKey as string,
  sendTransfer: async (params: { to: string; amountSmallest: string; mint?: string }) =>
    (await send('SEND_TRANSFER', params)).signature as string,
  getPendingRequest: async (id: string) =>
    (await send('GET_PENDING_REQUEST', { id })).request as PendingApproval | null,
  approveRequest: async (id: string) => {
    await send('APPROVE_REQUEST', { id });
  },
  rejectRequest: async (id: string, reason?: string) => {
    await send('REJECT_REQUEST', { id, reason });
  },
  previewTransaction: async (transaction: number[]) =>
    (await send('PREVIEW_TRANSACTION', { transaction })).preview as PreviewResult,
};
