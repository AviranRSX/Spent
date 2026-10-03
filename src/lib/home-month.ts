export const HOME_AVERAGE_MONTHS = 6;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface HomeMonthRange {
  /** "YYYY-MM" */
  key: string;
  year: number;
  /** 0-based, like Date#getMonth */
  monthIndex: number;
  /** "YYYY-MM-01" */
  from: string;
  /** Last day of the month, "YYYY-MM-DD" */
  to: string;
  daysInMonth: number;
  /** True for the calendar month that contains `now`. */
  isCurrent: boolean;
  /** Today's day of month for the current month, the full month otherwise. */
  elapsedDays: number;
}

export type HomeMonthParseResult =
  | { ok: true; month: HomeMonthRange }
  | { ok: false; error: "invalid_month" | "future_month" };

export interface HomeAverageWindow {
  from: string;
  to: string;
  months: string[];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseKey(key: string): { year: number; monthIndex: number } {
  const [year, monthNumber] = key.split("-").map(Number);
  return { year, monthIndex: monthNumber - 1 };
}

function lastDayOf(key: string): number {
  const { year, monthIndex } = parseKey(key);
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function monthKeyToDate(key: string): Date {
  const { year, monthIndex } = parseKey(key);
  return new Date(year, monthIndex, 1);
}

export function isValidMonthKey(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && MONTH_KEY_PATTERN.test(raw);
}

export function shiftMonthKey(key: string, delta: number): string {
  const { year, monthIndex } = parseKey(key);
  return monthKeyFromDate(new Date(year, monthIndex + delta, 1));
}

/** `count` month keys ending at `endKey`, oldest first. */
export function trendMonthKeys(endKey: string, count: number): string[] {
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    keys.push(shiftMonthKey(endKey, -offset));
  }
  return keys;
}

export function buildHomeMonthRange(key: string, now: Date): HomeMonthRange {
  const { year, monthIndex } = parseKey(key);
  const daysInMonth = lastDayOf(key);
  const isCurrent = key === monthKeyFromDate(now);
  return {
    key,
    year,
    monthIndex,
    from: `${key}-01`,
    to: `${key}-${pad2(daysInMonth)}`,
    daysInMonth,
    isCurrent,
    elapsedDays: isCurrent ? Math.min(now.getDate(), daysInMonth) : daysInMonth,
  };
}

export function parseHomeMonth(raw: string | null, now: Date): HomeMonthParseResult {
  const currentKey = monthKeyFromDate(now);
  if (raw == null || raw === "") {
    return { ok: true, month: buildHomeMonthRange(currentKey, now) };
  }
  if (!isValidMonthKey(raw)) return { ok: false, error: "invalid_month" };
  // "YYYY-MM" keys sort lexically in calendar order.
  if (raw > currentKey) return { ok: false, error: "future_month" };
  return { ok: true, month: buildHomeMonthRange(raw, now) };
}

/** Client side: a bad or future ?month falls back to the current month. */
export function resolveHomeMonthKey(raw: string | null, now: Date): string {
  const parsed = parseHomeMonth(raw, now);
  return parsed.ok ? parsed.month.key : monthKeyFromDate(now);
}

export function homeHrefForMonth(key: string, now: Date): string {
  return key === monthKeyFromDate(now) ? "/" : `/?month=${key}`;
}

/**
 * The window a month is compared against. The current month compares to the
 * same days of last month (clamped to its length); past months compare to
 * the full previous month.
 */
export function previousComparisonRange(month: HomeMonthRange): {
  from: string;
  to: string;
} {
  const prevKey = shiftMonthKey(month.key, -1);
  const prevDays = lastDayOf(prevKey);
  const lastDay = month.isCurrent
    ? Math.min(month.elapsedDays, prevDays)
    : prevDays;
  return { from: `${prevKey}-01`, to: `${prevKey}-${pad2(lastDay)}` };
}

/**
 * Up to `size` months immediately before the selected month. They are always
 * complete because the selected month is never in the future. Months before
 * the first month with data are dropped so a short history is not diluted.
 */
export function getAverageWindow(
  month: HomeMonthRange,
  firstDataMonth: string | null,
  size: number = HOME_AVERAGE_MONTHS
): HomeAverageWindow | null {
  if (firstDataMonth == null) return null;
  const months = trendMonthKeys(shiftMonthKey(month.key, -1), size).filter(
    (key) => key >= firstDataMonth
  );
  if (months.length === 0) return null;
  const last = months[months.length - 1];
  return {
    from: `${months[0]}-01`,
    to: `${last}-${pad2(lastDayOf(last))}`,
    months,
  };
}
