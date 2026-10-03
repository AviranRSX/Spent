"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getActivity, getHome } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  homeHrefForMonth,
  monthKeyFromDate,
  resolveHomeMonthKey,
} from "@/lib/home-month";
import { PageHeader } from "@/components/layout/app-shell";
import { SyncButton } from "@/components/dashboard/sync-button";
import { ImportXlsxButton } from "@/components/dashboard/import-xlsx-button";
import { CategorizeButton } from "@/components/dashboard/categorize-button";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { HomeMonthPicker } from "./home-month-picker";
import { KpiTiles, KpiTilesSkeleton } from "./kpi-tiles";
import { BudgetPaceCard } from "./budget-pace-card";
import { WhereMoneyWentCard } from "./where-money-went-card";
import { CashFlowChartCard } from "./cash-flow-chart-card";
import { RecentTransactionsCard } from "./recent-transactions-card";
import { SpendingStatsCard } from "./spending-stats-card";
import { NeedsAttentionCard } from "./needs-attention-card";
import { BankHealthCard } from "./bank-health-card";
import { SyncStatusPill } from "./sync-status-pill";
import { SyncFailureBanner } from "./sync-failure-banner";
import { CardError, CardSkeleton } from "./card-shell";
import type { DataSourceMode, HomePayload, HomeSection } from "@/lib/types";

const ROW_FULL = "col-span-12";
const ROW_MAIN = "col-span-12 md:col-span-6 lg:col-span-7";
const ROW_SIDE = "col-span-12 md:col-span-6 lg:col-span-5";

interface SectionHandlers {
  onSelectMonth: (month: string) => void;
}

interface SectionContext {
  data: HomePayload | undefined;
  isError: boolean;
  skeletonLabels: Record<HomeSection, string>;
  handlers: SectionHandlers;
}

export function HomePage({ dataSourceMode }: { dataSourceMode: DataSourceMode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scraperMode = dataSourceMode === "scraper";
  const [now] = useState(() => new Date());
  const currentMonth = monthKeyFromDate(now);
  const monthParam = searchParams.get("month");
  const selectedMonth = resolveHomeMonthKey(monthParam, now);
  const [autoStartSync] = useState(
    () => scraperMode && searchParams.get("sync") === "1"
  );
  const t = useTranslations("home");
  const skeletonLabels = useMemo<Record<HomeSection, string>>(
    () => ({
      kpis: t("kpisTitle"),
      historicalTrend: t("trendTitle"),
      categoryBreakdown: t("whereMoneyWent"),
      budgetPace: t("budgetPaceTitle"),
      recentTransactions: t("recentActivity"),
      spendingStats: t("spendingStatsTitle"),
      needsAttention: t("needsAttention"),
      bankHealth: t("bankConnections"),
    }),
    [t]
  );

  useEffect(() => {
    if (autoStartSync) {
      router.replace("/", { scroll: false });
    }
  }, [autoStartSync, router]);

  // A typed, stale or future ?month falls back to the current month instead
  // of a 400 from the API.
  useEffect(() => {
    if (monthParam != null && monthParam !== selectedMonth) {
      router.replace(homeHrefForMonth(selectedMonth, now), { scroll: false });
    }
  }, [monthParam, selectedMonth, router, now]);

  const { data, isError, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["home", selectedMonth],
    queryFn: () => getHome(selectedMonth),
    placeholderData: keepPreviousData,
  });

  const handleMonthChange = useCallback(
    (month: string) => {
      router.push(homeHrefForMonth(month, now), { scroll: false });
    },
    [router, now]
  );

  const [activityPopoverOpen, setActivityPopoverOpen] = useState(false);
  const { data: activity } = useQuery({
    queryKey: ["activity"],
    queryFn: getActivity,
    refetchInterval: (q) => {
      const a = q.state.data;
      if (activityPopoverOpen) return 3000;
      if (a?.sync.active) return 3000;
      return 15000;
    },
    refetchIntervalInBackground: false,
  });

  const handleActivityOpenChange = useCallback(
    (open: boolean) => {
      setActivityPopoverOpen(open);
      if (open) queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
    [queryClient]
  );

  const handleSyncOrCategorizeComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["summary"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  }, [queryClient]);

  // While another month loads, keep the previous one visible but dimmed.
  const refreshing = isFetching && isPlaceholderData;
  const ctx: SectionContext = {
    data,
    isError,
    skeletonLabels,
    handlers: { onSelectMonth: handleMonthChange },
  };
  const monthPicker = (
    <HomeMonthPicker
      month={selectedMonth}
      currentMonth={currentMonth}
      onChange={handleMonthChange}
    />
  );

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        actions={
          <>
            <div className="hidden md:block">{monthPicker}</div>
            {scraperMode && (
              <SyncStatusPill
                items={data?.bankHealth ?? null}
                nextScheduledSync={data?.nextScheduledSync ?? null}
                activity={activity ?? null}
                onOpenChange={handleActivityOpenChange}
              />
            )}
            <CategorizeButton onApplied={handleSyncOrCategorizeComplete} />
            {scraperMode ? (
              <SyncButton
                onComplete={handleSyncOrCategorizeComplete}
                autoStart={autoStartSync}
              />
            ) : (
              <ImportXlsxButton onComplete={handleSyncOrCategorizeComplete} />
            )}
          </>
        }
      />

      <div className="p-4 md:p-6 lg:p-8">
        <div className="mb-4 flex justify-center md:hidden">{monthPicker}</div>
        {scraperMode && (
          <SyncFailureBanner
            items={data?.bankHealth ?? null}
            className="mb-4 md:mb-5 lg:mb-6"
          />
        )}
        <AINotConnectedBanner className="mb-4 md:mb-5 lg:mb-6" />
        <div
          className={cn(
            "grid grid-cols-12 gap-4 transition-opacity md:gap-5 lg:gap-6",
            refreshing && "opacity-60"
          )}
          aria-busy={refreshing}
        >
          {renderSection("kpis", ctx, ROW_FULL)}
          {renderSection("historicalTrend", ctx, ROW_FULL)}
          {renderSection("categoryBreakdown", ctx, ROW_MAIN)}
          {renderSection("budgetPace", ctx, ROW_SIDE)}
          {renderSection("spendingStats", ctx, ROW_MAIN)}
          {renderSection("needsAttention", ctx, ROW_SIDE)}
          {renderSection("recentTransactions", ctx, scraperMode ? ROW_MAIN : ROW_FULL)}
          {scraperMode && renderSection("bankHealth", ctx, ROW_SIDE)}
        </div>
      </div>
    </>
  );
}

function renderSection(section: HomeSection, ctx: SectionContext, spanClass: string) {
  const { data, isError, skeletonLabels } = ctx;
  if (!data) {
    // Without data a failed fetch must say so instead of skeletons forever.
    return (
      <div key={section} className={spanClass}>
        {isError ? (
          <CardError label={skeletonLabels[section]} />
        ) : section === "kpis" ? (
          <KpiTilesSkeleton />
        ) : (
          <CardSkeleton
            label={skeletonLabels[section]}
            height={SKELETON_HEIGHTS[section]}
          />
        )}
      </div>
    );
  }

  // With data in hand a failed background refetch keeps the last good numbers;
  // only the payload's own per-section errors replace a card.
  if (data.errors.some((e) => e.section === section)) {
    return (
      <div key={section} className={spanClass}>
        <CardError label={skeletonLabels[section]} />
      </div>
    );
  }

  return (
    <div key={section} className={spanClass}>
      {renderCard(section, data, ctx.handlers)}
    </div>
  );
}

function renderCard(section: HomeSection, data: HomePayload, handlers: SectionHandlers) {
  switch (section) {
    case "kpis":
      return data.kpis ? <KpiTiles data={data.kpis} /> : null;
    case "historicalTrend":
      return data.historicalTrend ? (
        <CashFlowChartCard
          data={data.historicalTrend}
          onSelectMonth={handlers.onSelectMonth}
        />
      ) : null;
    case "categoryBreakdown":
      return data.categoryBreakdown ? (
        <WhereMoneyWentCard data={data.categoryBreakdown} />
      ) : null;
    case "budgetPace":
      return data.budgetPace ? <BudgetPaceCard data={data.budgetPace} /> : null;
    case "recentTransactions":
      return data.recentTransactions ? (
        <RecentTransactionsCard items={data.recentTransactions} />
      ) : null;
    case "spendingStats":
      return data.spendingStats ? (
        <SpendingStatsCard data={data.spendingStats} />
      ) : null;
    case "needsAttention":
      return data.needsAttention ? (
        <NeedsAttentionCard data={data.needsAttention} month={data.month} />
      ) : null;
    case "bankHealth":
      return data.bankHealth ? (
        <BankHealthCard items={data.bankHealth} />
      ) : null;
  }
}

const SKELETON_HEIGHTS: Record<HomeSection, number> = {
  kpis: 120,
  historicalTrend: 300,
  categoryBreakdown: 260,
  budgetPace: 180,
  recentTransactions: 280,
  spendingStats: 420,
  needsAttention: 160,
  bankHealth: 160,
};
