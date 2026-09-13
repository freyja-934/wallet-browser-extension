import { PublicKey, VersionedTransaction, type AccountInfo, type Connection } from '@solana/web3.js';
import { MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import {
  CHAIN_FOR_CLUSTER,
  isExtensionMessageType,
  UNSUPPORTED_CHAINS,
  type Commitment,
  type PendingApproval,
  type SendOptions,
  type WalletPublicState,
  type WalletSettings,
} from '../lib/messages';
import { parseRequest, type WalletRequest, type WalletResponse } from '../lib/protocol';
import { isExtensionSender, isRequestAllowed, pageOrigin, type SenderLike } from '../lib/sender-gate';
import { buildPreview, type PreviewResult } from '../lib/preview';
import { isTransactionMessage } from '../lib/tx-preview';
import {
  addAccount,
  changePassword,
  clearWallet,
  createWallet,
  exportPrivateKey,
  exportSeed,
  getPublicState,
  getSettings,
  lock,
  renameAccount,
  signMessage,
  switchAccount,
  touchActivity,
  unlock,
  updateSettings,
  getKeypair,
} from './keyring';
import {
  cancelApproval,
  claimApproval,
  enqueueApproval,
  getApprovalResult,
  getPending,
  NETWORK_CHANGED_MESSAGE,
  onCluster,
  rejectApproval,
  rejectForClusterChange,
  rejectForOrigin,
  settleClaimed,
} from './approvals';
import { addressesActiveFirst, sendToConnected, sendWalletEvent, snapshot } from './events';
import * as origins from './origins';
import { estimateTransfer, getConnection, sendTransfer, type TransferParams } from './transfers';

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

  if (isExtensionSender(sender, extensionBase)) {
    // The user is in the popup or approval window: push the auto-lock out again.
    await touchActivity();
    return dispatch(parseRequest(raw), { origin: extensionBase.replace(/\/$/, ''), page: false });
  }

  // Trust the browser's view of who sent this, never a field in the payload —
  // and only a real web origin gets a grant, a pending request, or a registry entry.
  const origin = pageOrigin(sender);
  if (origin === null) throw new Error('Untrusted sender');
  const frame = typeof sender.tab?.id === 'number'
    ? { tabId: sender.tab.id, frameId: typeof sender.frameId === 'number' ? sender.frameId : 0 }
    : undefined;
  // Note where the page is so events can reach it later.
  await origins.remember(sender, origin);
  return dispatch(parseRequest(raw), { origin, page: true, frame });
}

interface Caller {
  origin: string;
  /** A web page (content script) rather than the popup or approval window. */
  page: boolean;
  /** The tab and frame a page spoke from; absent for extension pages. */
  frame?: { tabId: number; frameId: number };
}

async function requireConnected(origin: string): Promise<void> {
  if (!(await origins.isConnected(origin))) throw new Error('Not connected');
}

/** Active account first: a dApp takes `accounts[0]` as the one to use. */
function addresses(state: Pick<WalletPublicState, 'accounts' | 'activeAccountIndex'>): string[] {
  return addressesActiveFirst(state);
}

function assertNever(_request: never): never {
  throw new Error('Unknown message type');
}

const CLUSTER_LABEL: Record<WalletSettings['cluster'], string> = { 'mainnet-beta': 'Mainnet', devnet: 'Devnet' };

/**
 * A page may name the chain it built the transaction for. No chain means the
 * active cluster; testnet and localnet have no cluster here; the other cluster
 * is refused with a hint, since the wallet does not switch on a page's behalf.
 * Returns the active cluster, which the pending request records.
 */
async function assertChain(chain: string | undefined): Promise<WalletSettings['cluster']> {
  if (chain !== undefined && (UNSUPPORTED_CHAINS as readonly string[]).includes(chain)) {
    throw new Error('Cinder does not support that network');
  }
  const { cluster } = await getSettings();
  if (chain !== undefined && chain !== CHAIN_FOR_CLUSTER[cluster]) {
    throw new Error(`Cinder is on ${CLUSTER_LABEL[cluster]}; switch networks in Settings`);
  }
  return cluster;
}

async function dispatch(request: WalletRequest, caller: Caller): Promise<WalletResponse> {
  const { origin, frame } = caller;
  // A page may poll or cancel only its own request; extension pages are unrestricted.
  const own = caller.page ? origin : undefined;
  switch (request.type) {
    case 'GET_STATE':
      return { state: await getPublicState() };
    case 'GET_SETTINGS':
      return { settings: await getSettings() };
    case 'UPDATE_SETTINGS': {
      const before = (await getSettings()).cluster;
      const settings = await updateSettings(request.settings);
      if (settings.cluster !== before) {
        // A transaction waiting for Approve was built for the old cluster; it cannot be signed now.
        await rejectForClusterChange(settings.cluster);
        const { accounts } = await snapshot();
        await sendToConnected('clusterChanged', { accounts, cluster: settings.cluster });
      }
      return { settings };
    }
    case 'CREATE_WALLET':
      return { state: await createWallet(request.password, request.seedPhrase) };
    case 'UNLOCK':
      return { state: await unlock(request.password) };
    case 'LOCK':
      return { state: await lock() };
    case 'CLEAR_WALLET':
      return { state: await clearWallet() };
    case 'SWITCH_ACCOUNT': {
      const state = await switchAccount(request.index);
      await sendToConnected('accountsChanged', await snapshot());
      return { state };
    }
    // A new or renamed account changes the list a connected page holds, so both
    // emit the same event as a switch: the active account can move to the front.
    case 'ADD_ACCOUNT': {
      const state = await addAccount();
      await sendToConnected('accountsChanged', await snapshot());
      return { state };
    }
    case 'RENAME_ACCOUNT': {
      const state = await renameAccount(request.index, request.name);
      await sendToConnected('accountsChanged', await snapshot());
      return { state };
    }
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
      const { cluster } = await getSettings();
      // A site that already connected gets its accounts back without a prompt.
      if (!state.isLocked && (await origins.isConnected(origin))) return { accounts: addresses(state), cluster };
      // Silent connects never open a window: nothing to show is an empty account list.
      if (request.silent) return { accounts: [], cluster };
      // Locked: the approval window renders the unlock form first, then the request.
      return { pendingId: await enqueueApproval('connect', origin, { ...frame }) };
    }
    case 'WALLET_DISCONNECT': {
      // Whatever the site still had waiting can no longer be approved.
      await rejectForOrigin(origin, 'Disconnected');
      await origins.disconnect(origin);
      const { cluster } = await snapshot();
      // The frame that asked emits its own `change`; its other frames and tabs hear it from here.
      await sendWalletEvent('disconnected', { origin, accounts: [], cluster, exclude: frame });
      return { disconnected: true };
    }
    case 'SIGN_MESSAGE': {
      await requireConnected(origin);
      // A signature over serialized message bytes is a valid transaction signature; never make one here.
      if (request.messages.some((message) => isTransactionMessage(Uint8Array.from(message)))) {
        throw new Error('Refusing to sign a transaction as a message');
      }
      const messages = request.messages.map((message) => [...message]);
      // One approval for the whole batch: the window shows every item, the page gets every signature.
      return { pendingId: await enqueueApproval('signMessage', origin, { ...frame, messages }) };
    }
    case 'SIGN_TRANSACTION':
    case 'SIGN_AND_SEND_TRANSACTION': {
      await requireConnected(origin);
      const clusterAtEnqueue = await assertChain(request.chain);
      const kind = request.type === 'SIGN_AND_SEND_TRANSACTION' ? 'signAndSendTransaction' : 'signTransaction';
      const extra: Partial<PendingApproval> = {
        ...frame,
        transactions: request.transactions.map((transaction) => [...transaction]),
        clusterAtEnqueue,
      };
      if (request.chain !== undefined) extra.chain = request.chain;
      if (request.options !== undefined) extra.options = { ...request.options };
      return { pendingId: await enqueueApproval(kind, origin, extra) };
    }
    case 'PREVIEW_TRANSACTION':
      return previewTransaction(Uint8Array.from(request.transaction));
    case 'GET_PENDING_REQUEST':
      return { request: await getPending(request.id) };
    case 'POLL_APPROVAL':
      return getApprovalResult(request.id, own);
    case 'APPROVE_REQUEST': {
      // The approval window unlocks inline first; nothing is approved on a locked wallet.
      if ((await getPublicState()).isLocked) throw new Error('Wallet is locked');
      // Claim before doing anything irreversible: from here on, nothing else can settle it,
      // so the page is told what actually happened (a broadcast in particular).
      const pending = await claimApproval(request.id, { requireConnected: true });
      let value: Record<string, unknown>;
      try {
        // The cluster may have changed since the request was enqueued (and since the
        // window rendered its preview): a transaction built for the other one is refused here.
        if (!onCluster(pending, (await getSettings()).cluster)) throw new Error(NETWORK_CHANGED_MESSAGE);
        value = await fulfillApproval(pending);
      } catch (error) {
        // Whatever failed, the request is finished: it must never be approvable again.
        await settleClaimed(pending.id, { status: 'rejected', error: errorText(error, 'Approval failed') });
        throw error;
      }
      await settleClaimed(pending.id, { status: 'approved', value });
      return {};
    }
    case 'REJECT_REQUEST':
      await rejectApproval(request.id, request.reason || 'User rejected');
      return {};
    case 'CANCEL_APPROVAL':
      // The page gave up waiting (its timeout, or it went away); a later Approve must not sign.
      // Only the page's own request, and never one already being fulfilled.
      if (own === undefined) await rejectApproval(request.id, 'Request timeout');
      else await cancelApproval(request.id, own);
      return {};
    case 'GET_CONNECTED_SITES':
      return { sites: await origins.list() };
    case 'REVOKE_SITE': {
      await rejectForOrigin(request.origin, 'Site revoked');
      await origins.disconnect(request.origin);
      const { cluster } = await snapshot();
      await sendWalletEvent('revoked', { origin: request.origin, accounts: [], cluster });
      return {};
    }
    case 'SEND_TRANSFER':
      return {
        signature: await exclusiveSend({
          to: request.to,
          amountSmallest: request.amountSmallest,
          mint: request.mint,
          source: request.source,
        }),
      };
    case 'ESTIMATE_FEE':
      return estimateTransfer({
        to: request.to,
        amountSmallest: request.amountSmallest,
        mint: request.mint,
        source: request.source,
      });
    default:
      return assertNever(request);
  }
}

export const SEND_IN_PROGRESS_MESSAGE = 'A send is already in progress';

/**
 * One popup send at a time. Confirmation runs for as long as a blockhash lives,
 * and a second `SEND_TRANSFER` in that window — a double-click, or a popup
 * reopened on a stale Review — would sign and broadcast a second transfer of the
 * same funds. The guard is a module-level promise: the worker is single-threaded
 * per instance, and a worker that was evicted mid-send has no in-flight send to
 * protect anyway.
 */
let sendInFlight: Promise<string> | null = null;

async function exclusiveSend(params: TransferParams): Promise<string> {
  if (sendInFlight) throw new Error(SEND_IN_PROGRESS_MESSAGE);
  const attempt = sendTransfer(params);
  sendInFlight = attempt;
  try {
    return await attempt;
  } finally {
    if (sendInFlight === attempt) sendInFlight = null;
  }
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function fulfillApproval(request: PendingApproval): Promise<Record<string, unknown>> {
  if (request.kind === 'connect') {
    const next = await getPublicState();
    await origins.connect(
      request.origin,
      next.accounts.map((account) => account.index),
    );
    const { cluster } = await getSettings();
    return {
      connected: true,
      accounts: addresses(next),
      publicKey: next.accounts[next.activeAccountIndex]?.address,
      cluster,
    };
  }
  if (request.kind === 'signMessage') {
    const signatures: number[][] = [];
    for (const message of request.messages ?? []) {
      signatures.push([...(await signMessage(Uint8Array.from(message)))]);
    }
    return { signatures };
  }
  // Every item in the order the page gave them; the outputs line up with the inputs.
  const signed: Uint8Array[] = [];
  for (const transaction of request.transactions ?? []) {
    signed.push(await signTransactionBytes(Uint8Array.from(transaction)));
  }
  if (request.kind === 'signAndSendTransaction') {
    const connection = await getConnection();
    const signatures: number[][] = [];
    for (const bytes of signed) {
      const signature = await connection.sendRawTransaction(bytes, sendOptionsFor(request.options));
      if (request.options?.commitment) {
        await waitForCommitment(connection, signature, request.options.commitment, request.deadline);
      }
      // Wallet Standard wants the 64 raw signature bytes; the RPC hands back base58.
      signatures.push([...bs58.decode(signature)]);
    }
    return { signatures };
  }
  return { signedTransactions: signed.map((bytes) => [...bytes]) };
}

/** The four `sendRawTransaction` options a page may set; preflight stays on unless it asked otherwise. */
function sendOptionsFor(options: SendOptions | undefined): {
  skipPreflight: boolean;
  preflightCommitment?: Commitment;
  maxRetries?: number;
  minContextSlot?: number;
} {
  const out: ReturnType<typeof sendOptionsFor> = { skipPreflight: options?.skipPreflight ?? false };
  if (options?.preflightCommitment !== undefined) out.preflightCommitment = options.preflightCommitment;
  if (options?.maxRetries !== undefined) out.maxRetries = options.maxRetries;
  if (options?.minContextSlot !== undefined) out.minContextSlot = options.minContextSlot;
  return out;
}

const COMMITMENT_RANK: Record<Commitment, number> = { processed: 0, confirmed: 1, finalized: 2 };
/** How long a `commitment` may hold the page's answer; after this the signature is returned as sent. */
export const CONFIRMATION_TIMEOUT_MS = 30_000;
export const CONFIRMATION_POLL_MS = 500;
/** The wait stops this long before the request's page deadline, so the answer always lands before the page gives up. */
export const CONFIRMATION_MARGIN_MS = 5_000;

/**
 * Poll `getSignatureStatuses` until the transaction reaches `commitment` or has
 * landed with an error, giving up after `CONFIRMATION_TIMEOUT_MS` or
 * `CONFIRMATION_MARGIN_MS` before `requestDeadline`, whichever is sooner. Never
 * throws: the transaction was already broadcast, so the page always gets its signature.
 */
async function waitForCommitment(
  connection: Pick<Connection, 'getSignatureStatuses'>,
  signature: string,
  commitment: Commitment,
  requestDeadline: number,
): Promise<void> {
  const deadline = Math.min(Date.now() + CONFIRMATION_TIMEOUT_MS, requestDeadline - CONFIRMATION_MARGIN_MS);
  while (Date.now() < deadline) {
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) return;
      const reached = status?.confirmationStatus;
      if (reached && COMMITMENT_RANK[reached] >= COMMITMENT_RANK[commitment]) return;
    } catch {
      /* transient RPC failure: try again until the deadline */
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_MS));
  }
}

/** `VersionedTransaction.deserialize` accepts legacy wire bytes too, so there is one path. */
async function signTransactionBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const keypair = await getKeypair();
  const tx = VersionedTransaction.deserialize(bytes);
  tx.sign([keypair]);
  return tx.serialize();
}

const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

/** The decimals of every mint account among `infos`, keyed by address; anything that is not a mint is skipped. */
function mintDecimals(mints: PublicKey[], infos: (AccountInfo<Buffer> | null)[]): Map<string, number> {
  const out = new Map<string, number>();
  mints.forEach((mint, i) => {
    const info = infos[i];
    if (!info || !TOKEN_PROGRAMS.has(info.owner.toBase58()) || info.data.length < MINT_SIZE) return;
    try {
      out.set(mint.toBase58(), MintLayout.decode(info.data.subarray(0, MINT_SIZE)).decimals);
    } catch {
      /* not a mint */
    }
  });
  return out;
}

/**
 * The preview for the approval window. Every network read goes through the
 * rotated connection and is fetched lazily, so an endpoint failure reaches the
 * screen as a decode-only preview with the error, never as a thrown message.
 *
 * The balance diff is relative to the slot the pre-state was read at: the
 * accounts come from `getMultipleAccountsInfoAndContext`, and its
 * `context.slot` is passed to `simulateTransaction` as `minContextSlot`, so a
 * simulation on a node behind that slot is refused rather than diffed against
 * older state. `buildPreview` always reads accounts before it simulates, so the
 * slot travels between the two deps here and the pure pipeline is unchanged.
 */
export async function previewTransaction(bytes: Uint8Array): Promise<{ preview: PreviewResult }> {
  const state = await getPublicState();
  const active = state.accounts[state.activeAccountIndex]?.address;
  if (state.isLocked || !active) throw new Error('Wallet is locked');
  let preStateSlot: number | undefined;
  const preview = await buildPreview(bytes, {
    owner: new PublicKey(active),
    fetchLookupTables: async (keys) => {
      const connection = await getConnection();
      const tables = await Promise.all(keys.map((key) => connection.getAddressLookupTable(key)));
      return tables.flatMap((table) => (table.value ? [table.value] : []));
    },
    fetchAccounts: async (keys) => {
      const connection = await getConnection();
      const { context, value: infos } = await connection.getMultipleAccountsInfoAndContext(keys);
      preStateSlot = context.slot;
      return new Map(keys.map((key, i) => [key.toBase58(), infos[i] ?? null]));
    },
    fetchMintDecimals: async (mints) => {
      const connection = await getConnection();
      return mintDecimals(mints, await connection.getMultipleAccountsInfo(mints));
    },
    simulate: async (tx, addresses) => {
      const connection = await getConnection();
      // The RPC refuses sigVerify together with replaceRecentBlockhash; the bytes are unsigned anyway.
      const simulation = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        innerInstructions: true,
        accounts: { encoding: 'base64', addresses },
        // Never diff against state older than the pre-state read.
        ...(preStateSlot !== undefined ? { minContextSlot: preStateSlot } : {}),
      });
      return simulation.value;
    },
  });
  // Nested so the preview's own `success` never collides with the message envelope.
  return { preview };
}
