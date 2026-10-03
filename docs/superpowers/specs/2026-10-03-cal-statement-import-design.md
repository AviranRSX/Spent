# CAL statement import fix: design

Date: 2026-10-03
Status: approved
Order: sub-project 1 of 3 (then home redesign, then trips)

## Problem

Importing two kinds of CAL workbooks fails with "Unsupported workbook format":

- CAL's "current statement" export for a card (one file per billing cycle)
- CAL's "bank charges summary" export

### Root causes

**Card statements.** These come from CAL's "current statement" export. They are not CAL's "transactions and credits" export, which the `cal_bill` signature in `src/lib/imports/template-detector.js` was built from.

| | Old export (supported) | Statement export (failing) |
|---|---|---|
| Headers | `תאריך עסקה`, `שם בית עסק`, `סכום בש"ח`, `מועד חיוב` | `תאריך\r\nעסקה`, `שם בית עסק`, `סכום\r\nעסקה`, `סכום\r\nחיוב`, `סוג\r\nעסקה`, `ענף`, `הערות` |
| Billing date | per-row `מועד חיוב` column | only in row 3: `עסקאות לחיוב ב-DD/MM/YYYY: 1,234.56 ₪` |
| Card number | row 1, `...לכרטיס מאסטרקארד 1234` | row 1, `...המסתיים ב-1234` |

Shared traits of the statement export:
- Row 1 identifies the account and card.
- Dates are Excel serial numbers and amounts are positive numbers.
- `סוג עסקה` is `רגילה` or `הוראת קבע`.
- The last row is a footer sentence starting `את המידע המלא על כל עסקה`.

Two of the four required `cal_bill` headers are missing, so no signature matches. Detection already normalizes `\r\n` and scans every row of every sheet, so header offset and sheet name are not the problem.

**Bank charges summary.**
- Headers: `תאריך חיוב`, `כרטיס`, `סכום`, `מטבע`.
- It holds monthly card totals that were debited from the bank, with no individual purchases.
- Importing it would double count the bank statement's card-payment rows, so it must be rejected with a clear explanation.

**Related bug found during diagnosis.**
- Some bank exports describe the card bill debit with the plural form `כרטיסי אשראי`, which `/כרטיס\s*אשראי/` in `src/server/lib/transfers.ts` does not match because of the extra `י`.
- Such a debit is therefore counted as an expense.
- It equals the card's statement total, so once the statement is imported the same spending is counted twice.

## Design

### 1. Second `cal_bill` signature and parser variant

- Add a second entry to `IMPORT_SIGNATURES` with `templateType: "cal_bill"`, `kind: "card"`, `container: "open_xml"`.
  - Its headers: `["תאריך עסקה", "שם בית עסק", "סכום עסקה", "סכום חיוב", "סוג עסקה"]`.
  - Reusing `cal_bill` keeps the provider id, account number and dedup hashes consistent with the CAL rows already stored.
  - Two signatures with the same `templateType` must count as one match, not "ambiguous". Verify the detector's dedupe by `templateType`, and add it if missing.
- `parseCalBill` in `src/lib/imports/xlsx-parser.js` keeps finding columns by header name and gains a variant branch for when `סכום חיוב` is present:
  - **account:** the existing `מסתיים ב-(\d{4,})` regex on row 1. It already matches `המסתיים ב-1234`.
  - **date:** the `תאריך עסקה` serial, converted with `excelSerialToISO`.
  - **chargedAmount:** `-סכום חיוב`. **originalAmount:** `-סכום עסקה`. The sign convention is the same as the existing CAL branch.
  - **currencies:**
    - ILS when the amount cell is a number.
    - When the cell is text with a currency symbol or code, parse the number and record the currency raw, the same way the other parsers do.
    - The charged currency is always ILS.
  - **processedDate:** parsed from the first row matching `עסקאות לחיוב ב-(\d{2}/\d{2}/\d{4})`. If it is missing, fall back to the transaction date.
  - **status:** `pending` if processedDate is after today, otherwise `completed`.
  - **type:** `installments` when `סוג עסקה` contains `תשלום`, otherwise `normal`.
  - **memo:** `ענף`, with `הערות` appended when present. Memo is not part of the dedup hash.
  - **Skipped rows:** any row whose date cell is not a date, which covers the footer and blank rows.
- **Dedup compatibility.**
  - For ILS rows, the variant must produce the same `accountNumber`, `date`, `originalAmount`, `originalCurrency` and `description` as the old export, so rows that appear in both exports dedupe.
  - Foreign-currency rows can't hash identically across the two exports, because the old export only carried ILS. The provided files have no foreign rows (`סכום עסקה == סכום חיוב` everywhere), so this is accepted.

### 2. Pending to completed on re-import

- When an imported row's dedup hash matches an existing row, the stored row's status is `pending`, and the incoming row is `completed`, update the stored row's `status` and `processed_date`.
- Nothing else changes and no new row is inserted.
- This applies to the import commit path. If the sync path shares the insert helper, apply it there too.

### 3. Reject the bank summary with a clear issue

- Add a non-transactional signature for the CAL bank-charges summary, with headers `["תאריך חיוב", "כרטיס", "סכום", "מטבע"]`.
- When it matches, the file produces a `ImportFileIssue` with a new code `not_transactions`:
  - "This is a CAL bank-charges summary (monthly card totals already in your bank statement). Import the card's transaction detail file instead."
  - The text goes through i18n, in en and he.
- Extend the `code` union in:
  - `src/lib/imports/import-types.ts`
  - `src/lib/imports/xlsx-parser.d.ts`
  - any UI switch over issue codes
- The preview panel shows this as an informational notice, not an error.

### 4. Card-payment pattern

- Change `/כרטיס\s*אשראי/i` to `/כרטיסי?\s*אשראי/i` in `src/server/lib/transfers.ts`.
- Add migration `024_credit_card_payment_plural.sql`:
  - Sets `kind = 'transfer'` on bank-provider rows (the same provider list as `022_bank_import_kinds.sql`) whose description contains `כרטיסי אשראי`.
  - Only touches rows that are not already transfers.

## Testing

- Add synthetic builders for the statement export and the bank summary to `scripts/import-workbook-test-helpers.mjs`. They copy the real layout (row 1 card line, row 3 billing line, header row, footer sentence) with invented merchants, amounts and card digits. Never read the real exports from `transactions/` in tests.
- `scripts/test-import-detection.mjs`: the statement fixture detects as `cal_bill`/`card`, and the bank summary fixture as a `not_transactions` issue.
- `scripts/test-import-parsers.mjs`:
  - Variant parsing: row count, account, amounts, processed date, pending status for the future billing date, footer skipped.
  - Totals per file equal the row-3 total.
- Dedup test: for a row present in both fixtures, the hash from the statement export equals the hash from the old export.
- Transfer pattern test: a plural `כרטיסי אשראי` description is detected as a transfer for bank providers.
- Run `npm run test:imports` and `npm run test:logic`.
- Manually import the files in the running app and confirm the preview counts, the duplicates skipped, and the bank summary notice.

## Out of scope

- Other CAL export variants not present in the samples.
- Changing dedup hash inputs.
