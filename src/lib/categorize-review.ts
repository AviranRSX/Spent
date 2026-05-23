import type { CategorizePreview, CategoryKindFilter } from "./api";

export interface CategorizeApplyPayload {
  assignments: Array<{
    transactionId: number;
    categoryName: string;
    isNew: boolean;
    kind?: CategoryKindFilter;
    aiConfidence?: number | null;
  }>;
  approvedNewCategoryNames: string[];
  rejectionFallbacks: Record<string, string>;
}

export function buildCategorizeApplyPayload({
  preview,
  approvedMap,
  fallbackMap,
}: {
  preview: CategorizePreview;
  approvedMap: Record<string, boolean>;
  fallbackMap: Record<string, string>;
}): CategorizeApplyPayload {
  return {
    assignments: preview.assignments.map((assignment) => ({
      transactionId: assignment.transactionId,
      categoryName: assignment.categoryName,
      isNew: assignment.isNew,
      kind: assignment.kind,
      aiConfidence: assignment.aiConfidence,
    })),
    approvedNewCategoryNames: Object.entries(approvedMap)
      .filter(([, approved]) => approved)
      .map(([name]) => name),
    rejectionFallbacks: Object.fromEntries(
      Object.entries(fallbackMap).filter(([, name]) => name.trim().length > 0)
    ),
  };
}
