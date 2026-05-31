import "server-only";

import type { CategoryWithData } from "@/lib/types";

export const UNCATEGORIZED_CATEGORY_ID = 0;
const TRANSFERS_CATEGORY_NAME = "Transfers";

interface UncategorizedCategoryInput {
  spent: number;
  count: number;
  needsReviewCount: number;
  previousSpent: number;
  timeElapsedPercent: number;
  topMerchant?: string | null;
}

export function buildUncategorizedCategoryRow({
  spent,
  count,
  needsReviewCount,
  previousSpent,
  topMerchant = null,
}: UncategorizedCategoryInput): CategoryWithData {
  const vsLastMonth =
    previousSpent > 0 ? ((spent - previousSpent) / previousSpent) * 100 : null;

  return {
    categoryId: UNCATEGORIZED_CATEGORY_ID,
    parentId: null,
    parentName: null,
    isParent: false,
    budgetSource: "leaf",
    categoryName: "Uncategorized",
    categoryColor: "#B5B3AC",
    categoryIcon: "circle-dot",
    budgetMode: "tracking",
    spent,
    transactionCount: count,
    topMerchant,
    budget: 0,
    isAutoBudget: false,
    vsLastMonth,
    remaining: 0,
    perDayRemaining: null,
    percentSpent: 0,
    status: "on-track",
    needsReviewCount,
    vsTypical: null,
  };
}

export interface TransferIncomeAdjustment {
  amount: number;
  count: number;
  needsReviewCount: number;
  previousAmount: number;
}

export interface TransferIncomeMergeOptions {
  transferCategoryId?: number;
  transferParentId?: number | null;
  previousExpenseParent?: number;
}

export function mergeTransferIncomeIntoExpenseRows(
  rows: CategoryWithData[],
  incomeTransfers: TransferIncomeAdjustment,
  previousExpenseTransfers: number,
  options: TransferIncomeMergeOptions = {}
): CategoryWithData[] {
  if (
    incomeTransfers.count === 0 &&
    incomeTransfers.amount === 0 &&
    incomeTransfers.needsReviewCount === 0 &&
    incomeTransfers.previousAmount === 0
  ) {
    return rows;
  }

  return rows.map((row) => {
    const isTransferLeaf =
      row.categoryName === TRANSFERS_CATEGORY_NAME ||
      row.categoryId === options.transferCategoryId;
    const isTransferParent =
      options.transferParentId != null && row.categoryId === options.transferParentId;
    if (!isTransferLeaf && !isTransferParent) return row;

    const spent = row.spent - incomeTransfers.amount;
    const previousExpense = isTransferParent
      ? options.previousExpenseParent ?? previousExpenseTransfers
      : previousExpenseTransfers;
    const previousSpent = previousExpense - incomeTransfers.previousAmount;
    const vsLastMonth =
      previousSpent > 0 ? ((spent - previousSpent) / previousSpent) * 100 : null;

    return {
      ...row,
      spent,
      transactionCount: row.transactionCount + incomeTransfers.count,
      needsReviewCount: row.needsReviewCount + incomeTransfers.needsReviewCount,
      remaining: Math.max(0, row.budget - spent),
      percentSpent: row.budget > 0 ? (spent / row.budget) * 100 : 0,
      vsLastMonth,
    };
  });
}

export interface SignedDailyPoint {
  date: string;
  amount: number;
}

export function mergeSignedTransferSeries(
  expenseSeries: SignedDailyPoint[],
  incomeSeries: SignedDailyPoint[]
): SignedDailyPoint[] {
  const daily = new Map<string, number>();
  for (const point of expenseSeries) {
    daily.set(point.date, (daily.get(point.date) ?? 0) + point.amount);
  }
  for (const point of incomeSeries) {
    daily.set(point.date, (daily.get(point.date) ?? 0) - point.amount);
  }
  return Array.from(daily.entries())
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
