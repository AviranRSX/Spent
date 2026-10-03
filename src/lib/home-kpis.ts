import type { HomeMonthRange } from "./home-month";
import type { HomeKpiFigures, HomeKpis } from "./types";

export type HomeKpiKey = "income" | "expenses" | "net" | "savingsRate";

export interface HomeKpiDelta {
  /** percent for income/expenses, shekels for net, percentage points for savings rate */
  unit: "percent" | "currency" | "points";
  value: number;
  /** Good for the household (more income, less spending, more net). Null when flat. */
  favorable: boolean | null;
}

export function computeSavingsRate(income: number, net: number): number | null {
  return income > 0 ? net / income : null;
}

export function toKpiFigures(income: number, expenses: number): HomeKpiFigures {
  const net = income - expenses;
  return { income, expenses, net, savingsRate: computeSavingsRate(income, net) };
}

export function buildHomeKpis(
  month: HomeMonthRange,
  current: { income: number; expenses: number },
  prev: { income: number; expenses: number },
  average: { income: number; expenses: number; months: number } | null
): HomeKpis {
  return {
    month: month.key,
    ...toKpiFigures(current.income, current.expenses),
    prev: toKpiFigures(prev.income, prev.expenses),
    avg6:
      average && average.months > 0
        ? {
            ...toKpiFigures(average.income, average.expenses),
            months: average.months,
          }
        : null,
    isCurrentMonth: month.isCurrent,
    dayOfMonth: month.elapsedDays,
    daysInMonth: month.daysInMonth,
  };
}

function isFavorable(key: HomeKpiKey, value: number): boolean | null {
  if (Math.round(value) === 0) return null;
  return key === "expenses" ? value < 0 : value > 0;
}

export function computeKpiDelta(
  key: HomeKpiKey,
  current: HomeKpiFigures,
  prev: HomeKpiFigures
): HomeKpiDelta | null {
  if (prev.income === 0 && prev.expenses === 0) return null;

  if (key === "income" || key === "expenses") {
    const before = prev[key];
    if (before <= 0) return null;
    const value = ((current[key] - before) / before) * 100;
    return { unit: "percent", value, favorable: isFavorable(key, value) };
  }

  if (key === "net") {
    const value = current.net - prev.net;
    return { unit: "currency", value, favorable: isFavorable(key, value) };
  }

  if (current.savingsRate == null || prev.savingsRate == null) return null;
  const value = (current.savingsRate - prev.savingsRate) * 100;
  return { unit: "points", value, favorable: isFavorable(key, value) };
}
