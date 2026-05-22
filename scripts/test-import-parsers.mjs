import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkbookBuffer } from "../src/lib/imports/xlsx-parser.js";

async function readSample(name) {
  const fs = await import("node:fs/promises");
  return fs.readFile(new URL(`../transactions/${name}`, import.meta.url));
}

test("parses Isracard bill rows with negative card charges", async () => {
  const buffer = await readSample("2437_05_2026.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "isracard_bill",
    sourceLabel: "Isracard 2437",
  });

  assert.equal(result.transactions.length > 10, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].date, "2026-04-29");
  assert.equal(result.transactions[0].description, "חממה בעיר רחובות");
  assert.equal(result.transactions[0].chargedAmount, -31.26);
  assert.equal(result.transactions[0].chargedCurrency, "ILS");
  assert.equal(result.transactions[0].identifier, "272019435");
});

test("parses bank account debit and credit signs from Hapoalim export", async () => {
  const buffer = await readSample("excelNewTransactions.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "bank_account",
    sourceLabel: "Hapoalim checking",
  });

  assert.equal(result.transactions.length > 10, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].date, "2026-05-22");
  assert.equal(result.transactions[0].chargedAmount, 40);
  assert.equal(result.transactions[1].chargedAmount, -229);
  assert.match(result.transactions[1].description, /הוראת-קבע/);
});

test("parses credit card export across multiple sheets", async () => {
  const buffer = await readSample("transaction-details_export_1779464233227.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "credit_card_export",
    sourceLabel: "Max card",
  });

  assert.equal(result.transactions.length > 10, true);
  assert.deepEqual(result.errors, []);
  assert.equal(
    result.transactions.some((txn) =>
      txn.description.includes("OPENAI *CHATGPT SUBSCR")
    ),
    true
  );
  const paybox = result.transactions.find((txn) => txn.description === "PAYBOX");
  assert.ok(paybox);
  assert.equal(paybox.chargedAmount, -40);
  assert.equal(paybox.date, "2026-04-13");
  assert.equal(paybox.processedDate, "2026-05-10");
});
