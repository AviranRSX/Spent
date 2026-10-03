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

/**
 * Wraps text in Unicode left-to-right isolates, for amounts interpolated into
 * a translated string where a dir="ltr" element cannot be used.
 */
export function isolateLtr(text: string): string {
  return String.fromCharCode(0x2066) + text + String.fromCharCode(0x2069);
}

/**
 * Wraps user text (a merchant name) in a first-strong isolate so a Latin name
 * inside a Hebrew sentence keeps its own direction.
 */
export function isolateText(text: string): string {
  return String.fromCharCode(0x2068) + text + String.fromCharCode(0x2069);
}

/** ILS amount that keeps its sign (formatCurrency drops it). */
export function formatTripAmount(amount: number, locale: Locale): string {
  const formatted = formatCurrency(amount, "ILS", locale);
  return amount < 0 ? `-${formatted}` : formatted;
}

/**
 * Foreign amounts use a fixed Latin locale in both languages, like the app's
 * ILS formatting: the symbol leads ("¥48,000") and no RTL marks are emitted.
 */
export function formatOriginalAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Math.abs(amount));
  } catch {
    return `${Math.abs(amount).toFixed(2)} ${currency}`;
  }
}
