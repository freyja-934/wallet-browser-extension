/// <reference types="chrome" />

import './buffer-polyfill';
import {
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { isExtensionMessageType, type PendingApproval } from '../lib/messages';
import { deserializeTransaction, getInstructions, decodeInstruction, collectWarnings } from '../lib/tx-preview';
import {
  changePassword,
  clearWallet,
  createWallet,
  exportPrivateKey,
  exportSeed,
  getPublicState,
  getSettings,
  lock,
  registerAutoLock,
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

registerAutoLock();

console.log('Lumen service worker initialized');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ network: 'mainnet-beta' });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const type = request?.type as string;
  if (!type || !isExtensionMessageType(type)) {
    sendResponse({ success: false, error: 'Unknown message type' });
    return false;
  }

  const origin = request.origin || sender.origin || sender.url || '';

  void (async () => {
    try {
      const result = await handleMessage(type, request, origin);
      sendResponse({ success: true, ...result });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  })();

  return true;
});

async function handleMessage(
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
        throw new Error('Wallet is locked. Unlock Lumen and try again.');
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

async function fulfillApproval(request: PendingApproval): Promise<Record<string, unknown>> {
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
    const connection = getConnection();
    const signature = await connection.sendRawTransaction(signed, { skipPreflight: false });
    return { signedTransaction: [...signed], signature };
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

async function previewTransaction(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const connection = getConnection();
  const tx = deserializeTransaction(bytes);
  const instructions = getInstructions(tx).map(decodeInstruction);
  const warnings = collectWarnings(instructions);

  try {
    const simulation = tx instanceof VersionedTransaction
      ? await connection.simulateTransaction(tx, { sigVerify: false, innerInstructions: true })
      : await connection.simulateTransaction(tx);
    const err = simulation.value.err;
    return {
      success: !err,
      error: err ? JSON.stringify(err) : undefined,
      logs: simulation.value.logs ?? [],
      unitsConsumed: simulation.value.unitsConsumed,
      instructions,
      warnings,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Simulation failed',
      instructions,
      warnings,
    };
  }
}
