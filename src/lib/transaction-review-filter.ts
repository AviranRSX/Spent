export type TransactionReviewFilter =
  | "all"
  | "pending"
  | "uncategorized"
  | "lowConfidence";

/**
 * AI confidence is on a 1-7 scale. Results at or below this value are
 * flagged for review during categorization and counted as low confidence.
 */
export const LOW_CONFIDENCE_MAX = 4;

const REVIEW_FILTERS: readonly TransactionReviewFilter[] = [
  "all",
  "pending",
  "uncategorized",
  "lowConfidence",
];

export function isPendingReviewFilter(
  filter: TransactionReviewFilter
): boolean {
  return filter === "pending";
}

export function serializeReviewFilter(
  filter: TransactionReviewFilter
): string | null {
  return isPendingReviewFilter(filter) ? "true" : null;
}

export function parseReviewFilter(raw: string | null): TransactionReviewFilter {
  return REVIEW_FILTERS.find((filter) => filter === raw) ?? "all";
}

export function reviewFilterQuery(filter: TransactionReviewFilter): {
  needsReview?: true;
  uncategorized?: true;
  lowConfidence?: true;
} {
  switch (filter) {
    case "pending":
      return { needsReview: true };
    case "uncategorized":
      return { uncategorized: true };
    case "lowConfidence":
      return { lowConfidence: true };
    default:
      return {};
  }
}
