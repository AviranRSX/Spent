import "server-only";

import { getDb } from "../index";
import { getWorkspaceSetting } from "./settings";
import { daysUntil, nextPayday } from "../../lib/pace";
import {
  buildCashFlowAverages,
  buildMonthlyCashFlowTrend,
  HOME_CASH_FLOW_SOURCE_TYPE,
  HOME_CATEGORY_SOURCE_TYPE,
} from "../../lib/home-analytics";
import {
  BANK_TRANSACTION_PROVIDERS,
  type TransactionSourceType,
} from "@/lib/transaction-source-types";
import {
  getAverageWindow,
  HOME_AVERAGE_MONTHS,
  monthKeyFromDate,
  previousComparisonRange,
  trendMonthKeys,
  type HomeMonthRange,
} from "@/lib/home-month";
import { buildHomeKpis } from "@/lib/home-kpis";
import { LOW_CONFIDENCE_MAX } from "@/lib/transaction-review-filter";
import {
  buildCategoryBreakdown,
  type BreakdownCategory,
  type BreakdownSpendRow,
} from "@/lib/home-category-breakdown";
import type {
  HomeBankHealthItem,
  HomeBudgetPace,
  HomeCashFlow,
  HomeCategoryBreakdown,
  HomeCategorySnapshotItem,
  HomeHistoricalTrendPoint,
  HomeKpis,
  HomeNeedsAttention,
  HomeRecentTransaction,
  HomeSpendingStats,
} from "@/lib/types";
import { BANK_PROVIDERS } from "@/lib/types";

const EXCLUDE_TRANSFERS_SQL = `NOT EXISTS (
  SELECT 1 FROM categories transfer_category
  WHERE transfer_category.id = t.category_id
    AND transfer_category.workspace_id = t.workspace_id
    AND transfer_category.name = 'Transfers'
)`;

function homeSourceProviders(
  sourceType: TransactionSourceType
): readonly string[] {
  return sourceType === "bank" ? BANK_TRANSACTION_PROVIDERS : [];
}

function homeSourceSql(providers: readonly string[]): string {
  return providers.length > 0
    ? `t.provider IN (${providers.map(() => "?").join(",")})`
    : "1 = 1";
}

const HOME_CASH_FLOW_SOURCE_PROVIDERS = homeSourceProviders(
  HOME_CASH_FLOW_SOURCE_TYPE
);
const HOME_CATEGORY_SOURCE_PROVIDERS = homeSourceProviders(
  HOME_CATEGORY_SOURCE_TYPE
);
const HOME_CASH_FLOW_SOURCE_SQL = homeSourceSql(HOME_CASH_FLOW_SOURCE_PROVIDERS);
const HOME_CATEGORY_SOURCE_SQL = homeSourceSql(HOME_CATEGORY_SOURCE_PROVIDERS);

function getMonthRange(fromMonth: string, toMonth: string): string[] {
  const [fromYear, fromMonthNumber] = fromMonth.split("-").map(Number);
  const [toYear, toMonthNumber] = toMonth.split("-").map(Number);
  const cursor = new Date(fromYear, fromMonthNumber - 1, 1);
  const end = new Date(toYear, toMonthNumber - 1, 1);
  const months: string[] = [];

  while (cursor <= end) {
    months.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

export function getCashFlow(
  workspaceId: number,
  from: string,
  to: string
): HomeCashFlow {
  const db = getDb();
  const income = db
    .prepare(
      `SELECT COALESCE(SUM(charged_amount), 0) as total
       FROM transactions t
       WHERE t.workspace_id = ? AND t.date >= ? AND t.date <= ?
         AND t.status = 'completed' AND t.kind = 'income'
         AND ${HOME_CASH_FLOW_SOURCE_SQL}
         AND ${EXCLUDE_TRANSFERS_SQL}`
    )
    .get(workspaceId, from, to, ...HOME_CASH_FLOW_SOURCE_PROVIDERS) as {
    total: number;
  };
  const expenses = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(charged_amount)), 0) as total
       FROM transactions t
       WHERE t.workspace_id = ? AND t.date >= ? AND t.date <= ?
         AND t.status = 'completed' AND t.kind = 'expense'
         AND ${HOME_CASH_FLOW_SOURCE_SQL}
         AND ${EXCLUDE_TRANSFERS_SQL}`
    )
    .get(workspaceId, from, to, ...HOME_CASH_FLOW_SOURCE_PROVIDERS) as {
    total: number;
  };
  return {
    income: income.total,
    expenses: expenses.total,
    net: income.total - expenses.total,
  };
}

interface MonthlyCashFlowRow {
  month: string;
  kind: "income" | "expense";
  total: number;
}

function getMonthlyCashFlowRows(
  workspaceId: number,
  from: string,
  to: string
): MonthlyCashFlowRow[] {
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m', t.date) as month,
              t.kind as kind,
              CASE
                WHEN t.kind = 'income' THEN SUM(t.charged_amount)
                ELSE SUM(ABS(t.charged_amount))
              END as total
       FROM transactions t
       WHERE t.workspace_id = ? AND t.date >= ? AND t.date <= ?
         AND t.status = 'completed'
         AND t.kind IN ('income', 'expense')
         AND ${HOME_CASH_FLOW_SOURCE_SQL}
         AND ${EXCLUDE_TRANSFERS_SQL}
       GROUP BY month, t.kind
       ORDER BY month ASC`
    )
    .all(workspaceId, from, to, ...HOME_CASH_FLOW_SOURCE_PROVIDERS) as MonthlyCashFlowRow[];
}

/** First "YYYY-MM" with completed income or expense rows, or null. */
export function getFirstActivityMonth(workspaceId: number): string | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(strftime('%Y-%m', t.date)) as month
       FROM transactions t
       WHERE t.workspace_id = ?
         AND t.status = 'completed'
         AND t.kind IN ('income', 'expense')
         AND ${HOME_CASH_FLOW_SOURCE_SQL}
         AND ${EXCLUDE_TRANSFERS_SQL}`
    )
    .get(workspaceId, ...HOME_CASH_FLOW_SOURCE_PROVIDERS) as { month: string | null };
  return row.month;
}

export function getHomeKpis(workspaceId: number, month: HomeMonthRange): HomeKpis {
  const current = getCashFlow(workspaceId, month.from, month.to);
  const prevRange = previousComparisonRange(month);
  const prev = getCashFlow(workspaceId, prevRange.from, prevRange.to);
  const window = getAverageWindow(
    month,
    getFirstActivityMonth(workspaceId),
    HOME_AVERAGE_MONTHS
  );
  const average = window
    ? buildCashFlowAverages(
        getMonthlyCashFlowRows(workspaceId, window.from, window.to),
        window.months.length
      )
    : null;

  return buildHomeKpis(
    month,
    current,
    prev,
    average && window
      ? {
          income: average.meanIncome,
          expenses: average.meanExpense,
          months: window.months.length,
        }
      : null
  );
}

export function getCashFlowTrend(
  workspaceId: number,
  month: HomeMonthRange,
  monthCount: number,
  now: Date
): HomeHistoricalTrendPoint[] {
  const keys = trendMonthKeys(month.key, monthCount);
  const currentKey = monthKeyFromDate(now);
  const rows = getMonthlyCashFlowRows(workspaceId, `${keys[0]}-01`, month.to);
  return buildMonthlyCashFlowTrend(
    keys.map((key) => ({
      key,
      isCurrent: key === currentKey,
      isSelected: key === month.key,
    })),
    rows
  );
}

export function getBudgetPace(
  workspaceId: number,
  month: HomeMonthRange,
  now: Date
): HomeBudgetPace {
  const spent = getCashFlow(workspaceId, month.from, month.to).expenses;
  const prevRange = previousComparisonRange(month);
  const prevSpent = getCashFlow(workspaceId, prevRange.from, prevRange.to).expenses;

  const targetRaw = getWorkspaceSetting(workspaceId, "monthly_target");
  const parsedTarget = targetRaw != null ? Number(targetRaw) : NaN;
  const budget = Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : 0;

  const isPast = !month.isCurrent;
  const timeElapsedPercent = isPast
    ? 100
    : Math.min(100, (Math.max(1, month.elapsedDays) / month.daysInMonth) * 100);

  const paydayDay = Number(getWorkspaceSetting(workspaceId, "payday_day") ?? "1");
  const daysUntilPayday = isPast
    ? null
    : Math.max(0, daysUntil(nextPayday(now, paydayDay), now));

  return {
    month: month.key,
    spent,
    budget,
    deltaVsLastMonth: prevSpent > 0 ? ((spent - prevSpent) / prevSpent) * 100 : null,
    daysUntilPayday,
    timeElapsedPercent,
    isPast,
  };
}

export function getCategoryBreakdown(
  workspaceId: number,
  month: HomeMonthRange
): HomeCategoryBreakdown {
  const db = getDb();
  const categories = db
    .prepare(
      `SELECT id, parent_id as parentId, name, color
       FROM categories WHERE workspace_id = ?`
    )
    .all(workspaceId) as BreakdownCategory[];

  // Same filters as the Expenses KPI, so the groups add up to it.
  const spendStmt = db.prepare(
    `SELECT t.category_id as categoryId, SUM(ABS(t.charged_amount)) as amount
     FROM transactions t
     WHERE t.workspace_id = ? AND t.date >= ? AND t.date <= ?
       AND t.status = 'completed' AND t.kind = 'expense'
       AND ${HOME_CATEGORY_SOURCE_SQL}
       AND ${EXCLUDE_TRANSFERS_SQL}
     GROUP BY t.category_id`
  );
  const monthRows = spendStmt.all(
    workspaceId,
    month.from,
    month.to,
    ...HOME_CATEGORY_SOURCE_PROVIDERS
  ) as BreakdownSpendRow[];

  const window = getAverageWindow(
    month,
    getFirstActivityMonth(workspaceId),
    HOME_AVERAGE_MONTHS
  );
  const averageRows = window
    ? (spendStmt.all(
        workspaceId,
        window.from,
        window.to,
        ...HOME_CATEGORY_SOURCE_PROVIDERS
      ) as BreakdownSpendRow[])
    : [];

  return buildCategoryBreakdown({
    month: month.key,
    isCurrentMonth: month.isCurrent,
    categories,
    monthRows,
    averageRows,
    averageMonths: window?.months.length ?? 0,
  });
}

export function getSpendingStats(
  workspaceId: number,
  to: string,
  defaultMonths: number
): HomeSpendingStats {
  const db = getDb();
  const oldest = db.prepare(
    `SELECT MIN(strftime('%Y-%m', t.date)) as month
     FROM transactions t
     WHERE t.workspace_id = ?
       AND t.date <= ?
       AND t.status = 'completed'
       AND t.kind IN ('income', 'expense')
       AND ${HOME_CATEGORY_SOURCE_SQL}
       AND ${EXCLUDE_TRANSFERS_SQL}`
  ).get(workspaceId, to, ...HOME_CATEGORY_SOURCE_PROVIDERS) as {
    month: string | null;
  };
  const now = new Date();
  const fallbackStart = new Date(
    now.getFullYear(),
    now.getMonth() - defaultMonths + 1,
    1
  );
  const toMonth = to.slice(0, 7);
  const startMonth =
    oldest.month != null
      ? oldest.month
      : `${fallbackStart.getFullYear()}-${String(fallbackStart.getMonth() + 1).padStart(2, "0")}`;
  const trendFrom = `${startMonth}-01`;

  const categoryRows = db.prepare(
    `SELECT strftime('%Y-%m', t.date) as month,
            c.id as categoryId,
            c.name as name,
            c.color as color,
            SUM(ABS(t.charged_amount)) as amount
     FROM transactions t
     JOIN categories c ON t.category_id = c.id
     WHERE t.workspace_id = ?
       AND t.date >= ?
       AND t.date <= ?
       AND t.status = 'completed'
       AND t.kind = 'expense'
       AND ${HOME_CATEGORY_SOURCE_SQL}
       AND c.name != 'Transfers'
     GROUP BY month, c.id, c.name, c.color
     ORDER BY month ASC`
  ).all(
    workspaceId,
    trendFrom,
    to,
    ...HOME_CATEGORY_SOURCE_PROVIDERS
  ) as Array<{
    month: string;
    categoryId: number;
    name: string;
    color: string;
    amount: number;
  }>;
  const cashFlowRows = getMonthlyCashFlowRows(workspaceId, trendFrom, to);
  const monthKeys = oldest.month != null ? getMonthRange(startMonth, toMonth) : [];
  const monthlyCashFlow = monthKeys.map((month) => {
    const income = cashFlowRows
      .filter((row) => row.month === month && row.kind === "income")
      .reduce((sum, row) => sum + row.total, 0);
    const expenses = cashFlowRows
      .filter((row) => row.month === month && row.kind === "expense")
      .reduce((sum, row) => sum + row.total, 0);
    return { month, income, expenses };
  });

  return {
    availableMonths: monthlyCashFlow.length,
    defaultMonths: Math.min(Math.max(3, monthlyCashFlow.length), defaultMonths),
    monthlyCashFlow,
    categoryMonthlySpend: categoryRows,
  };
}

export function getRecentTransactionsForHome(
  workspaceId: number,
  limit: number
): HomeRecentTransaction[] {
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.date, t.description, t.charged_amount as chargedAmount,
              t.charged_currency as chargedCurrency, t.kind,
              c.name as categoryName, c.color as categoryColor
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.workspace_id = ? AND t.status = 'completed' AND t.kind != 'transfer'
         AND ${EXCLUDE_TRANSFERS_SQL}
       ORDER BY t.date DESC, t.id DESC
       LIMIT ?`
    )
    .all(workspaceId, limit) as Array<{
    id: number;
    date: string;
    description: string;
    chargedAmount: number;
    chargedCurrency: string | null;
    kind: "expense" | "income" | "transfer";
    categoryName: string | null;
    categoryColor: string | null;
  }>;
  return rows;
}

export function getNeedsAttentionCounts(
  workspaceId: number,
  range?: { from: string; to: string }
): HomeNeedsAttention {
  const db = getDb();
  const rangeSql = range ? " AND date >= ? AND date <= ?" : "";
  const rangeValues = range ? [range.from, range.to] : [];
  const count = (condition: string, ...values: (string | number)[]): number =>
    (
      db
        .prepare(
          `SELECT COUNT(*) as count FROM transactions
           WHERE workspace_id = ? AND status = 'completed' AND ${condition}${rangeSql}`
        )
        .get(workspaceId, ...values, ...rangeValues) as { count: number }
    ).count;

  return {
    uncategorized: count("category_id IS NULL AND kind = 'expense'"),
    // Approving a row clears needs_review but keeps ai_confidence, so
    // approved rows must not stay in this count.
    lowConfidence: count(
      "category_source = 'ai' AND ai_confidence IS NOT NULL AND ai_confidence <= ? AND needs_review = 1",
      LOW_CONFIDENCE_MAX
    ),
    flagged: count("needs_review = 1"),
  };
}

export function getBankHealth(workspaceId: number): HomeBankHealthItem[] {
  const db = getDb();
  const creds = db
    .prepare(
      `SELECT provider FROM bank_credentials WHERE workspace_id = ? ORDER BY provider`
    )
    .all(workspaceId) as { provider: string }[];

  const latestRunStmt = db.prepare(
    `SELECT status, completed_at, error_message FROM sync_runs
     WHERE workspace_id = ? AND provider = ?
     ORDER BY started_at DESC LIMIT 1`
  );

  const staleThresholdMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  return creds.map(({ provider }) => {
    const latest = latestRunStmt.get(workspaceId, provider) as
      | { status: string; completed_at: string | null; error_message: string | null }
      | undefined;
    const providerInfo = BANK_PROVIDERS.find((p) => p.id === provider);
    const providerName = providerInfo?.name ?? provider;

    if (!latest) {
      return {
        provider,
        providerName,
        lastSyncAt: null,
        status: "never",
        errorMessage: null,
      };
    }

    if (latest.status === "failed") {
      return {
        provider,
        providerName,
        lastSyncAt: latest.completed_at,
        status: "error",
        errorMessage: latest.error_message,
      };
    }

    if (!latest.completed_at) {
      return {
        provider,
        providerName,
        lastSyncAt: null,
        status: "never",
        errorMessage: null,
      };
    }

    const ageMs = now - new Date(latest.completed_at + "Z").getTime();
    const status: "ok" | "stale" = ageMs > staleThresholdMs ? "stale" : "ok";
    return {
      provider,
      providerName,
      lastSyncAt: latest.completed_at,
      status,
      errorMessage: null,
    };
  });
}

export function getCategorySnapshot(
  workspaceId: number,
  from: string,
  to: string,
  limit: number
): HomeCategorySnapshotItem[] {
  const db = getDb();

  const categories = db
    .prepare(
      `SELECT id, parent_id as parentId, name, color
       FROM categories WHERE workspace_id = ? AND kind = 'expense'`
    )
    .all(workspaceId) as Array<{
    id: number;
    parentId: number | null;
    name: string;
    color: string;
  }>;

  const parentIds = new Set<number>();
  for (const c of categories) {
    if (c.parentId != null) parentIds.add(c.parentId);
  }

  const spendRows = db
    .prepare(
      `SELECT category_id as categoryId, SUM(ABS(charged_amount)) as amount
       FROM transactions t
       WHERE t.workspace_id = ? AND t.date >= ? AND t.date <= ?
         AND t.status = 'completed' AND t.kind = 'expense'
         AND t.category_id IS NOT NULL
         AND ${HOME_CATEGORY_SOURCE_SQL}
         AND ${EXCLUDE_TRANSFERS_SQL}
       GROUP BY category_id`
    )
    .all(workspaceId, from, to, ...HOME_CATEGORY_SOURCE_PROVIDERS) as Array<{
    categoryId: number;
    amount: number;
  }>;

  const budgetRows = db
    .prepare(
      `SELECT category_id as categoryId, monthly_amount as monthlyAmount
       FROM budgets WHERE workspace_id = ?`
    )
    .all(workspaceId) as Array<{ categoryId: number; monthlyAmount: number }>;

  const budgetByCategory = new Map<number, number>();
  for (const b of budgetRows) budgetByCategory.set(b.categoryId, b.monthlyAmount);

  // Roll each leaf's spend up to its parent if it has one, else under its own id.
  const rolledSpend = new Map<number, number>();
  const rolledBudget = new Map<number, number>();

  const categoryById = new Map(categories.map((c) => [c.id, c]));

  for (const row of spendRows) {
    const cat = categoryById.get(row.categoryId);
    if (!cat) continue;
    const key = cat.parentId ?? cat.id;
    rolledSpend.set(key, (rolledSpend.get(key) ?? 0) + row.amount);
  }

  // Roll up budgets the same way. Parent's explicit budget takes precedence
  // over the sum of children when it exists.
  for (const cat of categories) {
    const explicit = budgetByCategory.get(cat.id);
    if (explicit == null) continue;
    const key = cat.parentId ?? cat.id;
    if (cat.parentId == null && parentIds.has(cat.id)) {
      // This is a parent with its own explicit budget — use it directly.
      rolledBudget.set(key, explicit);
    } else {
      // Leaf budget: only add if parent doesn't have its own explicit budget.
      const parentHasOwnBudget =
        cat.parentId != null && budgetByCategory.has(cat.parentId);
      if (parentHasOwnBudget) continue;
      rolledBudget.set(key, (rolledBudget.get(key) ?? 0) + explicit);
    }
  }

  const items: HomeCategorySnapshotItem[] = [];
  for (const [key, spent] of rolledSpend) {
    const cat = categoryById.get(key);
    if (!cat) continue;
    const budget = rolledBudget.get(key) ?? 0;
    items.push({
      categoryId: key,
      name: cat.name,
      color: cat.color,
      spent,
      budget,
      percentSpent: budget > 0 ? (spent / budget) * 100 : 0,
    });
  }

  items.sort((a, b) => b.spent - a.spent);
  return items.slice(0, limit);
}
