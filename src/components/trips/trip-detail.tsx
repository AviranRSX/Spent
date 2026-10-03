"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { assignTransactionsToTrip, getTripDetail } from "@/lib/api";
import { formatTripAmount } from "@/lib/trips/format";
import { buildTripTransactionsHref } from "@/lib/trips/range-link";
import type { Locale } from "@/i18n/routing";
import { TripCategoryBreakdown } from "./trip-category-breakdown";
import { TripDailyChart } from "./trip-daily-chart";
import { TripHeader } from "./trip-header";
import { TripMemberList } from "./trip-member-list";
import { TRIP_KEYS, useInvalidateTrips } from "./use-trip-actions";

interface TripDetailTabProps {
  tripId: number;
  onDeleted: () => void;
}

const CARD = "rounded-3xl border border-border bg-card p-5 md:p-6";
const CARD_LABEL =
  "mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

export function TripDetailTab({ tripId, onDeleted }: TripDetailTabProps) {
  const t = useTranslations("trips");
  const locale = useLocale() as Locale;
  const invalidateTrips = useInvalidateTrips();
  const detailQuery = useQuery({
    queryKey: TRIP_KEYS.detail(tripId),
    queryFn: () => getTripDetail(tripId),
  });

  const removeMutation = useMutation({
    // Removing writes a "no trip" decision so automatic rules don't re-add it.
    mutationFn: (transactionId: number) => assignTransactionsToTrip([transactionId], null),
    onSuccess: () => {
      invalidateTrips();
      toast.success(t("detail.removedToast"));
    },
    onError: () => toast.error(t("errorToast")),
  });

  if (detailQuery.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-3xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    );
  }
  if (!detailQuery.data) {
    return <p className={`${CARD} text-sm text-muted-foreground`}>{t("loadError")}</p>;
  }

  // Every figure below comes from the server summary, which leaves out
  // pending and Transfers members; the list shows them marked as not counted.
  const detail = detailQuery.data;
  const addLink = (
    <Link
      href={buildTripTransactionsHref(detail.trip)}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent"
    >
      <Plus className="size-3.5" aria-hidden="true" />
      {t("detail.addTransactions")}
    </Link>
  );

  return (
    <div className="space-y-6">
      <TripHeader trip={detail.trip} days={detail.days} onDeleted={onDeleted} actions={addLink} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("detail.kpiTotal")} value={formatTripAmount(detail.total, locale)} />
        <Kpi
          label={t("detail.kpiPerDay")}
          value={formatTripAmount(detail.perDay, locale)}
          caption={t("days", { count: detail.days })}
        />
        <Kpi label={t("detail.kpiBefore")} value={formatTripAmount(detail.before, locale)} />
        <Kpi label={t("detail.kpiDuring")} value={formatTripAmount(detail.during, locale)} />
      </div>
      {detail.pendingCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("detail.pendingNote", { count: detail.pendingCount })}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        <section className={`${CARD} min-w-0 lg:col-span-5`}>
          <h3 className={CARD_LABEL}>{t("detail.breakdownTitle")}</h3>
          <TripCategoryBreakdown slices={detail.breakdown} />
        </section>
        <section className={`${CARD} min-w-0 lg:col-span-7`}>
          <h3 className={CARD_LABEL}>{t("detail.chartTitle")}</h3>
          <TripDailyChart points={detail.daily} />
        </section>
      </div>

      <TripMemberList
        members={detail.members}
        onRemove={(id) => removeMutation.mutate(id)}
        removingId={removeMutation.isPending ? (removeMutation.variables ?? null) : null}
      />
    </div>
  );
}

function Kpi({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="min-w-0 rounded-3xl border border-border bg-card p-4 md:p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 truncate font-serif text-2xl tracking-tight md:text-3xl">
        <span dir="ltr">{value}</span>
      </div>
      {caption ? <div className="mt-1 text-xs text-muted-foreground">{caption}</div> : null}
    </div>
  );
}
