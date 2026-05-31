import "server-only";

interface SummaryTotals {
  total: number;
  count: number;
}

export function combineTransactionSummaryTotals({
  income,
  expense,
  expenseTransfers,
}: {
  income: SummaryTotals;
  expense: SummaryTotals;
  expenseTransfers?: SummaryTotals;
}): {
  income: SummaryTotals;
  expense: SummaryTotals;
  net: number;
} {
  const totalExpense = expense.total + (expenseTransfers?.total ?? 0);
  const expenseCount = expense.count + (expenseTransfers?.count ?? 0);

  return {
    income,
    expense: {
      total: totalExpense,
      count: expenseCount,
    },
    net: income.total - totalExpense,
  };
}
