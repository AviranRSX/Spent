import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCashFlowAverages,
  buildCategoryMonthlyMeans,
  buildMonthlyCashFlowTrend,
  getLastCompleteMonthEnd,
  HOME_CASH_FLOW_SOURCE_TYPE,
  HOME_CATEGORY_SOURCE_TYPE,
} from "../src/server/lib/home-analytics.ts";

test("home cash-flow means use transactions scope while category means use all sources", () => {
  assert.equal(HOME_CASH_FLOW_SOURCE_TYPE, "bank");
  assert.equal(HOME_CATEGORY_SOURCE_TYPE, "all");
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
