import type { Locale } from "@/i18n/routing";
import { formatCurrency } from "@/lib/formatters";

function bcp(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-IL";
}

function utcNoon(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function formatTripDates(startDate: string, endDate: string, locale: Locale): string {
  const fmt = new Intl.DateTimeFormat(bcp(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return fmt.formatRange(utcNoon(startDate), utcNoon(endDate));
}

export function formatTripDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(bcp(locale), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(utcNoon(day));
}

/** ILS amount that keeps its sign (formatCurrency drops it). */
export function formatTripAmount(amount: number, locale: Locale): string {
  const formatted = formatCurrency(amount, "ILS", locale);
  return amount < 0 ? `-${formatted}` : formatted;
}

export function formatOriginalAmount(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(bcp(locale), {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Math.abs(amount));
  } catch {
    return `${Math.abs(amount).toFixed(2)} ${currency}`;
  }
}
