"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approveTransactionCategory,
  getCategories,
  getTransactions,
  previewCategorizeStream,
  updateTransactionCategory,
  type CategorizePreviewProgress,
  type CategorizePreview,
  type TransactionKindFilter,
} from "@/lib/api";
import { CategorizeReviewDialog } from "@/components/dashboard/categorize-review-dialog";
import { getClassificationProgressState } from "@/lib/setup/classification-progress";
import type { TransactionWithCategory } from "@/lib/types";

interface SetupReviewStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function SetupReviewStep({ onComplete, onBack }: SetupReviewStepProps) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<CategorizePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewProgress, setPreviewProgress] =
    useState<CategorizePreviewProgress | null>(null);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [reviewRows, setReviewRows] = useState<TransactionWithCategory[]>([]);
  const [loadingReviewRows, setLoadingReviewRows] = useState(false);
  const [approving, setApproving] = useState(false);
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });

  useEffect(() => {
    let cancelled = false;
    previewCategorizeStream((progress) => {
      if (!cancelled) setPreviewProgress(progress);
    })
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : "AI category preview failed"
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadReviewRows() {
    setLoadingReviewRows(true);
    try {
      const result = await getTransactions({
        needsReview: true,
        kind: "all" as TransactionKindFilter,
        limit: 25,
      });
      setReviewRows(result.transactions);
    } finally {
      setLoadingReviewRows(false);
    }
  }

  async function approveAll() {
    setApproving(true);
    try {
      await Promise.all(reviewRows.map((txn) => approveTransactionCategory(txn.id)));
      await queryClient.invalidateQueries();
      setReviewRows([]);
      toast.success("Approved reviewed categories");
    } finally {
      setApproving(false);
    }
  }

  async function changeReviewCategory(transactionId: number, categoryId: number) {
    await updateTransactionCategory(transactionId, categoryId);
    await queryClient.invalidateQueries();
    setReviewRows((rows) => rows.filter((row) => row.id !== transactionId));
    toast.success("Category updated");
  }

  const hasCategoryWork = (preview?.uncategorizedCount ?? 0) > 0;
  const proposedCount = preview?.proposedCategories.length ?? 0;
  const classificationProgress = getClassificationProgressState(
    loadingPreview,
    previewProgress
  );
  const existingCount = useMemo(
    () =>
      preview
        ? Object.values(preview.existingCategoryUsage).reduce(
            (sum, count) => sum + count,
            0
          )
        : 0,
    [preview]
  );
  const leafCategories = useMemo(() => {
    const parentIds = new Set(
      categories
        .map((category) => category.parentId)
        .filter((id): id is number => id != null)
    );
    return categories
      .filter((category) => !parentIds.has(category.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  return (
    <div className="mx-auto w-full max-w-[620px] space-y-6">
      <header className="space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Step 4 of 7 · Review
        </div>
        <h1 className="font-serif text-4xl leading-[1.08] tracking-tight">
          Review AI categories
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Spent can inspect new category proposals and then show any low
          confidence rows. You can skip either check.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        {loadingPreview ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {classificationProgress.label}...
            </div>
            {classificationProgress.visible && (
              <ClassificationProgressBar
                label={classificationProgress.label}
                percent={classificationProgress.percent}
                valueLabel={classificationProgress.valueLabel}
              />
            )}
          </div>
        ) : hasCategoryWork ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <SearchCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-serif text-2xl leading-tight">
                  Category inspection is ready
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {existingCount} rows fit existing categories. {proposedCount}{" "}
                  new categor{proposedCount === 1 ? "y" : "ies"} need approval.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setShowCategoryDialog(true)}>
                Inspect categories
              </Button>
              <Button variant="outline" onClick={loadReviewRows}>
                Skip category review
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            No uncategorized transactions need AI category proposals.
          </div>
        )}
      </div>

      {!loadingPreview && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-2xl leading-tight">
                Low confidence review
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Inspect rows the AI marked as uncertain, or skip this check.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={loadReviewRows}
              disabled={loadingReviewRows}
            >
              {loadingReviewRows && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Load rows
            </Button>
          </div>

          {reviewRows.length > 0 && (
            <div className="mt-4 space-y-2">
              {reviewRows.slice(0, 8).map((txn) => (
                <div
                  key={txn.id}
                  className="grid gap-3 rounded-xl border border-border bg-background p-3 sm:grid-cols-[1fr_190px_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {txn.description}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {txn.categoryName ?? "Uncategorized"} · ₪{" "}
                      {Math.abs(txn.chargedAmount).toLocaleString()}
                    </div>
                  </div>
                  <select
                    value={txn.categoryId ?? ""}
                    onChange={(event) =>
                      void changeReviewCategory(
                        txn.id,
                        Number(event.target.value)
                      )
                    }
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="" disabled>
                      Choose category
                    </option>
                    {leafCategories
                      .filter((category) => category.kind === txn.kind)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      approveTransactionCategory(txn.id).then(() =>
                        setReviewRows((rows) =>
                          rows.filter((row) => row.id !== txn.id)
                        )
                      )
                    }
                  >
                    Approve
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  Showing {Math.min(reviewRows.length, 8)} of {reviewRows.length}
                </span>
                <Button onClick={approveAll} disabled={approving}>
                  {approving ? "Approving..." : "Approve all shown"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={onComplete} disabled={loadingPreview}>
          Continue to statistics →
        </Button>
      </footer>

      {showCategoryDialog && preview && (
        <CategorizeReviewDialog
          preview={preview}
          onClose={() => setShowCategoryDialog(false)}
          onApplied={async () => {
            setShowCategoryDialog(false);
            await queryClient.invalidateQueries();
            await loadReviewRows();
          }}
        />
      )}
    </div>
  );
}

function ClassificationProgressBar({
  label,
  percent,
  valueLabel,
}: {
  label: string;
  percent: number | null;
  valueLabel: string;
}) {
  if (percent != null) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums">{valueLabel}</span>
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      role="progressbar"
      aria-label={label}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full w-1/3 animate-[setup-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      <style jsx>{`
        @keyframes setup-progress {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(320%);
          }
        }
      `}</style>
    </div>
  );
}
