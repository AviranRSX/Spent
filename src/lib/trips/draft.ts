import { countryForCurrency, LOCAL_CURRENCY, normalizeCurrency } from "../currency";
import { toDay } from "./dates";
import type { TripInput } from "./types";

/** Prefill for "New trip…" from the transactions the user picked. */
export function draftTripFromTransactions(
  transactions: ReadonlyArray<{ date: string; originalCurrency: string }>,
  options: { locale: string; fallbackName: string }
): TripInput {
  const days = transactions.map((txn) => toDay(txn.date)).sort();
  const startDate = days[0] ?? "";
  const endDate = days[days.length - 1] ?? "";

  const counts = new Map<string, number>();
  for (const txn of transactions) {
    const code = normalizeCurrency(txn.originalCurrency);
    if (code !== LOCAL_CURRENCY) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let currency = LOCAL_CURRENCY;
  let best = 0;
  for (const [code, count] of counts) {
    if (count > best || (count === best && code < currency)) {
      currency = code;
      best = count;
    }
  }

  const country = currency === LOCAL_CURRENCY ? "" : countryForCurrency(currency, options.locale);
  const month = startDate
    ? new Intl.DateTimeFormat(options.locale === "he" ? "he-IL" : "en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${startDate}T12:00:00Z`))
    : "";
  const label = country || options.fallbackName;
  return {
    name: [label, month].filter(Boolean).join(" "),
    country: country || null,
    currency,
    startDate,
    endDate,
  };
}
