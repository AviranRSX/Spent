import "server-only";

import type {
  HomeCashFlowAverages,
  HomeCategoryMean,
  HomeHistoricalTrendPoint,
} from "@/lib/types";

interface MonthInfo {
  key: string;
  label: string;
  isCurrent: boolean;
}

interface CashFlowRow {
  month: string;
  kind: "income" | "expense";
  total: number;
}

interface CategorySpendRow {
  categoryId: number;
  name: string;
  color: string;
  amount: number;
}

export function buildMonthlyCashFlowTrend(
  months: MonthInfo[],
  rows: CashFlowRow[]
): HomeHistoricalTrendPoint[] {
  const totals = new Map<string, { income: number; expenses: number }>();

  for (const row of rows) {
    const current = totals.get(row.month) ?? { income: 0, expenses: 0 };
    if (row.kind === "income") {
      current.income += row.total;
    } else {
      current.expenses += row.total;
    }
    totals.set(row.month, current);
  }

  return months.map((month) => {
    const total = totals.get(month.key) ?? { income: 0, expenses: 0 };
    return {
      month: month.key,
      label: month.label,
      income: total.income,
      expenses: total.expenses,
      net: total.income - total.expenses,
      isCurrent: month.isCurrent,
    };
  });
}

export function buildCashFlowAverages(
  rows: CashFlowRow[],
  monthCount: number
): HomeCashFlowAverages {
  const totals = rows.reduce(
    (acc, row) => {
      if (row.kind === "income") {
        acc.income += row.total;
      } else {
        acc.expenses += row.total;
      }
      return acc;
    },
    { income: 0, expenses: 0 }
  );
  const divisor = monthCount > 0 ? monthCount : 1;
  const meanIncome = totals.income / divisor;
  const meanExpense = totals.expenses / divisor;

  return {
    meanIncome,
    meanExpense,
    meanNet: meanIncome - meanExpense,
  };
}

export function buildCategoryMonthlyMeans(
  rows: CategorySpendRow[],
  monthCount: number,
  limit: number
): HomeCategoryMean[] {
  return rows
    .map((row) => ({
      categoryId: row.categoryId,
      name: row.name,
      color: row.color,
      monthlyMean: monthCount > 0 ? row.amount / monthCount : 0,
    }))
    .filter((row) => row.monthlyMean > 0)
    .sort((a, b) => b.monthlyMean - a.monthlyMean)
    .slice(0, limit);
}
