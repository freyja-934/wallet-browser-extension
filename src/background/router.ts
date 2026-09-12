import {
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { isExtensionMessageType, type PendingApproval } from '../lib/messages';
import { parseRequest, type WalletRequest, type WalletResponse } from '../lib/protocol';
import { isExtensionSender, isRequestAllowed, type SenderLike } from '../lib/sender-gate';
import { buildPreview, type PreviewResult } from '../lib/preview';
import {
  changePassword,
  clearWallet,
  createWallet,
  exportPrivateKey,
  exportSeed,
  getPublicState,
  getSettings,
  lock,
  signMessage,
  switchAccount,
  unlock,
  updateSettings,
  getKeypair,
} from './keyring';
import {
  enqueueApproval,
  getApprovalResult,
  getPending,
  openUnlockWindow,
  rejectApproval,
  resolveApproval,
} from './approvals';
import * as origins from './origins';
import { getConnection, sendTransfer } from './transfers';

/**
 * Worker entry for one runtime message. Gate on the sender first, then parse,
 * then dispatch. `extensionBase` is `chrome.runtime.getURL('')`, passed in so
 * this module never touches `chrome.*` at import time and stays unit-testable.
 */
export async function handleMessage(
  raw: unknown,
  sender: SenderLike,
  extensionBase: string
): Promise<Record<string, unknown>> {
  const type = raw && typeof raw === 'object' && 'type' in raw ? raw.type : undefined;
  if (typeof type !== 'string' || !isExtensionMessageType(type)) {
    throw new Error('Unknown message type');
  }

  if (!isRequestAllowed(type, sender, extensionBase)) {
    throw new Error('Not allowed from a page');
  }

  // Trust the browser's view of who sent this, never a field in the payload.
  const origin = sender.origin || sender.url || '';

  // A page talking from a tab: note where it is so events can reach it later.
  if (!isExtensionSender(sender, extensionBase)) {
    await origins.remember(sender, origin);
  }

  return dispatch(parseRequest(raw), origin);
}

async function requireConnected(origin: string): Promise<void> {
  if (!(await origins.isConnected(origin))) throw new Error('Not connected');
}

function addresses(state: { accounts: { address: string }[] }): string[] {
  return state.accounts.map((account) => account.address);
}

function assertNever(_request: never): never {
  throw new Error('Unknown message type');
}

async function dispatch(request: WalletRequest, origin: string): Promise<WalletResponse> {
  switch (request.type) {
    case 'GET_STATE':
      return { state: await getPublicState() };
    case 'GET_SETTINGS':
      return { settings: await getSettings() };
    case 'UPDATE_SETTINGS':
      return { settings: await updateSettings(request.settings) };
    case 'CREATE_WALLET':
      return { state: await createWallet(request.password, request.seedPhrase) };
    case 'UNLOCK':
      return { state: await unlock(request.password) };
    case 'LOCK':
      return { state: await lock() };
    case 'CLEAR_WALLET':
      return { state: await clearWallet() };
    case 'SWITCH_ACCOUNT':
      return { state: await switchAccount(request.index) };
    case 'CHANGE_PASSWORD':
      await changePassword(request.currentPassword, request.newPassword);
      return {};
    case 'EXPORT_SEED':
      return { seedPhrase: await exportSeed(request.password) };
    case 'EXPORT_PRIVATE_KEY':
      return { privateKey: await exportPrivateKey(request.password, request.accountIndex ?? 0) };
    case 'GET_ACCOUNTS': {
      await requireConnected(origin);
      const state = await getPublicState();
      if (state.isLocked) return { accounts: [] };
      return { accounts: addresses(state) };
    }
    case 'WALLET_CONNECT': {
      const state = await getPublicState();
      // A site that already connected gets its accounts back without a prompt.
      if (!state.isLocked && (await origins.isConnected(origin))) return { accounts: addresses(state) };
      // Silent connects never open a window: nothing to show is an empty account list.
      if (request.silent) return { accounts: [] };
      if (state.isLocked) {
        await openUnlockWindow();
        throw new Error('Wallet is locked. Unlock Cinder Wallet and try again.');
      }
      return { pendingId: await enqueueApproval('connect', origin) };
    }
    case 'WALLET_DISCONNECT':
      await origins.disconnect(origin);
      return { disconnected: true };
    case 'SIGN_MESSAGE':
      await requireConnected(origin);
      return {
        pendingId: await enqueueApproval('signMessage', origin, { messageBytes: [...request.message] }),
      };
    case 'SIGN_TRANSACTION':
    case 'SIGN_AND_SEND_TRANSACTION': {
      await requireConnected(origin);
      const kind = request.type === 'SIGN_AND_SEND_TRANSACTION' ? 'signAndSendTransaction' : 'signTransaction';
      return {
        pendingId: await enqueueApproval(kind, origin, { transactionBytes: [...request.transaction] }),
      };
    }
    case 'PREVIEW_TRANSACTION':
      return previewTransaction(Uint8Array.from(request.transaction));
    case 'GET_PENDING_REQUEST':
      return { request: await getPending(request.id) };
    case 'POLL_APPROVAL':
      return getApprovalResult(request.id);
    case 'APPROVE_REQUEST': {
      const pending = await getPending(request.id);
      if (!pending) throw new Error('Approval expired — unlock and retry the dApp request');
      await resolveApproval(pending.id, await fulfillApproval(pending));
      return {};
    }
    case 'REJECT_REQUEST':
      await rejectApproval(request.id, request.reason || 'User rejected');
      return {};
    case 'CANCEL_APPROVAL':
      // The page gave up waiting (its 120 s timeout); a later Approve must not sign.
      // The id is unguessable, so the page can only cancel its own request.
      await rejectApproval(request.id, 'Request timeout');
      return {};
    case 'GET_CONNECTED_SITES':
      return { sites: await origins.list() };
    case 'REVOKE_SITE':
      await origins.disconnect(request.origin);
      return {};
    case 'SEND_TRANSFER':
      return {
        signature: await sendTransfer({
          to: request.to,
          amountSmallest: request.amountSmallest,
          mint: request.mint,
        }),
      };
    default:
      return assertNever(request);
  }
}

export async function fulfillApproval(request: PendingApproval): Promise<Record<string, unknown>> {
  if (request.kind === 'connect') {
    const next = await getPublicState();
    await origins.connect(
      request.origin,
      next.accounts.map((account) => account.index),
    );
    return {
      connected: true,
      accounts: addresses(next),
      publicKey: next.accounts[next.activeAccountIndex]?.address,
    };
  }
  if (request.kind === 'signMessage') {
    const signature = await signMessage(Uint8Array.from(request.messageBytes || []));
    return { signature: [...signature] };
  }
  const bytes = Uint8Array.from(request.transactionBytes || []);
  const signed = await signTransactionBytes(bytes);
  if (request.kind === 'signAndSendTransaction') {
    const connection = await getConnection();
    const signature = await connection.sendRawTransaction(signed, { skipPreflight: false });
    // Wallet Standard wants the 64 raw signature bytes; the RPC hands back base58.
    return { signedTransaction: [...signed], signature: [...bs58.decode(signature)] };
  }
  return { signedTransaction: [...signed] };
}

async function signTransactionBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const keypair = await getKeypair();
  try {
    const tx = VersionedTransaction.deserialize(bytes);
    tx.sign([keypair]);
    return tx.serialize();
  } catch {
    const tx = Transaction.from(bytes);
    tx.partialSign(keypair);
    return tx.serialize();
  }
}

export async function previewTransaction(bytes: Uint8Array): Promise<{ preview: PreviewResult }> {
  const preview = await buildPreview(bytes, async (tx) => {
    const connection = await getConnection();
    const simulation = tx instanceof VersionedTransaction
      ? await connection.simulateTransaction(tx, { sigVerify: false, innerInstructions: true })
      : await connection.simulateTransaction(tx);
    return simulation.value;
  });
  // Nested so the preview's own `success` never collides with the message envelope.
  return { preview };
}
