import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

test("home cash-flow trend fills six months with income and expenses", () => {
  const trend = buildMonthlyCashFlowTrend(
    [
      { key: "2026-01", label: "Jan", isCurrent: false },
      { key: "2026-02", label: "Feb", isCurrent: true },
    ],
    [
      { month: "2026-01", kind: "income", total: 10000 },
      { month: "2026-01", kind: "expense", total: 6500 },
      { month: "2026-02", kind: "expense", total: 1200 },
    ]
  );

  assert.deepEqual(trend, [
    {
      month: "2026-01",
      label: "Jan",
      income: 10000,
      expenses: 6500,
      net: 3500,
      isCurrent: false,
    },
    {
      month: "2026-02",
      label: "Feb",
      income: 0,
      expenses: 1200,
      net: -1200,
      isCurrent: true,
    },
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
