import "server-only";

import { createAIProvider } from "@/server/ai/factory";
import { ensureOllamaRunning } from "@/server/ai/ollama-manager";
import { getAllCategories } from "@/server/db/queries/categories";
import { getRecentCorrections } from "@/server/db/queries/category-corrections";
import { getAppSettings } from "@/server/db/queries/settings";
import {
  batchSetNeedsReview,
  batchUpdateCategories,
  getCategorizedDescriptionCounts,
  getTransactionsForCategorization,
  getUncategorizedIdsByKind,
} from "@/server/db/queries/transactions";
import {
  incrementMerchantHits,
  lookupMerchantCategoriesBulk,
  normalizeMerchant,
} from "@/server/lib/merchant-memory";
import {
  buildDescriptionHistory,
  planDescriptionHistoryRoutes,
  type DescriptionCategoryHistory,
} from "@/server/sync/description-history";
import type { CategoryMapping, MatchingDescriptionHistory } from "@/server/ai/types";

export type CategorizationEventSender = (
  event: string,
  data: Record<string, unknown>
) => void;

export function friendlyAIError(err: unknown, modelName: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/model.*not found|pull.*model|404/i.test(msg)) {
    return `Ollama model "${modelName}" is not installed. Run: ollama pull ${modelName}`;
  }
  if (/ECONNREFUSED|fetch failed/i.test(msg)) {
    return "Ollama is not reachable. Make sure it's installed and that no firewall is blocking port 11434.";
  }
  if (/Anthropic|api[_-]?key|401|403/i.test(msg)) {
    return "Claude API request was rejected. Check your API key in settings.";
  }
  return `AI categorization failed: ${msg}`;
}

const NOOP_SEND: CategorizationEventSender = () => {};

export type CategorizationDecisionReason =
  | "memory-hit"
  | "majority-vote"
  | "below-threshold"
  | "tied-vote"
  | "no-history";

export type CategorizationDiagnosticEvent =
  | {
      type: "decision";
      transactionId: number;
      description: string;
      normalizedDescription: string;
      kind: "expense" | "income";
      historicalMatchCount: number;
      history: Array<{ category: string; count: number }>;
      route: "memory" | "database" | "ai";
      reason: CategorizationDecisionReason;
      selectedCategory: string | null;
    }
  | {
      type: "ai-batch";
      kind: "expense" | "income";
      transactionIds: number[];
      systemPrompt: string;
      userPrompt: string;
      mappings: CategoryMapping[];
      updates: Array<{
        id: number;
        categoryId: number;
        aiConfidence: number | null;
        needsReview: boolean;
      }>;
      error: string | null;
    };

export type CategorizationDiagnosticSink = (
  event: CategorizationDiagnosticEvent
) => void;

function toDiagnosticHistory(
  history: DescriptionCategoryHistory | null
): Array<{ category: string; count: number }> {
  return (
    history?.categories.map((category) => ({
      category: category.categoryName,
      count: category.count,
    })) ?? []
  );
}

function buildBatchMatchingHistory(
  batch: Array<{
    transaction: { description: string };
    normalizedDescription: string;
    history: {
      total: number;
      categories: Array<{ categoryName: string; count: number }>;
    } | null;
  }>
): MatchingDescriptionHistory[] {
  const unique = new Map<string, MatchingDescriptionHistory>();
  for (const item of batch) {
    if (!item.history || unique.has(item.normalizedDescription)) continue;
    unique.set(item.normalizedDescription, {
      normalizedDescription: item.normalizedDescription,
      displayDescription: item.transaction.description,
      total: item.history.total,
      categories: item.history.categories.map((category) => ({
        categoryName: category.categoryName,
        count: category.count,
      })),
    });
  }
  return Array.from(unique.values());
}

export async function categorizeWorkspaceTransactions(
  workspaceId: number,
  workspaceName: string,
  send: CategorizationEventSender = NOOP_SEND,
  diagnosticSink?: CategorizationDiagnosticSink
): Promise<{ categorized: number; aiWarning: string | null }> {
  const settings = getAppSettings(workspaceId);
  let categorized = 0;
  let aiWarning: string | null = null;
  let aiProvider: ReturnType<typeof createAIProvider> | undefined;
  let ollamaReady: boolean | undefined;

  async function getReadyAIProvider() {
    if (aiProvider === undefined) {
      aiProvider = createAIProvider();
      if (!aiProvider) {
        aiWarning =
          "AI provider not connected - new transactions weren't auto-categorized.";
        return null;
      }
    }

    if (settings.aiProvider === "ollama" && ollamaReady === false) {
      return null;
    }

    if (settings.aiProvider === "ollama" && ollamaReady === undefined) {
      send("stage", {
        workspaceId,
        workspaceName,
        stage: "ollama-start",
      });
      const ollamaResult = await ensureOllamaRunning(settings.ollamaUrl);
      ollamaReady = ollamaResult.ok;
      if (!ollamaResult.ok) {
        aiWarning = ollamaResult.error ?? "Ollama is not reachable";
        console.error("[sync]", aiWarning);
        return null;
      }
    }

    return aiProvider;
  }

  send("stage", {
    workspaceId,
    workspaceName,
    stage: "categorizing",
  });

  const kinds: Array<"expense" | "income"> = ["expense", "income"];
  const batchSize = 50;

  for (const kind of kinds) {
    const uncategorizedIds = getUncategorizedIdsByKind(workspaceId, kind);
    if (uncategorizedIds.length === 0) continue;

    const categories = getAllCategories(workspaceId, kind);
    if (categories.length === 0) continue;
    const categoryInput = categories.map((c) => ({
      name: c.name,
      description: c.description,
    }));
    const pastCorrections = getRecentCorrections(workspaceId, kind);

    const allTxns = getTransactionsForCategorization(
      workspaceId,
      uncategorizedIds
    );

    const historyByDescription = buildDescriptionHistory(
      getCategorizedDescriptionCounts(workspaceId, kind)
    );

    const memoryMap = lookupMerchantCategoriesBulk(
      workspaceId,
      allTxns.map((t) => t.description)
    );

    const categoryNamesById = new Map(
      categories.map((category) => [category.id, category.name])
    );
    const memoryUpdates: { id: number; categoryId: number }[] = [];
    const memoryKeysHit: string[] = [];
    const memoryTransactionIds = new Set<number>();
    for (const txn of allTxns) {
      const memory = memoryMap.get(txn.description);
      if (
        memory &&
        memory.kind === kind &&
        categoryNamesById.has(memory.categoryId)
      ) {
        memoryUpdates.push({ id: txn.id, categoryId: memory.categoryId });
        memoryKeysHit.push(normalizeMerchant(txn.description));
        memoryTransactionIds.add(txn.id);
      }
    }

    const routePlan = planDescriptionHistoryRoutes(
      allTxns,
      memoryTransactionIds,
      historyByDescription
    );

    if (memoryUpdates.length > 0) {
      batchUpdateCategories(workspaceId, memoryUpdates);
      incrementMerchantHits(workspaceId, memoryKeysHit);
      categorized += memoryUpdates.length;
      send("stage", {
        workspaceId,
        workspaceName,
        stage: "memory-hit",
        count: memoryUpdates.length,
        kind,
      });
    }

    const databaseUpdates = routePlan.databaseTransactions.map((item) => ({
      id: item.transaction.id,
      categoryId: item.decision.categoryId,
    }));
    if (databaseUpdates.length > 0) {
      batchUpdateCategories(workspaceId, databaseUpdates);
      categorized += databaseUpdates.length;
      send("stage", {
        workspaceId,
        workspaceName,
        stage: "history-hit",
        count: databaseUpdates.length,
        kind,
      });
    }

    if (diagnosticSink) {
      for (const transaction of routePlan.memoryTransactions) {
        const normalizedDescription = normalizeMerchant(transaction.description);
        const history = historyByDescription.get(normalizedDescription) ?? null;
        const memory = memoryMap.get(transaction.description);
        diagnosticSink({
          type: "decision",
          transactionId: transaction.id,
          description: transaction.description,
          normalizedDescription,
          kind,
          historicalMatchCount: history?.total ?? 0,
          history: toDiagnosticHistory(history),
          route: "memory",
          reason: "memory-hit",
          selectedCategory: memory
            ? (categoryNamesById.get(memory.categoryId) ?? null)
            : null,
        });
      }
      for (const item of routePlan.databaseTransactions) {
        diagnosticSink({
          type: "decision",
          transactionId: item.transaction.id,
          description: item.transaction.description,
          normalizedDescription: item.normalizedDescription,
          kind,
          historicalMatchCount: item.history.total,
          history: toDiagnosticHistory(item.history),
          route: "database",
          reason: item.decision.reason,
          selectedCategory: item.decision.categoryName,
        });
      }
      for (const item of routePlan.aiTransactions) {
        diagnosticSink({
          type: "decision",
          transactionId: item.transaction.id,
          description: item.transaction.description,
          normalizedDescription: item.normalizedDescription,
          kind,
          historicalMatchCount: item.history?.total ?? 0,
          history: toDiagnosticHistory(item.history),
          route: "ai",
          reason: item.decision.reason,
          selectedCategory: null,
        });
      }
    }

    for (let i = 0; i < routePlan.aiTransactions.length; i += batchSize) {
      const batchPlan = routePlan.aiTransactions.slice(i, i + batchSize);
      const batch = batchPlan.map((item) => item.transaction);
      const readyProvider = await getReadyAIProvider();
      if (!readyProvider) break;

      let observedPrompt = { systemPrompt: "", userPrompt: "" };
      try {
        const mappings = await readyProvider.categorize(
          batch.map((txn) => ({
            description: txn.description,
            amount: txn.chargedAmount,
            currency: txn.originalCurrency,
            memo: txn.memo,
          })),
          categoryInput,
          {
            pastCorrections,
            matchingHistory: buildBatchMatchingHistory(batchPlan),
            onPrompt(observation) {
              observedPrompt = observation;
            },
          }
        );

        const updates: {
          id: number;
          categoryId: number;
          aiConfidence: number | null;
        }[] = [];
        const reviewFlags: { id: number; needsReview: boolean }[] = [];

        for (const mapping of mappings) {
          const category = categories.find(
            (c) => c.name === mapping.categoryName
          );
          const txn = batch[mapping.index];
          if (!category || !txn) continue;
          const confidence = mapping.confidence ?? null;
          updates.push({
            id: txn.id,
            categoryId: category.id,
            aiConfidence: confidence,
          });
          reviewFlags.push({
            id: txn.id,
            needsReview: confidence == null || confidence <= 4,
          });
        }

        batchUpdateCategories(workspaceId, updates);
        batchSetNeedsReview(workspaceId, reviewFlags);
        categorized += updates.length;
        diagnosticSink?.({
          type: "ai-batch",
          kind,
          transactionIds: batch.map((transaction) => transaction.id),
          systemPrompt: observedPrompt.systemPrompt,
          userPrompt: observedPrompt.userPrompt,
          mappings,
          updates: updates.map((update) => ({
            ...update,
            needsReview:
              reviewFlags.find((flag) => flag.id === update.id)?.needsReview ??
              false,
          })),
          error: null,
        });
      } catch (err) {
        console.error(`[sync] AI categorization batch failed (${kind}):`, err);
        if (!aiWarning) {
          aiWarning = friendlyAIError(err, settings.ollamaModel);
        }
        diagnosticSink?.({
          type: "ai-batch",
          kind,
          transactionIds: batch.map((transaction) => transaction.id),
          systemPrompt: observedPrompt.systemPrompt,
          userPrompt: observedPrompt.userPrompt,
          mappings: [],
          updates: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { categorized, aiWarning };
}
