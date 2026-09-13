import { SOLANA_MAINNET_CHAIN } from '@solana/wallet-standard-chains';
import {
  SolanaSignAndSendTransaction,
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignAndSendTransactionFeature,
  type SolanaSignMessageFeature,
  type SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
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
import { PAGE_TIMEOUT_MS, WALLET_CHANNEL } from '../lib/messages';
import { CINDER_ICON_DATA_URI } from '../config/brand';
import { WALLET_NAME } from '../config/constants';

(() => {
  let messageId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
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
    else entry.resolve(event.data.response);
  });

  function send(type: string, payload: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
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

  function bytesToAccount(address: string): WalletAccount {
    return {
      address,
      publicKey: decodeAddress(address),
      chains: [SOLANA_MAINNET_CHAIN],
      features: [
        SolanaSignTransaction,
        SolanaSignAndSendTransaction,
        SolanaSignMessage,
      ],
    };
  }

  function decodeAddress(address: string): Uint8Array {
    try {
      const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const bytes = [0];
      for (const char of address) {
        const value = alphabet.indexOf(char);
        if (value < 0) throw new Error('bad address');
        let carry = value;
        for (let i = 0; i < bytes.length; i++) {
          const x = bytes[i] * 58 + carry;
          bytes[i] = x & 0xff;
          carry = x >> 8;
        }
        while (carry) {
          bytes.push(carry & 0xff);
          carry >>= 8;
        }
      }
      for (const char of address) {
        if (char !== '1') break;
        bytes.push(0);
      }
      return Uint8Array.from(bytes.reverse());
    } catch {
      return new Uint8Array(32);
    }
  }

  let accounts: WalletAccount[] = [];
  /** The wallet's active cluster as last reported; chains stay mainnet until SHIP-6 reads this. */
  let currentCluster: string | undefined;

  function handleWalletEvent(name: string, nextAccounts: unknown, cluster: unknown): void {
    if (typeof cluster === 'string') currentCluster = cluster;
    switch (name) {
      case 'locked':
      case 'disconnected':
      case 'revoked':
      case 'cleared':
        accounts = [];
        emit('change', { accounts });
        return;
      case 'accountsChanged':
      case 'clusterChanged': {
        const addresses = Array.isArray(nextAccounts)
          ? nextAccounts.filter((address): address is string => typeof address === 'string')
          : [];
        accounts = addresses.map(bytesToAccount);
        emit('change', { accounts });
        return;
      }
      default:
        return;
    }
  }

  const wallet: Wallet & { readonly cluster: string | undefined } = {
    // The Wallet Standard version, not the app version: the spec's WalletVersion is the literal '1.0.0'.
    version: '1.0.0',
    name: WALLET_NAME,
    icon: CINDER_ICON_DATA_URI,
    chains: [SOLANA_MAINNET_CHAIN],
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
          const addresses: string[] = response.accounts ?? [];
          accounts = addresses.map(bytesToAccount);
          emit('change', { accounts });
          return { accounts };
        },
      } satisfies StandardConnectFeature[typeof StandardConnect],
      [StandardDisconnect]: {
        version: '1.0.0',
        disconnect: async () => {
          await send('WALLET_DISCONNECT');
          accounts = [];
          emit('change', { accounts });
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
          const outputs = [];
          for (const input of inputs) {
            const bytes = input.transaction instanceof Uint8Array
              ? input.transaction
              : new Uint8Array(input.transaction as ArrayBuffer);
            const response = await send('SIGN_TRANSACTION', { transaction: [...bytes] });
            if (!response?.signedTransaction) throw new Error(response?.error || 'Sign failed');
            outputs.push({ signedTransaction: Uint8Array.from(response.signedTransaction) });
          }
          return outputs;
        },
      } satisfies SolanaSignTransactionFeature[typeof SolanaSignTransaction],
      [SolanaSignAndSendTransaction]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs) => {
          const outputs = [];
          for (const input of inputs) {
            const bytes = input.transaction instanceof Uint8Array
              ? input.transaction
              : new Uint8Array(input.transaction as ArrayBuffer);
            const response = await send('SIGN_AND_SEND_TRANSACTION', { transaction: [...bytes] });
            if (!response?.signature) throw new Error(response?.error || 'Send failed');
            outputs.push({ signature: Uint8Array.from(response.signature) });
          }
          return outputs;
        },
      } satisfies SolanaSignAndSendTransactionFeature[typeof SolanaSignAndSendTransaction],
      [SolanaSignMessage]: {
        version: '1.0.0',
        signMessage: async (...inputs) => {
          const outputs = [];
          for (const input of inputs) {
            const message = input.message instanceof Uint8Array ? input.message : new Uint8Array(input.message);
            const response = await send('SIGN_MESSAGE', { message: [...message] });
            if (!response?.signature) throw new Error(response?.error || 'Sign failed');
            outputs.push({
              signedMessage: message,
              signature: Uint8Array.from(response.signature),
            });
          }
          return outputs;
        },
      } satisfies SolanaSignMessageFeature[typeof SolanaSignMessage],
    },
  };

  // Wallet Standard only — do not impersonate Phantom or write window.solana.
  registerWallet(wallet);
  window.dispatchEvent(new CustomEvent('cinder#initialized', { detail: { name: WALLET_NAME } }));
})();
