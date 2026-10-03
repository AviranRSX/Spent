import { NextResponse } from "next/server";
import { getLastCompleteMonthEnd } from "@/server/lib/home-analytics";
import {
  getBankHealth,
  getBudgetPace,
  getCashFlowTrend,
  getCategoryBreakdown,
  getHomeKpis,
  getNeedsAttentionCounts,
  getRecentTransactionsForHome,
  getSpendingStats,
} from "@/server/db/queries/home";
import { getNextRunAt } from "@/server/sync/scheduler";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { toLocalISODate } from "@/server/lib/date-utils";
import { parseHomeMonth } from "@/lib/home-month";
import type {
  HomeBankHealthItem,
  HomeBudgetPace,
  HomeCategoryBreakdown,
  HomeHistoricalTrendPoint,
  HomeKpis,
  HomeNeedsAttention,
  HomePayload,
  HomeRecentTransaction,
  HomeSection,
  HomeSectionError,
  HomeSpendingStats,
} from "@/lib/types";

const TREND_MONTHS = 12;
const STATS_DEFAULT_MONTHS = 6;
const RECENT_TXN_LIMIT = 8;

function safe<T>(
  section: HomeSection,
  errors: HomeSectionError[],
  fn: () => T
): T | null {
  try {
    return fn();
  } catch (err) {
    errors.push({
      section,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const now = new Date();

  const parsedMonth = parseHomeMonth(
    new URL(request.url).searchParams.get("month"),
    now
  );
  if (!parsedMonth.ok) {
    return NextResponse.json(
      {
        error:
          parsedMonth.error === "future_month"
            ? "month cannot be in the future"
            : "month must be formatted as YYYY-MM",
      },
      { status: 400 }
    );
  }
  const selected = parsedMonth.month;

  const errors: HomeSectionError[] = [];

  const kpis = safe<HomeKpis>("kpis", errors, () =>
    getHomeKpis(workspaceId, selected)
  );

  const budgetPace = safe<HomeBudgetPace>("budgetPace", errors, () =>
    getBudgetPace(workspaceId, selected, now)
  );

  const categoryBreakdown = safe<HomeCategoryBreakdown>(
    "categoryBreakdown",
    errors,
    () => getCategoryBreakdown(workspaceId, selected)
  );

  const historicalTrend = safe<HomeHistoricalTrendPoint[]>(
    "historicalTrend",
    errors,
    () => getCashFlowTrend(workspaceId, selected, TREND_MONTHS, now)
  );

  const recentTransactions = safe<HomeRecentTransaction[]>(
    "recentTransactions",
    errors,
    () => getRecentTransactionsForHome(workspaceId, RECENT_TXN_LIMIT)
  );

  const spendingStats = safe<HomeSpendingStats>("spendingStats", errors, () => {
    const statsTo = toLocalISODate(getLastCompleteMonthEnd(now));
    return getSpendingStats(workspaceId, statsTo, STATS_DEFAULT_MONTHS);
  });

  const needsAttention = safe<HomeNeedsAttention>(
    "needsAttention",
    errors,
    () =>
      getNeedsAttentionCounts(workspaceId, {
        from: selected.from,
        to: selected.to,
      })
  );

  const bankHealth = safe<HomeBankHealthItem[]>("bankHealth", errors, () =>
    getBankHealth(workspaceId)
  );

  const payload: HomePayload = {
    month: selected.key,
    kpis,
    budgetPace,
    categoryBreakdown,
    historicalTrend,
    recentTransactions,
    spendingStats,
    needsAttention,
    bankHealth,
    nextScheduledSync: getNextRunAt(),
    errors,
  };

  return NextResponse.json(payload);
}
