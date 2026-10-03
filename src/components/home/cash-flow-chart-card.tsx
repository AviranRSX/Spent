"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type MouseHandlerDataParam,
  type XAxisTickContentProps,
} from "recharts";
import { CardShell } from "./card-shell";
import { cn } from "@/lib/utils";
import {
  formatCompactCurrency,
  formatMonthKey,
  formatSignedCurrency,
  formatWholeCurrency,
} from "@/lib/formatters";
import type { Locale } from "@/i18n/routing";
import type { HomeHistoricalTrendPoint } from "@/lib/types";

const INCOME_COLOR = "var(--chart-income)";
const EXPENSE_COLOR = "var(--chart-expense)";
const NET_COLOR = "var(--foreground)";
const DIMMED_OPACITY = 0.45;

interface Props {
  data: HomeHistoricalTrendPoint[];
  onSelectMonth: (month: string) => void;
}

export function CashFlowChartCard({ data, onSelectMonth }: Props) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const isRtl = locale === "he";
  const hasData = data.some((point) => point.income > 0 || point.expenses > 0);
  const selectedMonth =
    data.find((point) => point.isSelected)?.month ??
    data[data.length - 1]?.month ??
    "";

  if (!hasData) {
    return (
      <CardShell label={t("trendTitle")}>
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
          {t("notEnoughHistory")}
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell label={t("trendTitle")} action={<ChartLegend />}>
      <figure className="m-0">
        <figcaption className="sr-only">{t("trendChartLabel")}</figcaption>
        <div className="h-60 w-full cursor-pointer md:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
              barGap={2}
              barCategoryGap="24%"
              onClick={(state: MouseHandlerDataParam) => {
                if (typeof state.activeLabel === "string") {
                  onSelectMonth(state.activeLabel);
                }
              }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="month"
                reversed={isRtl}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={4}
                tick={(props: XAxisTickContentProps) => (
                  <MonthTick {...props} selectedMonth={selectedMonth} locale={locale} />
                )}
              />
              <YAxis
                orientation={isRtl ? "right" : "left"}
                axisLine={false}
                tickLine={false}
                width={56}
                tickCount={5}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickFormatter={(value: number) => formatCompactCurrency(value, locale)}
              />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as HomeHistoricalTrendPoint;
                  return <TrendTooltip point={point} locale={locale} />;
                }}
              />
              <Bar
                dataKey="income"
                name={t("cashFlowIn")}
                fill={INCOME_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              >
                {data.map((point) => (
                  <Cell
                    key={point.month}
                    fillOpacity={point.isSelected ? 1 : DIMMED_OPACITY}
                  />
                ))}
              </Bar>
              <Bar
                dataKey="expenses"
                name={t("cashFlowOut")}
                fill={EXPENSE_COLOR}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              >
                {data.map((point) => (
                  <Cell
                    key={point.month}
                    fillOpacity={point.isSelected ? 1 : DIMMED_OPACITY}
                  />
                ))}
              </Bar>
              <Line
                type="linear"
                dataKey="net"
                name={t("cashFlowNet")}
                stroke={NET_COLOR}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={{ r: 4, fill: NET_COLOR, stroke: "var(--card)", strokeWidth: 2 }}
                activeDot={{ r: 5, fill: NET_COLOR, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          {t("trendShowTable")}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-start font-medium">{t("trendMonth")}</th>
                <th className="py-1 text-end font-medium">{t("cashFlowIn")}</th>
                <th className="py-1 text-end font-medium">{t("cashFlowOut")}</th>
                <th className="py-1 text-end font-medium">{t("cashFlowNet")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr
                  key={point.month}
                  className={cn("border-t border-border/60", point.isSelected && "font-semibold")}
                >
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectMonth(point.month)}
                      className="underline-offset-4 hover:underline"
                      aria-current={point.isSelected ? "date" : undefined}
                      aria-label={t("trendSelectMonth", {
                        month: formatMonthKey(point.month, locale, "long"),
                      })}
                    >
                      {formatMonthKey(point.month, locale, "short")}
                    </button>
                  </td>
                  <td className="py-1.5 text-end">
                    <span dir="ltr">{formatWholeCurrency(point.income, locale)}</span>
                  </td>
                  <td className="py-1.5 text-end">
                    <span dir="ltr">{formatWholeCurrency(point.expenses, locale)}</span>
                  </td>
                  <td className="py-1.5 text-end">
                    <span dir="ltr">{formatSignedCurrency(point.net, locale)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </CardShell>
  );
}

function MonthTick({
  x,
  y,
  payload,
  selectedMonth,
  locale,
}: XAxisTickContentProps & { selectedMonth: string; locale: Locale }) {
  const month = String(payload.value);
  const isSelected = month === selectedMonth;
  return (
    <text
      x={x}
      y={y}
      dy={12}
      textAnchor="middle"
      fontSize={11}
      fontWeight={isSelected ? 600 : 400}
      fill={isSelected ? "var(--foreground)" : "var(--muted-foreground)"}
    >
      {formatMonthKey(month, locale, "short", false)}
    </text>
  );
}

function ChartLegend() {
  const t = useTranslations("home");
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <LegendItem label={t("cashFlowIn")}>
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INCOME_COLOR }} />
      </LegendItem>
      <LegendItem label={t("cashFlowOut")}>
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: EXPENSE_COLOR }} />
      </LegendItem>
      <LegendItem label={t("cashFlowNet")}>
        <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: NET_COLOR }} />
      </LegendItem>
    </div>
  );
}

function LegendItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-flex items-center">
        {children}
      </span>
      {label}
    </span>
  );
}

function TrendTooltip({
  point,
  locale,
}: {
  point: HomeHistoricalTrendPoint;
  locale: Locale;
}) {
  const t = useTranslations("home");
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-medium text-popover-foreground">
        {formatMonthKey(point.month, locale, "long")}
        {point.isCurrent ? ` ${t("soFar")}` : ""}
      </div>
      <TooltipRow color={INCOME_COLOR} label={t("cashFlowIn")} value={formatWholeCurrency(point.income, locale)} />
      <TooltipRow color={EXPENSE_COLOR} label={t("cashFlowOut")} value={formatWholeCurrency(point.expenses, locale)} />
      <TooltipRow color={NET_COLOR} label={t("cashFlowNet")} value={formatSignedCurrency(point.net, locale)} />
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        {label}
      </span>
      <span dir="ltr" className="font-medium tabular-nums text-popover-foreground">
        {value}
      </span>
    </div>
  );
}
