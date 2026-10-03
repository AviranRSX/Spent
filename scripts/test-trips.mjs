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

const {
  selectDetectionCandidates,
  clusterTripCandidates,
  suggestedTripName,
} = await import("../src/lib/trips/detection.ts");

const detectionCandidates = [
  { id: 101, date: "2026-04-01", currency: "CZK" },
  { id: 102, date: "2026-04-02", currency: "CZK" },
  { id: 103, date: "2026-04-03", currency: "CZK" },
  { id: 104, date: "2026-04-10", currency: "CZK" },
  { id: 105, date: "2026-04-12", currency: "CZK" },
  { id: 106, date: "2026-04-15", currency: "CZK" },
  { id: 107, date: "2026-05-01", currency: "CZK" },
  { id: 108, date: "2026-04-02", currency: "PLN" },
  { id: 109, date: "2026-04-03", currency: "PLN" },
];

test("detection splits on gaps over 3 days and needs 3 transactions", () => {
  assert.deepEqual(clusterTripCandidates(detectionCandidates, []), [
    { currency: "CZK", startDate: "2026-04-01", endDate: "2026-04-03", transactionIds: [101, 102, 103] },
    { currency: "CZK", startDate: "2026-04-10", endDate: "2026-04-15", transactionIds: [104, 105, 106] },
  ]);
});

test("detection skips clusters overlapping any same-currency trip, including dismissed ones", () => {
  const existing = [
    { currency: "CZK", startDate: "2026-04-01", endDate: "2026-04-03" },
    { currency: "PLN", startDate: "2026-04-10", endDate: "2026-04-20" },
  ];
  assert.deepEqual(clusterTripCandidates(detectionCandidates, existing), [
    { currency: "CZK", startDate: "2026-04-10", endDate: "2026-04-15", transactionIds: [104, 105, 106] },
  ]);
});

test("detection candidates exclude ILS, online, non-expense, members and manual no-trip rows", () => {
  const rows = [
    { id: 201, date: "2026-04-10", originalCurrency: "Kč", kind: "expense", description: "Demo Kavarna", categoryName: null },
    { id: 202, date: "2026-04-10", originalCurrency: "ILS", kind: "expense", description: "Demo Ride App", categoryName: null },
    { id: 203, date: "2026-04-10", originalCurrency: "$", kind: "expense", description: "SHEIN.COM DEMO", categoryName: null },
    { id: 204, date: "2026-04-10", originalCurrency: "Kč", kind: "income", description: "Demo Refund", categoryName: null },
    { id: 205, date: "2026-04-10", originalCurrency: "Kč", kind: "expense", description: "Demo Member", categoryName: null },
    { id: 206, date: "2026-04-10", originalCurrency: "Kč", kind: "expense", description: "Demo Not Trip", categoryName: null },
    { id: 207, date: "2026-04-11", originalCurrency: "€", kind: "expense", description: "Demo Ambiguous", categoryName: null },
    { id: 208, date: "2026-04-11T21:00:00.000Z", originalCurrency: "Kč", kind: "expense", description: "Demo Late Night", categoryName: null },
  ];
  const memberships = new Map([
    [205, { kind: "member", tripId: 1, reason: "during" }],
    [206, { kind: "none", manualNoTrip: true }],
    [207, { kind: "queue", cause: "ambiguous", suggestedTripIds: [1, 2] }],
  ]);
  assert.deepEqual(selectDetectionCandidates(rows, memberships), [
    { id: 201, date: "2026-04-10", currency: "CZK" },
    { id: 207, date: "2026-04-11", currency: "EUR" },
    { id: 208, date: "2026-04-11", currency: "CZK" },
  ]);
});

test("suggested trip names use the country, falling back to the currency", () => {
  assert.deepEqual(suggestedTripName({ currency: "CZK", startDate: "2026-04-10" }), {
    name: "Czechia Apr 2026",
    country: "Czechia",
  });
  assert.deepEqual(suggestedTripName({ currency: "EUR", startDate: "2026-06-01" }), {
    name: "EUR Jun 2026",
    country: "",
  });
});

test("categorization prompts tell the AI to categorize spending abroad by what it is", async () => {
  const { buildCategorizationPrompt } = await import("../src/server/ai/prompts.ts");
  for (const allowProposals of [false, true]) {
    const prompt = buildCategorizationPrompt(
      [{ description: "Demo Kavarna", amount: -120, currency: "CZK" }],
      [{ name: "Restaurants", description: "Restaurants", parentName: "Food" }],
      allowProposals
    );
    assert.match(
      prompt,
      /Spending abroad is categorized by what it is \(Restaurants, Groceries, Transport, Shopping\)\. Use Travel only for lodging, tours and rentals\./
    );
  }
});

const { summarizeTrip, tripPhase } = await import("../src/lib/trips/summary.ts");
const {
  parseTripInput,
  parseTripPatch,
  parseTransactionIds,
  parseAssignmentBody,
} = await import("../src/lib/trips/validation.ts");

function member(id, date, chargedAmount, status, category) {
  return {
    id,
    date,
    chargedAmount,
    status,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
    categoryColor: category?.color ?? null,
    parentName: category?.parentName ?? null,
    parentColor: category?.parentColor ?? null,
  };
}

const travelCat = { id: 5, name: "Travel", color: "#64B8D2", parentName: "Trips & Travel", parentColor: "#4FA3A5" };
const restaurantsCat = { id: 2, name: "Restaurants", color: "#E89B80", parentName: "Food", parentColor: "#E7A875" };
const groceriesCat = { id: 1, name: "Groceries", color: "#81B482", parentName: "Food", parentColor: "#E7A875" };

test("summarizeTrip counts completed members, splits before and during, and builds a daily series", () => {
  const totals = summarizeTrip({ startDate: "2026-04-10", endDate: "2026-04-15" }, [
    member(1, "2026-02-01", -900, "completed", travelCat),
    member(2, "2026-04-10", -200, "completed", restaurantsCat),
    member(3, "2026-04-10", -100, "completed", groceriesCat),
    member(4, "2026-04-12", -300, "completed", restaurantsCat),
    member(5, "2026-04-12", 50, "completed", restaurantsCat),
    member(6, "2026-04-13", -400, "pending", restaurantsCat),
    member(7, "2026-04-16T09:00:00.000Z", -60, "completed", null),
  ]);

  assert.equal(totals.total, 1510);
  assert.equal(totals.days, 6);
  assert.equal(totals.perDay, 251.67);
  assert.equal(totals.before, 900);
  assert.equal(totals.during, 610);
  assert.equal(totals.memberCount, 7);
  assert.equal(totals.pendingCount, 1);
  assert.deepEqual(
    totals.breakdown.map((s) => [s.name, s.amount, s.share, s.count, s.parentColor]),
    [
      ["Travel", 900, 0.596, 1, "#4FA3A5"],
      ["Restaurants", 450, 0.298, 3, "#E7A875"],
      ["Groceries", 100, 0.0662, 1, "#E7A875"],
      [null, 60, 0.0397, 1, null],
    ]
  );
  assert.deepEqual(totals.daily, [
    { date: "2026-04-10", amount: 300 },
    { date: "2026-04-11", amount: 0 },
    { date: "2026-04-12", amount: 250 },
    { date: "2026-04-13", amount: 0 },
    { date: "2026-04-14", amount: 0 },
    { date: "2026-04-15", amount: 0 },
    { date: "2026-04-16", amount: 60 },
  ]);
  assert.equal(tripPhase("2026-04-09", "2026-04-10"), "before");
  assert.equal(tripPhase("2026-04-10T00:00:00.000Z", "2026-04-10"), "during");
});

test("summarizeTrip stays finite when everything is pending or refunded", () => {
  const pendingOnly = summarizeTrip({ startDate: "2026-05-01", endDate: "2026-05-02" }, [
    member(1, "2026-05-01", -100, "pending", restaurantsCat),
  ]);
  assert.equal(pendingOnly.total, 0);
  assert.equal(pendingOnly.perDay, 0);
  assert.deepEqual(pendingOnly.breakdown, []);
  assert.deepEqual(pendingOnly.daily, [
    { date: "2026-05-01", amount: 0 },
    { date: "2026-05-02", amount: 0 },
  ]);

  const refundOnly = summarizeTrip({ startDate: "2026-05-01", endDate: "2026-05-01" }, [
    member(2, "2026-05-01", 50, "completed", restaurantsCat),
  ]);
  assert.equal(refundOnly.total, -50);
  assert.equal(refundOnly.perDay, -50);
  assert.equal(refundOnly.breakdown[0].share, 0);
  assert.equal(Number.isFinite(refundOnly.perDay), true);
});

test("parseTripInput normalizes input and reports the first problem", () => {
  assert.deepEqual(
    parseTripInput({ name: " Prague ", country: "Czechia", currency: "Kč", startDate: "2026-04-10", endDate: "2026-04-15" }),
    {
      ok: true,
      value: {
        input: { name: "Prague", country: "Czechia", currency: "CZK", startDate: "2026-04-10", endDate: "2026-04-15" },
        status: "confirmed",
      },
    }
  );
  assert.deepEqual(
    parseTripInput({ name: "Weekend", country: "", currency: "ILS", startDate: "2026-05-01", endDate: "2026-05-02" }).value.input.country,
    null
  );
  assert.deepEqual(parseTripInput(null), { ok: false, error: "invalidBody" });
  assert.deepEqual(parseTripInput({ name: " ", currency: "CZK", startDate: "2026-04-10", endDate: "2026-04-15" }), { ok: false, error: "nameRequired" });
  assert.deepEqual(parseTripInput({ name: "x".repeat(81), currency: "CZK", startDate: "2026-04-10", endDate: "2026-04-15" }), { ok: false, error: "nameTooLong" });
  assert.deepEqual(parseTripInput({ name: "Trip", currency: "€uro", startDate: "2026-04-10", endDate: "2026-04-15" }), { ok: false, error: "currencyInvalid" });
  assert.deepEqual(parseTripInput({ name: "Trip", currency: "CZK", startDate: "2026-02-30", endDate: "2026-04-15" }), { ok: false, error: "dateInvalid" });
  assert.deepEqual(parseTripInput({ name: "Trip", currency: "CZK", startDate: "2026-04-15", endDate: "2026-04-10" }), { ok: false, error: "dateOrder" });
  assert.deepEqual(parseTripInput({ name: "Trip", currency: "CZK", startDate: "2026-04-10", endDate: "2026-04-15", status: "bogus" }), { ok: false, error: "statusInvalid" });
});

test("parseTripPatch validates partial edits against the stored dates", () => {
  const current = { startDate: "2026-04-10", endDate: "2026-04-15" };
  assert.deepEqual(parseTripPatch({ endDate: "2026-04-01" }, current), { ok: false, error: "dateOrder" });
  assert.deepEqual(parseTripPatch({ startDate: "2026-04-20" }, current), { ok: false, error: "dateOrder" });
  assert.deepEqual(parseTripPatch({ startDate: "2026-04-10T00:00:00.000Z" }, current), { ok: false, error: "dateInvalid" });
  assert.deepEqual(parseTripPatch({ status: "dismissed" }, current), { ok: true, value: { status: "dismissed" } });
  assert.deepEqual(parseTripPatch({ currency: "¥", country: " " }, current), { ok: true, value: { currency: "JPY", country: null } });
  assert.deepEqual(parseTripPatch({}, current), { ok: false, error: "empty" });
});

test("assignment bodies accept positive integer ids and a trip id or null", () => {
  assert.deepEqual(parseTransactionIds([3, 1, 3]), [3, 1]);
  assert.equal(parseTransactionIds([]), null);
  assert.equal(parseTransactionIds([1, "2"]), null);
  assert.equal(parseTransactionIds([0]), null);
  assert.equal(parseTransactionIds(Array.from({ length: 1001 }, (_, i) => i + 1)), null);
  assert.deepEqual(parseAssignmentBody({ transactionIds: [1, 2], tripId: 7 }), { transactionIds: [1, 2], tripId: 7 });
  assert.deepEqual(parseAssignmentBody({ transactionIds: [1], tripId: null }), { transactionIds: [1], tripId: null });
  assert.equal(parseAssignmentBody({ transactionIds: [1] }), null);
  assert.equal(parseAssignmentBody({ transactionIds: [1], tripId: -2 }), null);
});

const transfersCat = { id: 9, name: "Transfers", color: "#999999", parentName: "Money Movement", parentColor: "#888888" };

test("summarizeTrip lists Transfers members but leaves them out of every figure", () => {
  // Same rule as Home: a row categorized Transfers is money movement, not trip spend.
  const totals = summarizeTrip({ startDate: "2026-07-01", endDate: "2026-07-02" }, [
    member(1, "2026-07-01", -100, "completed", restaurantsCat),
    member(2, "2026-07-01", -500, "completed", transfersCat),
    member(3, "2026-06-01", -300, "completed", transfersCat),
  ]);
  assert.equal(totals.total, 100);
  assert.equal(totals.perDay, 50);
  assert.equal(totals.before, 0);
  assert.equal(totals.during, 100);
  assert.equal(totals.memberCount, 3);
  assert.equal(totals.pendingCount, 0);
  assert.deepEqual(totals.breakdown.map((s) => [s.name, s.amount, s.share]), [["Restaurants", 100, 1]]);
  assert.deepEqual(totals.daily, [
    { date: "2026-07-01", amount: 100 },
    { date: "2026-07-02", amount: 0 },
  ]);
});
