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

const { resolveTripMembership } = await import(
  "../src/lib/trips/membership.ts"
);

let nextTxnId = 1;
function txn(overrides) {
  return {
    id: nextTxnId++,
    date: "2026-01-01",
    originalCurrency: "ILS",
    kind: "expense",
    description: "Demo merchant",
    categoryName: null,
    ...overrides,
  };
}

const czkTrip = {
  id: 1,
  currency: "CZK",
  startDate: "2026-04-10",
  endDate: "2026-04-15",
  status: "confirmed",
};
const jpyTrip = {
  id: 2,
  currency: "JPY",
  startDate: "2026-08-01",
  endDate: "2026-08-10",
  status: "confirmed",
};

test("rule 2: foreign spending during a trip joins it, even in a second currency", () => {
  const restaurant = txn({ date: "2026-04-11", originalCurrency: "Kč", description: "Demo Kavarna", categoryName: "Travel" });
  const exchange = txn({ date: "2026-04-12", originalCurrency: "€", description: "Demo Exchange" });
  const bufferStart = txn({ date: "2026-04-08", originalCurrency: "€" });
  const bufferEnd = txn({ date: "2026-04-17", originalCurrency: "€" });
  const afterBuffer = txn({ date: "2026-04-18", originalCurrency: "€" });
  const scraperDate = txn({ date: "2026-04-11T21:00:00.000Z", originalCurrency: "Kč" });
  const localApp = txn({ date: "2026-04-12", originalCurrency: "ILS", description: "Demo Ride App" });
  const online = txn({ date: "2026-04-13", originalCurrency: "$", description: "SHEIN.COM DEMO" });
  const subscription = txn({ date: "2026-04-13", originalCurrency: "$", description: "Demo App", categoryName: "Subscriptions" });

  const result = resolveTripMembership(
    [restaurant, exchange, bufferStart, bufferEnd, afterBuffer, scraperDate, localApp, online, subscription],
    [czkTrip],
    []
  );

  const during = { kind: "member", tripId: 1, reason: "during" };
  assert.deepEqual(result.get(restaurant.id), during);
  assert.deepEqual(result.get(exchange.id), during);
  assert.deepEqual(result.get(bufferStart.id), during);
  assert.deepEqual(result.get(bufferEnd.id), during);
  assert.deepEqual(result.get(scraperDate.id), during);
  const none = { kind: "none", manualNoTrip: false };
  assert.deepEqual(result.get(afterBuffer.id), none);
  assert.deepEqual(result.get(localApp.id), none);
  assert.deepEqual(result.get(online.id), none);
  assert.deepEqual(result.get(subscription.id), none);
});

test("rule 3: same-currency prepayments up to 180 days before join the trip, never USD", () => {
  const hotelPrepay = txn({ date: "2026-04-05", originalCurrency: "¥", description: "Demo Ryokan", categoryName: "Travel" });
  const tooEarly = txn({ date: "2026-01-31", originalCurrency: "¥" });
  const czkTwoDaysBefore = txn({ date: "2026-04-07", originalCurrency: "Kč" });
  const usdTour = txn({ date: "2026-08-04", originalCurrency: "$", description: "Demo City Tour" });
  const usdBefore = txn({ date: "2026-07-01", originalCurrency: "$", description: "Demo Gear Shop" });

  const result = resolveTripMembership(
    [hotelPrepay, tooEarly, czkTwoDaysBefore, usdTour, usdBefore],
    [czkTrip, jpyTrip],
    []
  );

  assert.deepEqual(result.get(hotelPrepay.id), { kind: "member", tripId: 2, reason: "pre" });
  assert.deepEqual(result.get(tooEarly.id), { kind: "none", manualNoTrip: false });
  assert.deepEqual(result.get(czkTwoDaysBefore.id), { kind: "member", tripId: 1, reason: "pre" });
  assert.deepEqual(result.get(usdTour.id), { kind: "member", tripId: 2, reason: "during" });
  assert.deepEqual(result.get(usdBefore.id), { kind: "none", manualNoTrip: false });
});

test("rule 4: travel categories without a trip go to the queue with ranked suggestions", () => {
  const usdTrip = { id: 30, currency: "USD", startDate: "2026-07-15", endDate: "2026-07-20", status: "confirmed" };
  const flight = txn({ date: "2026-06-20", originalCurrency: "$", description: "Demo Airways", categoryName: "Flights" });
  const insurance = txn({ date: "2026-06-21", originalCurrency: "ILS", description: "Demo Travel Cover", categoryName: "Travel Insurance" });

  const onlyJapan = resolveTripMembership([flight], [jpyTrip], []);
  assert.deepEqual(onlyJapan.get(flight.id), { kind: "queue", cause: "travel-category", suggestedTripIds: [2] });

  const both = resolveTripMembership([flight, insurance], [jpyTrip, usdTrip], []);
  assert.deepEqual(both.get(flight.id), { kind: "queue", cause: "travel-category", suggestedTripIds: [30, 2] });
  assert.deepEqual(both.get(insurance.id), { kind: "queue", cause: "travel-category", suggestedTripIds: [30, 2] });
});

test("rule 1: manual assignments win, null means not a trip, non-confirmed targets are ignored", () => {
  const dismissedTrip = { id: 9, currency: "CZK", startDate: "2026-04-01", endDate: "2026-04-20", status: "dismissed" };
  const localDinner = txn({ date: "2026-04-12", originalCurrency: "ILS", description: "Demo Bistro" });
  const flight = txn({ date: "2026-06-20", originalCurrency: "$", categoryName: "Flights" });
  const pointsAtDismissed = txn({ date: "2026-04-11", originalCurrency: "Kč" });

  const result = resolveTripMembership(
    [localDinner, flight, pointsAtDismissed],
    [czkTrip, jpyTrip, dismissedTrip],
    [
      { transactionId: localDinner.id, tripId: 1 },
      { transactionId: flight.id, tripId: null },
      { transactionId: pointsAtDismissed.id, tripId: 9 },
    ]
  );

  assert.deepEqual(result.get(localDinner.id), { kind: "member", tripId: 1, reason: "manual" });
  assert.deepEqual(result.get(flight.id), { kind: "none", manualNoTrip: true });
  assert.deepEqual(result.get(pointsAtDismissed.id), { kind: "member", tripId: 1, reason: "during" });
});

test("transfers and unconfirmed trips take no part", () => {
  const suggestedTrip = { id: 40, currency: "PLN", startDate: "2026-05-01", endDate: "2026-05-05", status: "suggested" };
  const transfer = txn({ date: "2026-04-11", originalCurrency: "Kč", kind: "transfer" });
  const pln = txn({ date: "2026-05-02", originalCurrency: "zł" });

  const result = resolveTripMembership([transfer, pln], [czkTrip, suggestedTrip], []);

  assert.equal(result.has(transfer.id), false);
  assert.deepEqual(result.get(pln.id), { kind: "none", manualNoTrip: false });
});

test("rule 2 tie-breaks: same currency wins, otherwise the queue", () => {
  const eurA = { id: 10, currency: "EUR", startDate: "2026-06-01", endDate: "2026-06-10", status: "confirmed" };
  const gbpC = { id: 11, currency: "GBP", startDate: "2026-06-08", endDate: "2026-06-15", status: "confirmed" };
  const eurB = { id: 12, currency: "EUR", startDate: "2026-06-05", endDate: "2026-06-12", status: "confirmed" };
  const gbp = txn({ date: "2026-06-09", originalCurrency: "£" });
  const eur = txn({ date: "2026-06-09", originalCurrency: "€" });
  const chf = txn({ date: "2026-06-09", originalCurrency: "CHF" });

  const result = resolveTripMembership([gbp, eur, chf], [eurA, gbpC, eurB], []);

  assert.deepEqual(result.get(gbp.id), { kind: "member", tripId: 11, reason: "during" });
  assert.deepEqual(result.get(eur.id), { kind: "queue", cause: "ambiguous", suggestedTripIds: [12, 10, 11] });
  assert.deepEqual(result.get(chf.id), { kind: "queue", cause: "ambiguous", suggestedTripIds: [11, 12, 10] });
});

test("rule 3 tie-breaks: nearest upcoming start wins, equal starts go to the queue", () => {
  const thbD = { id: 20, currency: "THB", startDate: "2026-12-01", endDate: "2026-12-10", status: "confirmed" };
  const thbE = { id: 21, currency: "THB", startDate: "2027-01-20", endDate: "2027-01-30", status: "confirmed" };
  const thbF = { id: 22, currency: "THB", startDate: "2027-03-01", endDate: "2027-03-05", status: "confirmed" };
  const thbG = { id: 23, currency: "THB", startDate: "2027-03-01", endDate: "2027-03-10", status: "confirmed" };
  const early = txn({ date: "2026-10-01", originalCurrency: "฿" });
  const tied = txn({ date: "2027-02-15", originalCurrency: "฿" });

  const result = resolveTripMembership([early, tied], [thbD, thbE, thbF, thbG], []);

  assert.deepEqual(result.get(early.id), { kind: "member", tripId: 20, reason: "pre" });
  assert.deepEqual(result.get(tied.id), { kind: "queue", cause: "ambiguous", suggestedTripIds: [22, 23] });
});
