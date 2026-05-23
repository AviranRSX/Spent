import "server-only";

export const NOT_ENOUGH_HISTORY_MESSAGE =
  "there is not enoght month for satistic";

export interface MonthlyCategorySpend {
  month: string;
  categoryId: number;
  categoryName: string;
  amount: number;
}

export interface MonthlyBankSpend {
  month: string;
  amount: number;
}

export interface BudgetSuggestion {
  categoryId: number;
  categoryName: string;
  mean: number;
  median: number;
  suggestedBudget: number;
}

export interface TotalBudgetSuggestion {
  mean: number;
  median: number;
  suggestedBudget: number;
}

export interface BudgetSuggestionsResult {
  hasEnoughHistory: boolean;
  message: string | null;
  months: string[];
  selectedMonthCount: number;
  minMonthCount: number;
  maxMonthCount: number;
  categorySuggestions: BudgetSuggestion[];
  totalBudgetSuggestion: TotalBudgetSuggestion | null;
}

export const MIN_BUDGET_SUGGESTION_MONTHS = 3;

export function getLastCompleteMonths(now: Date, count = 3): string[] {
  const months: string[] = [];
  for (let i = count; i >= 1; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(formatMonth(date));
  }
  return months;
}

export function getMonthKey(date: Date): string {
  return formatMonth(date);
}

export function resolveBudgetSuggestionMonthCount(
  requestedMonthCount: number | null | undefined,
  availableMonthCount: number
): number {
  const requested =
    requestedMonthCount == null || !Number.isFinite(requestedMonthCount)
      ? MIN_BUDGET_SUGGESTION_MONTHS
      : Math.floor(requestedMonthCount);
  const lowerBounded = Math.max(MIN_BUDGET_SUGGESTION_MONTHS, requested);
  return Math.min(lowerBounded, Math.max(MIN_BUDGET_SUGGESTION_MONTHS, availableMonthCount));
}

export function buildBudgetSuggestions(input: {
  now: Date;
  monthCount?: number;
  maxMonthCount?: number;
  availableMonths: string[];
  categoryMonthlySpend: MonthlyCategorySpend[];
  bankMonthlySpend: MonthlyBankSpend[];
}): BudgetSuggestionsResult {
  const selectedMonthCount = Math.max(
    MIN_BUDGET_SUGGESTION_MONTHS,
    Math.floor(input.monthCount ?? MIN_BUDGET_SUGGESTION_MONTHS)
  );
  const maxMonthCount = Math.max(
    input.maxMonthCount ?? input.availableMonths.length,
    input.availableMonths.length
  );
  const months = getLastCompleteMonths(input.now, selectedMonthCount);
  const available = new Set(input.availableMonths);
  const hasEnoughHistory = months.every((month) => available.has(month));

  if (!hasEnoughHistory) {
    return {
      hasEnoughHistory: false,
      message: NOT_ENOUGH_HISTORY_MESSAGE,
      months,
      selectedMonthCount,
      minMonthCount: MIN_BUDGET_SUGGESTION_MONTHS,
      maxMonthCount,
      categorySuggestions: [],
      totalBudgetSuggestion: null,
    };
  }

  const monthSet = new Set(months);
  const categoryNames = new Map<number, string>();
  const categoryAmounts = new Map<number, Map<string, number>>();
  for (const row of input.categoryMonthlySpend) {
    if (!monthSet.has(row.month)) continue;
    categoryNames.set(row.categoryId, row.categoryName);
    const byMonth = categoryAmounts.get(row.categoryId) ?? new Map();
    byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.amount);
    categoryAmounts.set(row.categoryId, byMonth);
  }

  const categorySuggestions = [...categoryAmounts.entries()]
    .map(([categoryId, byMonth]) => {
      const values = months.map((month) => byMonth.get(month) ?? 0);
      const mean = roundCurrency(getMean(values));
      const median = roundCurrency(getMedian(values));
      return {
        categoryId,
        categoryName: categoryNames.get(categoryId) ?? `Category ${categoryId}`,
        mean,
        median,
        suggestedBudget: mean,
      };
    })
    .filter((row) => row.suggestedBudget > 0)
    .sort((a, b) => b.suggestedBudget - a.suggestedBudget);

  const bankByMonth = new Map<string, number>();
  for (const row of input.bankMonthlySpend) {
    if (!monthSet.has(row.month)) continue;
    bankByMonth.set(row.month, (bankByMonth.get(row.month) ?? 0) + row.amount);
  }

  const totalBudgetSuggestion =
    bankByMonth.size === 0
      ? null
      : buildTotalSuggestion(months.map((month) => bankByMonth.get(month) ?? 0));

  return {
    hasEnoughHistory: true,
    message: null,
    months,
    selectedMonthCount,
    minMonthCount: MIN_BUDGET_SUGGESTION_MONTHS,
    maxMonthCount,
    categorySuggestions,
    totalBudgetSuggestion,
  };
}

function buildTotalSuggestion(values: number[]): TotalBudgetSuggestion {
  const mean = roundCurrency(getMean(values));
  const median = roundCurrency(getMedian(values));
  return {
    mean,
    median,
    suggestedBudget: mean,
  };
}

function getMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMonth(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}
