import { NextResponse } from "next/server";
import {
  getAvailableCompletedExpenseMonths,
  getCompletedExpenseMonths,
  getMonthlyBankSpend,
  getMonthlyCategorySpend,
} from "@/server/db/queries/transactions";
import {
  buildBudgetSuggestions,
  buildBudgetSuggestionApplyPlanFromSelections,
  getMonthKey,
  getLastCompleteMonths,
  resolveBudgetSuggestionMonthCount,
  type BudgetSuggestionApplySelection,
} from "@/server/lib/budget-suggestions";
import { setBudget } from "@/server/db/queries/budgets";
import { updateCategoryBudgetMode } from "@/server/db/queries/categories";
import { updateAppSettings } from "@/server/db/queries/settings";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  return NextResponse.json(calculateBudgetSuggestions(request, workspaceId));
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const categoryBudgets = (body as BudgetSuggestionApplySelection)
    .categoryBudgets;
  if (!Array.isArray(categoryBudgets)) {
    return NextResponse.json(
      { error: "categoryBudgets is required" },
      { status: 400 }
    );
  }

  const plan = buildBudgetSuggestionApplyPlanFromSelections(
    body as BudgetSuggestionApplySelection
  );
  for (const row of plan.categoryBudgets) {
    updateCategoryBudgetMode(workspaceId, row.categoryId, "budgeted");
    setBudget(workspaceId, row.categoryId, row.amount, true);
  }
  if (plan.monthlyTarget != null) {
    updateAppSettings(workspaceId, { monthlyTarget: plan.monthlyTarget });
  }

  return NextResponse.json({
    success: true,
    appliedCategoryCount: plan.categoryBudgets.length,
    monthlyTarget: plan.monthlyTarget,
  });
}

function calculateBudgetSuggestions(request: Request, workspaceId: number) {
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

  return result;
}
