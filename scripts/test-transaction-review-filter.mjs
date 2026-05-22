import assert from "node:assert/strict";
import test from "node:test";

const reviewFilters = await import("../src/lib/transaction-review-filter.ts");

test("review filter serializes and identifies pending review mode", () => {
  assert.equal(reviewFilters.isPendingReviewFilter("pending"), true);
  assert.equal(reviewFilters.isPendingReviewFilter("all"), false);
  assert.equal(reviewFilters.serializeReviewFilter("pending"), "true");
  assert.equal(reviewFilters.serializeReviewFilter("all"), null);
});
