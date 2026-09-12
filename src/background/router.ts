import {
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { isExtensionMessageType, type PendingApproval } from '../lib/messages';
import { isRequestAllowed, type SenderLike } from '../lib/sender-gate';
import { buildPreview } from '../lib/preview';
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
import { getConnection, sendTransfer } from './transfers';

/**
 * Worker entry for one runtime message. Gate on the sender first, then
 * dispatch. `extensionBase` is `chrome.runtime.getURL('')`, passed in so this
 * module never touches `chrome.*` at import time and stays unit-testable.
 */
export async function handleMessage(
  raw: unknown,
  sender: SenderLike,
  extensionBase: string
): Promise<Record<string, unknown>> {
  const request = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const type = request.type;
  if (typeof type !== 'string' || !isExtensionMessageType(type)) {
    throw new Error('Unknown message type');
  }

  if (!isRequestAllowed(type, sender, extensionBase)) {
    throw new Error('Not allowed from a page');
  }

  // Trust the browser's view of who sent this, never a field in the payload.
  const origin = sender.origin || sender.url || '';

  return dispatch(type, request, origin);
}

async function dispatch(
  type: string,
  request: Record<string, unknown>,
  origin: string
): Promise<Record<string, unknown>> {
  switch (type) {
    case 'GET_STATE':
      return { state: await getPublicState() };
    case 'GET_SETTINGS':
      return { settings: await getSettings() };
    case 'UPDATE_SETTINGS':
      return { settings: await updateSettings((request.settings ?? {}) as object) };
    case 'CREATE_WALLET':
      return {
        state: await createWallet(
          String(request.password),
          request.seedPhrase ? String(request.seedPhrase) : undefined
        ),
      };
    case 'UNLOCK':
      return { state: await unlock(String(request.password)) };
    case 'LOCK':
      return { state: await lock() };
    case 'CLEAR_WALLET':
      return { state: await clearWallet() };
    case 'SWITCH_ACCOUNT':
      return { state: await switchAccount(Number(request.index)) };
    case 'CHANGE_PASSWORD':
      await changePassword(String(request.currentPassword), String(request.newPassword));
      return {};
    case 'EXPORT_SEED':
      return { seedPhrase: await exportSeed(String(request.password)) };
    case 'EXPORT_PRIVATE_KEY':
      return {
        privateKey: await exportPrivateKey(String(request.password), Number(request.accountIndex ?? 0)),
      };
    case 'GET_ACCOUNTS': {
      const state = await getPublicState();
      if (state.isLocked) return { accounts: [] };
      return { accounts: state.accounts.map((account) => account.address) };
    }
    case 'WALLET_CONNECT': {
      const state = await getPublicState();
      if (state.isLocked) {
        await openUnlockWindow();
        throw new Error('Wallet is locked. Unlock Cinder Wallet and try again.');
      }
      return { pendingId: await enqueueApproval('connect', origin) };
    }
    case 'WALLET_DISCONNECT':
      return { disconnected: true };
    case 'SIGN_MESSAGE': {
      const message = Uint8Array.from(request.message as number[]);
      return {
        pendingId: await enqueueApproval('signMessage', origin, { messageBytes: [...message] }),
      };
    }
    case 'SIGN_TRANSACTION':
    case 'SIGN_AND_SEND_TRANSACTION': {
      const bytes = Uint8Array.from(request.transaction as number[]);
      const kind = type === 'SIGN_AND_SEND_TRANSACTION' ? 'signAndSendTransaction' : 'signTransaction';
      return {
        pendingId: await enqueueApproval(kind, origin, { transactionBytes: [...bytes] }),
      };
    }
    case 'PREVIEW_TRANSACTION': {
      const bytes = Uint8Array.from(request.transaction as number[]);
      return previewTransaction(bytes);
    }
    case 'GET_PENDING_REQUEST': {
      const pending = await getPending(String(request.id));
      return { request: pending };
    }
    case 'POLL_APPROVAL':
      return getApprovalResult(String(request.id));
    case 'APPROVE_REQUEST': {
      const pending = await getPending(String(request.id));
      if (!pending) throw new Error('Approval expired — unlock and retry the dApp request');
      await resolveApproval(pending.id, await fulfillApproval(pending));
      return {};
    }
    case 'REJECT_REQUEST':
      await rejectApproval(String(request.id), String(request.reason || 'User rejected'));
      return {};
    case 'SEND_TRANSFER': {
      const signature = await sendTransfer({
        to: String(request.to),
        amountSmallest: String(request.amountSmallest),
        mint: request.mint ? String(request.mint) : undefined,
      });
      return { signature };
    }
    default:
      throw new Error('Unknown message type');
  }
}

export async function fulfillApproval(request: PendingApproval): Promise<Record<string, unknown>> {
  if (request.kind === 'connect') {
    const next = await getPublicState();
    return {
      connected: true,
      accounts: next.accounts.map((account) => account.address),
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

export async function previewTransaction(bytes: Uint8Array): Promise<Record<string, unknown>> {
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
