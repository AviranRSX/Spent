"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plane, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { assignTransactionsToTrip } from "@/lib/api";
import { translateCategoryName } from "@/lib/i18n-data";
import { draftTripFromTransactions } from "@/lib/trips/draft";
import { formatTripDates, isolateText } from "@/lib/trips/format";
import type { TripRef } from "@/lib/trips/types";
import type { TransactionWithCategory } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { TripFormDialog } from "./trip-form-dialog";
import { useInvalidateTrips } from "./use-trip-actions";

interface TripCategoryPromptProps {
  transaction: TransactionWithCategory;
  categoryName: string;
  suggestions: TripRef[];
  onClose: () => void;
}

export function TripCategoryPrompt({
  transaction,
  categoryName,
  suggestions,
  onClose,
}: TripCategoryPromptProps) {
  const t = useTranslations("trips");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const invalidateTrips = useInvalidateTrips();
  const [creating, setCreating] = useState(false);

  const assign = useMutation({
    mutationFn: (vars: { tripId: number; tripName: string }) =>
      assignTransactionsToTrip([transaction.id], vars.tripId),
    onSuccess: (_result, vars) => {
      invalidateTrips();
      toast.success(t("needs.assignedToast", { name: vars.tripName }));
      onClose();
    },
    onError: () => toast.error(t("errorToast")),
  });

  if (creating) {
    return (
      <TripFormDialog
        initial={draftTripFromTransactions([transaction], {
          locale,
          fallbackName: t("form.defaultName"),
        })}
        onClose={() => setCreating(false)}
        onSaved={(trip) => assign.mutate({ tripId: trip.id, tripName: trip.name })}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl tracking-tight">{t("prompt.title")}</DialogTitle>
          <DialogDescription>
            {t("prompt.body", {
              description: isolateText(transaction.description),
              category: translateCategoryName(categoryName, tCat),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {suggestions.map((trip) => (
            <button
              key={trip.id}
              type="button"
              disabled={assign.isPending}
              onClick={() => assign.mutate({ tripId: trip.id, tripName: trip.name })}
              className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-start transition-colors hover:bg-accent disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{trip.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatTripDates(trip.startDate, trip.endDate, locale)}
                </span>
              </span>
              <Plane className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
          <Button variant="outline" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="size-3.5" aria-hidden="true" />
            {t("newTripEllipsis")}
          </Button>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">{t("prompt.skipHint")}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("prompt.skip")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
