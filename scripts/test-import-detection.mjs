import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import parser from "../src/lib/imports/xlsx-parser.js";
import { buildOpenXmlWorkbook } from "./import-workbook-test-helpers.mjs";

const { detectWorkbookBuffer, getOpenXmlArchiveLimitIssue } = parser;

const samples = [
  ["0103_07_2026.xlsx", "isracard_bill", "card"],
  ["0103_08_2026.xlsx", "isracard_bill", "card"],
  ["2437_07_2026.xlsx", "isracard_bill", "card"],
  ["2437_08_2026.xlsx", "isracard_bill", "card"],
  ["3497_07_2026.xlsx", "isracard_bill", "card"],
  ["3497_08_2026.xlsx", "isracard_bill", "card"],
  ["transaction-details_export_1785570692278.xlsx", "max_bill", "card"],
  ["transaction-details_export_1785570699131.xlsx", "max_bill", "card"],
  ["transaction-details_export_1785570707036.xlsx", "max_bill", "card"],
  ["transaction-details_export_1785570715061.xlsx", "max_bill", "card"],
  ["transaction-details_export_1785570720670.xlsx", "max_bill", "card"],
  ["transaction-details_export_1785570729313.xlsx", "max_bill", "card"],
  ["פירוט עסקאות וזיכויים(1).xlsx", "cal_bill", "card"],
  ["excelNewTransactions.xlsx", "hapoalim_bank_account", "bank"],
  ["תנועות בחשבון 1_8_2026.xls", "leumi_bank_account", "bank"],
];

for (const [fileName, templateType, kind] of samples) {
  test(`detects ${fileName} from workbook content`, async () => {
    const buffer = await readFile(new URL(`../transactions/${fileName}`, import.meta.url));
    assert.deepEqual(await detectWorkbookBuffer(buffer), {
      ok: true,
      templateType,
      kind,
    });
  });
}

test("normalizes header whitespace before exact matching", async () => {
  const buffer = await buildOpenXmlWorkbook([[
    "תאריך\r\nעסקה",
    "שם   בית עסק",
    "סכום\nבש\"ח",
    "מועד חיוב",
  ]]);
  assert.deepEqual(await detectWorkbookBuffer(buffer), {
    ok: true,
    templateType: "cal_bill",
    kind: "card",
  });
});

test("rejects a workbook with no supported signature", async () => {
  const buffer = await buildOpenXmlWorkbook([["Date", "Description", "Amount"]]);
  assert.deepEqual(await detectWorkbookBuffer(buffer), {
    ok: false,
    code: "unsupported",
    message: "Unsupported workbook format",
    matches: [],
  });
});

test("reports malformed workbook buffers as unreadable", async () => {
  assert.deepEqual(await detectWorkbookBuffer(Buffer.from("not a workbook")), {
    ok: false,
    code: "unreadable",
    message: "Workbook could not be read",
    matches: [],
  });
});

test("rejects Open XML workbooks with too many archive entries", async () => {
  const buffer = await buildOpenXmlWorkbook(
    [["Date", "Description", "Amount"]],
    { extraEntryCount: 1_001 }
  );

  assert.deepEqual(await detectWorkbookBuffer(buffer), {
    ok: false,
    code: "unreadable",
    message: "Workbook could not be read",
    matches: [],
  });
});

test("bounds total expanded Open XML bytes before reading entries", () => {
  assert.equal(
    getOpenXmlArchiveLimitIssue([100 * 1024 * 1024]),
    null
  );
  assert.equal(
    getOpenXmlArchiveLimitIssue([100 * 1024 * 1024, 1]),
    "expanded_size"
  );
});

test("rejects a workbook matching more than one provider", async () => {
  const buffer = await buildOpenXmlWorkbook([[
    "תאריך רכישה",
    "שם בית עסק",
    "סכום עסקה",
    "מטבע עסקה",
    "סכום חיוב",
    "מטבע חיוב",
    "מס' שובר",
    "פירוט נוסף",
    "תאריך עסקה",
    "שם בית העסק",
    "4 ספרות אחרונות של כרטיס האשראי",
    "סוג עסקה",
    "סכום עסקה מקורי",
    "מטבע עסקה מקורי",
    "תאריך חיוב",
  ]]);
  const result = await detectWorkbookBuffer(buffer);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ambiguous");
  assert.deepEqual(result.matches.sort(), ["isracard_bill", "max_bill"]);
});
