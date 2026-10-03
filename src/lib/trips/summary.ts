import { addDays, daysBetween, toDay } from "./dates";
import type { MembershipReason } from "./membership";

export type TripPhase = "before" | "during";

export interface TripMemberForSummary {
  id: number;
  date: string;
  chargedAmount: number;
  status: "completed" | "pending";
  categoryId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
  parentName: string | null;
  parentColor: string | null;
  reason?: MembershipReason;
}

export interface TripCategorySlice {
  categoryId: number | null;
  name: string | null;
  color: string | null;
  parentName: string | null;
  parentColor: string | null;
  amount: number;
  share: number;
  count: number;
}

export interface TripDailyPoint {
  date: string;
  amount: number;
}

export interface TripTotals {
  total: number;
  days: number;
  perDay: number;
  before: number;
  during: number;
  memberCount: number;
  pendingCount: number;
  breakdown: TripCategorySlice[];
  daily: TripDailyPoint[];
}

export const TRANSFERS_CATEGORY_NAME = "Transfers";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Phase follows membership: a "during" member (including the buffer days
 * before the start) is During, a "pre" member is Before. Manual members and
 * callers without a reason fall back to the calendar.
 */
export function tripPhase(
  date: string,
  startDate: string,
  reason?: MembershipReason
): TripPhase {
  if (reason === "during") return "during";
  if (reason === "pre") return "before";
  return toDay(date) < startDate ? "before" : "during";
}

/**
 * Trip totals follow the summary rule: completed members only, and spend is
 * -charged_amount so card refunds reduce the total. The daily series spans
 * the trip dates and stretches to the first and last during-phase member, so
 * charges in the buffer days around the trip stay visible.
 *
 * Members categorized Transfers stay members (listed in the trip) but add
 * nothing to any figure here, matching Home's EXCLUDE_TRANSFERS_SQL rule.
 */
export function summarizeTrip(
  trip: { startDate: string; endDate: string },
  members: readonly TripMemberForSummary[]
): TripTotals {
  const completed = members.filter((m) => m.status === "completed");
  const counted = completed.filter((m) => m.categoryName !== TRANSFERS_CATEGORY_NAME);
  let before = 0;
  let during = 0;
  const byCategory = new Map<string, TripCategorySlice>();
  const byDay = new Map<string, number>();
  let firstDuringDay = trip.startDate;
  let lastDuringDay = trip.endDate;

  for (const m of counted) {
    const spend = -m.chargedAmount;
    const day = toDay(m.date);
    if (tripPhase(day, trip.startDate, m.reason) === "before") {
      before += spend;
    } else {
      during += spend;
      byDay.set(day, (byDay.get(day) ?? 0) + spend);
      if (day < firstDuringDay) firstDuringDay = day;
      if (day > lastDuringDay) lastDuringDay = day;
    }
    const key = m.categoryId == null ? "none" : String(m.categoryId);
    const slice = byCategory.get(key) ?? {
      categoryId: m.categoryId,
      name: m.categoryName,
      color: m.categoryColor,
      parentName: m.parentName,
      parentColor: m.parentColor,
      amount: 0,
      share: 0,
      count: 0,
    };
    slice.amount += spend;
    slice.count += 1;
    byCategory.set(key, slice);
  }

  const total = round2(before + during);
  const days = daysBetween(trip.startDate, trip.endDate) + 1;
  const breakdown = [...byCategory.values()]
    .map((slice) => ({
      ...slice,
      amount: round2(slice.amount),
      share: total > 0 ? round4(slice.amount / total) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const daily: TripDailyPoint[] = [];
  for (let day = firstDuringDay; day <= lastDuringDay; day = addDays(day, 1)) {
    daily.push({ date: day, amount: round2(byDay.get(day) ?? 0) });
  }

  return {
    total,
    days,
    perDay: days > 0 ? round2(total / days) : 0,
    before: round2(before),
    during: round2(during),
    memberCount: members.length,
    pendingCount: members.length - completed.length,
    breakdown,
    daily,
  };
}
