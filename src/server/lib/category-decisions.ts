import "server-only";

import {
  updateTransactionCategory,
  setTransactionNeedsReview,
  getTransactionContext,
  setCategoryDecidedAt,
} from "@/server/db/queries/transactions";
import { recordMerchantCategory } from "@/server/lib/merchant-memory";
import { recordCorrection } from "@/server/db/queries/category-corrections";
import { getAllCategories } from "@/server/db/queries/categories";

/**
 * The user's recategorize decision. Shared by the desktop route and by the
 * phone change-file applier (which passes the phone's edit time as `decidedAt`).
 */
export function applyUserCategory(
  workspaceId: number,
  transactionId: number,
  categoryId: number,
  decidedAt?: string
): { ok: true } | { ok: false; reason: "not_found" | "category_not_found" } {
  const before = getTransactionContext(workspaceId, transactionId);
  if (!before) return { ok: false, reason: "not_found" };

  const category = getAllCategories(workspaceId).find((c) => c.id === categoryId);
  if (!category) return { ok: false, reason: "category_not_found" };

  updateTransactionCategory(workspaceId, transactionId, categoryId, "user");
  setTransactionNeedsReview(workspaceId, transactionId, false);
  setCategoryDecidedAt(
    workspaceId,
    transactionId,
    decidedAt ?? new Date().toISOString()
  );

  if (
    (before.kind === "expense" || before.kind === "income") &&
    (category.kind === "expense" || category.kind === "income")
  ) {
    recordMerchantCategory(
      workspaceId,
      before.description,
      categoryId,
      category.kind,
      "user"
    );

    // If the user just overrode an AI-set category, log it as a correction
    // so the categorizer learns not to repeat the mistake on similar merchants.
    if (
      before.categorySource === "ai" &&
      before.categoryId != null &&
      before.categoryId !== categoryId
    ) {
      recordCorrection(
        workspaceId,
        before.description,
        before.categoryId,
        categoryId,
        category.kind
      );
    }
  }

  return { ok: true };
}

/** The user confirms the current (AI-set) category as correct. */
export function approveCategory(
  workspaceId: number,
  transactionId: number,
  decidedAt?: string
): { ok: true } | { ok: false; reason: "not_found" } {
  const ctx = getTransactionContext(workspaceId, transactionId);
  if (!ctx) return { ok: false, reason: "not_found" };

  setTransactionNeedsReview(workspaceId, transactionId, false);
  setCategoryDecidedAt(
    workspaceId,
    transactionId,
    decidedAt ?? new Date().toISOString()
  );
  if (
    ctx.categoryId != null &&
    (ctx.kind === "expense" || ctx.kind === "income")
  ) {
    const category = getAllCategories(workspaceId).find(
      (c) => c.id === ctx.categoryId
    );
    if (
      category &&
      (category.kind === "expense" || category.kind === "income")
    ) {
      recordMerchantCategory(
        workspaceId,
        ctx.description,
        ctx.categoryId,
        category.kind,
        "approved-ai"
      );
    }
  }
  return { ok: true };
}
