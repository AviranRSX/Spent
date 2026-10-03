"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plane, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { assignTransactionsToTrip, getTrips, revertTripAssignments } from "@/lib/api";
import { draftTripFromTransactions } from "@/lib/trips/draft";
import { formatTripDates } from "@/lib/trips/format";
import type { TransactionWithCategory } from "@/lib/types";
import type { Locale } from "@/i18n/routing";
import { TripFormDialog } from "./trip-form-dialog";
import { TRIP_KEYS, useInvalidateTrips } from "./use-trip-actions";

interface TripBulkBarProps {
  transactions: TransactionWithCategory[];
  onDone: () => void;
}

export function TripBulkBar({ transactions, onDone }: TripBulkBarProps) {
  const t = useTranslations("trips");
  const locale = useLocale() as Locale;
  const invalidateTrips = useInvalidateTrips();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const overviewQuery = useQuery({ queryKey: TRIP_KEYS.overview, queryFn: getTrips });
  const confirmed = overviewQuery.data?.confirmed ?? [];
  const ids = transactions.map((txn) => txn.id);
  const count = ids.length;

  const assign = useMutation({
    mutationFn: (vars: { tripId: number | null; tripName?: string }) =>
      assignTransactionsToTrip(ids, vars.tripId),
    onSuccess: (_result, vars) => {
      invalidateTrips();
      toast.success(
        vars.tripId === null
          ? t("bulk.notTripToast", { count })
          : t("bulk.assignedToast", { count, name: vars.tripName ?? "" })
      );
      onDone();
    },
    onError: () => toast.error(t("errorToast")),
  });

  const revert = useMutation({
    mutationFn: () => revertTripAssignments(ids),
    onSuccess: () => {
      invalidateTrips();
      toast.success(t("bulk.removedToast"));
      onDone();
    },
    onError: () => toast.error(t("errorToast")),
  });

  const busy = assign.isPending || revert.isPending;

  return (
    <>
      <div
        role="toolbar"
        aria-label={t("bulk.selected", { count })}
        className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-[min(calc(100%-2rem),46rem)] flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur md:bottom-6"
      >
        <span className="ps-1 text-sm font-medium tabular-nums">{t("bulk.selected", { count })}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Plane className="size-3.5" aria-hidden="true" />
              {t("bulk.assign")}
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-64 p-1">
              <ul className="max-h-64 overflow-y-auto">
                {confirmed.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-muted-foreground">{t("bulk.noTrips")}</li>
                ) : (
                  confirmed.map((trip) => (
                    <li key={trip.id}>
                      <button
                        type="button"
                        className="flex w-full min-w-0 flex-col items-start rounded-md px-3 py-2 text-start text-sm transition-colors hover:bg-accent"
                        onClick={() => {
                          setPickerOpen(false);
                          assign.mutate({ tripId: trip.id, tripName: trip.name });
                        }}
                      >
                        <span dir="auto" className="w-full truncate text-start font-medium">
                          {trip.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatTripDates(trip.startDate, trip.endDate, locale)}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <div className="mt-1 border-t border-border pt-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-start text-sm font-medium transition-colors hover:bg-accent"
                  onClick={() => {
                    setPickerOpen(false);
                    setCreating(true);
                  }}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  {t("newTripEllipsis")}
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => revert.mutate()}
            title={t("bulk.removeHint")}
          >
            {t("bulk.remove")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => assign.mutate({ tripId: null })}>
            {t("bulk.notATrip")}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onDone}
            aria-label={t("bulk.clear")}
            title={t("bulk.clear")}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {creating ? (
        <TripFormDialog
          initial={draftTripFromTransactions(transactions, {
            locale,
            fallbackName: t("form.defaultName"),
          })}
          onClose={() => setCreating(false)}
          onSaved={(trip) => {
            setCreating(false);
            assign.mutate({ tripId: trip.id, tripName: trip.name });
          }}
        />
      ) : null}
    </>
  );
}
