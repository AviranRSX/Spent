export type TransactionReviewFilter = "all" | "pending";

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
