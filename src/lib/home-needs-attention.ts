import { buildTransactionsHref } from "./transactions-url";
import type { HomeNeedsAttention } from "./types";

export type NeedsAttentionRowId = "uncategorized" | "lowConfidence" | "flagged";

export interface NeedsAttentionRow {
  id: NeedsAttentionRowId;
  count: number;
  href: string;
}

/**
 * Rows for the Needs attention card, in display order. Adding a row (for
 * example the trips queue) means adding an id here and its icon and label
 * in the card.
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
  ];
}
