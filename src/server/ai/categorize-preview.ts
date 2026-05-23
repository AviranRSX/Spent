import "server-only";

import {
  getUncategorizedIdsByKind,
  getTransactionsForCategorization,
} from "@/server/db/queries/transactions";
import { getAllCategories } from "@/server/db/queries/categories";
import { getRecentCorrections } from "@/server/db/queries/category-corrections";
import { createAIProvider } from "@/server/ai/factory";
import { ensureOllamaRunning } from "@/server/ai/ollama-manager";
import { getAppSettings } from "@/server/db/queries/settings";
import type { CategoryMapping } from "@/server/ai/types";
import type { CategoryKind } from "@/lib/types";

export interface CategorizePreviewAssignment {
  transactionId: number;
  description: string;
  categoryName: string;
  isNew: boolean;
  kind: CategoryKind;
  aiConfidence: number | null;
}

export interface CategorizePreviewProposal {
  name: string;
  kind: CategoryKind;
  transactionIds: number[];
  samples: string[];
}

export interface CategorizePreviewResult {
  uncategorizedCount: number;
  assignments: CategorizePreviewAssignment[];
  proposedCategories: CategorizePreviewProposal[];
  existingCategoryUsage: Record<string, number>;
  errors: string[];
}

export interface CategorizePreviewProgress {
  processed: number;
  total: number;
  currentStart?: number;
  currentEnd?: number;
}

export async function buildCategorizePreview(
  workspaceId: number,
  onProgress: (progress: CategorizePreviewProgress) => void = () => {}
): Promise<CategorizePreviewResult> {
  const settings = getAppSettings(workspaceId);

  const aiProvider = createAIProvider();
  if (!aiProvider) {
    throw new CategorizePreviewError(
      "AI provider isn't configured. Set it up in Settings -> AI & automation.",
      400
    );
  }

  if (settings.aiProvider === "ollama") {
    const status = await ensureOllamaRunning(settings.ollamaUrl);
    if (!status.ok) {
      throw new CategorizePreviewError(
        status.error ?? "Ollama isn't reachable.",
        503
      );
    }
  }

  const kinds: CategoryKind[] = ["expense", "income"];
  const batchSize = 10;
  const idsByKind = kinds.map((kind) => ({
    kind,
    ids: getUncategorizedIdsByKind(workspaceId, kind),
  }));
  const totalUncategorized = idsByKind.reduce(
    (sum, item) => sum + item.ids.length,
    0
  );
  let processed = 0;
  onProgress({ processed, total: totalUncategorized });

  const allMappings: CategorizePreviewAssignment[] = [];
  const errors: string[] = [];

  for (const { kind, ids } of idsByKind) {
    if (ids.length === 0) continue;

    const categories = getAllCategories(workspaceId, kind);
    if (categories.length === 0) {
      processed += ids.length;
      onProgress({ processed, total: totalUncategorized });
      continue;
    }

    const parentNameById = new Map<number, string>();
    for (const category of categories) {
      if (category.parentId === null) {
        parentNameById.set(category.id, category.name);
      }
    }
    const parentIdSet = new Set(parentNameById.keys());
    const categoryInput = categories
      .filter((category) => !parentIdSet.has(category.id))
      .map((category) => ({
        name: category.name,
        description: category.description,
        parentName:
          category.parentId != null
            ? parentNameById.get(category.parentId) ?? null
            : null,
      }));
    const pastCorrections = getRecentCorrections(workspaceId, kind);

    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize);
      const txns = getTransactionsForCategorization(workspaceId, batchIds);
      onProgress({
        processed,
        total: totalUncategorized,
        currentStart: processed + 1,
        currentEnd: Math.min(processed + batchIds.length, totalUncategorized),
      });

      try {
        const mappings: CategoryMapping[] = await aiProvider.categorize(
          txns.map((transaction) => ({
            description: transaction.description,
            amount: transaction.chargedAmount,
            currency: transaction.originalCurrency,
            memo: transaction.memo,
          })),
          categoryInput,
          { allowProposals: true, pastCorrections }
        );

        for (const mapping of mappings) {
          const txn = txns[mapping.index];
          if (!txn) continue;
          allMappings.push({
            transactionId: txn.id,
            description: txn.description,
            categoryName: mapping.categoryName,
            isNew: !!mapping.isNew,
            kind,
            aiConfidence: mapping.confidence ?? null,
          });
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Unknown AI error");
      } finally {
        processed += batchIds.length;
        onProgress({ processed, total: totalUncategorized });
      }
    }
  }

  const proposalMap = new Map<string, CategorizePreviewProposal>();
  const existingUsage = new Map<string, number>();

  for (const mapping of allMappings) {
    if (mapping.isNew) {
      const key = `${mapping.kind}::${mapping.categoryName}`;
      const entry = proposalMap.get(key) ?? {
        name: mapping.categoryName,
        kind: mapping.kind,
        transactionIds: [],
        samples: [],
      };
      entry.transactionIds.push(mapping.transactionId);
      if (
        entry.samples.length < 4 &&
        !entry.samples.includes(mapping.description)
      ) {
        entry.samples.push(mapping.description);
      }
      proposalMap.set(key, entry);
    } else {
      existingUsage.set(
        mapping.categoryName,
        (existingUsage.get(mapping.categoryName) ?? 0) + 1
      );
    }
  }

  return {
    uncategorizedCount: totalUncategorized,
    assignments: allMappings,
    proposedCategories: Array.from(proposalMap.values()).sort(
      (a, b) => b.transactionIds.length - a.transactionIds.length
    ),
    existingCategoryUsage: Object.fromEntries(existingUsage),
    errors,
  };
}

export class CategorizePreviewError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}
