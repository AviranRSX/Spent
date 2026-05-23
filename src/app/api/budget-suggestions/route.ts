import { NextResponse } from "next/server";
import {
  getAvailableCompletedExpenseMonths,
  getCompletedExpenseMonths,
  getMonthlyBankSpend,
  getMonthlyCategorySpend,
} from "@/server/db/queries/transactions";
import {
  buildBudgetSuggestions,
  getMonthKey,
  getLastCompleteMonths,
  resolveBudgetSuggestionMonthCount,
} from "@/server/lib/budget-suggestions";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const now = new Date();
  const url = new URL(request.url);
  const requestedMonths = Number(url.searchParams.get("months"));
  const availableMonths = getAvailableCompletedExpenseMonths(
    workspaceId,
    getMonthKey(now)
  );
  const selectedMonthCount = resolveBudgetSuggestionMonthCount(
    Number.isFinite(requestedMonths) ? requestedMonths : null,
    availableMonths.length
  );
  const months = getLastCompleteMonths(now, selectedMonthCount);
  const result = buildBudgetSuggestions({
    now,
    monthCount: selectedMonthCount,
    maxMonthCount: availableMonths.length,
    availableMonths: getCompletedExpenseMonths(workspaceId, months),
    categoryMonthlySpend: getMonthlyCategorySpend(workspaceId, months),
    bankMonthlySpend: getMonthlyBankSpend(workspaceId, months),
  });

  return NextResponse.json(result);
}
