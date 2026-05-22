import assert from "node:assert/strict";
import test from "node:test";

const transfers = await import("../src/server/lib/transfers.ts");
const sourceTypes = await import("../src/lib/transaction-source-types.ts");

test("classifies bank account import credits as income", () => {
  assert.equal(
    transfers.detectKind("משכורת · המבצע: דיסקונט", "bank_account", 12697),
    "income"
  );
});

test("classifies bank account credit card settlements as transfers", () => {
  assert.equal(transfers.detectKind("כאל", "bank_account", -2365.38), "transfer");
  assert.equal(
    transfers.detectKind("ישראכרט בעמ · עבור: מזהה 319403497", "bank_account", -1418.05),
    "transfer"
  );
});

test("parses Ollama JSON object wrappers", async () => {
  const { parseCategorizationResponse } = await import(
    "../src/server/ai/parse-response.ts"
  );
  assert.equal(typeof parseCategorizationResponse, "function");

  assert.deepEqual(
    parseCategorizationResponse(
      JSON.stringify({
        transactions: [
          { index: 0, categoryName: "Groceries", confidence: 6 },
          { index: 1, categoryName: "Pet Supplies", isNew: true, confidence: 4 },
        ],
      }),
      ["Groceries"],
      true
    ),
    [
      {
        index: 0,
        categoryName: "Groceries",
        isNew: false,
        confidence: 6,
      },
      {
        index: 1,
        categoryName: "Pet Supplies",
        isNew: true,
        confidence: 4,
      },
    ]
  );
});

test("parses a single Ollama mapping object", async () => {
  const { parseCategorizationResponse } = await import(
    "../src/server/ai/parse-response.ts"
  );

  assert.deepEqual(
    parseCategorizationResponse(
      JSON.stringify({ index: 0, categoryName: "Groceries", confidence: 6 }),
      ["Groceries"],
      false
    ),
    [
      {
        index: 0,
        categoryName: "Groceries",
        isNew: false,
        confidence: 6,
      },
    ]
  );
});

test("classifies imported card transaction providers as card sources", () => {
  assert.equal(
    sourceTypes.getTransactionSourceType("credit_card_export"),
    "card"
  );
  assert.equal(sourceTypes.getTransactionSourceType("isracard_bill"), "card");
  assert.equal(sourceTypes.getTransactionSourceType("bank_account"), "bank");
});

test("labels imported transaction providers by institution name", () => {
  assert.equal(sourceTypes.getTransactionProviderLabel("isracard_bill"), "Isracard");
  assert.equal(sourceTypes.getTransactionProviderLabel("credit_card_export"), "Max");
  assert.equal(sourceTypes.getTransactionProviderLabel("bank_account"), "Hapoalim");
  assert.equal(sourceTypes.getTransactionProviderLabel("hapoalim"), null);
});
