"use client";

import { useLocale, useTranslations } from "next-intl";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { formatMonthKey } from "@/lib/formatters";
import { shiftMonthKey } from "@/lib/home-month";
import type { Locale } from "@/i18n/routing";

interface Props {
  month: string;
  currentMonth: string;
  onChange: (month: string) => void;
}

export function HomeMonthPicker({ month, currentMonth, onChange }: Props) {
  const t = useTranslations("home");
  const locale = useLocale() as Locale;
  return (
    <PeriodSelector
      label={formatMonthKey(month, locale, "short")}
      onPrev={() => onChange(shiftMonthKey(month, -1))}
      onNext={() => onChange(shiftMonthKey(month, 1))}
      nextDisabled={month >= currentMonth}
      prevLabel={t("monthPickerPrev")}
      nextLabel={t("monthPickerNext")}
    />
  );
}
