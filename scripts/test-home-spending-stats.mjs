import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSelectableSpendingStats,
  clampStatsMonthCount,
} from "../src/lib/home-spending-stats.ts";

test("clamps selected stats months to at least 3 and available history", () => {
  assert.equal(clampStatsMonthCount(1, 12), 3);
  assert.equal(clampStatsMonthCount(18, 12), 12);
  assert.equal(clampStatsMonthCount(6, 12), 6);
  assert.equal(clampStatsMonthCount(6, 0), 3);
});

test("selectable spending stats use the most recent selected months", () => {
  const stats = buildSelectableSpendingStats(
    {
      availableMonths: 4,
      monthlyCashFlow: [
        { month: "2026-01", income: 9000, expenses: 4500 },
        { month: "2026-02", income: 10000, expenses: 6000 },
        { month: "2026-03", income: 8000, expenses: 7000 },
        { month: "2026-04", income: 12000, expenses: 3000 },
      ],
      categoryMonthlySpend: [
        { month: "2026-01", categoryId: 1, name: "Groceries", color: "#111111", amount: 600 },
        { month: "2026-02", categoryId: 1, name: "Groceries", color: "#111111", amount: 900 },
        { month: "2026-03", categoryId: 1, name: "Groceries", color: "#111111", amount: 1200 },
        { month: "2026-04", categoryId: 1, name: "Groceries", color: "#111111", amount: 1500 },
        { month: "2026-04", categoryId: 2, name: "Restaurants", color: "#222222", amount: 600 },
      ],
    },
    3,
    12
  );

  assert.equal(stats.selectedMonths, 3);
  assert.deepEqual(stats.cashFlowAverages, {
    meanIncome: 10000,
    meanExpense: 5333.333333333333,
    meanNet: 4666.666666666667,
  });
  assert.deepEqual(stats.categoryMeans, [
    {
      categoryId: 1,
      name: "Groceries",
      color: "#111111",
      monthlyMean: 1200,
    },
    {
      categoryId: 2,
      name: "Restaurants",
      color: "#222222",
      monthlyMean: 200,
    },
  ]);
});

test("selectable spending stats include quiet months in the average", () => {
  const stats = buildSelectableSpendingStats(
    {
      availableMonths: 4,
      defaultMonths: 4,
      monthlyCashFlow: [
        { month: "2026-01", income: 9000, expenses: 4500 },
        { month: "2026-02", income: 0, expenses: 0 },
        { month: "2026-03", income: 8000, expenses: 7000 },
        { month: "2026-04", income: 12000, expenses: 3000 },
      ],
      categoryMonthlySpend: [
        {
          month: "2026-03",
          categoryId: 1,
          name: "Groceries",
          color: "#111111",
          amount: 1200,
        },
        {
          month: "2026-04",
          categoryId: 1,
          name: "Groceries",
          color: "#111111",
          amount: 1500,
        },
      ],
    },
    4,
    12
  );

  assert.equal(stats.selectedMonths, 4);
  assert.deepEqual(stats.cashFlowAverages, {
    meanIncome: 7250,
    meanExpense: 3625,
    meanNet: 3625,
  });
  assert.deepEqual(stats.categoryMeans, [
    {
      categoryId: 1,
      name: "Groceries",
      color: "#111111",
      monthlyMean: 675,
    },
  ]);
});
