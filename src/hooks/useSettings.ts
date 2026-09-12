import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { WalletSettings } from '../lib/messages';
import { extensionClient } from '../messaging/client';
import { setCluster, setHideSmallBalances } from '../store/slices/uiSlice';
import { useAppDispatch, type AppDispatch } from '../store/store';

export const SETTINGS_QUERY_KEY = ['settings'] as const;

/**
 * Pull the worker's settings into the popup: seed the React Query cache so
 * `useSettings()` does not refetch, and keep the Redux mirror for the
 * consumers that still read it there (SHIP-8a removes it). Called on popup
 * init and again after `CLEAR_WALLET`, when the worker has reverted to defaults.
 */
export async function syncSettings(queryClient: QueryClient, dispatch: AppDispatch): Promise<WalletSettings> {
  const settings = await extensionClient.getSettings();
  queryClient.setQueryData(SETTINGS_QUERY_KEY, settings);
  dispatch(setCluster(settings.cluster));
  dispatch(setHideSmallBalances(settings.hideSmallBalances));
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
  const dispatch = useAppDispatch();
  return useMutation({
    mutationFn: (patch: Partial<WalletSettings>) => extensionClient.updateSettings(patch),
    onSuccess: (next) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, next);
      // Redux mirror for the consumers that still read it there; SHIP-8a removes it.
      dispatch(setCluster(next.cluster));
      dispatch(setHideSmallBalances(next.hideSmallBalances));
    },
  });
}
