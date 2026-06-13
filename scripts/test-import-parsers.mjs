import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkbookBuffer } from "../src/lib/imports/xlsx-parser.js";

async function readSample(name) {
  const fs = await import("node:fs/promises");
  return fs.readFile(new URL(`../transactions/${name}`, import.meta.url));
}

test("parses Isracard bill rows with negative card charges", async () => {
  const buffer = await readSample("isracard_aviran.xlsx");
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
  const buffer = await readSample("hapoalim_bank.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "hapoalim_bank_account",
    sourceLabel: "Hapoalim checking",
  });

  assert.equal(result.transactions.length > 10, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].date, "2026-05-22");
  assert.equal(result.transactions[0].chargedAmount, 40);
  assert.equal(result.transactions[1].chargedAmount, -229);
  assert.match(result.transactions[1].description, /הוראת-קבע/);
});

test("parses Leumi HTML bank account export", async () => {
  const buffer = await readSample("leumi_bank.xls");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "leumi_bank_account",
    sourceLabel: "Leumi checking",
  });

  assert.equal(result.transactions.length > 20, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].accountNumber, "930-114882/60");
  assert.equal(result.transactions[0].date, "2026-05-11");
  assert.equal(result.transactions[0].processedDate, "2026-05-11");
  assert.equal(result.transactions[0].description, "העברה דיגיטל");
  assert.equal(result.transactions[0].chargedAmount, -12500);
  assert.equal(result.transactions[0].identifier, "13636");
  const salary = result.transactions.find(
    (txn) => txn.description === "העברת משכורת" && txn.date === "2026-05-07"
  );
  assert.ok(salary);
  assert.equal(salary.chargedAmount, 21403);
});

test("parses credit card export across multiple sheets", async () => {
  const buffer = await readSample("max_aviran.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "max_bill",
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
  const paybox = result.transactions.find(
    (txn) => txn.description === "PAYBOX" && txn.date === "2026-04-13"
  );
  assert.ok(paybox);
  assert.equal(paybox.chargedAmount, -40);
  assert.equal(paybox.date, "2026-04-13");
  assert.equal(paybox.processedDate, "2026-05-10");
  assert.deepEqual(
    [...new Set(result.transactions.map((txn) => txn.accountNumber))].sort(),
    ["5898", "7918"]
  );
});

test("parses CAL bill rows with bank charge date", async () => {
  const buffer = await readSample("cal_inbar_may.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "cal_bill",
    sourceLabel: "CAL Inbar",
  });

  assert.equal(result.transactions.length, 13);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].accountNumber, "6666");
  assert.equal(result.transactions[0].date, "2026-05-04");
  assert.equal(result.transactions[0].processedDate, "2026-05-10");
  assert.equal(result.transactions[0].description, "קרן מכבי- חיוב");
  assert.equal(result.transactions[0].chargedAmount, -162.33);
  assert.equal(result.transactions[0].chargedCurrency, "ILS");
  assert.equal(result.transactions[0].originalAmount, -162.33);
  assert.equal(result.transactions[0].memo, "הוראת קבע · רפואה ובריאות");
});

test("parses CAL June bill card suffix from bill title", async () => {
  const buffer = await readSample("cal_inbar_june.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "cal_bill",
    sourceLabel: "CAL Inbar",
  });

  assert.equal(result.transactions.length > 0, true);
  assert.equal(
    result.transactions.every((txn) => txn.accountNumber === "6666"),
    true
  );
});

test("parses Isracard monthly bill card suffix from title", async () => {
  const buffer = await readSample("isra_aviran/2437_02_2026.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "isracard_bill",
    sourceLabel: "Isracard Aviran",
  });

  assert.equal(result.transactions.length > 0, true);
  assert.equal(
    result.transactions.every((txn) => txn.accountNumber === "2437"),
    true
  );
});
