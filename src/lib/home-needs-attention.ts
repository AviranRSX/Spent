import { buildTransactionsHref } from "./transactions-url";
import type { HomeNeedsAttention } from "./types";

export type NeedsAttentionRowId = "uncategorized" | "lowConfidence" | "flagged" | "needsTrip";

export interface NeedsAttentionRow {
  id: NeedsAttentionRowId;
  count: number;
  href: string;
}

/**
 * Rows for the Needs attention card, in display order: the three review
 * queues, then the needs-a-trip queue. Adding a row means adding an id here
 * and its icon and label in the card.
 */
export function buildNeedsAttentionRows(
  data: HomeNeedsAttention,
  month: string
): NeedsAttentionRow[] {
  return [
    {
      id: "uncategorized",
      count: data.uncategorized,
      href: buildTransactionsHref({ month, kind: "expense", review: "uncategorized", source: "all" }),
    },
    {
      id: "lowConfidence",
      count: data.lowConfidence,
      href: buildTransactionsHref({ month, kind: "all", review: "lowConfidence", source: "all" }),
    },
    {
      id: "flagged",
      count: data.flagged,
      href: buildTransactionsHref({ month, kind: "all", review: "pending", source: "all" }),
    },
    {
      id: "needsTrip",
      count: data.needsTrip,
      // The trip queue spans all history, so this link ignores `month`.
      href: "/trips?tab=needs-trip",
    },
  ];
}
