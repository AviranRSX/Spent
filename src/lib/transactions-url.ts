import { isValidMonthKey } from "./home-month";
import {
  parseReviewFilter,
  type TransactionReviewFilter,
} from "./transaction-review-filter";
import type { TransactionKindFilter } from "./api";
import type { TransactionSourceType } from "./transaction-source-types";

export interface TransactionsUrlState {
  /** "YYYY-MM" */
  month: string | null;
  categoryIds: number[];
  kind: TransactionKindFilter | null;
  review: TransactionReviewFilter;
  source: TransactionSourceType | null;
}

const KINDS: readonly TransactionKindFilter[] = ["expense", "income", "all"];
const SOURCES: readonly TransactionSourceType[] = ["all", "bank", "card"];

export function buildTransactionsHref(state: Partial<TransactionsUrlState>): string {
  const params = new URLSearchParams();
  if (state.month) params.set("month", state.month);
  for (const id of state.categoryIds ?? []) params.append("category", String(id));
  if (state.kind) params.set("kind", state.kind);
  if (state.review && state.review !== "all") params.set("review", state.review);
  if (state.source) params.set("source", state.source);
  const query = params.toString();
  return query ? `/transactions?${query}` : "/transactions";
}

export function parseTransactionsUrlState(
  params: Pick<URLSearchParams, "get" | "getAll">
): TransactionsUrlState {
  const month = params.get("month");
  const kind = params.get("kind");
  const source = params.get("source");
  return {
    month: isValidMonthKey(month) ? month : null,
    categoryIds: params
      .getAll("category")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
    kind: KINDS.find((value) => value === kind) ?? null,
    review: parseReviewFilter(params.get("review")),
    source: SOURCES.find((value) => value === source) ?? null,
  };
}
