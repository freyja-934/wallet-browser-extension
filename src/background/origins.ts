/**
 * Which sites may see or sign for the account, and where to push events to them.
 *
 * `cinder_connected` (chrome.storage.local) holds `{ [origin]: { connectedAt, accountIndexes } }`.
 * `cinder_tabs` (chrome.storage.session) is the delivery registry: `${tabId}:${frameId}` -> origin,
 * refreshed from the sender on every dApp message and pruned when a tab closes. Tab ids are
 * per browser session, so the registry lives in session storage on purpose.
 */

import type { ConnectedSite } from '../lib/messages';
import type { SenderLike } from '../lib/sender-gate';
import { sessionArea, withLock } from './session-store';

export const CONNECTED_KEY = 'cinder_connected';
export const TABS_KEY = 'cinder_tabs';

interface ConnectedEntry {
  connectedAt: number;
  accountIndexes: number[];
}

type ConnectedMap = Record<string, ConnectedEntry>;
type TabsMap = Record<string, string>;

export interface RegistryEntry {
  tabId: number;
  frameId: number;
  origin: string;
}

async function readConnected(): Promise<ConnectedMap> {
  const data = await chrome.storage.local.get(CONNECTED_KEY);
  return (data[CONNECTED_KEY] as ConnectedMap | undefined) ?? {};
}

async function writeConnected(map: ConnectedMap): Promise<void> {
  await chrome.storage.local.set({ [CONNECTED_KEY]: map });
}

async function readTabs(): Promise<TabsMap> {
  const data = await sessionArea().get(TABS_KEY);
  return (data[TABS_KEY] as TabsMap | undefined) ?? {};
}

async function writeTabs(map: TabsMap): Promise<void> {
  await sessionArea().set({ [TABS_KEY]: map });
}

/** Record `origin` as connected (a repeat connect refreshes the time and account list). */
export async function connect(origin: string, accountIndexes: number[]): Promise<void> {
  await withLock(CONNECTED_KEY, async () => {
    const map = await readConnected();
    map[origin] = { connectedAt: Date.now(), accountIndexes: [...accountIndexes] };
    await writeConnected(map);
  });
}

export async function isConnected(origin: string): Promise<boolean> {
  return Object.prototype.hasOwnProperty.call(await readConnected(), origin);
}

/** Forget `origin`; true when it was connected. */
export async function disconnect(origin: string): Promise<boolean> {
  return withLock(CONNECTED_KEY, async () => {
    const map = await readConnected();
    if (!Object.prototype.hasOwnProperty.call(map, origin)) return false;
    delete map[origin];
    await writeConnected(map);
    return true;
  });
}

/** Every connected site, most recently connected first. */
export async function list(): Promise<ConnectedSite[]> {
  const map = await readConnected();
  return Object.entries(map)
    .map(([origin, entry]) => ({ origin, connectedAt: entry.connectedAt, accountIndexes: [...entry.accountIndexes] }))
    .sort((a, b) => b.connectedAt - a.connectedAt);
}

export async function clear(): Promise<void> {
  await withLock(CONNECTED_KEY, async () => {
    await chrome.storage.local.remove(CONNECTED_KEY);
  });
}

function registryKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

/** Remember which tab and frame `origin` is talking from. Senders without a tab (extension pages) are ignored. */
export async function remember(sender: SenderLike, origin: string): Promise<void> {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number' || !origin) return;
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
  await withLock(TABS_KEY, async () => {
    const map = await readTabs();
    const key = registryKey(tabId, frameId);
    if (map[key] === origin) return;
    map[key] = origin;
    await writeTabs(map);
  });
}

function parseEntries(map: TabsMap): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const [key, origin] of Object.entries(map)) {
    const [tab, frame] = key.split(':');
    const tabId = Number(tab);
    const frameId = Number(frame);
    if (!Number.isInteger(tabId) || !Number.isInteger(frameId)) continue;
    entries.push({ tabId, frameId, origin });
  }
  return entries;
}

/** Every tab and frame currently registered for `origin`. */
export async function tabsFor(origin: string): Promise<RegistryEntry[]> {
  return parseEntries(await readTabs()).filter((entry) => entry.origin === origin);
}

/** The whole registry, for events every page should hear (lock, clear). */
export async function allTabs(): Promise<RegistryEntry[]> {
  return parseEntries(await readTabs());
}

/** Drop every frame of a closed tab. */
export async function forget(tabId: number): Promise<void> {
  await withLock(TABS_KEY, async () => {
    const map = await readTabs();
    const prefix = `${tabId}:`;
    let changed = false;
    for (const key of Object.keys(map)) {
      if (key.startsWith(prefix)) {
        delete map[key];
        changed = true;
      }
    }
    if (changed) await writeTabs(map);
  });
}
