import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
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

const tmpRoot = path.join(process.cwd(), ".tmp-tests");
mkdirSync(tmpRoot, { recursive: true });
const dataDir = mkdtempSync(path.join(tmpRoot, "spent-home-cash-flow-"));
process.env.SPENT_DATA_DIR = dataDir;

test.after(() => {
  globalThis._db?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

import {
  buildCashFlowAverages,
  buildCategoryMonthlyMeans,
  buildMonthlyCashFlowTrend,
  getLastCompleteMonthEnd,
  HOME_CASH_FLOW_SOURCE_TYPE,
  HOME_CATEGORY_SOURCE_TYPE,
} from "../src/server/lib/home-analytics.ts";

test("home cash flow and category means both use all sources", () => {
  assert.equal(HOME_CASH_FLOW_SOURCE_TYPE, "all");
  assert.equal(HOME_CATEGORY_SOURCE_TYPE, "all");
});

test("home cash flow counts card purchases as expenses and skips the bank card-bill transfer", async () => {
  const { getDb } = await import("../src/server/db/index.ts");
  const { getCashFlow } = await import("../src/server/db/queries/home.ts");
  const db = getDb();
  const syncRunId = db
    .prepare(
      `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
       VALUES (1, 'test', '2026-07-01', 'completed', '2026-07-01')`
    )
    .run().lastInsertRowid;
  const insert = db.prepare(
    `INSERT INTO transactions
       (workspace_id, account_number, date, processed_date, original_amount,
        original_currency, charged_amount, description, type, status,
        provider, sync_run_id, dedup_hash, kind)
     VALUES (1, 'acct', ?, ?, ?, 'ILS', ?, ?, 'normal', 'completed', ?, ?, ?, ?)`
  );
  const rows = [
    ["2026-07-10", 10000, "Salary", "hapoalim_bank_account", "income"],
    ["2026-07-11", -3000, "Rent", "hapoalim_bank_account", "expense"],
    ["2026-07-12", -2000, "ISRACARD", "hapoalim_bank_account", "transfer"],
    ["2026-07-05", -1200, "Supermarket", "isracard_bill", "expense"],
    ["2026-07-06", -800, "Restaurant", "isracard_bill", "expense"],
  ];
  rows.forEach(([date, amount, description, provider, kind], index) => {
    insert.run(date, date, amount, amount, description, provider, syncRunId, `h${index}`, kind);
  });

  const cashFlow = getCashFlow(1, "2026-07-01", "2026-07-31");

  assert.deepEqual(cashFlow, { income: 10000, expenses: 5000, net: 5000 });
});

test("home spending stats end at the previous complete month", () => {
  const mayEnd = getLastCompleteMonthEnd(new Date(2026, 5, 13));
  assert.deepEqual(
    [mayEnd.getFullYear(), mayEnd.getMonth(), mayEnd.getDate()],
    [2026, 4, 31]
  );

  const decemberEnd = getLastCompleteMonthEnd(new Date(2026, 0, 3));
  assert.deepEqual(
    [
      decemberEnd.getFullYear(),
      decemberEnd.getMonth(),
      decemberEnd.getDate(),
    ],
    [2025, 11, 31]
  );
});

test("home cash-flow trend fills each month and flags current and selected", () => {
  const trend = buildMonthlyCashFlowTrend(
    [
      { key: "2026-01", isCurrent: false, isSelected: true },
      { key: "2026-02", isCurrent: true, isSelected: false },
    ],
    [
      { month: "2026-01", kind: "income", total: 10000 },
      { month: "2026-01", kind: "expense", total: 6500 },
      { month: "2026-02", kind: "expense", total: 1200 },
    ]
  );

  assert.deepEqual(trend, [
    { month: "2026-01", income: 10000, expenses: 6500, net: 3500, isCurrent: false, isSelected: true },
    { month: "2026-02", income: 0, expenses: 1200, net: -1200, isCurrent: true, isSelected: false },
  ]);
});

test("home category means average over the requested month window", () => {
  const means = buildCategoryMonthlyMeans(
    [
      {
        categoryId: 10,
        name: "Groceries",
        color: "#8FBC8A",
        amount: 3000,
      },
      {
        categoryId: 20,
        name: "Restaurants",
        color: "#E29C71",
        amount: 1500,
      },
    ],
    6,
    6
  );

  assert.deepEqual(means, [
    {
      categoryId: 10,
      name: "Groceries",
      color: "#8FBC8A",
      monthlyMean: 500,
    },
    {
      categoryId: 20,
      name: "Restaurants",
      color: "#E29C71",
      monthlyMean: 250,
    },
  ]);
});

test("home cash-flow averages compute income expenses and net saving", () => {
  const averages = buildCashFlowAverages(
    [
      { month: "2026-01", kind: "income", total: 10000 },
      { month: "2026-01", kind: "expense", total: 6500 },
      { month: "2026-02", kind: "income", total: 8000 },
      { month: "2026-02", kind: "expense", total: 9000 },
    ],
    6
  );

  assert.equal(averages.meanIncome, 3000);
  assert.equal(averages.meanExpense, 2583.3333333333335);
  assert.equal(Math.round(averages.meanNet * 100), 41667);
});

const FIXTURE_NOW = new Date(2026, 9, 3, 12, 0, 0);

test("home month parsing defaults to the current month and rejects bad or future months", async () => {
  const { parseHomeMonth } = await import("../src/lib/home-month.ts");

  const current = parseHomeMonth(null, FIXTURE_NOW);
  assert.equal(current.ok, true);
  assert.deepEqual(current.month, {
    key: "2026-10",
    year: 2026,
    monthIndex: 9,
    from: "2026-10-01",
    to: "2026-10-31",
    daysInMonth: 31,
    isCurrent: true,
    elapsedDays: 3,
  });

  const february = parseHomeMonth("2026-02", FIXTURE_NOW);
  assert.equal(february.ok, true);
  assert.equal(february.month.to, "2026-02-28");
  assert.equal(february.month.isCurrent, false);
  assert.equal(february.month.elapsedDays, 28);

  for (const raw of ["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", "abc"]) {
    assert.deepEqual(parseHomeMonth(raw, FIXTURE_NOW), { ok: false, error: "invalid_month" }, raw);
  }
  assert.deepEqual(parseHomeMonth("2026-11", FIXTURE_NOW), { ok: false, error: "future_month" });
  assert.deepEqual(parseHomeMonth("2027-01", FIXTURE_NOW), { ok: false, error: "future_month" });
});

test("home month helpers resolve URLs and shift months across years", async () => {
  const m = await import("../src/lib/home-month.ts");

  assert.equal(m.resolveHomeMonthKey("2027-01", FIXTURE_NOW), "2026-10");
  assert.equal(m.resolveHomeMonthKey("garbage", FIXTURE_NOW), "2026-10");
  assert.equal(m.resolveHomeMonthKey(null, FIXTURE_NOW), "2026-10");
  assert.equal(m.resolveHomeMonthKey("2026-05", FIXTURE_NOW), "2026-05");
  assert.equal(m.homeHrefForMonth("2026-10", FIXTURE_NOW), "/");
  assert.equal(m.homeHrefForMonth("2026-08", FIXTURE_NOW), "/?month=2026-08");
  assert.equal(m.shiftMonthKey("2026-01", -1), "2025-12");
  assert.equal(m.shiftMonthKey("2025-12", 1), "2026-01");
  assert.deepEqual(m.trendMonthKeys("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
  assert.equal(m.trendMonthKeys("2026-10", 12)[0], "2025-11");
  const feb = m.monthKeyToDate("2026-02");
  assert.deepEqual([feb.getFullYear(), feb.getMonth(), feb.getDate()], [2026, 1, 1]);
});

test("previous-month comparison uses the same days for the current month and clamps short months", async () => {
  const { buildHomeMonthRange, previousComparisonRange } = await import("../src/lib/home-month.ts");

  assert.deepEqual(previousComparisonRange(buildHomeMonthRange("2026-10", FIXTURE_NOW)), {
    from: "2026-09-01",
    to: "2026-09-03",
  });
  const marchThirtyFirst = new Date(2026, 2, 31, 9, 0, 0);
  assert.deepEqual(previousComparisonRange(buildHomeMonthRange("2026-03", marchThirtyFirst)), {
    from: "2026-02-01",
    to: "2026-02-28",
  });
  assert.deepEqual(previousComparisonRange(buildHomeMonthRange("2026-08", FIXTURE_NOW)), {
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.deepEqual(previousComparisonRange(buildHomeMonthRange("2026-01", FIXTURE_NOW)), {
    from: "2025-12-01",
    to: "2025-12-31",
  });
});

test("average window covers up to six completed months before the selected month", async () => {
  const { buildHomeMonthRange, getAverageWindow } = await import("../src/lib/home-month.ts");
  const october = buildHomeMonthRange("2026-10", FIXTURE_NOW);

  assert.deepEqual(getAverageWindow(october, "2026-06"), {
    from: "2026-06-01",
    to: "2026-09-30",
    months: ["2026-06", "2026-07", "2026-08", "2026-09"],
  });
  assert.deepEqual(getAverageWindow(october, "2020-01"), {
    from: "2026-04-01",
    to: "2026-09-30",
    months: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
  });
  assert.equal(getAverageWindow(october, null), null);
  assert.equal(getAverageWindow(october, "2026-10"), null);
  assert.deepEqual(getAverageWindow(buildHomeMonthRange("2026-01", FIXTURE_NOW), "2025-01"), {
    from: "2025-07-01",
    to: "2025-12-31",
    months: ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"],
  });
});

test("KPI figures report savings rate as n/a when income is zero", async () => {
  const { buildHomeKpis, toKpiFigures } = await import("../src/lib/home-kpis.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  assert.deepEqual(toKpiFigures(0, 500), { income: 0, expenses: 500, net: -500, savingsRate: null });
  assert.deepEqual(toKpiFigures(10000, 12000), { income: 10000, expenses: 12000, net: -2000, savingsRate: -0.2 });

  const kpis = buildHomeKpis(
    buildHomeMonthRange("2026-08", FIXTURE_NOW),
    { income: 12000, expenses: 6000 },
    { income: 0, expenses: 0 },
    null
  );
  assert.deepEqual(kpis, {
    month: "2026-08",
    income: 12000,
    expenses: 6000,
    net: 6000,
    savingsRate: 0.5,
    prev: { income: 0, expenses: 0, net: 0, savingsRate: null },
    avg6: null,
    isCurrentMonth: false,
    dayOfMonth: 31,
    daysInMonth: 31,
  });
});

test("KPI deltas use percent, shekels and points with the right direction", async () => {
  const { computeKpiDelta, toKpiFigures } = await import("../src/lib/home-kpis.ts");
  const current = toKpiFigures(10000, 6000);
  const prev = toKpiFigures(8000, 5000);

  assert.deepEqual(computeKpiDelta("income", current, prev), { unit: "percent", value: 25, favorable: true });
  assert.deepEqual(computeKpiDelta("expenses", current, prev), { unit: "percent", value: 20, favorable: false });
  assert.deepEqual(computeKpiDelta("net", current, prev), { unit: "currency", value: 1000, favorable: true });
  const rate = computeKpiDelta("savingsRate", current, prev);
  assert.equal(rate.unit, "points");
  assert.equal(Math.round(rate.value * 10) / 10, 2.5);
  assert.equal(rate.favorable, true);

  const empty = toKpiFigures(0, 0);
  for (const key of ["income", "expenses", "net", "savingsRate"]) {
    assert.equal(computeKpiDelta(key, current, empty), null, key);
  }

  const noPrevIncome = toKpiFigures(0, 4000);
  assert.equal(computeKpiDelta("income", current, noPrevIncome), null);
  assert.equal(computeKpiDelta("savingsRate", current, noPrevIncome), null);
  assert.deepEqual(computeKpiDelta("expenses", current, noPrevIncome), { unit: "percent", value: 50, favorable: false });

  assert.equal(computeKpiDelta("net", toKpiFigures(1000, 500.2), toKpiFigures(1000, 500)).favorable, null);
});

test("formatters render month keys and compact or signed money", async () => {
  const f = await import("../src/lib/formatters.ts");

  assert.equal(f.formatMonthKey("2026-10", "en", "short"), "Oct 2026");
  assert.equal(f.formatMonthKey("2026-01", "en", "long", false), "January");
  assert.equal(f.formatWholeCurrency(12345.6, "en"), "₪12,346");
  assert.equal(f.formatCompactCurrency(12500, "en"), "₪12.5K");
  assert.equal(f.formatCompactCurrency(-3000, "en"), "−₪3K");
  assert.equal(f.formatSignedNumber(3.2), "+3");
  assert.equal(f.formatSignedPercent(12.4), "+12%");
  assert.equal(f.formatSignedPercent(-7.6), "−8%");
  assert.equal(f.formatSignedPercent(-0.4), "0%");
  assert.equal(f.formatSignedCurrency(-1200.4, "en"), "−₪1,200");
  assert.equal(f.formatSignedCurrency(0.3, "en"), "₪0");
});

test("home and transactions messages have matching keys in English and Hebrew", () => {
  const read = (locale) =>
    JSON.parse(
      readFileSync(path.join(process.cwd(), "src", "i18n", "messages", `${locale}.json`), "utf8")
    );
  const en = read("en");
  const he = read("he");
  for (const namespace of ["home", "transactions"]) {
    assert.deepEqual(Object.keys(he[namespace]).sort(), Object.keys(en[namespace]).sort(), namespace);
  }
  const homeText = JSON.stringify(en.home) + JSON.stringify(he.home);
  const emDash = String.fromCharCode(0x2014);
  assert.equal(homeText.includes(emDash), false, "no em dashes in home messages");
});

// Workspace 2: invented household with history from June 2026.
// Monthly expenses: Jun 4000, Jul 5000, Aug 6000, Sep 5000 (300 of it on
// Sep 2), Oct 600 so far. Income: 10000, 10000, 12000, 8000, 9000.
let homeFixturePromise;
function getHomeFixture() {
  homeFixturePromise ??= seedHomeFixture();
  return homeFixturePromise;
}

async function seedHomeFixture() {
  const { getDb } = await import("../src/server/db/index.ts");
  const db = getDb();
  const workspaceId = 2;
  db.prepare(
    `INSERT INTO workspaces (id, name, slug) VALUES (?, 'Home fixture', 'home-fixture')`
  ).run(workspaceId);
  const syncRunId = db
    .prepare(
      `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
       VALUES (?, 'test', '2026-06-01', 'completed', '2026-06-01')`
    )
    .run(workspaceId).lastInsertRowid;

  const addCategory = (name, { parentId = null, kind = "expense", color }) =>
    Number(
      db
        .prepare(
          `INSERT INTO categories (workspace_id, parent_id, name, color, kind)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(workspaceId, parentId, name, color, kind).lastInsertRowid
    );
  const food = addCategory("Food", { color: "#E7A875" });
  const groceries = addCategory("Groceries", { parentId: food, color: "#8FBC8A" });
  const restaurants = addCategory("Restaurants", { parentId: food, color: "#E29C71" });
  const utilities = addCategory("Utilities", { color: "#7D90CA" });
  const transfers = addCategory("Transfers", { color: "#A2ABBB" });
  const salary = addCategory("Salary", { kind: "income", color: "#65C1D1" });

  const insert = db.prepare(
    `INSERT INTO transactions
       (workspace_id, account_number, date, processed_date, original_amount,
        original_currency, charged_amount, description, type, status,
        provider, sync_run_id, dedup_hash, kind, category_id)
     VALUES (?, 'acct', ?, ?, ?, 'ILS', ?, 'Synthetic row', 'normal', ?, ?, ?, ?, ?, ?)`
  );
  let rowIndex = 0;
  const add = (date, amount, kind, categoryId, options = {}) => {
    const provider =
      options.provider ?? (kind === "income" ? "hapoalim_bank_account" : "isracard_bill");
    rowIndex += 1;
    insert.run(
      workspaceId, date, date, amount, amount, options.status ?? "completed",
      provider, syncRunId, `home-fixture-${rowIndex}`, kind, categoryId
    );
  };

  for (const [date, amount] of [
    ["2026-06-01", 10000],
    ["2026-07-01", 10000],
    ["2026-08-01", 12000],
    ["2026-09-01", 8000],
    ["2026-10-01", 9000],
  ]) {
    add(date, amount, "income", salary);
  }
  for (const [date, amount, categoryId] of [
    ["2026-06-12", -2500, groceries],
    ["2026-06-20", -1500, utilities],
    ["2026-07-12", -3000, groceries],
    ["2026-07-14", -1000, restaurants],
    ["2026-07-20", -1000, utilities],
    ["2026-08-12", -3500, groceries],
    ["2026-08-14", -1500, restaurants],
    ["2026-08-20", -1000, utilities],
    ["2026-09-02", -300, groceries],
    ["2026-09-10", -2700, groceries],
    ["2026-09-14", -1000, restaurants],
    ["2026-09-20", -1000, utilities],
    ["2026-10-02", -250, groceries],
    ["2026-10-02", -150, restaurants],
    ["2026-10-02", -120, utilities],
    ["2026-10-02", -80, null],
  ]) {
    add(date, amount, "expense", categoryId);
  }
  // Rows that must never count: pending, Transfers category, card-bill transfer.
  add("2026-10-02", -999, "expense", groceries, { status: "pending" });
  add("2026-10-02", -500, "expense", transfers);
  add("2026-10-02", -2000, "transfer", null, { provider: "hapoalim_bank_account" });

  db.prepare(
    `INSERT INTO workspace_settings (workspace_id, key, value)
     VALUES (?, 'monthly_target', '8000'), (?, 'payday_day', '10')`
  ).run(workspaceId, workspaceId);

  return {
    workspaceId,
    categories: { food, groceries, restaurants, utilities, transfers, salary },
  };
}

test("home KPIs for the current month compare the same days last month and average completed months only", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getHomeKpis } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  const kpis = getHomeKpis(workspaceId, buildHomeMonthRange("2026-10", FIXTURE_NOW));

  assert.deepEqual(kpis, {
    month: "2026-10",
    income: 9000,
    expenses: 600,
    net: 8400,
    savingsRate: 8400 / 9000,
    prev: { income: 8000, expenses: 300, net: 7700, savingsRate: 7700 / 8000 },
    // June to September only: October is still in progress and May has no data.
    avg6: { income: 10000, expenses: 5000, net: 5000, savingsRate: 0.5, months: 4 },
    isCurrentMonth: true,
    dayOfMonth: 3,
    daysInMonth: 31,
  });
});

test("home KPIs for a past month compare full months and average the months before it", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getHomeKpis } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  const kpis = getHomeKpis(workspaceId, buildHomeMonthRange("2026-08", FIXTURE_NOW));

  assert.deepEqual(kpis, {
    month: "2026-08",
    income: 12000,
    expenses: 6000,
    net: 6000,
    savingsRate: 0.5,
    prev: { income: 10000, expenses: 5000, net: 5000, savingsRate: 0.5 },
    avg6: { income: 10000, expenses: 4500, net: 5500, savingsRate: 5500 / 10000, months: 2 },
    isCurrentMonth: false,
    dayOfMonth: 31,
    daysInMonth: 31,
  });
});

test("home KPIs for a workspace without history have no average and no savings rate", async () => {
  await getHomeFixture();
  const { getHomeKpis } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  const kpis = getHomeKpis(99, buildHomeMonthRange("2026-10", FIXTURE_NOW));

  assert.equal(kpis.avg6, null);
  assert.equal(kpis.savingsRate, null);
  assert.equal(kpis.expenses, 0);
});

test("home cash-flow trend returns 12 months ending at the selected month", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getCashFlowTrend } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  const october = getCashFlowTrend(workspaceId, buildHomeMonthRange("2026-10", FIXTURE_NOW), 12, FIXTURE_NOW);
  assert.equal(october.length, 12);
  assert.deepEqual(october[0], {
    month: "2025-11", income: 0, expenses: 0, net: 0, isCurrent: false, isSelected: false,
  });
  assert.deepEqual(october[10], {
    month: "2026-09", income: 8000, expenses: 5000, net: 3000, isCurrent: false, isSelected: false,
  });
  assert.deepEqual(october[11], {
    month: "2026-10", income: 9000, expenses: 600, net: 8400, isCurrent: true, isSelected: true,
  });

  const august = getCashFlowTrend(workspaceId, buildHomeMonthRange("2026-08", FIXTURE_NOW), 12, FIXTURE_NOW);
  assert.equal(august[11].month, "2026-08");
  assert.equal(august[11].isSelected, true);
  assert.equal(august[11].isCurrent, false);
});

test("budget pace tracks the current month and gives a final view of past months", async () => {
  const { workspaceId } = await getHomeFixture();
  const { getBudgetPace } = await import("../src/server/db/queries/home.ts");
  const { buildHomeMonthRange } = await import("../src/lib/home-month.ts");

  assert.deepEqual(getBudgetPace(workspaceId, buildHomeMonthRange("2026-10", FIXTURE_NOW), FIXTURE_NOW), {
    month: "2026-10",
    spent: 600,
    budget: 8000,
    deltaVsLastMonth: 100,
    daysUntilPayday: 7,
    timeElapsedPercent: (3 / 31) * 100,
    isPast: false,
  });
  assert.deepEqual(getBudgetPace(workspaceId, buildHomeMonthRange("2026-08", FIXTURE_NOW), FIXTURE_NOW), {
    month: "2026-08",
    spent: 6000,
    budget: 8000,
    deltaVsLastMonth: 20,
    daysUntilPayday: null,
    timeElapsedPercent: 100,
    isPast: true,
  });
});
