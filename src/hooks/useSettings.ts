import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { WalletSettings } from '../lib/messages';
import { extensionClient } from '../messaging/client';

export const SETTINGS_QUERY_KEY = ['settings'] as const;

/**
 * Pull the worker's settings into the popup, seeding the React Query cache so
 * `useSettings()` does not refetch. Called on popup init and again after
 * `CLEAR_WALLET`, when the worker has reverted to defaults.
 */
export async function syncSettings(queryClient: QueryClient): Promise<WalletSettings> {
  const settings = await extensionClient.getSettings();
  queryClient.setQueryData(SETTINGS_QUERY_KEY, settings);
  return settings;
}

/** Worker-owned settings, read once per popup session; mutations write the cache directly. */
export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => extensionClient.getSettings(),
    staleTime: Infinity,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<WalletSettings>) => extensionClient.updateSettings(patch),
    // The worker answers with the settings it stored, so the cache takes them as-is.
    onSuccess: (next) => queryClient.setQueryData(SETTINGS_QUERY_KEY, next),
  });
}
