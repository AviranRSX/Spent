"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CardShell } from "./card-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  formatSignedCurrency,
  formatSignedNumber,
  formatSignedPercent,
  formatWholeCurrency,
} from "@/lib/formatters";
import {
  computeKpiDelta,
  type HomeKpiDelta,
  type HomeKpiKey,
} from "@/lib/home-kpis";
import type { Locale } from "@/i18n/routing";
import type { HomeKpiFigures, HomeKpis } from "@/lib/types";

const KPI_ORDER: HomeKpiKey[] = ["income", "expenses", "net", "savingsRate"];

const KPI_LABEL_KEYS: Record<HomeKpiKey, string> = {
  income: "kpiIncome",
  expenses: "kpiExpenses",
  net: "kpiNet",
  savingsRate: "kpiSavingsRate",
};

const TILE_GRID = "grid grid-cols-2 gap-4 md:gap-5 lg:grid-cols-4 lg:gap-6";

export function KpiTiles({ data }: { data: HomeKpis }) {
  return (
    <div className={TILE_GRID}>
      {KPI_ORDER.map((kpi) => (
        <KpiTile key={kpi} kpi={kpi} data={data} />
      ))}
    </div>
  );
}

export function KpiTilesSkeleton() {
  return (
    <div className={TILE_GRID}>
      {KPI_ORDER.map((kpi) => (
        <CardShell key={kpi} className="p-4 md:p-5">
          <Skeleton className="h-28 w-full" />
        </CardShell>
      ))}
    </div>
  );
}

function KpiTile({ kpi, data }: { kpi: HomeKpiKey; data: HomeKpis }) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const notAvailable = t("kpiNotAvailable");
  const delta = computeKpiDelta(kpi, data, data.prev);
  const valueTone =
    kpi === "net" && Math.round(data.net) !== 0
      ? data.net > 0
        ? "text-[var(--status-on-track)]"
        : "text-[var(--status-over)]"
      : "text-foreground";

  return (
    <CardShell label={t(KPI_LABEL_KEYS[kpi])} className="p-4 md:p-5">
      <div className="flex flex-1 flex-col gap-2">
        <div
          className={cn(
            "font-serif text-2xl leading-none tracking-tight tabular-nums sm:text-3xl xl:text-4xl",
            valueTone
          )}
        >
          <span dir="ltr">{formatKpiValue(kpi, data, locale, notAvailable)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {data.isCurrentMonth
            ? t("kpiSoFar", { day: data.dayOfMonth, days: data.daysInMonth })
            : t("kpiFullMonth")}
        </div>
        <DeltaLine delta={delta} isCurrentMonth={data.isCurrentMonth} locale={locale} />
        <div className="mt-auto border-t border-border/60 pt-2 text-xs text-muted-foreground">
          {data.avg6
            ? t("kpiAverage", {
                months: data.avg6.months,
                value: formatKpiValue(kpi, data.avg6, locale, notAvailable),
              })
            : t("kpiNoAverage")}
        </div>
      </div>
    </CardShell>
  );
}

function DeltaLine({
  delta,
  isCurrentMonth,
  locale,
}: {
  delta: HomeKpiDelta | null;
  isCurrentMonth: boolean;
  locale: Locale;
}) {
  const t = useTranslations("home");
  if (!delta) {
    return <div className="text-xs text-muted-foreground">{t("kpiNoComparison")}</div>;
  }
  const rounded = Math.round(delta.value);
  const Icon = rounded > 0 ? ArrowUp : ArrowDown;
  const tone =
    delta.favorable == null
      ? "bg-muted/60 text-muted-foreground"
      : delta.favorable
        ? "bg-[var(--status-on-track)]/10 text-[var(--status-on-track)]"
        : "bg-[var(--status-over)]/10 text-[var(--status-over)]";
  const text =
    delta.unit === "percent"
      ? formatSignedPercent(delta.value)
      : delta.unit === "currency"
        ? formatSignedCurrency(delta.value, locale)
        : t("kpiPoints", { value: formatSignedNumber(delta.value) });

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium tabular-nums",
          tone
        )}
        title={t(isCurrentMonth ? "comparedToLastMonth" : "comparedToPreviousMonth")}
      >
        {rounded !== 0 && <Icon className="h-3 w-3" aria-hidden />}
        <span dir="ltr">{text}</span>
      </span>
      <span className="text-muted-foreground">
        {t(isCurrentMonth ? "kpiVsSameDays" : "kpiVsLastMonth")}
      </span>
    </div>
  );
}

function formatKpiValue(
  kpi: HomeKpiKey,
  figures: HomeKpiFigures,
  locale: Locale,
  notAvailable: string
): string {
  switch (kpi) {
    case "income":
      return formatWholeCurrency(figures.income, locale);
    case "expenses":
      return formatWholeCurrency(figures.expenses, locale);
    case "net":
      return formatSignedCurrency(figures.net, locale);
    case "savingsRate":
      if (figures.savingsRate == null) return notAvailable;
      return figures.savingsRate < 0
        ? formatSignedPercent(figures.savingsRate * 100)
        : `${Math.round(figures.savingsRate * 100)}%`;
  }
}
