import { getCluster, rpcUrlFor, type Cluster } from '../config/constants';
import { extensionClient } from '../messaging/client';

export async function runtimeCluster(): Promise<Cluster> {
  try {
    const settings = await extensionClient.getSettings();
    return settings.cluster ?? getCluster();
  } catch {
    return getCluster();
  }
}

export async function runtimeRpcUrl(): Promise<string> {
  return rpcUrlFor(await runtimeCluster());
}
