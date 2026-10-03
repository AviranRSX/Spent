"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { detectTrips, getTrips } from "@/lib/api";
import { AllTripsTab } from "./all-trips-tab";
import { NeedsTripTab } from "./needs-trip-tab";
import { TripDetailTab } from "./trip-detail";
import { TripFormDialog } from "./trip-form-dialog";
import { TRIP_KEYS, useInvalidateTrips } from "./use-trip-actions";

export const ALL_TAB = "all";
export const NEEDS_TAB = "needs-trip";
const TRIGGER_CLASS = "flex-none px-3";

function tripTab(id: number): string {
  return `trip-${id}`;
}

export function TripsPage() {
  const t = useTranslations("trips");
  const router = useRouter();
  const searchParams = useSearchParams();
  const invalidateTrips = useInvalidateTrips();
  const [creating, setCreating] = useState(false);

  const overviewQuery = useQuery({ queryKey: TRIP_KEYS.overview, queryFn: getTrips });

  const { mutate: runDetection } = useMutation({
    mutationFn: detectTrips,
    onSuccess: (result) => {
      if (result.created > 0) invalidateTrips();
    },
  });
  useEffect(() => {
    runDetection();
  }, [runDetection]);

  const confirmed = overviewQuery.data?.confirmed ?? [];
  const needsTripCount = overviewQuery.data?.needsTripCount ?? 0;
  const tripParam = searchParams.get("trip");
  const tabParam = searchParams.get("tab");

  let activeTab = ALL_TAB;
  if (tripParam && (overviewQuery.isPending || confirmed.some((trip) => String(trip.id) === tripParam))) {
    activeTab = `trip-${tripParam}`;
  } else if (tabParam === NEEDS_TAB) {
    activeTab = NEEDS_TAB;
  }

  const selectTab = (value: string) => {
    const params = new URLSearchParams();
    if (value === NEEDS_TAB) params.set("tab", NEEDS_TAB);
    else if (value.startsWith("trip-")) params.set("trip", value.slice("trip-".length));
    const query = params.toString();
    router.replace(query ? `/trips?${query}` : "/trips", { scroll: false });
  };

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="size-3.5" aria-hidden="true" />
            {t("newTrip")}
          </Button>
        }
      />

      <div className="p-4 md:p-6 lg:p-8">
        <Tabs value={activeTab} onValueChange={(value) => selectTab(String(value))}>
          <div className="-mx-4 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6 lg:mx-0 lg:px-0">
            <TabsList variant="line" aria-label={t("tabsLabel")} className="w-max gap-2">
              <TabsTrigger value={ALL_TAB} className={TRIGGER_CLASS}>
                {t("tabAll")}
              </TabsTrigger>
              {confirmed.map((trip) => (
                <TabsTrigger key={trip.id} value={tripTab(trip.id)} className={TRIGGER_CLASS}>
                  {trip.name}
                </TabsTrigger>
              ))}
              <TabsTrigger value={NEEDS_TAB} className={`${TRIGGER_CLASS} gap-1.5`}>
                {t("tabNeedsTrip")}
                {needsTripCount > 0 ? (
                  <span className="rounded-full bg-[color-mix(in_oklch,var(--status-heads-up)_22%,transparent)] px-1.5 text-[11px] font-semibold tabular-nums text-foreground">
                    {needsTripCount}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={ALL_TAB} className="pt-4">
            <AllTripsTab
              overview={overviewQuery.data}
              loading={overviewQuery.isPending}
              onOpenTrip={(id) => selectTab(tripTab(id))}
              onCreate={() => setCreating(true)}
            />
          </TabsContent>

          {confirmed.map((trip) => (
            <TabsContent key={trip.id} value={tripTab(trip.id)} className="pt-4">
              <TripDetailTab tripId={trip.id} onDeleted={() => selectTab(ALL_TAB)} />
            </TabsContent>
          ))}

          <TabsContent value={NEEDS_TAB} className="pt-4">
            <NeedsTripTab />
          </TabsContent>
        </Tabs>
      </div>

      {creating ? (
        <TripFormDialog
          onClose={() => setCreating(false)}
          onSaved={(trip) => {
            setCreating(false);
            if (trip.status === "confirmed") selectTab(tripTab(trip.id));
          }}
        />
      ) : null}
    </>
  );
}
