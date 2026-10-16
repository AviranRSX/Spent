import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createTempDataDir,
  registerSrcAliases,
  seedSyntheticWorkspace,
} from "./phone-sync-test-helpers.mjs";

registerSrcAliases();
const dataDir = createTempDataDir("spent-phone-handlers-");

test.after(() => {
  globalThis._db?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const { createSqlJsDatabase } = await import("../src/mobile/db/sqljs-adapter.ts");
const { getDb } = await import("../src/server/db/index.ts");
const home = await import("../src/server/api-handlers/home.ts");
const summary = await import("../src/server/api-handlers/summary.ts");
const transactions = await import("../src/server/api-handlers/transactions.ts");
const categories = await import("../src/server/api-handlers/categories.ts");
const trips = await import("../src/server/api-handlers/trips.ts");
const workspaces = await import("../src/server/api-handlers/workspaces.ts");
const integrations = await import("../src/server/api-handlers/integrations.ts");

const native = getDb();
const { workspaceId, transactionIds } = await seedSyntheticWorkspace(native);

const fixedNow = new Date();
const pad = (n) => String(n).padStart(2, "0");
const today = `${fixedNow.getFullYear()}-${pad(fixedNow.getMonth() + 1)}-${pad(fixedNow.getDate())}`;
const monthKey = today.slice(0, 7);
const from = `${monthKey}-01`;
const wideFrom = "2000-01-01";
const range = `from=${wideFrom}&to=${today}`;

function ctx(query = "", params = {}) {
  return {
    workspaceId,
    query: new URLSearchParams(query),
    params,
    now: fixedNow,
    nextScheduledSync: null,
  };
}

const firstCategory = categories.getCategoriesHandler(ctx()).body[0];
const firstTrip = Object.values(trips.getTripsHandler(ctx()).body)
  .flat()
  .find((t) => t && typeof t === "object" && t.id);
const idQuery = Object.values(transactionIds)
  .slice(0, 5)
  .map((i) => `ids=${i}`)
  .join("&");

// One entry per in-scope GET: [name, route url (with query), params, handler].
const CASES = [
  ["home", `/api/home?month=${monthKey}`, {}, (c) => home.getHomeHandler(c)],
  ["home bad month", "/api/home?month=2026-13", {}, (c) => home.getHomeHandler(c)],
  ["summary", `/api/summary?from=${from}&to=${today}&months=6`, {}, (c) => summary.getSummaryHandler(c)],
  ["summary card", `/api/summary?${range}&sourceType=card`, {}, (c) => summary.getSummaryHandler(c)],
  ["transactions", `/api/transactions?${range}&limit=20&sort=date&order=desc`, {}, (c) => transactions.getTransactionsHandler(c)],
  ["transactions review", "/api/transactions?needsReview=true", {}, (c) => transactions.getTransactionsHandler(c)],
  ["transactions summary", `/api/transactions/summary?${range}`, {}, (c) => transactions.getTransactionsSummaryHandler(c)],
  ["transactions summary 400", "/api/transactions/summary", {}, (c) => transactions.getTransactionsSummaryHandler(c)],
  ["account numbers", `/api/transactions/account-numbers?${range}`, {}, (c) => transactions.getAccountNumbersHandler(c)],
  ["categories", "/api/categories", {}, (c) => categories.getCategoriesHandler(c)],
  ["categories leaves", "/api/categories?kind=expense&leavesOnly=1", {}, (c) => categories.getCategoriesHandler(c)],
  ["category detail", `/api/categories/${firstCategory.id}/detail?${range}`, { id: String(firstCategory.id) }, (c) => categories.getCategoryDetailHandler(c)],
  ["category detail 400", "/api/categories/abc/detail", { id: "abc" }, (c) => categories.getCategoryDetailHandler(c)],
  ["category detail 404", "/api/categories/99999/detail", { id: "99999" }, (c) => categories.getCategoryDetailHandler(c)],
  ["trips", "/api/trips", {}, (c) => trips.getTripsHandler(c)],
  ["trip detail", `/api/trips/${firstTrip.id}`, { id: String(firstTrip.id) }, (c) => trips.getTripDetailHandler(c)],
  ["trip detail 400", "/api/trips/abc", { id: "abc" }, (c) => trips.getTripDetailHandler(c)],
  ["trip detail 404", "/api/trips/99999", { id: "99999" }, (c) => trips.getTripDetailHandler(c)],
  ["needs trip", "/api/trips/needs-trip", {}, (c) => trips.getNeedsTripHandler(c)],
  ["memberships", `/api/trips/memberships?${idQuery}`, {}, (c) => trips.getTripMembershipsHandler(c)],
  ["memberships empty", "/api/trips/memberships", {}, (c) => trips.getTripMembershipsHandler(c)],
  ["workspaces", "/api/workspaces", {}, (c) => workspaces.listWorkspacesHandler(c)],
  ["integrations", "/api/integrations", {}, (c) => integrations.listIntegrationsHandler(c)],
];

const ROUTES = {
  home: () => import("../src/app/api/home/route.ts"),
  summary: () => import("../src/app/api/summary/route.ts"),
  transactions: () => import("../src/app/api/transactions/route.ts"),
  "transactions/summary": () => import("../src/app/api/transactions/summary/route.ts"),
  "transactions/account-numbers": () =>
    import("../src/app/api/transactions/account-numbers/route.ts"),
  categories: () => import("../src/app/api/categories/route.ts"),
  "categories/detail": () => import("../src/app/api/categories/[id]/detail/route.ts"),
  trips: () => import("../src/app/api/trips/route.ts"),
  "trips/id": () => import("../src/app/api/trips/[id]/route.ts"),
  "trips/needs-trip": () => import("../src/app/api/trips/needs-trip/route.ts"),
  "trips/memberships": () => import("../src/app/api/trips/memberships/route.ts"),
  workspaces: () => import("../src/app/api/workspaces/route.ts"),
  integrations: () => import("../src/app/api/integrations/route.ts"),
};

function routeKey(url) {
  const p = new URL(`http://x${url}`).pathname.replace(/^\/api\//, "");
  if (/^categories\/[^/]+\/detail$/.test(p)) return "categories/detail";
  if (/^trips\/(?!needs-trip$|memberships$)[^/]+$/.test(p)) return "trips/id";
  return p;
}

test("home handler matches route output", () => {
  const res = home.getHomeHandler(ctx(`month=${monthKey}`));
  assert.equal(res.status, 200);
  for (const key of [
    "kpis",
    "budgetPace",
    "categoryBreakdown",
    "historicalTrend",
    "recentTransactions",
    "spendingStats",
    "needsAttention",
    "bankHealth",
  ]) {
    assert.ok(key in res.body, key);
  }
  assert.equal(res.body.nextScheduledSync, null);
});

test("home handler rejects bad month", () => {
  const res = home.getHomeHandler(ctx("month=2026-13"));
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test("handlers run on sql.js", async () => {
  const nativeResults = CASES.map(([, url, params, run]) =>
    run(ctx(new URL(`http://x${url}`).search.slice(1), params))
  );
  assert.ok(nativeResults[4].body.transactions.length > 5);
  assert.ok(nativeResults[0].body.kpis);

  const file = path.join(dataDir, "copy.db");
  native.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  const phone = await createSqlJsDatabase(new Uint8Array(readFileSync(file)));

  const original = globalThis._db;
  globalThis._db = phone;
  let phoneResults;
  try {
    phoneResults = CASES.map(([, url, params, run]) =>
      run(ctx(new URL(`http://x${url}`).search.slice(1), params))
    );
  } finally {
    globalThis._db = original;
  }

  CASES.forEach(([name], i) => {
    assert.equal(phoneResults[i].status, nativeResults[i].status, name);
    assert.deepEqual(phoneResults[i].body, nativeResults[i].body, name);
  });
});

test("route GET exports return the handler body", async () => {
  for (const [name, url, params, run] of CASES) {
    const mod = await ROUTES[routeKey(url)]();
    const request = new Request(`http://localhost${url}`, {
      headers: { "x-workspace-id": String(workspaceId) },
    });
    const res = await (params && Object.keys(params).length > 0
      ? mod.GET(request, { params: Promise.resolve(params) })
      : mod.GET(request));
    const expected = run(ctx(new URL(`http://x${url}`).search.slice(1), params));
    assert.equal(res.status, expected.status, name);
    const body = await res.json();
    // Home carries a clock-derived nextScheduledSync from the desktop scheduler.
    const normalize = (b) =>
      name.startsWith("home") && b && "nextScheduledSync" in b
        ? { ...b, nextScheduledSync: null }
        : b;
    assert.deepEqual(
      normalize(body),
      normalize(JSON.parse(JSON.stringify(expected.body))),
      name
    );
  }
});
