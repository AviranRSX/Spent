import "server-only";

import type { CategoryWithData } from "@/lib/types";

export const UNCATEGORIZED_CATEGORY_ID = 0;

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
