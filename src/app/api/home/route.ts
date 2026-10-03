import { NextResponse } from "next/server";
import { getPeriodTotal } from "@/server/db/queries/transactions";
import {
  getLastCompleteMonthEnd,
  HOME_CASH_FLOW_SOURCE_TYPE,
} from "@/server/lib/home-analytics";
import {
  getBankHealth,
  getBudgetPace,
  getCashFlowTrend,
  getCategoryBreakdown,
  getCategorySnapshot,
  getHomeKpis,
  getNeedsAttentionCounts,
  getRecentTransactionsForHome,
  getSpendingStats,
} from "@/server/db/queries/home";
import { getWorkspaceSetting } from "@/server/db/queries/settings";
import { getNextRunAt } from "@/server/sync/scheduler";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import {
  daysInMonth,
  dayWithinMonth,
  daysUntil,
  nextPayday,
  pacePhrase,
} from "@/server/lib/pace";
import { toLocalISODate } from "@/server/lib/date-utils";
import { parseHomeMonth } from "@/lib/home-month";
import type {
  HomeBankHealthItem,
  HomeBudgetPace,
  HomeCategoryBreakdown,
  HomeCategorySnapshotItem,
  HomeHistoricalTrendPoint,
  HomeKpis,
  HomeNeedsAttention,
  HomePayload,
  HomeRecentTransaction,
  HomeSection,
  HomeSectionError,
  HomeSpendingStats,
  HomeThisMonth,
} from "@/lib/types";

const TREND_MONTHS = 12;
const STATS_DEFAULT_MONTHS = 6;
const RECENT_TXN_LIMIT = 8;
const CATEGORY_SNAPSHOT_LIMIT = 6;

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

  // Legacy current-month window for the thisMonth section, removed with ThisMonthCard.
  const year = now.getFullYear();
  const month = now.getMonth();

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const from = toLocalISODate(monthStart);
  const to = toLocalISODate(monthEnd);
  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long" });

  const totalDays = daysInMonth(year, month);
  const elapsedDays = Math.max(1, dayWithinMonth(now, year, month));
  const timeElapsedPercent = Math.min(100, (elapsedDays / totalDays) * 100);

  const paydayDay = Number(getWorkspaceSetting(workspaceId, "payday_day") ?? "1");
  const payday = nextPayday(now, paydayDay);
  const daysUntilPayday = Math.max(0, daysUntil(payday));

  const errors: HomeSectionError[] = [];

  const kpis = safe<HomeKpis>("kpis", errors, () =>
    getHomeKpis(workspaceId, selected)
  );

  const budgetPace = safe<HomeBudgetPace>("budgetPace", errors, () =>
    getBudgetPace(workspaceId, selected, now)
  );

  const thisMonth = safe<HomeThisMonth>("thisMonth", errors, () => {
    const spent = getPeriodTotal(workspaceId, from, to, {
      excludeTransfers: true,
      sourceType: HOME_CASH_FLOW_SOURCE_TYPE,
    });
    const monthlyTargetRaw = getWorkspaceSetting(workspaceId, "monthly_target");
    const parsed = monthlyTargetRaw != null ? Number(monthlyTargetRaw) : NaN;
    const budget = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

    // Same window last month: from day 1 to today's day-of-month (clamped).
    const prevMonthStart = new Date(year, month - 1, 1);
    const prevElapsedDay = Math.min(
      elapsedDays,
      daysInMonth(prevMonthStart.getFullYear(), prevMonthStart.getMonth())
    );
    const prevMonthMtdEnd = new Date(
      prevMonthStart.getFullYear(),
      prevMonthStart.getMonth(),
      prevElapsedDay
    );
    const prevSpent = getPeriodTotal(
      workspaceId,
      toLocalISODate(prevMonthStart),
      toLocalISODate(prevMonthMtdEnd),
      { excludeTransfers: true, sourceType: HOME_CASH_FLOW_SOURCE_TYPE }
    );
    const deltaVsLastMonth =
      prevSpent > 0 ? ((spent - prevSpent) / prevSpent) * 100 : null;

    const phrase = pacePhrase(spent, spent, budget, timeElapsedPercent, monthLabel);

    return {
      spent,
      budget,
      deltaVsLastMonth,
      pacePhrase: phrase,
      daysUntilPayday,
      timeElapsedPercent,
      monthLabel,
    };
  });

  const categorySnapshot = safe<HomeCategorySnapshotItem[]>(
    "categorySnapshot",
    errors,
    () =>
      getCategorySnapshot(
        workspaceId,
        selected.from,
        selected.to,
        CATEGORY_SNAPSHOT_LIMIT
      )
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

  const categoryBreakdown = safe<HomeCategoryBreakdown>(
    "categoryBreakdown",
    errors,
    () => getCategoryBreakdown(workspaceId, selected)
  );

  const payload: HomePayload = {
    month: selected.key,
    kpis,
    budgetPace,
    thisMonth,
    categorySnapshot,
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
