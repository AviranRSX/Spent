import type { Locale } from "@/i18n/routing";

function bcp47(locale: Locale | "en-IL" | "he-IL" | undefined): string {
  if (!locale) return "en-IL";
  if (locale === "he") return "he-IL";
  if (locale === "en") return "en-IL";
  return locale;
}

export function formatCurrency(
  amount: number,
  currency = "ILS",
  locale?: Locale,
): string {
  const bcp = bcp47(locale);
  if (currency === "ILS") {
    return `₪${Math.abs(amount).toLocaleString(bcp, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return new Intl.NumberFormat(bcp, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
}

export function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatMonth(isoDate: string, locale?: Locale): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString(bcp47(locale), { month: "short", year: "numeric" });
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getMonthRange(date: Date = new Date()): {
  from: string;
  to: string;
} {
  const from = new Date(date.getFullYear(), date.getMonth(), 1);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    from: toLocalDateString(from),
    to: toLocalDateString(to),
  };
}

export function formatMonthLabel(date: Date, locale?: Locale): string {
  return date.toLocaleDateString(bcp47(locale), {
    month: "long",
    year: "numeric",
  });
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/** Formats a "YYYY-MM" key in the active locale, e.g. "Oct 2026". */
export function formatMonthKey(
  monthKey: string,
  locale?: Locale,
  style: "short" | "long" = "long",
  withYear = true,
): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(
    bcp47(locale),
    withYear ? { month: style, year: "numeric" } : { month: style },
  );
}

export function formatWholeCurrency(amount: number, locale?: Locale): string {
  return `₪${Math.round(Math.abs(amount)).toLocaleString(bcp47(locale))}`;
}

/** Axis ticks: "₪12.5K", "−₪3K". */
export function formatCompactCurrency(amount: number, locale?: Locale): string {
  const sign = amount < 0 ? "−" : "";
  const compact = new Intl.NumberFormat(bcp47(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.abs(amount));
  return `${sign}₪${compact}`;
}

/** Rounded, with "+" or a true minus sign; zero has no sign. */
export function formatSignedNumber(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}`;
}

export function formatSignedPercent(value: number): string {
  return `${formatSignedNumber(value)}%`;
}

export function formatSignedCurrency(amount: number, locale?: Locale): string {
  if (Math.round(amount) === 0) return formatWholeCurrency(0, locale);
  return `${amount > 0 ? "+" : "−"}${formatWholeCurrency(amount, locale)}`;
}

export interface FormatLastSyncLabels {
  never: string;
  justNow: string;
  minute: (n: number) => string;
  hour: (n: number) => string;
  day: (n: number) => string;
  week: (n: number) => string;
  monthAgo: (n: number) => string;
}

const FALLBACK_LABELS: FormatLastSyncLabels = {
  never: "Never synced",
  justNow: "just now",
  minute: (n) => `${n}m ago`,
  hour: (n) => `${n}h ago`,
  day: (n) => `${n}d ago`,
  week: (n) => `${n}w ago`,
  monthAgo: (n) => `${n}mo ago`,
};

// The DB returns datetime('now') in UTC without a Z suffix.
export function formatLastSync(
  iso: string | null,
  labels: FormatLastSyncLabels = FALLBACK_LABELS,
): string {
  if (!iso) return labels.never;
  const synced = new Date(iso + "Z").getTime();
  const ageMs = Date.now() - synced;
  if (!Number.isFinite(ageMs) || ageMs < 0) return labels.justNow;

  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return labels.justNow;
  const min = Math.floor(sec / 60);
  if (min < 60) return labels.minute(min);
  const hr = Math.floor(min / 60);
  if (hr < 24) return labels.hour(hr);
  const day = Math.floor(hr / 24);
  if (day < 7) return labels.day(day);
  const wk = Math.floor(day / 7);
  if (wk < 5) return labels.week(wk);
  const mo = Math.floor(day / 30);
  return labels.monthAgo(mo);
}

export function formatJerusalemTimeOfDay(iso: string, locale?: Locale): string {
  return new Intl.DateTimeFormat(bcp47(locale), {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
