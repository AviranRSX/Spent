"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPhoneSyncStatus, runPhoneSyncNow } from "@/lib/api";
import { IS_MOBILE } from "@/lib/platform";
import type { PhoneSyncStatus } from "@/lib/types";

export const PHONE_SYNC_QUERY_KEY = ["phone-sync"] as const;
const POLL_MS = 10_000;

/** Desktop phone-sync status. Polls only while the tab is visible and sync is on. */
export function useDesktopPhoneSync() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: PHONE_SYNC_QUERY_KEY,
    queryFn: getPhoneSyncStatus,
    enabled: !IS_MOBILE,
    refetchInterval: (q) => (q.state.data?.enabled ? POLL_MS : false),
    refetchIntervalInBackground: false,
  });
  const syncMutation = useMutation({
    mutationFn: runPhoneSyncNow,
    onSuccess: (status) => queryClient.setQueryData(PHONE_SYNC_QUERY_KEY, status),
  });
  const setStatus = (status: PhoneSyncStatus) =>
    queryClient.setQueryData(PHONE_SYNC_QUERY_KEY, status);
  const status = query.data ?? null;
  return {
    status,
    setStatus,
    sync: () => syncMutation.mutate(),
    isSyncing: syncMutation.isPending || status?.state === "syncing",
  };
}
