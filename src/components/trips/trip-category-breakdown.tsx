"use client";

import { useLocale, useTranslations } from "next-intl";
import { translateCategoryName } from "@/lib/i18n-data";
import { formatTripAmount } from "@/lib/trips/format";
import type { TripCategorySlice } from "@/lib/trips/types";
import type { Locale } from "@/i18n/routing";

export function TripCategoryBreakdown({ slices }: { slices: TripCategorySlice[] }) {
  const t = useTranslations("trips");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;

  if (slices.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("detail.noMembers")}</p>;
  }
  const max = Math.max(0, ...slices.map((s) => s.amount));

  return (
    <ul className="space-y-3.5">
      {slices.map((slice) => {
        const name = slice.name ? translateCategoryName(slice.name, tCat) : t("detail.uncategorized");
        const parent = slice.parentName ? translateCategoryName(slice.parentName, tCat) : null;
        const fill = slice.parentColor ?? slice.color ?? "var(--muted-foreground)";
        const width = max > 0 && slice.amount > 0 ? Math.max(2, (slice.amount / max) * 100) : 0;
        return (
          <li key={slice.categoryId ?? "uncategorized"} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: fill }} />
                <span className="truncate font-medium">{name}</span>
                {parent ? <span className="truncate text-xs text-muted-foreground">{parent}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">
                <span dir="ltr">{formatTripAmount(slice.amount, locale)}</span>
                <span className="ms-1.5 text-xs text-muted-foreground">{Math.round(slice.share * 100)}%</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: fill }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
