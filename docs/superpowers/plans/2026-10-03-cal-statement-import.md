# CAL Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import CAL's "current statement" card export, reject CAL's bank-charges summary with a clear notice, and classify the plural "credit cards" bank description as a card payment.

**Architecture:**
- The statement export becomes a second header signature for the existing `cal_bill` template, plus a variant branch in `parseCalBill`. Provider ids, account numbers and dedup hashes therefore stay identical to the rows already stored.
- The detector gains a small list of known non-transaction layouts that produce a new `not_transactions` file issue.
- A regex tweak plus a data migration fixes the card-payment kind.

**Tech Stack:** Plain JS import modules (`src/lib/imports/*.js` with `.d.ts`), JSZip-based workbook reader, `node --test`, better-sqlite3 SQL migrations, next-intl.

**Spec:** `docs/superpowers/specs/2026-10-03-cal-statement-import-design.md`

## Global Constraints

- No em dashes anywhere in code, comments, docs, or commit messages.
- Conventional commits with a body explaining what and why, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never read `/transactions/` or `/data/` in tests**, and never copy a real row, amount, account number, card digits, merchant, or export file name into code, tests, or commits. All fixtures are synthetic builders in `scripts/import-workbook-test-helpers.mjs` with invented values.
- Reuse `templateType: "cal_bill"`. Do not add a new template type.
- Do not change dedup hash inputs (`src/server/lib/dedup.ts`).
- Every new user-facing string goes in both `src/i18n/messages/en.json` and `he.json`.
- Migrations are new numbered files. Never edit an applied migration. This plan owns `024_credit_card_payment_plural.sql`.
- Before every commit, read the staged diff for anything from a real export.

## Review Focus

- **Header cells with embedded line breaks** (`"סכום\r\nחיוב"`). Expect them to normalize to `סכום חיוב` and match. Pinned in Task 1 (the fixture uses `\r\n` headers).
- **A statement whose billing date is in the future.** Expect every row to be `pending`, with `processedDate` equal to the billing date. Pinned in Task 2 with an injected `today`.
- **The same purchase in the legacy export and in the statement export.** Expect identical hash inputs, so it dedupes. Pinned in Task 2.
- **The trailing footer sentence and blank rows.** Expect no transaction and no row issue. Pinned in Task 2.
- **A legacy CAL export after this change.** Expect it to still detect once (not "ambiguous") and parse exactly as before. Pinned in Task 1 and by the existing CAL parser test.

---

### Task 1: Detect the CAL statement export as `cal_bill`

**Files:**
- Modify: `scripts/import-workbook-test-helpers.mjs` (add a builder and fixture constants after `buildCalWorkbook`)
- Modify: `src/lib/imports/template-detector.js:14-19` (add the second `cal_bill` signature)
- Test: `scripts/test-import-detection.mjs`

**Interfaces:**
- Produces:
  - `buildCalStatementWorkbook({ billingDate?: string } = {}): Promise<Buffer>`, default `billingDate = "2026-08-10"`
  - `CAL_STATEMENT_ROWS`: an array of `{ date, merchant, amount, type, branch }`
  - Both exported from the helpers module and used in Task 2.

- [ ] **Step 1: Add the synthetic statement builder**

In `scripts/import-workbook-test-helpers.mjs`, after `buildCalWorkbook`, add the following. The layout mirrors the real export:
- row 1 is the account and card line
- row 3 is the billing line
- row 4 holds the headers, with embedded line breaks
- a footer sentence closes the sheet

```js
// CAL "current statement" export: no per-row billing date, the billing date
// and total live in row 3, and headers contain embedded line breaks.
export const CAL_STATEMENT_ROWS = [
  { date: "2026-07-12", merchant: "סופר לדוגמה", amount: 210.4, type: "רגילה", branch: "מזון ומשקאות" },
  { date: "2026-07-20", merchant: "ספק אינטרנט לדוגמה", amount: 99.9, type: "הוראת קבע", branch: "" },
  { date: "2026-07-31", merchant: "מתנה לדוגמה", amount: 150.25, type: "רגילה", branch: "מתנות" },
];

function formatIsraeliDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function buildCalStatementWorkbook({ billingDate = "2026-08-10" } = {}) {
  const total = CAL_STATEMENT_ROWS.reduce((sum, row) => sum + row.amount, 0);
  return buildOpenXmlWorkbook(
    [
      [`פירוט עסקאות לחשבון בנק לדוגמה 999-11111 לכרטיס מאסטרקארד זהב המסתיים ב-${FIXTURE_ACCOUNTS.cal_bill}`],
      [],
      [`עסקאות לחיוב ב-${formatIsraeliDate(billingDate)}: ${total.toFixed(2)} ₪`],
      ["תאריך\r\nעסקה", "שם בית עסק", "סכום\r\nעסקה", "סכום\r\nחיוב", "סוג\r\nעסקה", "ענף", "הערות"],
      ...CAL_STATEMENT_ROWS.map((row) => [
        excelSerial(row.date),
        row.merchant,
        row.amount,
        row.amount,
        row.type,
        row.branch,
        "",
      ]),
      [],
      ["את המידע המלא על כל עסקה אפשר למצוא באתר ובאפליקציה של חברת הכרטיס."],
    ],
    { sheetName: "בנק לדוגמה 999-11111" }
  );
}
```

Also add it to `PROVIDER_FIXTURES` so the shared detect and parse loops cover it:

```js
export const PROVIDER_FIXTURES = [
  ["isracard_bill", "card", buildIsracardWorkbook],
  ["max_bill", "card", buildMaxWorkbook],
  ["cal_bill", "card", buildCalWorkbook],
  ["cal_bill", "card", buildCalStatementWorkbook],
  ["hapoalim_bank_account", "bank", buildHapoalimWorkbook],
  ["leumi_bank_account", "bank", buildLeumiHtml],
];
```

Test titles in the loops use `templateType`, so the two `cal_bill` entries would share a title. Give them distinct titles: in `scripts/test-import-detection.mjs` and `scripts/test-import-parsers.mjs`, change the loop header to use the builder name:

```js
for (const [templateType, kind, buildFixture] of PROVIDER_FIXTURES) {
  test(`detects a ${templateType} export from workbook content (${buildFixture.name})`, async () => {
```

```js
for (const [templateType, , buildFixture] of PROVIDER_FIXTURES) {
  test(`parses a ${templateType} export (${buildFixture.name})`, async () => {
```

- [ ] **Step 2: Run the detection tests and confirm the new fixture fails**

Run: `node --test scripts/test-import-detection.mjs`
Expected: FAIL on `detects a cal_bill export from workbook content (buildCalStatementWorkbook)`, where the actual value is `{ ok: false, code: "unsupported", ... }`. All other tests pass.

- [ ] **Step 3: Add the second `cal_bill` signature**

In `src/lib/imports/template-detector.js`, insert directly after the existing `cal_bill` entry:

```js
  {
    // CAL "current statement" export. Same template, different headers.
    templateType: "cal_bill",
    kind: "card",
    container: "open_xml",
    headers: ["תאריך עסקה", "שם בית עסק", "סכום עסקה", "סכום חיוב", "סוג עסקה"],
  },
```

`detectImportTemplate` already keys `matches` by `templateType`, so a workbook matching both CAL signatures resolves to one match. No detector logic change is needed.

- [ ] **Step 4: Run the detection tests again and confirm they pass**

Run: `node --test scripts/test-import-detection.mjs`
Expected: PASS, including the existing legacy `cal_bill` fixture and the "normalizes header whitespace" test.

`scripts/test-import-parsers.mjs` will now fail on `parses a cal_bill export (buildCalStatementWorkbook)`, because the parser does not handle the variant yet. That is expected and is fixed in Task 2. Do not commit yet.

### Task 2: Parse the CAL statement variant

**Files:**
- Modify: `src/lib/imports/xlsx-parser.js` (`parseCalBill` at about lines 324-406, `parseWorkbookBuffer` at about lines 473-489, and new helpers next to `currencyCode`)
- Modify: `src/lib/imports/xlsx-parser.d.ts` (the `parseWorkbookBuffer` options)
- Test: `scripts/test-import-parsers.mjs`

**Interfaces:**
- Consumes: `buildCalStatementWorkbook`, `CAL_STATEMENT_ROWS`, `FIXTURE_ACCOUNTS` from Task 1.
- Produces:
  - `parseWorkbookBuffer(buffer, { templateType, sourceLabel, today? })`. `today` is an optional `YYYY-MM-DD` and defaults to the local date. It is only used by the CAL statement branch.

- [ ] **Step 1: Write the failing parser tests**

Append to `scripts/test-import-parsers.mjs`, and add `buildCalStatementWorkbook` and `CAL_STATEMENT_ROWS` to its helper import:

```js
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
```

Also import `excelSerial` from the helpers module.

- [ ] **Step 2: Run the parser tests and confirm they fail**

Run: `node --test scripts/test-import-parsers.mjs`
Expected: FAIL on the new tests and on `parses a cal_bill export (buildCalStatementWorkbook)`. The CAL statement yields no transactions because `findHeaderRow` never finds `סכום בש"ח`.

- [ ] **Step 3: Add the amount and currency helpers**

In `src/lib/imports/xlsx-parser.js`, directly after `currencyCode`:

```js
// Statement amount cells are numbers for ILS and text like "€ 24.50" for
// foreign purchases.
function amountWithCurrency(value) {
  if (typeof value === "number") {
    return { amount: Number.isFinite(value) ? value : null, currency: "ILS" };
  }
  const text = asText(value);
  if (!text) return { amount: null, currency: "ILS" };
  const numberText = text.match(/-?[\d,]+(?:\.\d+)?/)?.[0] ?? "";
  const symbol = text.replace(numberText, "").trim();
  const amount = Number(numberText.replace(/,/g, ""));
  return {
    amount: numberText && Number.isFinite(amount) ? amount : null,
    currency: currencyCode(symbol),
  };
}

function localISODate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const CAL_BILLING_LINE = /לחיוב ב-(?<day>\d{1,2})\/(?<month>\d{1,2})\/(?<year>\d{4})/;

function findCalBillingDate(sheet, headerRow) {
  for (let rowNo = 1; rowNo < headerRow; rowNo += 1) {
    const date = dateToISO(rowTexts(sheet.getRow(rowNo)).join(" "), [{ re: CAL_BILLING_LINE }]);
    if (date) return date;
  }
  return null;
}
```

- [ ] **Step 4: Split `parseCalBill` into the legacy and statement branches**

Rename the existing function body to `parseCalLegacySheet(sheet, headerRow, sourceLabel, transactions, rowIssues)`. Its behavior stays unchanged. Then add the statement branch and a dispatcher:

```js
const CAL_LEGACY_HEADERS = ["תאריך עסקה", "שם בית עסק", "סכום בש\"ח", "מועד חיוב"];
const CAL_STATEMENT_HEADERS = ["תאריך עסקה", "שם בית עסק", "סכום עסקה", "סכום חיוב", "סוג עסקה"];

function calAccountNumber(sheet, sourceLabel) {
  const accountLine = rowTexts(sheet.getRow(1)).join(" ");
  return (
    accountLine.match(/מסתיים ב-(\d{4,})/)?.[1] ??
    accountLine.match(/כרטיס.*?(\d{4})\b/)?.[1] ??
    sourceLabel
  );
}

function parseCalStatementSheet(sheet, headerRow, sourceLabel, today, transactions, rowIssues) {
  const columns = headerColumnMap(sheet.getRow(headerRow));
  const dateColumn = columns.get("תאריך עסקה");
  const descriptionColumn = columns.get("שם בית עסק");
  const originalColumn = columns.get("סכום עסקה");
  const chargedColumn = columns.get("סכום חיוב");
  const typeColumn = columns.get("סוג עסקה");
  const branchColumn = columns.get("ענף");
  const notesColumn = columns.get("הערות");
  const accountNumber = calAccountNumber(sheet, sourceLabel);
  const billingDate = findCalBillingDate(sheet, headerRow);

  for (let rowNo = headerRow + 1; rowNo <= sheet.rowCount; rowNo += 1) {
    const vals = rowValues(sheet.getRow(rowNo));
    if (rowHasHeaders(vals, CAL_STATEMENT_HEADERS)) continue;
    const rawDate = vals[dateColumn];
    const date = dateToISO(rawDate, []);
    const description = asText(vals[descriptionColumn]);
    const rawOriginal = vals[originalColumn];
    const rawCharged = vals[chargedColumn];
    if (isTotalRow(vals)) continue;
    const hasAmount = Boolean(asText(rawCharged));
    const hasTransactionEvidence = Boolean(
      (asText(rawDate) && description) || (description && hasAmount) || (asText(rawDate) && hasAmount)
    );
    if (!hasTransactionEvidence) continue;

    const original = amountWithCurrency(rawOriginal);
    const charged = amountWithCurrency(rawCharged);
    const originalAmount = original.amount == null ? null : original.amount === 0 ? 0 : -Math.abs(original.amount);
    const chargedAmount = charged.amount == null ? null : charged.amount === 0 ? 0 : -Math.abs(charged.amount);
    const problems = [
      requiredDateProblem(rawDate, date, "transaction date", "Excel date"),
      requiredTextProblem(description, "merchant"),
      requiredAmountProblem(rawOriginal, originalAmount, "original amount"),
      requiredAmountProblem(rawCharged, chargedAmount, "charged amount"),
    ];
    if (addRowIssue(rowIssues, sheet.name, rowNo, problems)) continue;

    const transactionType = typeColumn == null ? "" : asText(vals[typeColumn]);
    const processedDate = billingDate ?? date;
    transactions.push({
      accountNumber,
      date,
      processedDate,
      originalAmount,
      originalCurrency: original.currency,
      chargedAmount,
      chargedCurrency: "ILS",
      description,
      memo:
        normalizeDescription([
          transactionType,
          branchColumn == null ? "" : vals[branchColumn],
          notesColumn == null ? "" : vals[notesColumn],
        ]) || undefined,
      type: transactionType.includes("תשלום") ? "installments" : "normal",
      status: processedDate > today ? "pending" : "completed",
    });
  }
}

function parseCalBill(workbook, sourceLabel, today) {
  const transactions = [];
  const rowIssues = [];
  for (const sheet of workbook.worksheets) {
    const legacyHeaderRow = findHeaderRow(sheet, CAL_LEGACY_HEADERS);
    if (legacyHeaderRow) {
      parseCalLegacySheet(sheet, legacyHeaderRow, sourceLabel, transactions, rowIssues);
      continue;
    }
    const statementHeaderRow = findHeaderRow(sheet, CAL_STATEMENT_HEADERS);
    if (statementHeaderRow) {
      parseCalStatementSheet(sheet, statementHeaderRow, sourceLabel, today, transactions, rowIssues);
    }
  }
  return { transactions, rowIssues };
}
```

Inside `parseCalLegacySheet`:
- Replace the inline account lookup with `const accountNumber = calAccountNumber(sheet, sourceLabel);`
- Replace the repeated header array with `CAL_LEGACY_HEADERS`.
- Keep all other lines exactly as they are today.

In `parseWorkbookBuffer`:

```js
    case "cal_bill":
      return parseCalBill(
        await readOpenXmlWorkbook(buffer),
        sourceLabel,
        options.today ?? localISODate()
      );
```

In `src/lib/imports/xlsx-parser.d.ts`:

```ts
export function parseWorkbookBuffer(
  buffer: Buffer,
  options: { templateType: ImportTemplateType; sourceLabel: string; today?: string }
): Promise<{
```

- [ ] **Step 5: Run the import tests and confirm they pass**

Run: `npm run test:imports`
Expected: PASS, including:
- `parses CAL billing dates amounts and pending rows exactly`, which checks legacy behavior is unchanged
- the five new tests
- both `cal_bill` loop entries

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit Tasks 1 and 2 together**

They form one logical change (detecting without parsing would ship a broken import).

```bash
git add scripts/import-workbook-test-helpers.mjs scripts/test-import-detection.mjs scripts/test-import-parsers.mjs src/lib/imports/template-detector.js src/lib/imports/xlsx-parser.js src/lib/imports/xlsx-parser.d.ts
git diff --cached   # read it: synthetic values only
git commit -F - <<'EOF'
feat: import CAL current statement exports

CAL's "current statement" export uses different headers from the
"transactions and credits" export: separate original and charged amount
columns, a sector column, and no per-row billing date (the billing date
only appears in a preamble line). Detection rejected these files as
unsupported.

- Add a second cal_bill header signature. Matches are keyed by template
  type, so a workbook still resolves to a single cal_bill match.
- Split parseCalBill into legacy and statement branches. The statement
  branch reads the billing date from the preamble, marks rows pending
  while that date is in the future, reads foreign currency from text
  amount cells, and keeps account, date, amount and description identical
  to the legacy export so overlapping rows dedupe.
- Add a synthetic statement fixture and parser tests, including a dedup
  input equality check against the legacy export.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 3: Reject the CAL bank-charges summary with a `not_transactions` notice

**Files:**
- Modify: `scripts/import-workbook-test-helpers.mjs` (add `buildCalBankSummaryWorkbook`)
- Modify: `src/lib/imports/template-detector.js` (add non-transaction signatures and their check)
- Modify: `src/lib/imports/import-types.ts:10` and `src/lib/imports/xlsx-parser.d.ts:32` (code union)
- Modify: `src/lib/imports/batch-staging.ts` (`summarizeImportPreviews`, `buildImportPreviewDisplay`)
- Modify: `src/components/imports/import-preview-panel.tsx` (informational styling plus translated text)
- Modify: `src/i18n/messages/en.json`, `src/i18n/messages/he.json` (new `importPreview` namespace)
- Test: `scripts/test-import-detection.mjs`, `scripts/test-setup-import-and-budget-suggestions.mjs`

**Interfaces:**
- Produces:
  - Detection result `{ ok: false, code: "not_transactions", message: "CAL bank-charges summary", matches: [] }`.
  - The display row gains `fileIssueCode: ImportFileIssue["code"] | null`.
  - `summarizeImportPreviews` counts `not_transactions` in a new `notices` field instead of `fileErrors`.

- [ ] **Step 1: Add the synthetic summary builder**

```js
// CAL "bank charges summary": monthly card totals debited from the bank. Not
// a transaction export.
export function buildCalBankSummaryWorkbook() {
  return buildOpenXmlWorkbook([
    ["פירוט חיובים בבנק לחשבון בנק לדוגמה 999-22222 נכון לתאריך 01/09/2026"],
    ["תאריך\r\nחיוב", "כרטיס", "סכום", "מטבע"],
    [excelSerial("2026-08-02"), "מאסטרקארד 4321", 480, "₪"],
    [excelSerial("2026-07-02"), "מאסטרקארד 4321", 515, "₪"],
  ]);
}
```

- [ ] **Step 2: Write the failing tests**

In `scripts/test-import-detection.mjs`, import `buildCalBankSummaryWorkbook` and add:

```js
test("reports the CAL bank-charges summary as a non-transaction file", async () => {
  assert.deepEqual(await detectWorkbookBuffer(await buildCalBankSummaryWorkbook()), {
    ok: false,
    code: "not_transactions",
    message: "CAL bank-charges summary",
    matches: [],
  });
});
```

In `scripts/test-setup-import-and-budget-suggestions.mjs`, add a third entry to `previewFiles`:

```js
  {
    fileName: "summary.xlsx",
    kind: null,
    templateType: null,
    rows: [],
    duplicateCount: 0,
    rowIssues: [],
    fileIssue: {
      code: "not_transactions",
      message: "CAL bank-charges summary",
      matches: [],
    },
  },
```

Update the summary expectation to:

```js
  assert.deepEqual(staging.summarizeImportPreviews(previewFiles), {
    validRows: 2,
    duplicates: 1,
    skippedRows: 1,
    fileErrors: 1,
    notices: 1,
    importableRows: 1,
  });
```

In both `buildImportPreviewDisplay` expectations in that file:
- add `fileIssueCode: null` to the detected-file case
- add `fileIssueCode: "unsupported"` to the unsupported case

Then add:

```js
test("flags non-transaction files with their issue code", () => {
  const [display] = staging.buildImportPreviewDisplay([previewFiles[2]]);
  assert.equal(display.fileIssueCode, "not_transactions");
  assert.equal(display.fileIssue, "CAL bank-charges summary");
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node --test scripts/test-import-detection.mjs && node --conditions react-server --experimental-transform-types --test scripts/test-setup-import-and-budget-suggestions.mjs`
Expected: FAIL. Detection returns `unsupported`, and display rows have no `fileIssueCode` and no `notices`.

- [ ] **Step 4: Implement detection**

In `src/lib/imports/template-detector.js`, below `IMPORT_SIGNATURES`:

```js
// Exports that look like bank or card files but hold no individual
// transactions. Importing them would double count.
const NON_TRANSACTION_SIGNATURES = [
  {
    container: "open_xml",
    headers: ["תאריך חיוב", "כרטיס", "סכום", "מטבע"],
    message: "CAL bank-charges summary",
  },
];
```

In `detectImportTemplate`:
- build the same per-row `headers` set
- additionally record `nonTransaction = signature` when a `NON_TRANSACTION_SIGNATURES` entry matches
- before the final `return`, when `resolved.length === 0 && nonTransaction`, return:

```js
  if (resolved.length === 0 && nonTransaction) {
    return {
      ok: false,
      code: "not_transactions",
      message: nonTransaction.message,
      matches: [],
    };
  }
```

Declare `let nonTransaction = null;` next to `const matches = new Map();`. Inside the row loop, after the signature loop:

```js
      for (const signature of NON_TRANSACTION_SIGNATURES) {
        if (
          signature.container === container &&
          signature.headers.every((header) => headers.has(header))
        ) {
          nonTransaction = signature;
        }
      }
```

Widen the code union in both `src/lib/imports/import-types.ts` and `src/lib/imports/xlsx-parser.d.ts`:

```ts
  code: "unsupported" | "ambiguous" | "unreadable" | "not_transactions";
```

- [ ] **Step 5: Implement staging**

In `src/lib/imports/batch-staging.ts`, add `notices: number` to `ImportPreviewSummary` and update `summarizeImportPreviews`:

```ts
    (summary, file) => {
      const isNotice = file.fileIssue?.code === "not_transactions";
      return {
        validRows: summary.validRows + file.rows.length,
        duplicates: summary.duplicates + file.duplicateCount,
        skippedRows: summary.skippedRows + file.rowIssues.length,
        fileErrors: summary.fileErrors + (file.fileIssue && !isNotice ? 1 : 0),
        notices: summary.notices + (isNotice ? 1 : 0),
        importableRows:
          summary.importableRows + Math.max(0, file.rows.length - file.duplicateCount),
      };
    },
    {
      validRows: 0,
      duplicates: 0,
      skippedRows: 0,
      fileErrors: 0,
      notices: 0,
      importableRows: 0,
    }
```

In `buildImportPreviewDisplay`, add `fileIssueCode: file.fileIssue?.code ?? null,` after `skippedRows`.

Run `grep -rn "summarizeImportPreviews\|ImportPreviewSummary" src` and update any other consumer that spreads or exhaustively lists the summary fields.

- [ ] **Step 6: Implement the panel notice and its translations**

In `src/i18n/messages/en.json`, add a top-level namespace:

```json
  "importPreview": {
    "notTransactionsTitle": "Not a transaction file",
    "notTransactionsBody": "This is a CAL bank-charges summary: monthly card totals that are already in your bank statement. Import the card's transaction detail file instead."
  },
```

In `src/i18n/messages/he.json`:

```json
  "importPreview": {
    "notTransactionsTitle": "זה לא קובץ עסקאות",
    "notTransactionsBody": "זהו סיכום חיובים בבנק של כאל: סכומים חודשיים של הכרטיס שכבר מופיעים בדף הבנק. ייבאו במקום זאת את קובץ פירוט העסקאות של הכרטיס."
  },
```

In `src/components/imports/import-preview-panel.tsx`:
- add `"use client";` at the top if it is missing, plus `import { useTranslations } from "next-intl";` and `Info` from `lucide-react`
- call `const t = useTranslations("importPreview");` in `ImportPreviewPanel`
- inside the file map, compute `const isNotice = file.fileIssueCode === "not_transactions";` and `const hasIssues = Boolean((file.fileIssue && !isNotice) || file.issueLines.length > 0);`
- in the icon slot, render `<Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={t("notTransactionsTitle")} />` when `isNotice`
- replace the `file.fileIssue` block with:

```tsx
              {file.fileIssue && isNotice && (
                <div className="mt-3 break-words rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  <div className="font-medium text-foreground">{t("notTransactionsTitle")}</div>
                  {t("notTransactionsBody")}
                </div>
              )}

              {file.fileIssue && !isNotice && (
                <div className="mt-3 break-words rounded-md bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                  {file.fileIssue}
                </div>
              )}
```

- [ ] **Step 7: Run all import and logic tests**

Run: `npm run test:imports && npm run test:logic && npm run lint`
Expected: PASS.

- [ ] **Step 8: Manual check in the running app**

Run `npm run dev`. Open Home and click Import. Select the CAL bank-charges summary export from your own local files, plus one CAL statement export. Check:
- The summary file shows the muted "Not a transaction file" notice, not a red error.
- The File errors metric does not count it.
- The statement file shows as CAL with valid rows.

Switch the locale to Hebrew (Settings, General) and confirm that the notice text and layout are right in RTL. Do not commit any screenshot taken from the live database.

- [ ] **Step 9: Commit**

```bash
git add scripts/import-workbook-test-helpers.mjs scripts/test-import-detection.mjs scripts/test-setup-import-and-budget-suggestions.mjs src/lib/imports/template-detector.js src/lib/imports/import-types.ts src/lib/imports/xlsx-parser.d.ts src/lib/imports/batch-staging.ts src/components/imports/import-preview-panel.tsx src/i18n/messages/en.json src/i18n/messages/he.json
git diff --cached
git commit -F - <<'EOF'
feat: explain CAL bank-charges summaries instead of rejecting them

CAL's "bank charges" page exports monthly card totals that were debited
from the bank. It has no individual purchases, and those totals already
appear in the bank statement, so importing it would double count. It was
reported as an unsupported format, which gave no hint what to do.

- Add known non-transaction layouts to the detector and report them
  with a new not_transactions file issue code.
- Show it in the import preview as a muted notice that points to the
  card's transaction detail export, and keep it out of the file error
  count. Text is translated to English and Hebrew.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 4: Treat "כרטיסי אשראי" bank rows as card payments

**Files:**
- Modify: `src/server/lib/transfers.ts:34`
- Create: `src/server/db/migrations/024_credit_card_payment_plural.sql`
- Test: `scripts/test-transaction-ai-logic.mjs`, `scripts/test-income-transfer-category.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `detectKind("כרטיסי אשראי לדוגמה", <bank provider>, negative)` returns `"transfer"`.

- [ ] **Step 1: Write the failing detectKind test**

In `scripts/test-transaction-ai-logic.mjs`, add inside the existing `classifies bank account credit card settlements as transfers` test:

```js
  assert.equal(
    transfers.detectKind("כרטיסי אשראי לדוגמה", "leumi_bank_account", -480),
    "transfer"
  );
```

- [ ] **Step 2: Write the failing migration test**

In `scripts/test-income-transfer-category.mjs`, add a test that builds its own database:
- run every migration before 024
- insert a bank row
- run 024
- assert the kind changed

```js
test("migration 024 reclassifies plural credit card payments as transfers", () => {
  const migrationsDir = path.join(process.cwd(), "src", "server", "db", "migrations");
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  const scratch = new Database(path.join(dataDir, "migration-024.db"));
  try {
    for (const file of files.filter((name) => name < "024")) {
      scratch.pragma("foreign_keys = OFF");
      scratch.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
      scratch.pragma("foreign_keys = ON");
    }
    const runId = scratch
      .prepare(
        `INSERT INTO sync_runs (workspace_id, provider, started_at, status, scrape_from_date)
         VALUES (1, 'leumi_bank_account', '2026-08-01', 'completed', '2026-08-01')`
      )
      .run().lastInsertRowid;
    const insert = scratch.prepare(
      `INSERT INTO transactions (workspace_id, account_number, date, processed_date,
         original_amount, original_currency, charged_amount, description, type, status,
         provider, sync_run_id, dedup_hash, kind)
       VALUES (1, '000', '2026-08-02', '2026-08-02', ?, 'ILS', ?, ?, 'normal', 'completed',
         ?, ?, ?, 'expense')`
    );
    insert.run(-480, -480, "כרטיסי אשראי לדוגמה", "leumi_bank_account", runId, "h1");
    insert.run(-60, -60, "כרטיסי אשראי לדוגמה", "isracard_bill", runId, "h2");

    scratch.exec(readFileSync(path.join(migrationsDir, "024_credit_card_payment_plural.sql"), "utf8"));

    const kinds = scratch
      .prepare("SELECT provider, kind FROM transactions ORDER BY provider")
      .all();
    assert.deepEqual(kinds, [
      { provider: "isracard_bill", kind: "expense" },
      { provider: "leumi_bank_account", kind: "transfer" },
    ]);
  } finally {
    scratch.close();
  }
});
```

Because the shared `runSqlMigrations` at the top of the file runs every migration, it will apply 024 once the file exists. That is intended.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm run test:logic`
Expected:
- the `detectKind` assertion fails (`expense` vs `transfer`)
- the migration test fails with ENOENT for `024_credit_card_payment_plural.sql`

- [ ] **Step 4: Implement the pattern and the migration**

In `src/server/lib/transfers.ts`, replace `/כרטיס\s*אשראי/i,` with:

```ts
  /כרטיסי?\s*אשראי/i,
```

Create `src/server/db/migrations/024_credit_card_payment_plural.sql`:

```sql
-- Some banks describe the card bill debit as "כרטיסי אשראי" (plural). The
-- singular pattern missed it, so those rows counted as expenses on top of
-- the card purchases imported from the card files.
UPDATE transactions
SET kind = 'transfer', updated_at = datetime('now')
WHERE provider IN (
  'hapoalim_bank_account',
  'leumi_bank_account',
  'hapoalim',
  'leumi',
  'mizrahi',
  'discount',
  'mercantile',
  'beinleumi',
  'otsarHahayal',
  'union',
  'pagi',
  'yahav',
  'massad',
  'oneZero'
)
  AND kind <> 'transfer'
  AND description LIKE '%כרטיסי אשראי%';
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm run test:logic && npm run test:imports && npm run lint`
Expected: PASS.

- [ ] **Step 6: Hand the live-data check to the user**

Do not open `data/`. The migration test above covers the logic. In the summary for this plan, ask the user to restart their own app (so migration 024 applies to their database) and confirm on Home that this month's expenses dropped by the card-bill amount instead of growing.

- [ ] **Step 7: Commit**

```bash
git add src/server/lib/transfers.ts src/server/db/migrations/024_credit_card_payment_plural.sql scripts/test-transaction-ai-logic.mjs scripts/test-income-transfer-category.mjs
git diff --cached
git commit -F - <<'EOF'
fix: treat plural credit card bank debits as card payments

Some bank exports describe the monthly card bill debit as "כרטיסי אשראי".
The card payment pattern only matched the singular form, so those debits
were classified as expenses and the same spending was counted twice once
the card's own transactions were imported.

- Match an optional plural yod in the card payment pattern.
- Add migration 024 to reclassify existing bank rows with that
  description as transfers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 5: End-to-end import check (no commit)

- [ ] **Step 1:** With `npm run dev` running, import all CAL statement exports and your bank statement through Home → Import.
- [ ] **Step 2:** In the preview:
  - each statement file is detected as CAL
  - rows that were already imported from the legacy CAL export appear as duplicates
  - the statement with a future billing date shows its rows
- [ ] **Step 3:** After commit:
  - the pending rows appear as pending in Transactions and are not counted in Home totals
  - re-importing a statement whose billing date has passed flips earlier pending rows to completed. This is handled by the existing `ON CONFLICT ... DO UPDATE` in `insertTransactions`, `src/server/db/queries/transactions.ts:80-85`.
- [ ] **Step 4:** Report the counts (files, new rows, duplicates) to the user. Report no row contents.
