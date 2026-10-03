"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatTripAmount, formatTripDay } from "@/lib/trips/format";
import type { TripDailyPoint } from "@/lib/trips/types";
import type { Locale } from "@/i18n/routing";

export function TripDailyChart({ points }: { points: TripDailyPoint[] }) {
  const t = useTranslations("trips");
  const locale = useLocale() as Locale;
  const isRtl = locale === "he";
  const compact = new Intl.NumberFormat(isRtl ? "he-IL" : "en-IL", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const data = points.map((p) => ({ ...p, label: formatTripDay(p.date, locale) }));
  const first = data[0]?.label ?? "";
  const last = data[data.length - 1]?.label ?? "";

  return (
    <figure className="m-0 h-56 w-full" aria-label={t("detail.chartLabel", { from: first, to: last })}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          {/* A manual member long after the trip stretches the series; the
              tick gap keeps labels from colliding however many days it spans. */}
          <XAxis
            dataKey="label"
            reversed={isRtl}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            orientation={isRtl ? "right" : "left"}
            width={52}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            tickFormatter={(value: number) => `₪${compact.format(value)}`}
          />
          <Tooltip
            cursor={{ fill: "color-mix(in oklch, var(--foreground) 6%, transparent)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as (typeof data)[number];
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                  <div className="text-muted-foreground">{point.label}</div>
                  <div className="mt-0.5 font-medium tabular-nums text-popover-foreground">
                    <span dir="ltr">{formatTripAmount(point.amount, locale)}</span>
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="amount" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
