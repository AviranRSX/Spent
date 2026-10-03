import assert from "node:assert/strict";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

const srcRoot = path.join(process.cwd(), "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = path.join(srcRoot, specifier.slice(2));
      const withExt = path.extname(target) === "" ? `${target}.ts` : target;
      return nextResolve(pathToFileURL(withExt).href, context);
    }
    if (
      specifier.startsWith(".") &&
      path.extname(specifier) === "" &&
      context.parentURL?.includes("/src/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { normalizeCurrency, countryForCurrency } = await import(
  "../src/lib/currency.ts"
);
const { isOnlineTransaction } = await import(
  "../src/lib/trips/online-merchants.ts"
);

test("normalizeCurrency maps symbols and Hebrew names to ISO codes", () => {
  const cases = [
    ["₪", "ILS"],
    ['ש"ח', "ILS"],
    ["ש״ח", "ILS"],
    ["NIS", "ILS"],
    ["nis", "ILS"],
    ["$", "USD"],
    ["€", "EUR"],
    ["£", "GBP"],
    ["¥", "JPY"],
    ["Ft", "HUF"],
    ["₩", "KRW"],
    ["฿", "THB"],
    ["zł", "PLN"],
    ["Kč", "CZK"],
    ["₺", "TRY"],
  ];
  for (const [raw, iso] of cases) {
    assert.equal(normalizeCurrency(raw), iso, `raw ${raw}`);
  }
});

test("normalizeCurrency uppercases codes and strips bidi marks and spaces", () => {
  assert.equal(normalizeCurrency("usd"), "USD");
  assert.equal(normalizeCurrency("CZK"), "CZK");
  assert.equal(normalizeCurrency("\u200F Kč \u200E"), "CZK");
  assert.equal(normalizeCurrency(" ש״ח "), "ILS");
  assert.equal(normalizeCurrency(""), "ILS");
  assert.equal(normalizeCurrency(null), "ILS");
  assert.equal(normalizeCurrency(undefined), "ILS");
});

test("countryForCurrency gives a default country and stays empty for shared currencies", () => {
  assert.equal(countryForCurrency("CZK"), "Czechia");
  assert.equal(countryForCurrency("JPY"), "Japan");
  assert.equal(countryForCurrency("GBP"), "United Kingdom");
  assert.equal(countryForCurrency("THB"), "Thailand");
  assert.equal(countryForCurrency("USD"), "United States");
  assert.equal(countryForCurrency("Kč"), "Czechia");
  assert.equal(countryForCurrency("EUR"), "");
  assert.equal(countryForCurrency("ILS"), "");
  assert.equal(countryForCurrency("XYZ"), "");
});

test("online detection matches the merchant list and the Subscriptions category", () => {
  assert.equal(isOnlineTransaction("SHEIN.COM DEMO", null), true);
  assert.equal(isOnlineTransaction("Netflix.com Demo", null), true);
  assert.equal(isOnlineTransaction("ADOBE *DEMO", null), true);
  assert.equal(isOnlineTransaction("SPOTIFY *DEMO", null), true);
  assert.equal(isOnlineTransaction("אמזון דמו", null), true);
  assert.equal(isOnlineTransaction("Demo App", "Subscriptions"), true);
  assert.equal(isOnlineTransaction("Demo Kavarna", "Restaurants"), false);
  assert.equal(isOnlineTransaction("Demo Kavarna", null), false);
});
