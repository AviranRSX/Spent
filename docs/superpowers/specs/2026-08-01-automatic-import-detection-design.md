# Automatic Transaction Import Detection and Row Error Preview

Date: 2026-08-01

## Summary

Spent will identify supported transaction workbooks from their content during Preview. Users will no longer choose a bank or credit-card template for each file. Both the setup wizard and the dashboard import dialog will show the detected provider after Preview, list each invalid Excel row with its exact problems, and allow Load to import valid non-duplicate rows while skipping invalid rows.

## Goals

- Detect Isracard, Max, CAL, Hapoalim, and Leumi exports deterministically from workbook structure and headers.
- Remove manual source-kind and provider-template selection from both active file import screens.
- Show the detected provider and source kind after Preview.
- Report the sheet, Excel row number, and exact validation problems for every invalid transaction row.
- Let users load valid rows even when other rows or files contain errors.
- Preserve existing duplicate detection and transaction insertion behavior.

## Non-goals

- Inferring a provider from a filename.
- Guessing when no rule or multiple rules match.
- Adding new providers or redesigning the XLSX versus scraper setup choice.
- Changing the database schema, transaction categorization, or duplicate hash.
- Allowing manual provider overrides in this iteration.

## Evidence From the Sample Workbooks

The current `transactions` directory contains examples of every supported import type. Content-based inspection separates them without using filenames:

| Provider | Sample family | Workbook structure | Distinguishing header features |
| --- | --- | --- | --- |
| Isracard | `0103_*`, `2437_*`, `3497_*` | Open XML workbook | `תאריך רכישה`, `שם בית עסק`, `סכום עסקה`, `סכום חיוב` |
| Max | `transaction-details_export_*` | Open XML workbook | `תאריך עסקה`, `שם בית העסק`, card-last-digits column, `סכום חיוב` |
| CAL | `פירוט עסקאות וזיכויים(1).xlsx` | Open XML workbook | `תאריך עסקה`, `שם בית עסק`, `סכום בש"ח`, `מועד חיוב` |
| Hapoalim | `excelNewTransactions.xlsx` | Open XML workbook | `תאריך`, `הפעולה`, `חובה`, `זכות`, `תאריך ערך` |
| Leumi | `תנועות בחשבון 1_8_2026.xls` | HTML table workbook | `תאריך`, `תאריך ערך`, `תיאור`, `בחובה`, `בזכות` |

The sample filenames are test fixtures only. They are not classification inputs.

## Deterministic Classification Rules

### Header normalization

Before matching, each cell used for classification is normalized in the same way:

1. Convert the cell to text.
2. Remove left-to-right and right-to-left direction marks.
3. Replace line breaks and repeated whitespace with one space.
4. Trim leading and trailing whitespace.
5. Decode HTML entities for HTML workbooks.
6. Preserve meaningful Hebrew text, quotes, and words. Do not use fuzzy matching.

Headers may appear on any row in any worksheet. Column positions outside the required signature do not affect detection. A signature matches only when all of its required normalized header cells occur in the same row.

### Provider signatures

| Selected template | Source kind | Required container | Required normalized header cells |
| --- | --- | --- | --- |
| `isracard_bill` | Credit card | Open XML | `תאריך רכישה`, `שם בית עסק`, `סכום עסקה`, `מטבע עסקה`, `סכום חיוב`, `מטבע חיוב`, `מס' שובר`, `פירוט נוסף` |
| `max_bill` | Credit card | Open XML | `תאריך עסקה`, `שם בית העסק`, `4 ספרות אחרונות של כרטיס האשראי`, `סוג עסקה`, `סכום חיוב`, `מטבע חיוב`, `סכום עסקה מקורי`, `מטבע עסקה מקורי`, `תאריך חיוב` |
| `cal_bill` | Credit card | Open XML | `תאריך עסקה`, `שם בית עסק`, `סכום בש"ח`, `מועד חיוב` |
| `hapoalim_bank_account` | Bank account | Open XML | `תאריך`, `הפעולה`, `חובה`, `זכות`, `תאריך ערך` |
| `leumi_bank_account` | Bank account | HTML table | `תאריך`, `תאריך ערך`, `תיאור`, `אסמכתא`, `בחובה`, `בזכות` |

The Max rule uses `שם בית העסק`, while CAL uses `שם בית עסק`. This difference is meaningful and is preserved by normalization. The Isracard rule requires `תאריך רכישה`, so its broader amount terms cannot cause a CAL match.

### Match resolution

- Exactly one signature matches: select that provider and source kind.
- No signature matches: return a file-level `Unsupported workbook format` issue.
- More than one signature matches: return a file-level `Ambiguous workbook format` issue and list the matching providers.
- A file-level detection issue produces no transactions for that file but does not prevent other files in the batch from being previewed or loaded.
- Detection never falls back to filename, extension alone, valid-row count, or parser trial scoring.

The file extension remains a file-picker filter. Classification trusts the inspected container and headers rather than the extension.

## Architecture and Data Flow

### Client selection

The selected-file state will contain only the file identity and `File` object. Before Preview, each row will say that the source is detected during preview. Existing provider and source-kind selectors will be removed.

### Preview request

`previewImportFiles` will submit the files without client-selected import metadata. The preview route will process every file independently:

1. Inspect the workbook container and normalized headers.
2. Resolve one deterministic provider signature.
3. Parse with only the selected provider parser.
4. Validate transaction rows.
5. Apply existing duplicate detection to valid parsed rows.
6. Return a preview result for the file, including detection details, valid rows, duplicate count, row issues, and any file issue.

One unsupported or malformed file will not turn the entire batch request into an HTTP error. Request-level failures remain reserved for malformed multipart requests or unexpected server failures.

### Preview response

Each file preview will carry:

- `fileName`
- detected `kind` and `templateType`, or `null` when detection fails
- valid parsed `rows`
- `duplicateCount`
- `rowIssues`
- optional `fileIssue`

The commit request will include only preview files with a detected template and valid rows. Existing server-side validation of template and source-kind pairs remains in place.

## Row Validation and Error Model

Parsers currently return broad messages such as `Missing date, merchant, or amount`. They will instead collect exact problems for each candidate transaction row.

Each invalid row produces one issue:

```ts
interface ImportRowIssue {
  sheetName: string;
  rowNumber: number;
  problems: string[];
}
```

Example problems include:

- `Missing merchant`
- `Invalid purchase date: expected DD.MM.YYYY`
- `Missing charged amount`
- `Invalid original amount: "abc" is not a number`

When several fields are invalid on the same row, that row has one issue containing all problems. This keeps the skipped-row count equal to the number of invalid transaction rows. Blank rows, totals, explanatory text, and known footer rows remain ignored rather than reported as errors.

Valid rows are returned even when neighboring rows are invalid. Parser failures that make the whole workbook unreadable become file-level issues.

## User Interface

The same preview behavior will be used in:

- the setup wizard import step
- the dashboard `Load transactions` dialog

Before Preview, selected files show `Source detected during preview`. After Preview, each file summary shows:

- provider label, such as `Isracard`
- source kind, such as `Credit card`
- valid row count
- duplicate count
- skipped invalid row count

Detailed issues appear below the summary, grouped by file. A row issue is rendered in a directly actionable format:

`Sheet1 | Excel row 21 | Invalid charged amount: value is empty`

File-level issues are shown in the same grouped area without an Excel row number. Error details remain visible while the user decides whether to correct the file or continue with valid rows.

## Load Semantics

- Load is enabled when the batch contains at least one valid non-duplicate row.
- The primary action states the number of importable rows, for example `Load 42 valid rows`.
- Invalid rows and files with detection failures are omitted from the commit payload.
- Existing duplicate handling remains authoritative. Duplicate rows are not added again.
- Completion feedback reports new transactions added and invalid rows skipped.
- If there are no valid non-duplicate rows, Load remains disabled and Preview still shows all detection and validation details.

## Testing Strategy

Implementation follows test-driven development.

### Detector tests

- Detect every current sample workbook as its expected provider and source kind.
- Rename fixture inputs in memory to prove filenames do not affect detection.
- Verify header whitespace and line-break normalization.
- Reject a workbook with no matching signature.
- Reject a synthetic workbook containing signatures for more than one provider.
- Verify that detection does not choose the parser producing the most rows.

### Parser and validation tests

- Preserve valid transaction parsing for each provider.
- Return exact problems and the physical Excel row number for invalid dates, descriptions, and amounts.
- Return one issue with multiple problems when one row has multiple invalid fields.
- Keep valid rows when another row is invalid.
- Ignore blank, total, and footer rows.

### Preview and staging tests

- Preview multiple files when one file is unsupported.
- Summarize valid, duplicate, and skipped rows correctly.
- Build a commit payload containing detected files and valid rows only.
- Enable loading only when at least one valid non-duplicate row exists.

### UI verification

- Run import and logic tests, lint, and TypeScript checks.
- Start the application and inspect the setup wizard import step and dashboard import dialog in the browser.
- Confirm detected provider labels and row-level errors remain readable in both light and dark themes at narrow and desktop widths.

## Compatibility and Security

- Parsing remains server-side and in memory.
- Uploaded workbook contents and transaction values are not logged.
- No database migration is needed.
- Existing saved transactions and dedup hashes are unchanged.
- Existing commit validation remains in place even though normal clients receive provider metadata from Preview.

## Acceptance Criteria

1. Neither active file import screen asks the user to select a bank, card provider, or import template.
2. Preview deterministically classifies all supported sample formats by content.
3. The setup wizard shows the selected provider and source kind after Preview.
4. Every invalid transaction row shows its sheet, physical Excel row number, and exact field problems.
5. Load imports valid non-duplicate rows while skipping invalid rows.
6. Unknown and ambiguous files are explained without blocking valid files in the same batch.
7. Duplicate behavior, categorization, and existing stored data remain unchanged.
