"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plane, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { assignTransactionsToTrip, getNeedsTrip } from "@/lib/api";
import { LOCAL_CURRENCY } from "@/lib/currency";
import { translateCategoryName } from "@/lib/i18n-data";
import { toDay } from "@/lib/trips/dates";
import { draftTripFromTransactions } from "@/lib/trips/draft";
import {
  formatOriginalAmount,
  formatTripAmount,
  formatTripDates,
  formatTripDay,
} from "@/lib/trips/format";
import type { NeedsTripItem } from "@/lib/trips/types";
import type { Locale } from "@/i18n/routing";
import { TripFormDialog } from "./trip-form-dialog";
import { TRIP_KEYS, useInvalidateTrips } from "./use-trip-actions";

const MAX_CHIPS = 3;
/** The queue can hold years of past travel charges, so it renders in pages. */
const PAGE_SIZE = 30;

interface MonthGroup {
  key: string;
  label: string;
  total: number;
  items: NeedsTripItem[];
}

function formatMonth(monthKey: string, locale: Locale): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : "en-IL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** Groups the visible rows (newest first) by month; `total` counts the whole queue for that month. */
function groupByMonth(all: NeedsTripItem[], visible: number, locale: Locale): MonthGroup[] {
  const totals = new Map<string, number>();
  for (const item of all) {
    const key = toDay(item.transaction.date).slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const groups: MonthGroup[] = [];
  for (const item of all.slice(0, visible)) {
    const key = toDay(item.transaction.date).slice(0, 7);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: formatMonth(key, locale), total: totals.get(key) ?? 0, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function NeedsTripTab() {
  const t = useTranslations("trips");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const invalidateTrips = useInvalidateTrips();
  const [creatingFor, setCreatingFor] = useState<NeedsTripItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const queueQuery = useQuery({ queryKey: TRIP_KEYS.needs, queryFn: getNeedsTrip });

  const assignMutation = useMutation({
    mutationFn: (vars: { transactionId: number; tripId: number | null; tripName?: string }) =>
      assignTransactionsToTrip([vars.transactionId], vars.tripId),
    onSuccess: (_result, vars) => {
      invalidateTrips();
      toast.success(
        vars.tripId === null
          ? t("needs.notTripToast")
          : t("needs.assignedToast", { name: vars.tripName ?? "" })
      );
    },
    onError: () => toast.error(t("errorToast")),
  });

  if (queueQuery.isPending) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );
  }

  const items = queueQuery.data?.items ?? [];
  const groups = groupByMonth(items, visibleCount, locale);
  const remaining = Math.max(0, items.length - visibleCount);

  return (
    <section className="rounded-3xl border border-border bg-card p-5 md:p-6">
      <div className="mb-4 space-y-1">
        <h2 className="font-serif text-2xl tracking-tight">{t("needs.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("needs.description")}</p>
      </div>

      {queueQuery.isError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
          {t("needs.loadError")}
          <Button size="sm" variant="outline" onClick={() => void queueQuery.refetch()}>
            {t("needs.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-[var(--status-on-track)]" />
          {t("needs.empty")}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.key}>
              <h3 className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-2 text-xs font-medium text-muted-foreground">
                <span className="uppercase tracking-wide">{group.label}</span>
                <span className="tabular-nums">{t("transactionsCount", { count: group.total })}</span>
              </h3>
              <ul className="divide-y divide-border/60">
                {group.items.map((item) => {
                  const txn = item.transaction;
                  const busy =
                    assignMutation.isPending && assignMutation.variables?.transactionId === txn.id;
                  return (
                    <li
                      key={txn.id}
                      className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
                          {formatTripDay(txn.date, locale)}
                        </span>
                        <div className="min-w-0 space-y-1">
                          <div dir="auto" className="w-fit max-w-full truncate text-sm font-medium">
                            {txn.description}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {txn.categoryName ? (
                              <Badge
                                variant="outline"
                                style={
                                  txn.categoryColor
                                    ? {
                                        borderColor: txn.categoryColor + "40",
                                        backgroundColor: txn.categoryColor + "15",
                                        color: txn.categoryColor,
                                      }
                                    : undefined
                                }
                              >
                                {translateCategoryName(txn.categoryName, tCat)}
                              </Badge>
                            ) : null}
                            <span>
                              {item.cause === "ambiguous"
                                ? t("needs.causeAmbiguous")
                                : t("needs.causeTravel")}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums" dir="ltr">
                              {formatTripAmount(-txn.chargedAmount, locale)}
                            </span>
                            {txn.originalCurrency !== LOCAL_CURRENCY ? (
                              <span className="tabular-nums" dir="ltr">
                                ({formatOriginalAmount(txn.originalAmount, txn.originalCurrency)})
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 ps-[4.25rem] lg:shrink-0 lg:justify-end lg:ps-0">
                        {item.suggestions.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{t("needs.noSuggestions")}</span>
                        ) : (
                          item.suggestions.slice(0, MAX_CHIPS).map((trip) => (
                            <button
                              key={trip.id}
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                assignMutation.mutate({
                                  transactionId: txn.id,
                                  tripId: trip.id,
                                  tripName: trip.name,
                                })
                              }
                              title={formatTripDates(trip.startDate, trip.endDate, locale)}
                              className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                            >
                              <Plane className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                              <span className="truncate">{trip.name}</span>
                            </button>
                          ))
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setCreatingFor(item)}
                          className="gap-1.5 rounded-full"
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                          {t("newTripEllipsis")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => assignMutation.mutate({ transactionId: txn.id, tripId: null })}
                          className="rounded-full text-muted-foreground"
                        >
                          {t("needs.notATrip")}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {remaining > 0 ? (
            <div className="flex flex-col items-center gap-1.5 border-t border-border/60 pt-4">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                {t("needs.showMore", { count: Math.min(PAGE_SIZE, remaining) })}
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("needs.shownOf", { shown: items.length - remaining, total: items.length })}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {creatingFor ? (
        <TripFormDialog
          initial={draftTripFromTransactions([creatingFor.transaction], {
            locale,
            fallbackName: t("form.defaultName"),
          })}
          onClose={() => setCreatingFor(null)}
          onSaved={(trip) => {
            const transactionId = creatingFor.transaction.id;
            setCreatingFor(null);
            assignMutation.mutate({ transactionId, tripId: trip.id, tripName: trip.name });
          }}
        />
      ) : null}
    </section>
  );
}
