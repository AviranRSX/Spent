import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkbookBuffer } from "../src/lib/imports/xlsx-parser.js";

async function readSample(name) {
  const fs = await import("node:fs/promises");
  return fs.readFile(new URL(`../transactions/${name}`, import.meta.url));
}

test("parses Isracard bill rows with negative card charges", async () => {
  const buffer = await readSample("isracard_export.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "isracard_bill",
    sourceLabel: "Isracard 1234",
  });

  assert.equal(result.transactions.length > 10, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].date, "2026-04-29");
  assert.equal(result.transactions[0].description, "Example merchant");
  assert.equal(result.transactions[0].chargedAmount, -31.26);
  assert.equal(result.transactions[0].chargedCurrency, "ILS");
  assert.equal(result.transactions[0].identifier, "000000001");
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
  assert.equal(result.transactions[0].accountNumber, "123-456789/01");
  assert.equal(result.transactions[0].date, "2026-05-11");
  assert.equal(result.transactions[0].processedDate, "2026-05-11");
  assert.equal(result.transactions[0].description, "Example merchant");
  assert.equal(result.transactions[0].chargedAmount, -12500);
  assert.equal(result.transactions[0].identifier, "000000");
  const salary = result.transactions.find(
    (txn) => txn.description === "העברת משכורת" && txn.date === "2026-05-07"
  );
  assert.ok(salary);
  assert.equal(salary.chargedAmount, 9000);
});

test("parses credit card export across multiple sheets", async () => {
  const buffer = await readSample("max_export.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "max_bill",
    sourceLabel: "Max card",
  });

  assert.equal(result.transactions.length > 10, true);
  assert.deepEqual(result.errors, []);
  assert.equal(
    result.transactions.some((txn) =>
      txn.description.includes("Example merchant")
    ),
    true
  );
  const paybox = result.transactions.find(
    (txn) => txn.description === "Example merchant" && txn.date === "2026-04-13"
  );
  assert.ok(paybox);
  assert.equal(paybox.chargedAmount, -40);
  assert.equal(paybox.date, "2026-04-13");
  assert.equal(paybox.processedDate, "2026-05-10");
  assert.deepEqual(
    [...new Set(result.transactions.map((txn) => txn.accountNumber))].sort(),
    ["4444", "2222"]
  );
});

test("parses CAL bill rows with bank charge date", async () => {
  const buffer = await readSample("cal_export.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "cal_bill",
    sourceLabel: "CAL",
  });

  assert.equal(result.transactions.length, 13);
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions[0].accountNumber, "3333");
  assert.equal(result.transactions[0].date, "2026-05-04");
  assert.equal(result.transactions[0].processedDate, "2026-05-10");
  assert.equal(result.transactions[0].description, "Example merchant");
  assert.equal(result.transactions[0].chargedAmount, -123.45);
  assert.equal(result.transactions[0].chargedCurrency, "ILS");
  assert.equal(result.transactions[0].originalAmount, -123.45);
  assert.equal(result.transactions[0].memo, "הוראת קבע · רפואה ובריאות");
});

test("parses CAL June bill card suffix from bill title", async () => {
  const buffer = await readSample("cal_export.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "cal_bill",
    sourceLabel: "CAL",
  });

  assert.equal(result.transactions.length > 0, true);
  assert.equal(
    result.transactions.every((txn) => txn.accountNumber === "3333"),
    true
  );
});

test("parses Isracard monthly bill card suffix from title", async () => {
  const buffer = await readSample("isracard-example.xlsx");
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "isracard_bill",
    sourceLabel: "Isracard",
  });

  assert.equal(result.transactions.length > 0, true);
  assert.equal(
    result.transactions.every((txn) => txn.accountNumber === "1111"),
    true
  );
});
