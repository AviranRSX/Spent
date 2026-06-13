import assert from "node:assert/strict";
import test from "node:test";

const reviewFilters = await import("../src/lib/transaction-review-filter.ts");
const transactionFilters = await import("../src/lib/transaction-filters.ts");

test("review filter serializes and identifies pending review mode", () => {
  assert.equal(reviewFilters.isPendingReviewFilter("pending"), true);
  assert.equal(reviewFilters.isPendingReviewFilter("all"), false);
  assert.equal(reviewFilters.serializeReviewFilter("pending"), "true");
  assert.equal(reviewFilters.serializeReviewFilter("all"), null);
});

test("transaction category options exclude transfer categories", () => {
  const categories = [
    {
      id: 1,
      parentId: null,
      name: "Salary",
      color: "#111111",
      icon: null,
      kind: "income",
      budgetMode: "tracking",
      description: null,
    },
    {
      id: 2,
      parentId: null,
      name: "Transfers",
      color: "#222222",
      icon: null,
      kind: "income",
      budgetMode: "tracking",
      description: null,
    },
    {
      id: 3,
      parentId: null,
      name: "Groceries",
      color: "#333333",
      icon: null,
      kind: "expense",
      budgetMode: "budgeted",
      description: null,
    },
    {
      id: 4,
      parentId: null,
      name: "Transfers",
      color: "#444444",
      icon: null,
      kind: "expense",
      budgetMode: "tracking",
      description: null,
    },
  ];

  assert.deepEqual(
    transactionFilters.getTransactionCategoryOptions(categories).map((c) => c.name),
    ["Salary", "Groceries"]
  );
});
