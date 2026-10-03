"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";
import { CardAction, CardShell } from "./card-shell";
import { cn } from "@/lib/utils";
import { formatCurrency, formatMonthKey } from "@/lib/formatters";
import { budgetPaceMessage, type BudgetPaceMessage } from "@/lib/home-budget-pace";
import type { Locale } from "@/i18n/routing";
import type { HomeBudgetPace } from "@/lib/types";

const TONE_CLASS: Record<BudgetPaceMessage["tone"], string> = {
  neutral: "text-muted-foreground",
  good: "text-[var(--status-on-track)]",
  bad: "text-[var(--status-over)]",
};

export function BudgetPaceCard({ data }: { data: HomeBudgetPace }) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  const {
    month,
    spent,
    budget,
    deltaVsLastMonth,
    daysUntilPayday,
    timeElapsedPercent,
    isPast,
  } = data;
  const hasBudget = budget > 0;
  const pctSpent = hasBudget ? (spent / budget) * 100 : 0;
  const message = budgetPaceMessage({ spent, budget, timeElapsedPercent, isPast });
  const verdict = t(message.key, {
    amount: formatCurrency(message.amount ?? 0),
    month: formatMonthKey(month, locale, "long", false),
  });

  return (
    <CardShell
      label={t("budgetPaceTitle")}
      action={<CardAction href="/budget">{t("budgetDetail")}</CardAction>}
    >
      <Link
        href="/budget"
        className="group -m-2 flex flex-1 flex-col gap-5 rounded-2xl p-2 outline-none transition-colors hover:bg-accent/30 focus-visible:bg-accent/40"
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span className="font-serif text-3xl leading-none tracking-tight md:text-4xl">
              <span dir="ltr">{formatCurrency(spent)}</span>
            </span>
            <span className={cn("mt-2 text-sm", TONE_CLASS[message.tone])}>{verdict}</span>
          </div>
          {deltaVsLastMonth != null && (
            <DeltaPill value={deltaVsLastMonth} isPast={isPast} />
          )}
        </div>

        {hasBudget && (
          <div className="space-y-2">
            <ProgressBar
              percent={pctSpent}
              markPercent={isPast ? null : timeElapsedPercent}
              isOver={pctSpent > 100}
            />
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>
                {t("percentOfBudget", {
                  percent: Math.round(pctSpent),
                  budget: formatCurrency(budget),
                })}
              </span>
              {daysUntilPayday != null && (
                <span>{t("daysToPayday", { days: daysUntilPayday })}</span>
              )}
            </div>
          </div>
        )}

        {!hasBudget && daysUntilPayday != null && (
          <div className="text-xs text-muted-foreground">
            {t("daysToPayday", { days: daysUntilPayday })}
          </div>
        )}
      </Link>
    </CardShell>
  );
}

function DeltaPill({ value, isPast }: { value: number; isPast: boolean }) {
  const t = useTranslations("home");
  const rounded = Math.round(value);
  const isUp = rounded > 0;
  const isFlat = rounded === 0;
  const Icon = isUp ? ArrowUp : ArrowDown;
  const cls = isFlat
    ? "text-muted-foreground bg-muted/60"
    : isUp
      ? "text-[var(--status-over)] bg-[var(--status-over)]/10"
      : "text-[var(--status-on-track)] bg-[var(--status-on-track)]/10";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${cls}`}
      title={t(isPast ? "comparedToPreviousMonth" : "comparedToLastMonth")}
    >
      {!isFlat && <Icon className="h-3 w-3" />}
      {t(isPast ? "vsPreviousMonth" : "vsLastMonth", { percent: Math.abs(rounded) })}
    </span>
  );
}

function ProgressBar({
  percent,
  markPercent,
  isOver,
}: {
  percent: number;
  markPercent: number | null;
  isOver: boolean;
}) {
  const fillClass = isOver
    ? "bg-[var(--status-over)]"
    : "bg-[var(--status-on-track)]";
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full ${fillClass}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
      {markPercent != null && (
        <div
          className="absolute top-0 bottom-0 w-px bg-foreground/40"
          style={{ insetInlineStart: `${Math.min(100, Math.max(0, markPercent))}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}
