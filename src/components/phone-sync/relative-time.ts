import { formatLastSync, type FormatLastSyncLabels } from "@/lib/formatters";

/** Relative time for an ISO 8601 UTC string (formatLastSync expects no Z suffix). */
export function formatSyncTime(
  iso: string | null,
  labels: FormatLastSyncLabels
): string {
  return formatLastSync(iso ? iso.replace(/Z$/, "") : null, labels);
}
