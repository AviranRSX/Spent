"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Pencil, Plane, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { updateTrip } from "@/lib/api";
import { formatTripAmount, formatTripDates } from "@/lib/trips/format";
import type { TripStatus, TripSummary, TripsOverview } from "@/lib/trips/types";
import type { Locale } from "@/i18n/routing";
import { TripFormDialog } from "./trip-form-dialog";
import { useInvalidateTrips } from "./use-trip-actions";

interface AllTripsTabProps {
  overview: TripsOverview | undefined;
  loading: boolean;
  onOpenTrip: (id: number) => void;
  onCreate: () => void;
}

const SECTION_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

export function AllTripsTab({ overview, loading, onOpenTrip, onCreate }: AllTripsTabProps) {
  const t = useTranslations("trips");
  const invalidateTrips = useInvalidateTrips();
  const [editing, setEditing] = useState<TripSummary | null>(null);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TripStatus }) =>
      updateTrip(id, { status }),
    onSuccess: (trip) => {
      invalidateTrips();
      toast.success(trip.status === "confirmed" ? t("confirmedToast") : t("dismissedToast"));
    },
    onError: () => toast.error(t("errorToast")),
  });

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-3xl" />
        ))}
      </div>
    );
  }

  const suggested = overview?.suggested ?? [];
  const confirmed = overview?.confirmed ?? [];

  if (suggested.length === 0 && confirmed.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border bg-card px-6 py-14 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Plane className="size-5" aria-hidden="true" />
        </span>
        <h2 className="font-serif text-2xl tracking-tight">{t("emptyTitle")}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
        <Button size="sm" onClick={onCreate} className="mt-2 gap-1.5">
          <Plus className="size-3.5" aria-hidden="true" />
          {t("newTrip")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {suggested.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className={SECTION_LABEL}>{t("suggestedLabel")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("suggestedHint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {suggested.map((trip) => (
              <SuggestedTripCard
                key={trip.id}
                trip={trip}
                busy={statusMutation.isPending}
                onConfirm={() => statusMutation.mutate({ id: trip.id, status: "confirmed" })}
                onDismiss={() => statusMutation.mutate({ id: trip.id, status: "dismissed" })}
                onEdit={() => setEditing(trip)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {confirmed.length > 0 ? (
        <section className="space-y-3">
          {suggested.length > 0 ? <h2 className={SECTION_LABEL}>{t("confirmedLabel")}</h2> : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {confirmed.map((trip) => (
              <TripCard key={trip.id} trip={trip} onOpen={() => onOpenTrip(trip.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {editing ? (
        <TripFormDialog
          trip={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function TripMeta({ trip }: { trip: TripSummary }) {
  const t = useTranslations("trips");
  const locale = useLocale() as Locale;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
      {trip.country ? (
        <>
          <span>{trip.country}</span>
          <span aria-hidden="true">·</span>
        </>
      ) : null}
      <span>{formatTripDates(trip.startDate, trip.endDate, locale)}</span>
      <span aria-hidden="true">·</span>
      <span>{t("days", { count: trip.days })}</span>
    </p>
  );
}

function TripCard({ trip, onOpen }: { trip: TripSummary; onOpen: () => void }) {
  const t = useTranslations("trips");
  const locale = useLocale() as Locale;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full flex-col justify-between gap-6 rounded-3xl border border-border bg-card p-5 text-start transition-colors duration-200 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-6"
    >
      <div className="min-w-0 space-y-1">
        <h3 className="truncate font-serif text-xl tracking-tight">{trip.name}</h3>
        <TripMeta trip={trip} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <span className="font-serif text-3xl tracking-tight">
          {formatTripAmount(trip.total, locale)}
        </span>
        <span className="pb-1 text-sm text-muted-foreground">
          {t("perDayValue", { amount: formatTripAmount(trip.perDay, locale) })}
        </span>
      </div>
    </button>
  );
}

interface SuggestedTripCardProps {
  trip: TripSummary;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onEdit: () => void;
}

function SuggestedTripCard({ trip, busy, onConfirm, onDismiss, onEdit }: SuggestedTripCardProps) {
  const t = useTranslations("trips");
  const locale = useLocale() as Locale;
  return (
    <div className="flex h-full flex-col justify-between gap-5 rounded-3xl border border-dashed border-border bg-card/60 p-5 md:p-6">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <Plane className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h3 className="truncate font-serif text-xl tracking-tight">{trip.name}</h3>
        </div>
        <TripMeta trip={trip} />
        <p className="text-sm text-muted-foreground">
          {t("transactionsCount", { count: trip.memberCount })}
          {" · "}
          {formatTripAmount(trip.total, locale)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onConfirm} disabled={busy} className="gap-1.5">
          <Check className="size-3.5" aria-hidden="true" />
          {t("confirm")}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit} disabled={busy} className="gap-1.5">
          <Pencil className="size-3.5" aria-hidden="true" />
          {t("edit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          disabled={busy}
          className="gap-1.5 text-muted-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
          {t("dismiss")}
        </Button>
      </div>
    </div>
  );
}
