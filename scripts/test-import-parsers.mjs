import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkbookBuffer } from "../src/lib/imports/xlsx-parser.js";
import {
  FIXTURE_ACCOUNTS,
  ISRACARD_REPEATED_HEADER_ROW,
  PROVIDER_FIXTURES,
  CAL_STATEMENT_ROWS,
  buildCalStatementWorkbook,
  buildCalWorkbook,
  buildIsracardWorkbook,
  buildMaxWorkbook,
  buildOpenXmlWorkbook,
  excelSerial,
} from "./import-workbook-test-helpers.mjs";

for (const [templateType, , buildFixture] of PROVIDER_FIXTURES) {
  test(`parses a ${templateType} export (${buildFixture.name})`, async () => {
    const result = await parseWorkbookBuffer(await buildFixture(), {
      templateType,
      sourceLabel: templateType,
    });
    assert.equal(result.transactions.length > 0, true);
    assert.equal(result.transactions[0].accountNumber, FIXTURE_ACCOUNTS[templateType]);
    assert.deepEqual(result.rowIssues, []);
    assert.equal("errors" in result, false);
  });
}

test("parses CAL billing dates amounts and pending rows exactly", async () => {
  const result = await parseWorkbookBuffer(await buildCalWorkbook(), {
    templateType: "cal_bill",
    sourceLabel: "CAL",
  });

  assert.deepEqual(result.rowIssues, []);
  assert.deepEqual(
    result.transactions.map((transaction) => ({
      accountNumber: transaction.accountNumber,
      description: transaction.description,
      originalAmount: transaction.originalAmount,
      chargedAmount: transaction.chargedAmount,
      date: transaction.date,
      processedDate: transaction.processedDate,
      status: transaction.status,
      type: transaction.type,
    })),
    [
      {
        accountNumber: "4321",
        description: "מתנה לדוגמה",
        originalAmount: -150.25,
        chargedAmount: -150.25,
        date: "2026-07-31",
        processedDate: "2026-07-31",
        status: "pending",
        type: "normal",
      },
      {
        accountNumber: "4321",
        description: "מאפייה לדוגמה",
        originalAmount: -42.9,
        chargedAmount: -42.9,
        date: "2026-07-30",
        processedDate: "2026-07-30",
        status: "pending",
        type: "normal",
      },
      {
        accountNumber: "4321",
        description: "רהיטים לדוגמה",
        originalAmount: -900,
        chargedAmount: -900,
        date: "2026-07-29",
        processedDate: "2026-08-10",
        status: "completed",
        type: "installments",
      },
    ]
  );
});

test("ignores a repeated Isracard section header", async () => {
  const result = await parseWorkbookBuffer(await buildIsracardWorkbook(), {
    templateType: "isracard_bill",
    sourceLabel: "Isracard",
  });

  assert.equal(
    result.rowIssues.some((issue) => issue.rowNumber === ISRACARD_REPEATED_HEADER_ROW),
    false
  );
  const foreign = result.transactions.find(
    (transaction) => transaction.description === "EXAMPLE HOTEL"
  );
  assert.equal(foreign?.originalCurrency, "USD");
  assert.equal(foreign?.chargedCurrency, "ILS");
  assert.equal(foreign?.chargedAmount, -441.6);
});

function buildMixedIsracardWorkbook() {
  return buildOpenXmlWorkbook([
    ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב", "מס' שובר", "פירוט נוסף"],
    ["bad-date", "Broken merchant", "abc", "ILS", "", "ILS", "101", ""],
    ["01.08.2026", "Valid merchant", "25", "ILS", "25", "ILS", "102", ""],
  ]);
}

test("reports every exact field problem on the physical Excel row", async () => {
  const buffer = await buildMixedIsracardWorkbook();
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "isracard_bill",
    sourceLabel: "Isracard",
  });

  assert.deepEqual(result.rowIssues, [{
    sheetName: "Sheet1",
    rowNumber: 2,
    problems: [
      "Invalid purchase date: \"bad-date\" (expected DD.MM.YYYY)",
      "Invalid original amount: \"abc\" is not a number",
      "Missing charged amount",
    ],
  }]);
});

test("retains valid rows next to an invalid row", async () => {
  const result = await parseWorkbookBuffer(await buildMixedIsracardWorkbook(), {
    templateType: "isracard_bill",
    sourceLabel: "Isracard",
  });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].description, "Valid merchant");
});

test("rejects calendar-invalid Isracard purchase dates", async () => {
  const buffer = await buildOpenXmlWorkbook([
    ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב"],
    ["31.02.2026", "Merchant", "25", "ILS", "25", "ILS"],
  ]);
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "isracard_bill",
    sourceLabel: "Isracard",
  });
  assert.deepEqual(result.rowIssues, [{
    sheetName: "Sheet1",
    rowNumber: 2,
    problems: ["Invalid purchase date: \"31.02.2026\" (expected DD.MM.YYYY)"],
  }]);
});

test("reports exact Max row problems", async () => {
  const buffer = await buildOpenXmlWorkbook([
    ["תאריך עסקה", "שם בית העסק", "", "כרטיס", "", "סכום חיוב", "", "סכום עסקה"],
    ["31-02-2026", "Merchant", "", "1234", "", "abc", "", ""],
  ]);
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "max_bill",
    sourceLabel: "Max",
  });
  assert.deepEqual(result.rowIssues, [{
    sheetName: "Sheet1",
    rowNumber: 2,
    problems: [
      "Invalid transaction date: \"31-02-2026\" (expected DD-MM-YYYY or DD/MM/YYYY)",
      "Invalid charged amount: \"abc\" is not a number",
      "Missing original amount",
    ],
  }]);
});

test("imports Max rows with only an original amount as regular transactions", async () => {
  const result = await parseWorkbookBuffer(await buildMaxWorkbook(), {
    templateType: "max_bill",
    sourceLabel: "Max",
  });

  assert.deepEqual(result.rowIssues, []);
  assert.deepEqual(
    result.transactions.slice(1).map((transaction) => ({
      accountNumber: transaction.accountNumber,
      description: transaction.description,
      originalAmount: transaction.originalAmount,
      originalCurrency: transaction.originalCurrency,
      chargedAmount: transaction.chargedAmount,
      chargedCurrency: transaction.chargedCurrency,
      status: transaction.status,
    })),
    [
      {
        accountNumber: "5678",
        description: "חנות לדוגמה",
        originalAmount: -120,
        originalCurrency: "ILS",
        chargedAmount: -120,
        chargedCurrency: "ILS",
        status: "completed",
      },
      {
        accountNumber: "5678",
        description: "חנות לדוגמה",
        originalAmount: -75,
        originalCurrency: "ILS",
        chargedAmount: -75,
        chargedCurrency: "ILS",
        status: "completed",
      },
    ]
  );
});

test("rejects a Max row when neither amount is usable", async () => {
  const buffer = await buildOpenXmlWorkbook([
    ["תאריך עסקה", "שם בית העסק", "", "כרטיס", "", "סכום חיוב", "", "סכום עסקה מקורי"],
    ["01-08-2026", "Merchant", "", "1234", "", "", "", ""],
  ]);
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "max_bill",
    sourceLabel: "Max",
  });

  assert.deepEqual(result.rowIssues, [{
    sheetName: "Sheet1",
    rowNumber: 2,
    problems: ["Missing charged amount", "Missing original amount"],
  }]);
});

test("reports exact CAL row problems", async () => {
  const buffer = await buildOpenXmlWorkbook([
    ["תאריך עסקה", "שם בית עסק", "סכום בש\"ח", "מועד חיוב"],
    ["not-an-excel-date", "Merchant", "abc", ""],
  ]);
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "cal_bill",
    sourceLabel: "CAL",
  });
  assert.deepEqual(result.rowIssues, [{
    sheetName: "Sheet1",
    rowNumber: 2,
    problems: [
      "Invalid transaction date: \"not-an-excel-date\" (expected Excel date)",
      "Invalid original amount: \"abc\" is not a number",
      "Invalid charged amount: \"abc\" is not a number",
    ],
  }]);
});

test("reports the visible worksheet name for row issues", async () => {
  const buffer = await buildOpenXmlWorkbook(
    [
      ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב"],
      ["bad-date", "Merchant", "25", "ILS", "25", "ILS"],
    ],
    { sheetName: "עסקאות אוגוסט" }
  );
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "isracard_bill",
    sourceLabel: "Isracard",
  });

  assert.equal(result.rowIssues[0].sheetName, "עסקאות אוגוסט");
});

test("reports exact Hapoalim row problems", async () => {
  const buffer = await buildOpenXmlWorkbook([
    ["תאריך", "הפעולה", "", "", "חובה", "זכות"],
    ["not-an-excel-date", "Action", "", "", "abc", ""],
  ]);
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "hapoalim_bank_account",
    sourceLabel: "Hapoalim",
  });
  assert.deepEqual(result.rowIssues, [{
    sheetName: "Sheet1",
    rowNumber: 2,
    problems: [
      "Invalid transaction date: \"not-an-excel-date\" (expected Excel date)",
      "Invalid debit or credit amount: \"abc\" is not a number",
    ],
  }]);
});

test("reports exact Leumi row problems", async () => {
  const buffer = Buffer.from(`
    <table>
      <tr><th>תאריך</th><th>תאריך ערך</th><th>תיאור</th><th>אסמכתא</th><th>בחובה</th><th>בזכות</th></tr>
      <tr><td>99/99/2026</td><td>99/99/2026</td><td>Transfer</td><td>123</td><td></td><td>50</td></tr>
    </table>
  `);
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "leumi_bank_account",
    sourceLabel: "Leumi",
  });
  assert.deepEqual(result.rowIssues, [{
    sheetName: "Sheet1",
    rowNumber: 2,
    problems: ["Invalid transaction date: \"99/99/2026\" (expected DD/MM/YYYY)"],
  }]);
});

test("ignores blank total and explanatory rows", async () => {
  const buffer = await buildOpenXmlWorkbook([
    ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב", "מס' שובר", "פירוט נוסף"],
    ["01.08.2026", "Valid merchant", "25", "ILS", "25", "ILS", "102", ""],
    ["", "סה\"כ לחיוב", "", "", "25", "ILS", "", ""],
    ["Legal explanation without transaction fields", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", ""],
  ]);
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "isracard_bill",
    sourceLabel: "Isracard",
  });
  assert.deepEqual(result.rowIssues, []);
});

test("parses the CAL statement export with billing date from the preamble", async () => {
  const result = await parseWorkbookBuffer(await buildCalStatementWorkbook({ billingDate: "2026-08-10" }), {
    templateType: "cal_bill",
    sourceLabel: "CAL",
    today: "2026-09-01",
  });

  assert.deepEqual(result.rowIssues, []);
  assert.deepEqual(
    result.transactions.map((t) => ({
      accountNumber: t.accountNumber,
      date: t.date,
      processedDate: t.processedDate,
      description: t.description,
      originalAmount: t.originalAmount,
      originalCurrency: t.originalCurrency,
      chargedAmount: t.chargedAmount,
      chargedCurrency: t.chargedCurrency,
      status: t.status,
      type: t.type,
    })),
    CAL_STATEMENT_ROWS.map((row) => ({
      accountNumber: "4321",
      date: row.date,
      processedDate: "2026-08-10",
      description: row.merchant,
      originalAmount: -row.amount,
      originalCurrency: "ILS",
      chargedAmount: -row.amount,
      chargedCurrency: "ILS",
      status: "completed",
      type: "normal",
    }))
  );
  assert.equal(result.transactions[0].memo, "רגילה · מזון ומשקאות");
});

test("marks CAL statement rows pending when the billing date is in the future", async () => {
  const result = await parseWorkbookBuffer(await buildCalStatementWorkbook({ billingDate: "2026-10-10" }), {
    templateType: "cal_bill",
    sourceLabel: "CAL",
    today: "2026-10-03",
  });
  assert.deepEqual(
    [...new Set(result.transactions.map((t) => t.status))],
    ["pending"]
  );
  assert.equal(result.transactions[0].processedDate, "2026-10-10");
});

test("CAL statement row totals equal the billing line total", async () => {
  const result = await parseWorkbookBuffer(await buildCalStatementWorkbook(), {
    templateType: "cal_bill",
    sourceLabel: "CAL",
  });
  const parsedTotal = result.transactions.reduce((sum, t) => sum - t.chargedAmount, 0);
  const expected = CAL_STATEMENT_ROWS.reduce((sum, row) => sum + row.amount, 0);
  assert.equal(parsedTotal.toFixed(2), expected.toFixed(2));
});

test("CAL statement and legacy exports produce identical dedup inputs for the same purchase", async () => {
  const pick = (t) => ({
    accountNumber: t.accountNumber,
    date: t.date,
    originalAmount: t.originalAmount,
    originalCurrency: t.originalCurrency,
    description: t.description,
    identifier: t.identifier,
  });
  const legacy = await parseWorkbookBuffer(await buildCalWorkbook(), {
    templateType: "cal_bill",
    sourceLabel: "CAL",
  });
  const statement = await parseWorkbookBuffer(await buildCalStatementWorkbook(), {
    templateType: "cal_bill",
    sourceLabel: "CAL",
  });
  // "מתנה לדוגמה" on 2026-07-31 for 150.25 exists in both fixtures.
  const legacyRow = legacy.transactions.find((t) => t.date === "2026-07-31");
  const statementRow = statement.transactions.find((t) => t.date === "2026-07-31");
  assert.deepEqual(pick(statementRow), pick(legacyRow));
});

test("parses a foreign currency amount cell in the CAL statement export", async () => {
  const buffer = await buildOpenXmlWorkbook([
    ["פירוט עסקאות לכרטיס מאסטרקארד המסתיים ב-4321"],
    [],
    ["עסקאות לחיוב ב-10/08/2026: 95.00 ₪"],
    ["תאריך\r\nעסקה", "שם בית עסק", "סכום\r\nעסקה", "סכום\r\nחיוב", "סוג\r\nעסקה", "ענף", "הערות"],
    [excelSerial("2026-07-15"), "EXAMPLE CAFE", "€ 24.50", 95, "רגילה", "", ""],
  ]);
  const result = await parseWorkbookBuffer(buffer, {
    templateType: "cal_bill",
    sourceLabel: "CAL",
    today: "2026-09-01",
  });
  assert.deepEqual(result.rowIssues, []);
  assert.equal(result.transactions[0].originalAmount, -24.5);
  assert.equal(result.transactions[0].originalCurrency, "EUR");
  assert.equal(result.transactions[0].chargedAmount, -95);
  assert.equal(result.transactions[0].chargedCurrency, "ILS");
});
