"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { CardShell } from "./card-shell";
import { formatCurrency } from "@/lib/formatters";
import {
  buildSelectableSpendingStats,
  clampStatsMonthCount,
} from "@/lib/home-spending-stats";
import { translateCategoryName } from "@/lib/i18n-data";
import type { HomeSpendingStats } from "@/lib/types";

interface Props {
  data: HomeSpendingStats;
}

export function SpendingStatsCard({ data }: Props) {
  const t = useTranslations("home");
  const tCat = useTranslations("categoriesSeeded");
  const maxMonths = Math.max(3, data.availableMonths);
  const [monthCount, setMonthCount] = useState(() =>
    clampStatsMonthCount(data.defaultMonths, data.availableMonths)
  );
  const selectedMonthCount = clampStatsMonthCount(
    monthCount,
    data.availableMonths
  );
  const stats = useMemo(
    () => buildSelectableSpendingStats(data, selectedMonthCount, 12),
    [data, selectedMonthCount]
  );
  const hasStats =
    stats.cashFlowAverages.meanIncome > 0 ||
    stats.cashFlowAverages.meanExpense > 0 ||
    stats.categoryMeans.length > 0;

  if (!hasStats) {
    return (
      <CardShell label={t("spendingStatsTitle")} className="min-h-[560px]">
        <div className="flex flex-1 flex-col justify-center gap-4">
          <MonthSelector
            value={selectedMonthCount}
            max={maxMonths}
            onChange={setMonthCount}
          />
          <div className="py-6 text-center text-sm text-muted-foreground">
            {t("noSpendingMonth")}
          </div>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell label={t("spendingStatsTitle")} className="min-h-[560px]">
      <div className="flex flex-1 flex-col gap-4">
        <MonthSelector
          value={selectedMonthCount}
          max={maxMonths}
          onChange={setMonthCount}
        />

        <div className="grid grid-cols-3 gap-2">
          <MiniStat
            label={t("meanIncome")}
            value={formatCurrency(stats.cashFlowAverages.meanIncome)}
            icon={<ArrowDownRight className="h-3 w-3" />}
            color="var(--status-on-track)"
          />
          <MiniStat
            label={t("meanExpense")}
            value={formatCurrency(stats.cashFlowAverages.meanExpense)}
            icon={<ArrowUpRight className="h-3 w-3" />}
            color="var(--status-over)"
          />
          <MiniStat
            label={
              stats.cashFlowAverages.meanNet >= 0
                ? t("meanSaving")
                : t("meanOverspend")
            }
            value={formatCurrency(Math.abs(stats.cashFlowAverages.meanNet))}
            icon={<Minus className="h-3 w-3" />}
            color={
              stats.cashFlowAverages.meanNet >= 0
                ? "var(--status-on-track)"
                : "var(--status-over)"
            }
          />
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("categoryMonthlyMean")}
          </div>
          {stats.categoryMeans.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("topCategoriesEmpty")}
            </div>
          ) : (
            <div className="space-y-2">
              {stats.categoryMeans.map((item) => (
                <div
                  key={item.categoryId}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate text-sm font-medium">
                      {translateCategoryName(item.name, tCat)}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {formatCurrency(item.monthlyMean)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}

function MonthSelector({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const t = useTranslations("home");
  const disabled = max <= 3;

  return (
    <div className="rounded-lg bg-background/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("statsWindow")}
        </div>
        <div className="text-sm font-medium tabular-nums">
          {t("statsMonths", { count: value })}
        </div>
      </div>
      <input
        type="range"
        min={3}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-2 w-full accent-foreground disabled:opacity-40"
        aria-label={t("statsWindow")}
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>3</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-background/40 p-2.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span style={{ color }}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
