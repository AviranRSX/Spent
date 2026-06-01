import type {
  HomeCashFlowAverages,
  HomeCategoryMean,
  HomeSpendingStats,
} from "./types";

export function clampStatsMonthCount(
  requestedMonths: number,
  availableMonths: number
): number {
  const maxMonths = Math.max(3, availableMonths);
  if (!Number.isFinite(requestedMonths)) return maxMonths;
  return Math.min(maxMonths, Math.max(3, Math.round(requestedMonths)));
}

export function buildSelectableSpendingStats(
  data: HomeSpendingStats,
  requestedMonths: number,
  categoryLimit: number
): {
  selectedMonths: number;
  cashFlowAverages: HomeCashFlowAverages;
  categoryMeans: HomeCategoryMean[];
} {
  const selectedMonths = clampStatsMonthCount(
    requestedMonths,
    data.availableMonths
  );
  const selectedMonthKeys = data.monthlyCashFlow
    .slice(-selectedMonths)
    .map((row) => row.month);
  const selectedMonthSet = new Set(selectedMonthKeys);
  const cashFlowTotals = data.monthlyCashFlow
    .filter((row) => selectedMonthSet.has(row.month))
    .reduce(
      (acc, row) => {
        acc.income += row.income;
        acc.expenses += row.expenses;
        return acc;
      },
      { income: 0, expenses: 0 }
    );
  const meanIncome = cashFlowTotals.income / selectedMonths;
  const meanExpense = cashFlowTotals.expenses / selectedMonths;
  const categoryById = new Map<
    number,
    { categoryId: number; name: string; color: string; amount: number }
  >();

  for (const row of data.categoryMonthlySpend) {
    if (!selectedMonthSet.has(row.month)) continue;
    const current =
      categoryById.get(row.categoryId) ??
      {
        categoryId: row.categoryId,
        name: row.name,
        color: row.color,
        amount: 0,
      };
    current.amount += row.amount;
    categoryById.set(row.categoryId, current);
  }

  return {
    selectedMonths,
    cashFlowAverages: {
      meanIncome,
      meanExpense,
      meanNet: meanIncome - meanExpense,
    },
    categoryMeans: [...categoryById.values()]
      .map((row) => ({
        categoryId: row.categoryId,
        name: row.name,
        color: row.color,
        monthlyMean: row.amount / selectedMonths,
      }))
      .filter((row) => row.monthlyMean > 0)
      .sort((a, b) => b.monthlyMean - a.monthlyMean)
      .slice(0, categoryLimit),
  };
}
