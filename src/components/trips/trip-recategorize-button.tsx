"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategorizeReviewDialog } from "@/components/dashboard/categorize-review-dialog";
import { previewTripTravelRecategorize, type CategorizePreview } from "@/lib/api";
import { useInvalidateTrips } from "./use-trip-actions";

/** fetchJSON throws the raw response body; show the route's error text instead. */
function errorText(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  try {
    const body = JSON.parse(err.message) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not JSON: use the message as is.
  }
  return err.message || null;
}

interface RecategorizeTravelButtonProps {
  tripId: number;
  count: number;
}

export function RecategorizeTravelButton({ tripId, count }: RecategorizeTravelButtonProps) {
  const t = useTranslations("trips");
  const tDash = useTranslations("dashboard");
  const queryClient = useQueryClient();
  const invalidateTrips = useInvalidateTrips();
  const [preview, setPreview] = useState<CategorizePreview | null>(null);

  const mutation = useMutation({
    mutationFn: () => previewTripTravelRecategorize(tripId),
    onSuccess: (data) => {
      if (data.assignments.length === 0) {
        const aiError = data.errors?.[0];
        if (aiError) {
          toast.error(aiError, { duration: Infinity, closeButton: true });
          return;
        }
        toast.info(t("detail.recategorizeNone"));
        return;
      }
      setPreview(data);
    },
    onError: (err) => {
      toast.error(errorText(err) ?? t("errorToast"), {
        duration: Infinity,
        closeButton: true,
      });
    },
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={count === 0 || mutation.isPending}
        onClick={() => mutation.mutate()}
        title={count === 0 ? t("detail.recategorizeNone") : t("detail.recategorizeHint")}
      >
        <Sparkles className="size-3.5" aria-hidden="true" />
        {mutation.isPending ? tDash("thinking") : t("detail.recategorize")}
        {count > 0 && !mutation.isPending ? (
          <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{count}</span>
        ) : null}
      </Button>

      {preview ? (
        <CategorizeReviewDialog
          preview={preview}
          description={t("detail.recategorizeDescription", { count: preview.uncategorizedCount })}
          onClose={() => setPreview(null)}
          onApplied={() => {
            setPreview(null);
            invalidateTrips();
            queryClient.invalidateQueries({ queryKey: ["transactions"] });
            queryClient.invalidateQueries({ queryKey: ["summary"] });
            queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
            queryClient.invalidateQueries({ queryKey: ["categories"] });
          }}
        />
      ) : null}
    </>
  );
}
