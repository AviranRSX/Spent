const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export const LOCAL_CURRENCY = "ILS";

// Keys are uppercase because lookups uppercase the raw value first.
const SYMBOL_TO_ISO: Readonly<Record<string, string>> = {
  "₪": "ILS",
  'ש"ח': "ILS",
  "ש״ח": "ILS",
  "שח": "ILS",
  "NIS": "ILS",
  "$": "USD",
  "US$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "FT": "HUF",
  "₩": "KRW",
  "฿": "THB",
  "ZŁ": "PLN",
  "KČ": "CZK",
  "₺": "TRY",
};

// ISO 3166-1 region per currency, localized at read time with
// Intl.DisplayNames. Currencies shared by many countries (EUR, XOF, ...)
// are left out on purpose so callers fall back to the currency code.
const REGION_BY_CURRENCY: Readonly<Record<string, string>> = {
  AED: "AE",
  AUD: "AU",
  BGN: "BG",
  BRL: "BR",
  CAD: "CA",
  CHF: "CH",
  CNY: "CN",
  CZK: "CZ",
  DKK: "DK",
  EGP: "EG",
  GBP: "GB",
  GEL: "GE",
  HKD: "HK",
  HUF: "HU",
  IDR: "ID",
  INR: "IN",
  ISK: "IS",
  JOD: "JO",
  JPY: "JP",
  KRW: "KR",
  MAD: "MA",
  MXN: "MX",
  MYR: "MY",
  NOK: "NO",
  NZD: "NZ",
  PHP: "PH",
  PLN: "PL",
  RON: "RO",
  RSD: "RS",
  SEK: "SE",
  SGD: "SG",
  THB: "TH",
  TRY: "TR",
  USD: "US",
  VND: "VN",
  ZAR: "ZA",
};

/**
 * Maps a raw stored currency (symbol, Hebrew name, or code) to an ISO 4217
 * code. Stored values are never rewritten because they feed the dedup hash.
 * Empty values mean a local row.
 */
export function normalizeCurrency(raw: string | null | undefined): string {
  const cleaned = (raw ?? "").replace(BIDI_MARKS, "").replace(/\s+/g, "");
  if (cleaned === "") return LOCAL_CURRENCY;
  const upper = cleaned.toUpperCase();
  return SYMBOL_TO_ISO[upper] ?? upper;
}

export function countryForCurrency(code: string, locale = "en"): string {
  const region = REGION_BY_CURRENCY[normalizeCurrency(code)];
  if (!region) return "";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(region) ?? "";
  } catch {
    return "";
  }
}
