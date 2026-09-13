/**
 * Worker-to-page push channel. Pages learn about lock, disconnect, account and
 * cluster changes through `chrome.tabs.sendMessage` to the tabs the delivery
 * registry knows about; the content script forwards only events for its own
 * origin. The popup hears `locked` through `chrome.runtime.sendMessage`.
 * Delivery is best effort: a tab whose content script is gone simply drops it.
 */

import type { WalletEventName, WalletPublicState } from '../lib/messages';
import { getPublicState, getSettings, setLockHooks } from './keyring';
import * as origins from './origins';

export interface WalletEventPayload {
  /** Deliver to this origin's tabs only; omit for every registered tab. */
  origin?: string;
  accounts: string[];
  cluster: string;
  /** Skip this frame: the page that asked for the change already knows (its own `disconnect()` emits). */
  exclude?: { tabId: number; frameId: number };
}

export interface WalletEventMessage {
  type: 'WALLET_EVENT';
  event: WalletEventName;
  origin: string;
  accounts: string[];
  cluster: string;
}

/**
 * Every account's address with the active one first: Wallet Standard has no
 * "active account", so `accounts[0]` is what a dApp treats as the one to use.
 */
export function addressesActiveFirst(state: Pick<WalletPublicState, 'accounts' | 'activeAccountIndex'>): string[] {
  const addresses = state.accounts.map((account) => account.address);
  // By the account's own index, not its position: the two agree today only
  // because the list is dense and in order, and a page must never be handed
  // someone else's address as the active one.
  const at = state.accounts.findIndex((account) => account.index === state.activeAccountIndex);
  const active = at === -1 ? undefined : addresses[at];
  if (active === undefined) return addresses;
  return [active, ...addresses.filter((_, i) => i !== at)];
}

/** The account list pages may see right now, active first, and the active cluster. */
export async function snapshot(): Promise<{ accounts: string[]; cluster: string }> {
  const [state, settings] = await Promise.all([getPublicState(), getSettings()]);
  return {
    accounts: state.isLocked ? [] : addressesActiveFirst(state),
    cluster: settings.cluster,
  };
}

async function deliver(entry: origins.RegistryEntry, message: WalletEventMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(entry.tabId, message, { frameId: entry.frameId });
  } catch {
    /* tab or content script gone */
  }
}

export async function sendWalletEvent(event: WalletEventName, payload: WalletEventPayload): Promise<void> {
  const { exclude } = payload;
  const entries = (payload.origin === undefined ? await origins.allTabs() : await origins.tabsFor(payload.origin))
    .filter((entry) => !exclude || entry.tabId !== exclude.tabId || entry.frameId !== exclude.frameId);
  await Promise.all(
    entries.map((entry) =>
      deliver(entry, {
        type: 'WALLET_EVENT',
        event,
        origin: entry.origin,
        accounts: payload.accounts,
        cluster: payload.cluster,
      })
    )
  );
  if (event === 'locked') await tellExtensionPages('locked');
}

/** The popup and any approval window; the worker's own listener never sees it. */
async function tellExtensionPages(event: 'locked' | 'unlocked'): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'WALLET_EVENT', event });
  } catch {
    /* no extension page open */
  }
}

/** `event` to every tab whose origin is currently connected (account switch, cluster change). */
export async function sendToConnected(event: WalletEventName, payload: Omit<WalletEventPayload, 'origin'>): Promise<void> {
  const connected = new Set((await origins.list()).map((site) => site.origin));
  const entries = (await origins.allTabs()).filter((entry) => connected.has(entry.origin));
  await Promise.all(
    entries.map((entry) =>
      deliver(entry, { type: 'WALLET_EVENT', event, origin: entry.origin, accounts: payload.accounts, cluster: payload.cluster })
    )
  );
}

/** Wire lock, unlock and clear (including auto-lock) to the event channel. Called once at worker start. */
export function installWalletEvents(): void {
  setLockHooks({
    onLocked: async () => {
      const { cluster } = await snapshot();
      await sendWalletEvent('locked', { accounts: [], cluster });
    },
    // Extension pages only: a page learns it is connected again through its own connect().
    onUnlocked: () => tellExtensionPages('unlocked'),
    onCleared: async () => {
      const { cluster } = await snapshot();
      await sendWalletEvent('cleared', { accounts: [], cluster });
    },
  });
}
