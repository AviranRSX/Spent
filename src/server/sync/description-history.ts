import "server-only";

import type Database from "better-sqlite3";
import type { MatchingDescriptionHistory } from "../ai/types";
import { normalizeMerchant } from "../lib/merchant-normalization";

export const HISTORY_DATABASE_THRESHOLD = 5;

export interface CategorizedDescriptionCountRow {
  description: string;
  categoryId: number;
  categoryName: string;
  count: number;
}

export interface DescriptionCategoryHistory {
  normalizedDescription: string;
  total: number;
  categories: Array<{
    categoryId: number;
    categoryName: string;
    count: number;
  }>;
}

export type DescriptionHistoryDecision =
  | {
      route: "database";
      reason: "majority-vote";
      categoryId: number;
      categoryName: string;
    }
  | {
      route: "ai";
      reason: "no-history" | "below-threshold" | "tied-vote";
      categoryId: null;
      categoryName: null;
    };

export function queryCategorizedDescriptionCounts(
  db: Database.Database,
  workspaceId: number,
  kind: "expense" | "income"
): CategorizedDescriptionCountRow[] {
  return db
    .prepare(
      `SELECT t.description,
              c.id as categoryId,
              c.name as categoryName,
              COUNT(*) as count
       FROM transactions t
       JOIN categories c
         ON c.id = t.category_id
        AND c.workspace_id = t.workspace_id
        AND c.kind = t.kind
       WHERE t.workspace_id = ?
         AND t.kind = ?
         AND t.category_id IS NOT NULL
       GROUP BY t.description, c.id, c.name
       ORDER BY t.description, c.name`
    )
    .all(workspaceId, kind) as CategorizedDescriptionCountRow[];
}

export function buildDescriptionHistory(
  rows: CategorizedDescriptionCountRow[]
): Map<string, DescriptionCategoryHistory> {
  const countsByDescription = new Map<
    string,
    Map<number, { categoryName: string; count: number }>
  >();

  for (const row of rows) {
    const normalizedDescription = normalizeMerchant(row.description);
    if (!normalizedDescription || row.count <= 0) continue;

    const categoryCounts =
      countsByDescription.get(normalizedDescription) ?? new Map();
    const current = categoryCounts.get(row.categoryId);
    categoryCounts.set(row.categoryId, {
      categoryName: row.categoryName,
      count: (current?.count ?? 0) + row.count,
    });
    countsByDescription.set(normalizedDescription, categoryCounts);
  }

  const history = new Map<string, DescriptionCategoryHistory>();
  for (const [normalizedDescription, categoryCounts] of countsByDescription) {
    const categories = Array.from(categoryCounts, ([categoryId, value]) => ({
      categoryId,
      categoryName: value.categoryName,
      count: value.count,
    })).sort(
      (a, b) =>
        b.count - a.count || a.categoryName.localeCompare(b.categoryName)
    );
    history.set(normalizedDescription, {
      normalizedDescription,
      total: categories.reduce((sum, category) => sum + category.count, 0),
      categories,
    });
  }

  return history;
}

export function decideDescriptionHistory(
  history: DescriptionCategoryHistory | null | undefined
): DescriptionHistoryDecision {
  if (!history || history.total === 0 || history.categories.length === 0) {
    return {
      route: "ai",
      reason: "no-history",
      categoryId: null,
      categoryName: null,
    };
  }
  if (history.total < HISTORY_DATABASE_THRESHOLD) {
    return {
      route: "ai",
      reason: "below-threshold",
      categoryId: null,
      categoryName: null,
    };
  }
  if (
    history.categories.length > 1 &&
    history.categories[0].count === history.categories[1].count
  ) {
    return {
      route: "ai",
      reason: "tied-vote",
      categoryId: null,
      categoryName: null,
    };
  }

  const winner = history.categories[0];
  return {
    route: "database",
    reason: "majority-vote",
    categoryId: winner.categoryId,
    categoryName: winner.categoryName,
  };
}

interface DescriptionTransaction {
  id: number;
  description: string;
}

export interface PlannedAITransaction<T extends DescriptionTransaction> {
  transaction: T;
  normalizedDescription: string;
  history: DescriptionCategoryHistory | null;
  decision: Extract<DescriptionHistoryDecision, { route: "ai" }>;
}

export interface PlannedDatabaseTransaction<T extends DescriptionTransaction> {
  transaction: T;
  normalizedDescription: string;
  history: DescriptionCategoryHistory;
  decision: Extract<DescriptionHistoryDecision, { route: "database" }>;
}

export function planDescriptionHistoryRoutes<T extends DescriptionTransaction>(
  transactions: T[],
  memoryTransactionIds: ReadonlySet<number>,
  historyByDescription: ReadonlyMap<string, DescriptionCategoryHistory>
): {
  memoryTransactions: T[];
  databaseTransactions: PlannedDatabaseTransaction<T>[];
  aiTransactions: PlannedAITransaction<T>[];
  matchingHistory: MatchingDescriptionHistory[];
} {
  const memoryTransactions: T[] = [];
  const databaseTransactions: PlannedDatabaseTransaction<T>[] = [];
  const aiTransactions: PlannedAITransaction<T>[] = [];
  const matchingHistoryByDescription = new Map<
    string,
    MatchingDescriptionHistory
  >();

  for (const transaction of transactions) {
    if (memoryTransactionIds.has(transaction.id)) {
      memoryTransactions.push(transaction);
      continue;
    }

    const normalizedDescription = normalizeMerchant(transaction.description);
    const history = historyByDescription.get(normalizedDescription) ?? null;
    const decision = decideDescriptionHistory(history);
    if (decision.route === "database") {
      if (!history) {
        throw new Error("Database history decision requires history evidence");
      }
      databaseTransactions.push({
        transaction,
        normalizedDescription,
        history,
        decision,
      });
      continue;
    }

    aiTransactions.push({
      transaction,
      normalizedDescription,
      history,
      decision,
    });
    if (history && !matchingHistoryByDescription.has(normalizedDescription)) {
      matchingHistoryByDescription.set(normalizedDescription, {
        normalizedDescription,
        displayDescription: transaction.description,
        total: history.total,
        categories: history.categories.map((category) => ({
          categoryName: category.categoryName,
          count: category.count,
        })),
      });
    }
  }

  return {
    memoryTransactions,
    databaseTransactions,
    aiTransactions,
    matchingHistory: Array.from(matchingHistoryByDescription.values()),
  };
}
