"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plane, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";
import { assignTransactionsToTrip, getTrips, revertTripAssignments } from "@/lib/api";
import { cn } from "@/lib/utils";
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
  const { state: sidebarState } = useSidebar();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const overviewQuery = useQuery({ queryKey: TRIP_KEYS.overview, queryFn: getTrips });
  const confirmed = overviewQuery.data?.confirmed ?? [];
  const ids = transactions.map((txn) => txn.id);
  const count = ids.length;
  // Transfers never join a trip (the server ignores them), so they are left out
  // of assignment and the toast reports only the rows that changed.
  const assignable = transactions.filter((txn) => txn.kind !== "transfer");
  const assignableIds = assignable.map((txn) => txn.id);
  const skippedTransfers = count - assignableIds.length;

  const assign = useMutation({
    mutationFn: (vars: { tripId: number | null; tripName?: string }) =>
      assignTransactionsToTrip(assignableIds, vars.tripId),
    onSuccess: (_result, vars) => {
      invalidateTrips();
      const assigned = assignableIds.length;
      toast.success(
        vars.tripId === null
          ? t("bulk.notTripToast", { count: assigned })
          : t("bulk.assignedToast", { count: assigned, name: vars.tripName ?? "" }),
        skippedTransfers > 0
          ? { description: t("bulk.transfersSkipped", { count: skippedTransfers }) }
          : undefined
      );
      onDone();
    },
    onError: () => toast.error(t("errorToast")),
  });

  const runAssign = (vars: { tripId: number | null; tripName?: string }) => {
    if (assignableIds.length === 0) {
      toast.error(t("bulk.transfersOnly"));
      return;
    }
    assign.mutate(vars);
  };

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
      {/* Centered on the content area: from md up the sidebar (expanded or
          icon-only) takes the inline start, matching its own width tokens. */}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 transition-[inset-inline-start] duration-200 ease-linear md:bottom-6",
          sidebarState === "collapsed" ? "md:start-(--sidebar-width-icon)" : "md:start-(--sidebar-width)"
        )}
      >
        <div
          role="toolbar"
          aria-label={t("bulk.selected", { count })}
          className="pointer-events-auto flex w-full max-w-[46rem] flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur"
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
                            runAssign({ tripId: trip.id, tripName: trip.name });
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
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => runAssign({ tripId: null })}>
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
      </div>

      {creating ? (
        <TripFormDialog
          initial={draftTripFromTransactions(assignable.length > 0 ? assignable : transactions, {
            locale,
            fallbackName: t("form.defaultName"),
          })}
          onClose={() => setCreating(false)}
          onSaved={(trip) => {
            setCreating(false);
            runAssign({ tripId: trip.id, tripName: trip.name });
          }}
        />
      ) : null}
    </>
  );
}
