import { LOCAL_CURRENCY, normalizeCurrency } from "../currency";
import { addDays, daysBetween, toDay } from "./dates";
import { isOnlineTransaction } from "./online-merchants";

export const TRIP_DURING_BUFFER_DAYS = 2;
export const TRIP_PRE_WINDOW_DAYS = 180;
export const TRAVEL_CATEGORY_NAMES: readonly string[] = [
  "Flights",
  "Travel",
  "Travel Insurance",
];

export type TripStatus = "suggested" | "confirmed" | "dismissed";
export type MembershipReason = "manual" | "during" | "pre";

export interface MembershipTrip {
  id: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
}

export interface MembershipTransaction {
  id: number;
  date: string;
  originalCurrency: string;
  kind: "expense" | "income" | "transfer";
  description: string;
  categoryName: string | null;
}

export interface MembershipAssignment {
  transactionId: number;
  tripId: number | null;
}

export type MembershipResult =
  | { kind: "member"; tripId: number; reason: MembershipReason }
  | {
      kind: "queue";
      cause: "travel-category" | "ambiguous";
      suggestedTripIds: number[];
    }
  | { kind: "none"; manualNoTrip: boolean };

const NO_TRIP: MembershipResult = { kind: "none", manualNoTrip: false };

function inDuringWindow(day: string, trip: MembershipTrip): boolean {
  return (
    day >= addDays(trip.startDate, -TRIP_DURING_BUFFER_DAYS) &&
    day <= addDays(trip.endDate, TRIP_DURING_BUFFER_DAYS)
  );
}

function inPreWindow(day: string, trip: MembershipTrip): boolean {
  return (
    day < trip.startDate &&
    day >= addDays(trip.startDate, -TRIP_PRE_WINDOW_DAYS)
  );
}

/**
 * Confirmed trips that could own this transaction: the date sits in the
 * trip's window, or the trip starts within 180 days after it. Same-currency
 * trips rank first, then the nearest start.
 */
export function suggestTripsFor(
  transaction: MembershipTransaction,
  trips: readonly MembershipTrip[]
): number[] {
  const day = toDay(transaction.date);
  const currency = normalizeCurrency(transaction.originalCurrency);
  return trips
    .filter((trip) => trip.status === "confirmed")
    .filter((trip) => inDuringWindow(day, trip) || inPreWindow(day, trip))
    .sort((a, b) => {
      const sameA = normalizeCurrency(a.currency) === currency ? 0 : 1;
      const sameB = normalizeCurrency(b.currency) === currency ? 0 : 1;
      if (sameA !== sameB) return sameA - sameB;
      const distA = Math.abs(daysBetween(day, a.startDate));
      const distB = Math.abs(daysBetween(day, b.startDate));
      if (distA !== distB) return distA - distB;
      return a.id - b.id;
    })
    .map((trip) => trip.id);
}

function resolveOne(
  transaction: MembershipTransaction,
  confirmed: readonly MembershipTrip[],
  manual: ReadonlyMap<number, number | null>
): MembershipResult {
  if (manual.has(transaction.id)) {
    const tripId = manual.get(transaction.id) ?? null;
    if (tripId === null) return { kind: "none", manualNoTrip: true };
    if (confirmed.some((trip) => trip.id === tripId)) {
      return { kind: "member", tripId, reason: "manual" };
    }
    // The manual target is no longer confirmed: fall through to the rules.
  }

  const day = toDay(transaction.date);
  const currency = normalizeCurrency(transaction.originalCurrency);
  const online = isOnlineTransaction(
    transaction.description,
    transaction.categoryName
  );
  const ambiguous = (): MembershipResult => ({
    kind: "queue",
    cause: "ambiguous",
    suggestedTripIds: suggestTripsFor(transaction, confirmed),
  });

  if (currency !== LOCAL_CURRENCY && !online) {
    const during = confirmed.filter(
      (trip) => trip.currency !== LOCAL_CURRENCY && inDuringWindow(day, trip)
    );
    if (during.length === 1) {
      return { kind: "member", tripId: during[0].id, reason: "during" };
    }
    if (during.length > 1) {
      const sameCurrency = during.filter((trip) => trip.currency === currency);
      if (sameCurrency.length === 1) {
        return { kind: "member", tripId: sameCurrency[0].id, reason: "during" };
      }
      return ambiguous();
    }

    if (currency !== "USD") {
      const pre = confirmed.filter(
        (trip) => trip.currency === currency && inPreWindow(day, trip)
      );
      if (pre.length > 0) {
        const nearest = Math.min(
          ...pre.map((trip) => daysBetween(day, trip.startDate))
        );
        const best = pre.filter(
          (trip) => daysBetween(day, trip.startDate) === nearest
        );
        if (best.length === 1) {
          return { kind: "member", tripId: best[0].id, reason: "pre" };
        }
        return ambiguous();
      }
    }
  }

  if (
    transaction.categoryName &&
    TRAVEL_CATEGORY_NAMES.includes(transaction.categoryName)
  ) {
    return {
      kind: "queue",
      cause: "travel-category",
      suggestedTripIds: suggestTripsFor(transaction, confirmed),
    };
  }
  return NO_TRIP;
}

/**
 * Resolves each transaction's trip on read. Only confirmed trips take part
 * and transfers get no entry. Rules run in order and the first match wins:
 * manual, during the trip, before the trip, then the "needs a trip" queue.
 */
export function resolveTripMembership(
  transactions: readonly MembershipTransaction[],
  trips: readonly MembershipTrip[],
  assignments: readonly MembershipAssignment[]
): Map<number, MembershipResult> {
  const confirmed = trips
    .filter((trip) => trip.status === "confirmed")
    .map((trip) => ({ ...trip, currency: normalizeCurrency(trip.currency) }));
  const manual = new Map(
    assignments.map((a) => [a.transactionId, a.tripId] as const)
  );
  const result = new Map<number, MembershipResult>();
  for (const transaction of transactions) {
    if (transaction.kind === "transfer") continue;
    result.set(transaction.id, resolveOne(transaction, confirmed, manual));
  }
  return result;
}
