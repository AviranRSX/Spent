import assert from "node:assert/strict";
import test from "node:test";

const transfers = await import("../src/server/lib/transfers.ts");
const sourceTypes = await import("../src/lib/transaction-source-types.ts");

test("classifies bank account import credits as income", () => {
  assert.equal(
    transfers.detectKind("משכורת · המבצע: דיסקונט", "hapoalim_bank_account", 12697),
    "income"
  );
  assert.equal(
    transfers.detectKind("העברת משכורת", "leumi_bank_account", 21403),
    "income"
  );
});

test("classifies bank account credit card settlements as transfers", () => {
  assert.equal(transfers.detectKind("כאל", "hapoalim_bank_account", -2365.38), "transfer");
  assert.equal(
    transfers.detectKind("ישראכרט בעמ · עבור: מזהה 319403497", "hapoalim_bank_account", -1418.05),
    "transfer"
  );
  assert.equal(
    transfers.detectKind("ל.מאסטרקרד(יש)", "leumi_bank_account", -3618.16),
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

test("proposal prompt matches main classification behavior", async () => {
  const { buildCategorizationPrompt } = await import(
    "../src/server/ai/prompts.ts"
  );

  const prompt = buildCategorizationPrompt(
    [{ description: "Supermarket", amount: -100, currency: "ILS" }],
    [{ name: "Groceries", description: "Food stores" }],
    true
  );

  assert.match(prompt, /When no existing category is a good fit, propose a new one/);
  assert.match(prompt, /If you propose a new category, add "isNew": true/);
  assert.match(prompt, /Don't over-propose/);
});

test("classifies imported card transaction providers as card sources", () => {
  assert.equal(
    sourceTypes.getTransactionSourceType("max_bill"),
    "card"
  );
  assert.equal(sourceTypes.getTransactionSourceType("cal_bill"), "card");
  assert.equal(sourceTypes.getTransactionSourceType("isracard_bill"), "card");
  assert.equal(sourceTypes.getTransactionSourceType("hapoalim_bank_account"), "bank");
  assert.equal(sourceTypes.getTransactionSourceType("leumi_bank_account"), "bank");
});

test("labels imported transaction providers by institution name", () => {
  assert.equal(sourceTypes.getTransactionProviderLabel("isracard_bill"), "Isracard");
  assert.equal(sourceTypes.getTransactionProviderLabel("max_bill"), "Max");
  assert.equal(sourceTypes.getTransactionProviderLabel("cal_bill"), "CAL");
  assert.equal(sourceTypes.getTransactionProviderLabel("hapoalim_bank_account"), "Hapoalim");
  assert.equal(sourceTypes.getTransactionProviderLabel("leumi_bank_account"), "Leumi");
  assert.equal(sourceTypes.getTransactionProviderLabel("hapoalim"), null);
});
