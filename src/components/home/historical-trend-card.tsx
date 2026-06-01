"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CardShell } from "./card-shell";
import { formatCurrency } from "@/lib/formatters";
import type { HomeHistoricalTrendPoint } from "@/lib/types";

interface Props {
  data: HomeHistoricalTrendPoint[];
}

export function HistoricalTrendCard({ data }: Props) {
  const t = useTranslations("home");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hasData = data.some((d) => d.income > 0 || d.expenses > 0);

  if (!hasData) {
    return (
      <CardShell label={t("last6Months")}>
        <div className="flex flex-1 items-center justify-center py-6 text-sm text-muted-foreground">
          {t("notEnoughHistory")}
        </div>
      </CardShell>
    );
  }

  const max = Math.max(...data.flatMap((d) => [d.income, d.expenses]));
  const active = hoverIdx != null ? data[hoverIdx] : data[data.length - 1];

  return (
    <CardShell label={t("last6Months")}>
      <div className="flex flex-1 flex-col justify-between gap-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="text-xs text-muted-foreground">
                {active.label}
                {active.isCurrent ? ` ${t("soFar")}` : ""}
              </div>
              <div className="mt-1 font-serif text-2xl tabular-nums">
                {formatCurrency(active.expenses)}
              </div>
            </div>
            <div className="text-end text-xs text-muted-foreground">
              <div className="tabular-nums text-[var(--status-on-track)]">
                {t("cashFlowIn")} {formatCurrency(active.income)}
              </div>
              <div className="mt-1 tabular-nums text-[var(--status-over)]">
                {t("cashFlowOut")} {formatCurrency(active.expenses)}
              </div>
            </div>
          </div>
        </div>

        <BarChart
          data={data}
          max={max}
          hoverIdx={hoverIdx}
          onHover={setHoverIdx}
        />
      </div>
    </CardShell>
  );
}

function BarChart({
  data,
  max,
  hoverIdx,
  onHover,
}: {
  data: HomeHistoricalTrendPoint[];
  max: number;
  hoverIdx: number | null;
  onHover: (i: number | null) => void;
}) {
  const width = 100;
  const height = 36;
  const barWidth = width / data.length;
  const innerBarWidth = barWidth * 0.26;
  const barGap = (barWidth - innerBarWidth * 2) / 2;

  return (
    <div className="flex flex-col gap-2" onMouseLeave={() => onHover(null)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
      >
        {data.map((d, i) => {
          const isHovered = hoverIdx === i;
          const opacity = hoverIdx == null
            ? d.isCurrent ? 1 : 0.55
            : isHovered ? 1 : 0.3;
          const incomeHeight = max > 0 ? (d.income / max) * (height - 2) : 0;
          const expenseHeight = max > 0 ? (d.expenses / max) * (height - 2) : 0;
          const baseX = i * barWidth + barGap;
          return (
            <g key={d.month} onMouseEnter={() => onHover(i)}>
              <rect
                x={baseX}
                y={height - incomeHeight}
                width={innerBarWidth}
                height={Math.max(incomeHeight, 0.5)}
                fill="currentColor"
                opacity={opacity}
                rx={0.6}
                className="cursor-pointer text-[var(--status-on-track)] transition-opacity"
              />
              <rect
                x={baseX + innerBarWidth}
                y={height - expenseHeight}
                width={innerBarWidth}
                height={Math.max(expenseHeight, 0.5)}
                fill="currentColor"
                opacity={opacity}
                rx={0.6}
                className="cursor-pointer text-[var(--status-over)] transition-opacity"
              />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        {data.map((d) => (
          <span
            key={d.month}
            className={d.isCurrent ? "font-medium text-foreground" : ""}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
