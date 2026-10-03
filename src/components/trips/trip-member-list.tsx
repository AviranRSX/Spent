"use client";

import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { translateCategoryName } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import {
  formatOriginalAmount,
  formatTripAmount,
  formatTripDay,
} from "@/lib/trips/format";
import { TRANSFERS_CATEGORY_NAME } from "@/lib/trips/summary";
import type { MembershipReason, TripMember } from "@/lib/trips/types";
import type { Locale } from "@/i18n/routing";

interface TripMemberListProps {
  members: TripMember[];
  onRemove: (id: number) => void;
  removingId: number | null;
}

const REASON_KEY: Record<MembershipReason, string> = {
  manual: "detail.reasonManual",
  during: "detail.reasonDuring",
  pre: "detail.reasonPre",
};

const MUTED_PILL = "rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium";

export function TripMemberList({ members, onRemove, removingId }: TripMemberListProps) {
  const t = useTranslations("trips");
  const before = members.filter((m) => m.phase === "before");
  const during = members.filter((m) => m.phase === "during");

  return (
    <section className="rounded-3xl border border-border bg-card p-5 md:p-6">
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {t("detail.transactionsTitle")}
      </h3>
      {members.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("detail.noMembers")}</p>
      ) : (
        <div className="space-y-6">
          {before.length > 0 ? (
            <MemberGroup title={t("detail.beforeGroup")} rows={before} onRemove={onRemove} removingId={removingId} />
          ) : null}
          {during.length > 0 ? (
            <MemberGroup title={t("detail.duringGroup")} rows={during} onRemove={onRemove} removingId={removingId} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function MemberGroup({
  title,
  rows,
  onRemove,
  removingId,
}: {
  title: string;
  rows: TripMember[];
  onRemove: (id: number) => void;
  removingId: number | null;
}) {
  const t = useTranslations("trips");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium">{title}</h4>
      <ul className="divide-y divide-border/60">
        {rows.map((row) => {
          const pending = row.status === "pending";
          // Same rule as the server summary: Transfers rows are listed but not counted.
          const transfer = row.categoryName === TRANSFERS_CATEGORY_NAME;
          const category = row.categoryName
            ? translateCategoryName(row.categoryName, tCat)
            : t("detail.uncategorized");
          return (
            <li
              key={row.id}
              className={cn("flex items-center gap-3 py-2.5", (pending || transfer) && "opacity-70")}
            >
              <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatTripDay(row.date, locale)}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="truncate text-sm font-medium">{row.description}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    style={
                      row.categoryColor
                        ? {
                            borderColor: row.categoryColor + "40",
                            backgroundColor: row.categoryColor + "15",
                            color: row.categoryColor,
                          }
                        : undefined
                    }
                  >
                    {category}
                  </Badge>
                  <span>{t(REASON_KEY[row.reason])}</span>
                  {pending ? <span className={MUTED_PILL}>{t("detail.pending")}</span> : null}
                  {transfer ? (
                    <span className={MUTED_PILL} title={t("detail.notCountedTransfers")}>
                      {t("detail.notCounted")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 text-end">
                <div
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    (pending || transfer) && "text-muted-foreground"
                  )}
                >
                  <span dir="ltr">{formatTripAmount(-row.chargedAmount, locale)}</span>
                </div>
                {row.originalCurrency !== "ILS" ? (
                  <div className="text-xs tabular-nums text-muted-foreground">
                    <span dir="ltr">
                      {formatOriginalAmount(row.originalAmount, row.originalCurrency, locale)}
                    </span>
                  </div>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                onClick={() => onRemove(row.id)}
                disabled={removingId === row.id}
                aria-label={t("detail.remove")}
                title={t("detail.remove")}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
