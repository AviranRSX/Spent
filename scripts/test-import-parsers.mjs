import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkbookBuffer } from "../src/lib/imports/xlsx-parser.js";
import { buildOpenXmlWorkbook } from "./import-workbook-test-helpers.mjs";

async function readSample(name) {
  const fs = await import("node:fs/promises");
  return fs.readFile(new URL(`../transactions/${name}`, import.meta.url));
}

const providerSamples = [
  ["2437_07_2026.xlsx", "isracard_bill"],
  ["transaction-details_export_1785570699131.xlsx", "max_bill"],
  ["פירוט עסקאות וזיכויים(1).xlsx", "cal_bill"],
  ["excelNewTransactions.xlsx", "hapoalim_bank_account"],
  ["תנועות בחשבון 1_8_2026.xls", "leumi_bank_account"],
];

const stableFieldAssertions = {
  isracard_bill: (transaction) => assert.equal(transaction.accountNumber, "2437"),
  max_bill: (transaction) => assert.equal(transaction.accountNumber, "7918"),
  cal_bill: (transaction) => {
    assert.equal(transaction.accountNumber, "6666");
    assert.equal(transaction.description, "מתנה באשראי לאירוע");
    assert.equal(transaction.originalAmount, -410.8);
    assert.equal(transaction.chargedAmount, -410.8);
    assert.equal(transaction.date, "2026-07-31");
    assert.equal(transaction.processedDate, "2026-07-31");
    assert.equal(transaction.status, "pending");
  },
  hapoalim_bank_account: (transaction) => assert.equal(transaction.accountNumber, "12-702-77447"),
  leumi_bank_account: (transaction) => assert.equal(transaction.accountNumber, "930-114882/60"),
};

for (const [fileName, templateType] of providerSamples) {
  test(`parses current ${templateType} sample`, async () => {
    const result = await parseWorkbookBuffer(await readSample(fileName), {
      templateType,
      sourceLabel: templateType,
    });
    assert.equal(result.transactions.length > 0, true);
    stableFieldAssertions[templateType](result.transactions[0]);
    assert.equal(Array.isArray(result.rowIssues), true);
    assert.equal("errors" in result, false);
  });
}

test("parses current CAL billing dates amounts and pending rows exactly", async () => {
  const result = await parseWorkbookBuffer(
    await readSample("פירוט עסקאות וזיכויים(1).xlsx"),
    { templateType: "cal_bill", sourceLabel: "CAL" }
  );

  assert.equal(result.transactions.length, 51);
  assert.deepEqual(result.rowIssues, []);
  assert.deepEqual(
    result.transactions.slice(0, 2).map((transaction) => ({
      accountNumber: transaction.accountNumber,
      description: transaction.description,
      originalAmount: transaction.originalAmount,
      chargedAmount: transaction.chargedAmount,
      date: transaction.date,
      processedDate: transaction.processedDate,
      status: transaction.status,
    })),
    [
      {
        accountNumber: "6666",
        description: "מתנה באשראי לאירוע",
        originalAmount: -410.8,
        chargedAmount: -410.8,
        date: "2026-07-31",
        processedDate: "2026-07-31",
        status: "pending",
      },
      {
        accountNumber: "6666",
        description: "יוחננוף - אחד העם",
        originalAmount: -97.53,
        chargedAmount: -97.53,
        date: "2026-07-30",
        processedDate: "2026-07-30",
        status: "pending",
      },
    ]
  );
  assert.deepEqual(
    {
      accountNumber: result.transactions[2].accountNumber,
      originalAmount: result.transactions[2].originalAmount,
      chargedAmount: result.transactions[2].chargedAmount,
      date: result.transactions[2].date,
      processedDate: result.transactions[2].processedDate,
      status: result.transactions[2].status,
    },
    {
      accountNumber: "6666",
      originalAmount: -1140.2,
      chargedAmount: -1140.2,
      date: "2026-07-29",
      processedDate: "2026-08-10",
      status: "completed",
    }
  );
});

for (const [fileName, repeatedHeaderRow, followingDescription] of [
  ["2437_08_2026.xlsx", 37, "NICE*HOTEL"],
  ["3497_08_2026.xlsx", 21, "משיכת מזומנים"],
]) {
  test(`ignores repeated Isracard section header in ${fileName}`, async () => {
    const result = await parseWorkbookBuffer(await readSample(fileName), {
      templateType: "isracard_bill",
      sourceLabel: "Isracard",
    });

    assert.equal(
      result.rowIssues.some((issue) => issue.rowNumber === repeatedHeaderRow),
      false
    );
    assert.equal(
      result.transactions.some(
        (transaction) => transaction.description === followingDescription
      ),
      true
    );
  });
}

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
  const result = await parseWorkbookBuffer(
    await readSample("transaction-details_export_1785570692278.xlsx"),
    { templateType: "max_bill", sourceLabel: "Max" }
  );

  assert.deepEqual(result.rowIssues, []);
  assert.deepEqual(
    result.transactions.map((transaction) => ({
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
        accountNumber: "7918",
        description: "בהצדעה",
        originalAmount: -404,
        originalCurrency: "ILS",
        chargedAmount: -404,
        chargedCurrency: "ILS",
        status: "completed",
      },
      {
        accountNumber: "7918",
        description: "בהצדעה",
        originalAmount: -264,
        originalCurrency: "ILS",
        chargedAmount: -264,
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
