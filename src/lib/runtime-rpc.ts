import { DEFAULT_SETTINGS, type WalletSettings } from '../lib/messages';
import { getCluster, rpcUrlsFor, type Cluster } from '../config/constants';
import { prioritizeRpcUrls } from './rpc-rotate';
import { extensionClient } from '../messaging/client';

/** Worker-owned settings as seen from the popup; build defaults when the worker is unreachable. */
export async function runtimeSettings(): Promise<WalletSettings> {
  try {
    return await extensionClient.getSettings();
  } catch {
    return { ...DEFAULT_SETTINGS, cluster: getCluster() };
  }
}

export async function runtimeCluster(): Promise<Cluster> {
  return (await runtimeSettings()).cluster;
}

/** `rpcUrlsFor` over the live settings: custom URL, Helius, then the public defaults. */
export async function runtimeRpcUrls(): Promise<string[]> {
  const settings = await runtimeSettings();
  return rpcUrlsFor(settings.cluster, settings);
}

export async function runtimeRpcUrl(): Promise<string> {
  return prioritizeRpcUrls(await runtimeRpcUrls())[0];
}
