"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CardAction, CardShell } from "./card-shell";
import { cn } from "@/lib/utils";
import { formatSignedPercent, formatWholeCurrency } from "@/lib/formatters";
import {
  categoryDeltaVsAverage,
  foldBreakdownForDonut,
  type DonutSlice,
} from "@/lib/home-category-breakdown";
import { translateCategoryName } from "@/lib/i18n-data";
import { buildTransactionsHref } from "@/lib/transactions-url";
import type { Locale } from "@/i18n/routing";
import type {
  HomeCategoryBreakdown,
  HomeCategoryBreakdownGroup,
} from "@/lib/types";

// Beyond this many groups the smallest fold into "Other" in the donut only;
// the ranked list still shows every group.
const DONUT_MAX_SLICES = 7;
const UNCATEGORIZED_COLOR = "var(--muted-foreground)";
const OTHER_COLOR = "var(--input)";

function sliceColor(slice: DonutSlice): string {
  if (slice.isOther) return OTHER_COLOR;
  return slice.color ?? UNCATEGORIZED_COLOR;
}

export function WhereMoneyWentCard({ data }: { data: HomeCategoryBreakdown }) {
  const t = useTranslations("home");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const allExpensesHref = buildTransactionsHref({
    month: data.month,
    kind: "expense",
    source: "all",
  });

  if (data.groups.length === 0) {
    return (
      <CardShell label={t("whereMoneyWent")}>
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
          {t("whereEmpty")}
        </div>
      </CardShell>
    );
  }

  const slices = foldBreakdownForDonut(data.groups, DONUT_MAX_SLICES);
  const sliceName = (slice: DonutSlice) =>
    slice.isOther
      ? t("whereOther")
      : slice.name == null
        ? t("uncategorized")
        : translateCategoryName(slice.name, tCat);

  return (
    <CardShell
      label={t("whereMoneyWent")}
      action={<CardAction href={allExpensesHref}>{t("whereAllExpenses")}</CardAction>}
    >
      <div className="flex flex-1 flex-col gap-5 sm:flex-row sm:items-start">
        <figure className="relative mx-auto h-40 w-40 shrink-0 sm:mx-0">
          <figcaption className="sr-only">{t("whereMoneyWent")}</figcaption>
          {/* Before the chart so the tooltip paints above it. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {t("whereTotal")}
            </span>
            <span dir="ltr" className="font-serif text-lg tabular-nums">
              {formatWholeCurrency(data.total, locale)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="amount"
                nameKey="key"
                innerRadius="66%"
                outerRadius="100%"
                stroke="var(--card)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((slice) => (
                  <Cell key={slice.key} fill={sliceColor(slice)} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const slice = payload[0].payload as DonutSlice;
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                      <div className="font-medium tabular-nums text-popover-foreground">
                        <span dir="ltr">{formatWholeCurrency(slice.amount, locale)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        {sliceName(slice)} · {Math.round(slice.share * 100)}%
                      </div>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </figure>

        <ul className="-mx-2 flex min-w-0 flex-1 flex-col">
          {data.groups.map((group) => (
            <BreakdownRow
              key={group.categoryId ?? "uncategorized"}
              group={group}
              month={data.month}
              isCurrentMonth={data.isCurrentMonth}
              averageMonths={data.averageMonths}
            />
          ))}
        </ul>
      </div>
    </CardShell>
  );
}

function BreakdownRow({
  group,
  month,
  isCurrentMonth,
  averageMonths,
}: {
  group: HomeCategoryBreakdownGroup;
  month: string;
  isCurrentMonth: boolean;
  averageMonths: number;
}) {
  const t = useTranslations("home");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const name =
    group.name == null ? t("uncategorized") : translateCategoryName(group.name, tCat);
  const href =
    group.categoryId == null
      ? buildTransactionsHref({ month, kind: "expense", review: "uncategorized", source: "all" })
      : buildTransactionsHref({ month, categoryIds: group.categoryIds, kind: "expense", source: "all" });
  const childNames = group.children
    .slice(0, 3)
    .map((child) => translateCategoryName(child.name, tCat))
    .join(", ");

  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-xl px-2 py-2 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: group.color ?? UNCATEGORIZED_COLOR }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t("whereShare", { percent: Math.round(group.share * 100) })}
            {childNames ? ` · ${childNames}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span dir="ltr" className="block text-sm tabular-nums">
            {formatWholeCurrency(group.amount, locale)}
          </span>
          <AverageComparison
            amount={group.amount}
            avg6={group.avg6}
            averageMonths={averageMonths}
            isCurrentMonth={isCurrentMonth}
          />
        </span>
      </Link>
    </li>
  );
}

function AverageComparison({
  amount,
  avg6,
  averageMonths,
  isCurrentMonth,
}: {
  amount: number;
  avg6: number | null;
  averageMonths: number;
  isCurrentMonth: boolean;
}) {
  const t = useTranslations("home");
  if (averageMonths === 0 || avg6 == null) return null;
  if (avg6 <= 0) {
    return <span className="block text-xs text-muted-foreground">{t("whereNew")}</span>;
  }
  // Month-to-date spend vs a full-month average would always look low early
  // in the month, so the current month shows progress toward the average.
  if (isCurrentMonth) {
    return (
      <span className="block text-xs tabular-nums text-muted-foreground">
        {t("whereOfAvgSoFar", { percent: Math.round((amount / avg6) * 100) })}
      </span>
    );
  }
  const delta = categoryDeltaVsAverage(amount, avg6);
  if (delta == null) return null;
  const rounded = Math.round(delta);
  const tone =
    rounded === 0
      ? "text-muted-foreground"
      : rounded > 0
        ? "text-[var(--status-over)]"
        : "text-[var(--status-on-track)]";
  return (
    <span className={cn("block text-xs tabular-nums", tone)}>
      {t("whereVsAvg", { value: formatSignedPercent(delta) })}
    </span>
  );
}
