"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { getTripDetail } from "@/lib/api";
import { TripHeader } from "./trip-header";
import { TRIP_KEYS } from "./use-trip-actions";

interface TripDetailTabProps {
  tripId: number;
  onDeleted: () => void;
}

export function TripDetailTab({ tripId, onDeleted }: TripDetailTabProps) {
  const t = useTranslations("trips");
  const detailQuery = useQuery({
    queryKey: TRIP_KEYS.detail(tripId),
    queryFn: () => getTripDetail(tripId),
  });

  if (detailQuery.isPending) return <Skeleton className="h-32 rounded-3xl" />;
  if (!detailQuery.data) {
    return (
      <p className="rounded-3xl border border-border bg-card p-6 text-sm text-muted-foreground">
        {t("loadError")}
      </p>
    );
  }
  const detail = detailQuery.data;
  return (
    <div className="space-y-6">
      <TripHeader trip={detail.trip} days={detail.days} onDeleted={onDeleted} />
    </div>
  );
}
