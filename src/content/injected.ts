import { SOLANA_DEVNET_CHAIN, SOLANA_MAINNET_CHAIN } from '@solana/wallet-standard-chains';
import {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import type { IdentifierString, Wallet, WalletAccount } from '@wallet-standard/base';
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
  type StandardEventsListeners,
} from '@wallet-standard/features';
import { registerWallet } from '@wallet-standard/wallet';
import bs58 from 'bs58';
import { SINGLE_SEND_MESSAGE } from '../lib/bridge';
import { PAGE_TIMEOUT_MS, WALLET_CHANNEL } from '../lib/messages';
import { CINDER_ICON_DATA_URI } from '../config/brand';
import { WALLET_NAME } from '../config/constants';

/**
 * What a reply from the extension can carry: the worker's envelope for an
 * answer it had straight away, or the value an approval settled with (which
 * `awaitApproval` stamps `success: true` onto). None of it is trusted — this
 * code runs in the page's own world — so the payload fields stay `unknown` and
 * every one is checked where it is read.
 */
interface WalletReply {
  success?: boolean;
  error?: string;
  accounts?: unknown;
  cluster?: unknown;
  signatures?: unknown;
  signedTransactions?: unknown;
}

/** A reply is an object or nothing at all; anything else is not an answer. */
function asReply(value: unknown): WalletReply | undefined {
  return value !== null && typeof value === 'object' ? (value as WalletReply) : undefined;
}

(() => {
  let messageId = 0;
  const pending = new Map<number, { resolve: (value: WalletReply | undefined) => void; reject: (error: Error) => void }>();
  const listeners: { [K in keyof StandardEventsListeners]?: Set<StandardEventsListeners[K]> } = {};

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.channel !== WALLET_CHANNEL) return;
    // Worker events carry `event` and no `id`; they never match a pending request.
    if (typeof event.data.event === 'string' && event.data.id === undefined) {
      handleWalletEvent(event.data.event, event.data.accounts, event.data.cluster);
      return;
    }
    if (event.data.id === undefined || !pending.has(event.data.id)) return;
    // Outbound requests include `type`; only inbound replies have response/error.
    if (event.data.type) return;
    if (event.data.response === undefined && event.data.error === undefined) return;
    const entry = pending.get(event.data.id)!;
    pending.delete(event.data.id);
    if (event.data.error) entry.reject(new Error(event.data.error));
    else entry.resolve(asReply(event.data.response));
  });

  function send(type: string, payload: Record<string, unknown> = {}): Promise<WalletReply | undefined> {
    return new Promise<WalletReply | undefined>((resolve, reject) => {
      const id = messageId++;
      pending.set(id, { resolve, reject });
      window.postMessage({ channel: WALLET_CHANNEL, id, type, payload }, window.location.origin);
      // The content script withdraws an approval strictly before this fires.
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('Request timeout'));
        }
      }, PAGE_TIMEOUT_MS);
    });
  }

  function emit<E extends keyof StandardEventsListeners>(event: E, ...args: Parameters<StandardEventsListeners[E]>) {
    listeners[event]?.forEach((handler) => {
      try {
        (handler as (...a: unknown[]) => void)(...args);
      } catch (error) {
        console.error('Cinder Wallet event handler error', error);
      }
    });
  }

  /**
   * The chain an account can sign for right now. wallet-adapter refuses to send
   * through an account whose `chains` lack the endpoint's chain, so each account
   * carries exactly the wallet's active cluster; the wallet itself lists both.
   */
  function chainsFor(cluster: string | undefined): IdentifierString[] {
    return cluster === 'devnet' ? [SOLANA_DEVNET_CHAIN] : [SOLANA_MAINNET_CHAIN];
  }

  function bytesToAccount(address: string, cluster: string | undefined): WalletAccount {
    return {
      address,
      publicKey: decodeAddress(address),
      chains: chainsFor(cluster),
      features: [
        SolanaSignTransaction,
        SolanaSignAndSendTransaction,
        SolanaSignMessage,
      ],
    };
  }

  function decodeAddress(address: string): Uint8Array {
    try {
      const bytes = bs58.decode(address);
      return bytes.length === 32 ? bytes : new Uint8Array(32);
    } catch {
      return new Uint8Array(32);
    }
  }

  /** The worker orders the active account first; `accounts[0]` is what a dApp uses. */
  let accounts: WalletAccount[] = [];
  /** The wallet's active cluster as last reported; every account's `chains` follows it. */
  let currentCluster: string | undefined;

  function sameChains(a: readonly IdentifierString[], b: readonly IdentifierString[]): boolean {
    return a.length === b.length && a.every((chain, i) => chain === b[i]);
  }

  /**
   * Replace the account list, keeping the object of every account whose address
   * and chains are unchanged (dApps compare accounts by identity), and emit
   * `change` only when something actually changed: the addresses, their order,
   * or their chains.
   */
  function applyAccounts(next: WalletAccount[]): void {
    const merged = next.map((account) => {
      const existing = accounts.find((current) => current.address === account.address);
      return existing && sameChains(existing.chains, account.chains) ? existing : account;
    });
    const changed = merged.length !== accounts.length || merged.some((account, i) => account !== accounts[i]);
    accounts = merged;
    if (changed) emit('change', { accounts });
  }

  function setAccounts(addresses: unknown, cluster: unknown): void {
    if (typeof cluster === 'string') currentCluster = cluster;
    const list = Array.isArray(addresses)
      ? addresses.filter((address): address is string => typeof address === 'string')
      : [];
    applyAccounts(list.map((address) => bytesToAccount(address, currentCluster)));
  }

  function handleWalletEvent(name: string, nextAccounts: unknown, cluster: unknown): void {
    if (typeof cluster === 'string') currentCluster = cluster;
    switch (name) {
      case 'locked':
      case 'disconnected':
      case 'revoked':
      case 'cleared':
        applyAccounts([]);
        return;
      case 'accountsChanged':
      case 'clusterChanged':
        // A cluster change re-stamps every account's chains without a reconnect.
        setAccounts(nextAccounts, cluster);
        return;
      default:
        return;
    }
  }

  function toBytes(value: Uint8Array | ArrayBuffer | ArrayLike<number>): Uint8Array {
    return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
  }

  /** Every input must name one of this wallet's accounts and, when it names a chain, the same one. */
  function checkInputs(inputs: readonly { account: WalletAccount; chain?: IdentifierString }[]): IdentifierString | undefined {
    const known = new Set(accounts.map((account) => account.address));
    let chain: IdentifierString | undefined;
    for (const input of inputs) {
      if (!known.has(input.account?.address)) throw new Error('Invalid account');
      if (input.chain !== undefined) {
        if (chain !== undefined && chain !== input.chain) throw new Error('All inputs must use the same chain');
        chain = input.chain;
      }
    }
    return chain;
  }

  const OPTION_KEYS = ['skipPreflight', 'preflightCommitment', 'maxRetries', 'minContextSlot', 'commitment'] as const;

  /** Only the options the worker understands, copied one by one; the worker validates them again. */
  function pickOptions(options: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!options) return undefined;
    const out: Record<string, unknown> = {};
    for (const key of OPTION_KEYS) {
      if (options[key] !== undefined) out[key] = options[key];
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /**
   * One batch carries one set of options: the worker applies them to every
   * item, so inputs that disagree are refused rather than silently given the
   * first input's options. Returns the shared options.
   */
  function sharedOptions(inputs: readonly { options?: Record<string, unknown> }[]): Record<string, unknown> | undefined {
    const first = pickOptions(inputs[0]?.options);
    const key = (options: Record<string, unknown> | undefined) =>
      OPTION_KEYS.map((name) => `${name}=${JSON.stringify(options?.[name])}`).join('&');
    const expected = key(first);
    for (const input of inputs.slice(1)) {
      if (key(pickOptions(input.options)) !== expected) {
        throw new Error('All transactions in a request must share the same options');
      }
    }
    return first;
  }

  function withChainAndOptions(
    payload: Record<string, unknown>,
    chain: IdentifierString | undefined,
    options: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (chain !== undefined) payload.chain = chain;
    if (options !== undefined) payload.options = options;
    return payload;
  }

  const wallet: Wallet & { readonly cluster: string | undefined } = {
    // The Wallet Standard version, not the app version: the spec's WalletVersion is the literal '1.0.0'.
    version: '1.0.0',
    name: WALLET_NAME,
    icon: CINDER_ICON_DATA_URI,
    chains: [SOLANA_MAINNET_CHAIN, SOLANA_DEVNET_CHAIN],
    get accounts() {
      return accounts;
    },
    get cluster() {
      return currentCluster;
    },
    features: {
      [StandardConnect]: {
        version: '1.0.0',
        connect: async (input) => {
          const response = await send('WALLET_CONNECT', { silent: !!input?.silent });
          if (!response?.success) throw new Error(response?.error || 'Connect failed');
          setAccounts(response.accounts ?? [], response.cluster);
          return { accounts };
        },
      } satisfies StandardConnectFeature[typeof StandardConnect],
      [StandardDisconnect]: {
        version: '1.0.0',
        disconnect: async () => {
          await send('WALLET_DISCONNECT');
          applyAccounts([]);
        },
      } satisfies StandardDisconnectFeature[typeof StandardDisconnect],
      [StandardEvents]: {
        version: '1.0.0',
        on: (event, listener) => {
          (listeners[event] ??= new Set()).add(listener);
          return () => listeners[event]?.delete(listener);
        },
      } satisfies StandardEventsFeature[typeof StandardEvents],
      [SolanaSignTransaction]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async (...inputs) => {
          if (inputs.length === 0) return [];
          // One message, one approval window, N signed transactions in the same order.
          const chain = checkInputs(inputs);
          const options = sharedOptions(inputs);
          const transactions = inputs.map((input) => [...toBytes(input.transaction)]);
          const response = await send('SIGN_TRANSACTION', withChainAndOptions({ transactions }, chain, options));
          const signed: unknown = response?.signedTransactions;
          if (!Array.isArray(signed) || signed.length !== inputs.length) {
            throw new Error(response?.error || 'Sign failed');
          }
          return signed.map((bytes) => ({ signedTransaction: Uint8Array.from(bytes as number[]) }));
        },
      } satisfies SolanaSignTransactionFeature[typeof SolanaSignTransaction],
      [SolanaSignAndSendTransaction]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs) => {
          if (inputs.length === 0) return [];
          // One per call: a batch broadcast is not atomic, and the worker refuses it with the same message.
          if (inputs.length > 1) throw new Error(SINGLE_SEND_MESSAGE);
          const chain = checkInputs(inputs);
          const transactions = inputs.map((input) => [...toBytes(input.transaction)]);
          const response = await send(
            'SIGN_AND_SEND_TRANSACTION',
            withChainAndOptions({ transactions }, chain, pickOptions(inputs[0].options)),
          );
          const signatures: unknown = response?.signatures;
          if (!Array.isArray(signatures) || signatures.length !== inputs.length) {
            throw new Error(response?.error || 'Send failed');
          }
          return signatures.map((bytes) => ({ signature: Uint8Array.from(bytes as number[]) }));
        },
      } satisfies SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction],
      [SolanaSignMessage]: {
        version: '1.0.0',
        signMessage: async (...inputs) => {
          if (inputs.length === 0) return [];
          checkInputs(inputs);
          const messages = inputs.map((input) => toBytes(input.message));
          const response = await send('SIGN_MESSAGE', { messages: messages.map((message) => [...message]) });
          const signatures: unknown = response?.signatures;
          if (!Array.isArray(signatures) || signatures.length !== inputs.length) {
            throw new Error(response?.error || 'Sign failed');
          }
          return signatures.map((bytes, i) => ({
            signedMessage: messages[i],
            signature: Uint8Array.from(bytes as number[]),
          }));
        },
      } satisfies SolanaSignMessageFeature[typeof SolanaSignMessage],
    },
  };

  // Wallet Standard only — do not impersonate Phantom or write window.solana.
  registerWallet(wallet);
})();
