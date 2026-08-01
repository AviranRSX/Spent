# Max Missing Charged Amount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Max rows with a valid original amount and a blank charged amount as ordinary completed transactions.

**Architecture:** Keep the change inside the existing `max_bill` parser. Derive an effective charged amount and currency from the original fields only when the Max charged fields are blank, then pass the normalized transaction through the unchanged import, deduplication, categorization, and reporting paths.

**Tech Stack:** Node.js test runner, JavaScript, JSZip workbook parser, TypeScript application types

## Global Constraints

- Apply fallback behavior only to the `max_bill` parser.
- Preserve a present charged amount and currency.
- Store supported Max rows as `completed` transactions.
- Keep other workbook template validation unchanged.
- Do not use em dashes in code, comments, documentation, or commit messages.
- Preserve existing user changes in the dirty worktree.

---

### Task 1: Normalize Missing Max Charged Fields

**Files:**
- Modify: `scripts/test-import-parsers.mjs`
- Modify: `src/lib/imports/xlsx-parser.js:408-458`

**Interfaces:**
- Consumes: `parseWorkbookBuffer(buffer, { templateType: "max_bill", sourceLabel: string })`
- Produces: existing `{ transactions, rowIssues }` result with normalized `chargedAmount`, `chargedCurrency`, and `status` fields

- [ ] **Step 1: Add the exact-workbook regression test**

Add this test after the current Max sample test coverage in `scripts/test-import-parsers.mjs`:

```js
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
```

- [ ] **Step 2: Add validation coverage for rows with no usable amount**

Add a synthetic Max workbook test:

```js
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
```

- [ ] **Step 3: Run the parser tests and verify the regression fails**

Run:

```bash
node --test scripts/test-import-parsers.mjs
```

Expected: the exact-workbook test fails because rows 5 and 6 appear in `rowIssues` as missing charged amounts and no transactions are returned. The no-amount validation test passes, confirming existing invalid-row behavior.

- [ ] **Step 4: Implement Max-only amount and currency fallback**

In `parseCreditCardExport`, retain the raw charged and original fields, compute original values first, and derive charged values as follows:

```js
const rawChargedAmount = vals[5];
const rawOriginalAmount = vals[7];
const originalAmount = signedCardAmount(rawOriginalAmount);
const chargedAmount =
  signedCardAmount(rawChargedAmount) ??
  (asText(rawChargedAmount) ? null : originalAmount);
const originalCurrency = currencyCode(vals[8]);
const chargedCurrency = asText(vals[6])
  ? currencyCode(vals[6])
  : originalCurrency;
```

Validate the effective charged amount without hiding a malformed nonblank charged value:

```js
const chargedAmountProblem = asText(rawChargedAmount)
  ? requiredAmountProblem(rawChargedAmount, chargedAmount, "charged amount")
  : originalAmount == null
    ? "Missing charged amount"
    : null;
```

Use `chargedAmountProblem` in the row problem list, keep original-amount validation, assign `originalCurrency` and `chargedCurrency` to the transaction, and retain `status: "completed"`.

- [ ] **Step 5: Run the focused parser tests and verify they pass**

Run:

```bash
node --test scripts/test-import-parsers.mjs
```

Expected: all parser tests pass, including two imported completed rows from `transaction-details_export_1785570692278.xlsx` and rejection of the row with neither amount.

- [ ] **Step 6: Run the full import suite**

Run:

```bash
npm run test:imports
```

Expected: all parser, template-detection, and preview-orchestration tests pass.

- [ ] **Step 7: Run lint**

Run:

```bash
npm run lint
```

Expected: ESLint exits successfully with no new errors or warnings from the changed files.

- [ ] **Step 8: Review the scoped diff**

Run:

```bash
git diff -- scripts/test-import-parsers.mjs src/lib/imports/xlsx-parser.js
```

Expected: only the Max regression tests and Max parser normalization are added. Existing unrelated worktree changes remain intact.

- [ ] **Step 9: Commit after explicit authorization**

After the user explicitly authorizes a commit:

```bash
git add scripts/test-import-parsers.mjs src/lib/imports/xlsx-parser.js
git commit -m "fix: import Max rows without charged amounts"
```
