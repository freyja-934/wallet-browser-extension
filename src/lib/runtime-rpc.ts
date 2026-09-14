import { DEFAULT_SETTINGS, type WalletSettings } from '../lib/messages';
import { getCluster, rpcUrlsFor, type Cluster } from '../config/constants';
import { extensionClient } from '../messaging/client';

/**
 * Worker-owned settings as seen from the popup, or `undefined` when the worker did
 * not answer. The distinction exists for one caller: a decision that must fail
 * *closed* cannot be made on build defaults, because the defaults carry no
 * `rpcUrl` and no `heliusApiKey` and so look exactly like a user who configured
 * nothing. `jupiterEnabledFor` is that decision — a worker restart mid-read must
 * never be what sends a configured user's address to a third party.
 */
export async function runtimeSettingsOrUndefined(): Promise<WalletSettings | undefined> {
  try {
    return await extensionClient.getSettings();
  } catch {
    return undefined;
  }
}

/** Worker-owned settings as seen from the popup; build defaults when the worker is unreachable. */
export async function runtimeSettings(): Promise<WalletSettings> {
  return (await runtimeSettingsOrUndefined()) ?? { ...DEFAULT_SETTINGS, cluster: getCluster() };
}

export async function runtimeCluster(): Promise<Cluster> {
  return (await runtimeSettings()).cluster;
}

/** `rpcUrlsFor` over the live settings: custom URL, Helius, then the public defaults. */
export async function runtimeRpcUrls(): Promise<string[]> {
  const settings = await runtimeSettings();
  return rpcUrlsFor(settings.cluster, settings);
}
