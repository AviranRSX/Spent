import { isIsoDay } from "./dates";

export interface TransactionsRange {
  from: string;
  to: string;
}

/**
 * Trips span cards and bank accounts, so the link asks for all sources.
 * `source` is read by parseTransactionsUrlState in src/lib/transactions-url.ts.
 */
export function buildTripTransactionsHref(trip: { startDate: string; endDate: string }): string {
  const params = new URLSearchParams({
    from: trip.startDate,
    to: trip.endDate,
    source: "all",
  });
  return `/transactions?${params.toString()}`;
}

export function parseTransactionsRange(params: {
  get(name: string): string | null;
}): TransactionsRange | null {
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to || !isIsoDay(from) || !isIsoDay(to) || to < from) return null;
  return { from, to };
}
