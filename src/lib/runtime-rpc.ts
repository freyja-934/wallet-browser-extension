import { getCluster, rpcUrlsFor, type Cluster } from '../config/constants';
import { prioritizeRpcUrls } from './rpc-rotate';
import { extensionClient } from '../messaging/client';

export async function runtimeCluster(): Promise<Cluster> {
  try {
    const settings = await extensionClient.getSettings();
    return settings.cluster ?? getCluster();
  } catch {
    return getCluster();
  }
}

export async function runtimeRpcUrls(): Promise<string[]> {
  return rpcUrlsFor(await runtimeCluster());
}

export async function runtimeRpcUrl(): Promise<string> {
  return prioritizeRpcUrls(await runtimeRpcUrls())[0];
}
