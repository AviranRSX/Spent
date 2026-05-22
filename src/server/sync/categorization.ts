import "server-only";

import { createAIProvider } from "@/server/ai/factory";
import { ensureOllamaRunning } from "@/server/ai/ollama-manager";
import { getAllCategories } from "@/server/db/queries/categories";
import { getRecentCorrections } from "@/server/db/queries/category-corrections";
import { getAppSettings } from "@/server/db/queries/settings";
import {
  batchSetNeedsReview,
  batchUpdateCategories,
  getTransactionsForCategorization,
  getUncategorizedIdsByKind,
} from "@/server/db/queries/transactions";
import {
  incrementMerchantHits,
  lookupMerchantCategoriesBulk,
  normalizeMerchant,
} from "@/server/lib/merchant-memory";

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

export async function categorizeWorkspaceTransactions(
  workspaceId: number,
  workspaceName: string,
  send: CategorizationEventSender = NOOP_SEND
): Promise<{ categorized: number; aiWarning: string | null }> {
  const settings = getAppSettings(workspaceId);
  let categorized = 0;
  let aiWarning: string | null = null;

  const aiProvider = createAIProvider();
  if (!aiProvider) {
    return {
      categorized: 0,
      aiWarning:
        "AI provider not connected — new transactions weren't auto-categorized.",
    };
  }

  if (settings.aiProvider === "ollama") {
    send("stage", {
      workspaceId,
      workspaceName,
      stage: "ollama-start",
    });
    const ollamaResult = await ensureOllamaRunning(settings.ollamaUrl);
    if (!ollamaResult.ok) {
      aiWarning = ollamaResult.error ?? "Ollama is not reachable";
      console.error("[sync]", aiWarning);
    }
  }

  if (aiWarning) return { categorized, aiWarning };

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

    const memoryMap = lookupMerchantCategoriesBulk(
      workspaceId,
      allTxns.map((t) => t.description)
    );

    const memoryUpdates: { id: number; categoryId: number }[] = [];
    const memoryKeysHit: string[] = [];
    const remainingTxns: typeof allTxns = [];
    for (const txn of allTxns) {
      const memory = memoryMap.get(txn.description);
      if (memory && memory.kind === kind) {
        memoryUpdates.push({ id: txn.id, categoryId: memory.categoryId });
        memoryKeysHit.push(normalizeMerchant(txn.description));
      } else {
        remainingTxns.push(txn);
      }
    }
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

    for (let i = 0; i < remainingTxns.length; i += batchSize) {
      const batch = remainingTxns.slice(i, i + batchSize);
      try {
        const mappings = await aiProvider.categorize(
          batch.map((txn) => ({
            description: txn.description,
            amount: txn.chargedAmount,
            currency: txn.originalCurrency,
            memo: txn.memo,
          })),
          categoryInput,
          { pastCorrections }
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
      } catch (err) {
        console.error(`[sync] AI categorization batch failed (${kind}):`, err);
        if (!aiWarning) {
          aiWarning = friendlyAIError(err, settings.ollamaModel);
        }
      }
    }
  }

  return { categorized, aiWarning };
}
