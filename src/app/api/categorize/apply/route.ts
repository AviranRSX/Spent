import { NextResponse } from "next/server";
import {
  batchUpdateCategories,
  batchSetNeedsReview,
} from "@/server/db/queries/transactions";
import {
  ensureCategory,
  getCategoryByName,
  getParentIds,
} from "@/server/db/queries/categories";
import type { CategoryKind } from "@/lib/types";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

interface ApplyBody {
  /**
   * Original assignments returned by /preview. These reference transactions by id and
   * categories by name. Mark each as isNew to indicate the AI proposed it.
   */
  assignments: Array<{
    transactionId: number;
    categoryName: string;
    isNew: boolean;
    kind?: CategoryKind;
    aiConfidence?: number | null;
  }>;
  /**
   * The set of new-category names the user approved during review. Anything in
   * assignments with isNew but not in this set is dropped (the transaction
   * stays uncategorized).
   */
  approvedNewCategoryNames: string[];
  /**
   * Optional per-name mapping when the user chose to redirect a proposed new
   * category onto an existing one (e.g., "Pet supplies" → "Subscriptions").
   */
  rejectionFallbacks?: Record<string, string>;
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const body = (await request.json()) as ApplyBody;
  const approved = new Set(
    (body.approvedNewCategoryNames ?? []).map((n) => n.toLowerCase())
  );
  const fallbacks = body.rejectionFallbacks ?? {};

  // Resolve every assignment to a concrete category id.
  // - existing categories: look up by name
  // - approved new categories: ensureCategory creates them
  // - rejected new categories with a fallback: use the fallback's id
  // - rejected new categories without a fallback: skip (transaction stays uncategorized)
  // Parents must never receive transactions. If the AI somehow returns a
  // parent name (despite the prompt guidance), skip rather than assign.
  const parentIds = getParentIds(workspaceId);

  const newCategoryCache = new Map<string, number>();
  const updates: {
    id: number;
    categoryId: number;
    aiConfidence?: number | null;
  }[] = [];
  const reviewFlags: { id: number; needsReview: boolean }[] = [];
  let createdCount = 0;
  let skippedCount = 0;

  function pushUpdate(
    transactionId: number,
    categoryId: number,
    confidence?: number | null
  ) {
    updates.push({
      id: transactionId,
      categoryId,
      aiConfidence: confidence ?? null,
    });
    reviewFlags.push({
      id: transactionId,
      needsReview: confidence == null || confidence <= 4,
    });
  }

  for (const a of body.assignments) {
    const assignmentKind = a.kind ?? "expense";
    const categoryKey = `${assignmentKind}::${a.categoryName.toLowerCase()}`;
    if (a.isNew) {
      const isApproved = approved.has(a.categoryName.toLowerCase());
      if (isApproved) {
        const cached = newCategoryCache.get(categoryKey);
        if (cached != null) {
          pushUpdate(a.transactionId, cached, a.aiConfidence);
        } else {
          // Check if it already exists before creating
          const wasExisting = getCategoryByName(
            workspaceId,
            a.categoryName,
            assignmentKind
          );
          const cat = ensureCategory(
            workspaceId,
            a.categoryName,
            undefined,
            assignmentKind
          );
          if (!wasExisting) createdCount++;
          newCategoryCache.set(categoryKey, cat.id);
          pushUpdate(a.transactionId, cat.id, a.aiConfidence);
        }
      } else {
        // Rejected. Try a fallback if user set one.
        const fallbackName = fallbacks[a.categoryName];
        if (fallbackName) {
          const fallbackCat = getCategoryByName(
            workspaceId,
            fallbackName,
            assignmentKind
          );
          if (fallbackCat && !parentIds.has(fallbackCat.id)) {
            pushUpdate(a.transactionId, fallbackCat.id, a.aiConfidence);
          } else {
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      }
    } else {
      // Existing category
      const cat = getCategoryByName(
        workspaceId,
        a.categoryName,
        assignmentKind
      );
      if (cat && !parentIds.has(cat.id)) {
        pushUpdate(a.transactionId, cat.id, a.aiConfidence);
      } else {
        skippedCount++;
      }
    }
  }

  batchUpdateCategories(workspaceId, updates);
  batchSetNeedsReview(workspaceId, reviewFlags);

  return NextResponse.json({
    appliedCount: updates.length,
    createdCategoriesCount: createdCount,
    skippedCount,
  });
}
