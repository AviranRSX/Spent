import {
  countryForCurrency,
  LOCAL_CURRENCY,
  normalizeCurrency,
} from "../currency";
import { daysBetween, toDay } from "./dates";
import type { MembershipResult, MembershipTransaction } from "./membership";
import { isOnlineTransaction } from "./online-merchants";

export const DETECTION_GAP_DAYS = 3;
export const DETECTION_MIN_TRANSACTIONS = 3;

export interface DetectionCandidate {
  id: number;
  date: string;
  currency: string;
}

export interface DetectedCluster {
  currency: string;
  startDate: string;
  endDate: string;
  transactionIds: number[];
}

export interface ExistingTripRange {
  currency: string;
  startDate: string;
  endDate: string;
}

// Stored trip names are data, not UI copy, so they use fixed English months.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function selectDetectionCandidates(
  transactions: readonly MembershipTransaction[],
  memberships: ReadonlyMap<number, MembershipResult>
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];
  for (const txn of transactions) {
    if (txn.kind !== "expense") continue;
    const currency = normalizeCurrency(txn.originalCurrency);
    if (currency === LOCAL_CURRENCY) continue;
    if (isOnlineTransaction(txn.description, txn.categoryName)) continue;
    const membership = memberships.get(txn.id);
    if (membership?.kind === "member") continue;
    if (membership?.kind === "none" && membership.manualNoTrip) continue;
    candidates.push({ id: txn.id, date: toDay(txn.date), currency });
  }
  return candidates;
}

function overlaps(
  cluster: DetectedCluster,
  trip: ExistingTripRange
): boolean {
  return (
    normalizeCurrency(trip.currency) === cluster.currency &&
    cluster.startDate <= trip.endDate &&
    trip.startDate <= cluster.endDate
  );
}

export function clusterTripCandidates(
  candidates: readonly DetectionCandidate[],
  existingTrips: readonly ExistingTripRange[]
): DetectedCluster[] {
  const byCurrency = new Map<string, DetectionCandidate[]>();
  for (const candidate of candidates) {
    const list = byCurrency.get(candidate.currency) ?? [];
    list.push(candidate);
    byCurrency.set(candidate.currency, list);
  }

  const clusters: DetectedCluster[] = [];
  for (const [currency, list] of byCurrency) {
    const sorted = [...list].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id - b.id
    );
    let current: DetectionCandidate[] = [];
    const flush = () => {
      if (current.length >= DETECTION_MIN_TRANSACTIONS) {
        clusters.push({
          currency,
          startDate: current[0].date,
          endDate: current[current.length - 1].date,
          transactionIds: current.map((c) => c.id),
        });
      }
      current = [];
    };
    for (const candidate of sorted) {
      const last = current[current.length - 1];
      if (last && daysBetween(last.date, candidate.date) > DETECTION_GAP_DAYS) {
        flush();
      }
      current.push(candidate);
    }
    flush();
  }

  return clusters
    .filter((cluster) => !existingTrips.some((trip) => overlaps(cluster, trip)))
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        a.currency.localeCompare(b.currency)
    );
}

export function suggestedTripName(
  cluster: Pick<DetectedCluster, "currency" | "startDate">
): { name: string; country: string } {
  const country = countryForCurrency(cluster.currency);
  const [year, month] = cluster.startDate.split("-");
  const label = country || cluster.currency;
  return {
    name: `${label} ${MONTHS[Number(month) - 1]} ${year}`,
    country,
  };
}
