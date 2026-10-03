"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteTrip } from "@/lib/api";
import { formatTripDates } from "@/lib/trips/format";
import type { Trip } from "@/lib/trips/types";
import type { Locale } from "@/i18n/routing";
import { TripFormDialog } from "./trip-form-dialog";
import { useInvalidateTrips } from "./use-trip-actions";

interface TripHeaderProps {
  trip: Trip;
  days: number;
  onDeleted: () => void;
  actions?: ReactNode;
}

export function TripHeader({ trip, days, onDeleted, actions }: TripHeaderProps) {
  const t = useTranslations("trips");
  const locale = useLocale() as Locale;
  const invalidateTrips = useInvalidateTrips();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteTrip(trip.id),
    onSuccess: () => {
      setConfirmingDelete(false);
      invalidateTrips();
      toast.success(t("deletedToast"));
      onDeleted();
    },
    onError: () => toast.error(t("errorToast")),
  });

  return (
    <>
      <div className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 md:flex-row md:items-start md:justify-between md:p-6">
        <div className="min-w-0 space-y-1.5">
          <h2 className="truncate font-serif text-3xl tracking-tight">{trip.name}</h2>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            {trip.country ? (
              <>
                <span>{trip.country}</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>{formatTripDates(trip.startDate, trip.endDate, locale)}</span>
            <span aria-hidden="true">·</span>
            <span>{t("days", { count: days })}</span>
            <span
              dir="ltr"
              className="ms-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium tracking-wide text-foreground/80"
            >
              {trip.currency}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
            <Pencil className="size-3.5" aria-hidden="true" />
            {t("edit")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            className="gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("delete")}
          </Button>
        </div>
      </div>

      {editing ? (
        <TripFormDialog
          trip={trip}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}

      {confirmingDelete ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmingDelete(false);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl tracking-tight">
                {t("deleteDialog.title")}
              </DialogTitle>
              <DialogDescription>{t("deleteDialog.body")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
                {t("form.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? t("deleteDialog.deleting") : t("deleteDialog.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
