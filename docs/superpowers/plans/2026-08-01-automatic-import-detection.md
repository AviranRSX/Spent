# Automatic Transaction Import Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically classify supported transaction workbooks during Preview, show exact row-level problems, and load valid rows from both import screens without manual provider selection.

**Architecture:** A pure signature matcher will classify normalized workbook headers, while the existing workbook parser remains responsible for provider-specific transaction extraction. The preview API will become the authority for provider metadata and will return a result for every file, including unsupported files. Shared staging helpers and a reusable preview panel will keep setup and dashboard behavior identical.

**Tech Stack:** Next.js 16 App Router Route Handlers, React 19, TypeScript strict mode, Node test runner, JSZip, shadcn/ui v4 with base-ui, Tailwind CSS v4.

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and the request payload section of `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md` before editing the preview Route Handler.
- Next.js Route Handlers use the Web `Request` API and `await request.formData()` for the multipart preview request.
- TypeScript remains in strict mode. Do not add `any`.
- Do not use em dashes in code, comments, documentation, or commit messages.
- Keep workbook parsing server-side and in memory. Do not log uploaded contents or transaction values.
- Preserve the existing database schema, dedup hash, categorization flow, and source terminology.
- Use exact normalized header matching only. Do not classify by filename, extension alone, fuzzy matching, parser row counts, or trial-parser scoring.
- A detection failure in one file must not prevent other files in the same batch from being previewed or loaded.
- Invalid rows are excluded from parsed rows. Valid rows and existing duplicate behavior remain unchanged.
- Follow test-driven development for every behavior change: failing test, observed expected failure, minimal implementation, passing test, then refactor.

---

## File Structure

### New files

- `src/lib/imports/template-detector.js`: Pure normalization, signature matching, and match-resolution logic.
- `scripts/import-workbook-test-helpers.mjs`: Minimal in-memory Open XML workbook builder for detector and parser tests.
- `scripts/test-import-detection.mjs`: Real-sample and synthetic classification tests.
- `src/lib/imports/import-types.ts`: Shared client and server preview result types.
- `src/components/imports/import-preview-panel.tsx`: Shared detected-provider summary and detailed issue presentation.

### Modified files

- `src/lib/imports/xlsx-parser.js`: Inspect workbook containers, expose automatic detection, and return precise row issues.
- `src/lib/imports/xlsx-parser.d.ts`: Type detection results and row issues.
- `scripts/test-import-parsers.mjs`: Replace stale fixtures with the current sample set and add invalid-row integration coverage.
- `package.json`: Add the detector test file to `test:imports`.
- `src/app/api/imports/preview/route.ts`: Remove client metadata, detect every file, and return per-file issues.
- `src/lib/imports/batch-staging.ts`: Remove template defaults and calculate valid, duplicate, skipped, file-error, and importable counts.
- `scripts/test-setup-import-and-budget-suggestions.mjs`: Cover metadata-free staging, preview summaries, commit selection, and display formatting.
- `src/lib/api.ts`: Send files only, consume shared preview types, and commit detected valid previews.
- `src/server/imports/import-transactions.ts`: Align preview interfaces with row issues while keeping commit input strict.
- `src/components/setup/setup-import-step.tsx`: Remove selectors, use detected preview data, show detailed issues, and allow valid-row loading.
- `src/components/dashboard/import-xlsx-button.tsx`: Apply the same behavior in the dashboard dialog.

---

### Task 1: Deterministic Workbook Classification

**Files:**

- Create: `src/lib/imports/template-detector.js`
- Create: `scripts/import-workbook-test-helpers.mjs`
- Create: `scripts/test-import-detection.mjs`
- Modify: `src/lib/imports/xlsx-parser.js`
- Modify: `src/lib/imports/xlsx-parser.d.ts`
- Modify: `package.json`

**Interfaces:**

- Produces `detectImportTemplate(container, workbook)` in `template-detector.js`.
- Produces `detectWorkbookBuffer(buffer): Promise<ImportDetectionResult>` in `xlsx-parser.js`.
- `ImportDetectionResult` is a discriminated union with `ok: true` for one match and `ok: false` for unsupported, ambiguous, or unreadable workbooks.
- Later tasks consume `templateType`, `kind`, `code`, `message`, and `matches` from this result.

- [ ] **Step 1: Create the minimal workbook test helper**

Add an in-memory workbook builder that matches the deliberately small subset read by `readOpenXmlWorkbook`:

```js
import JSZip from "jszip";

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

export async function buildOpenXmlWorkbook(rows) {
  const rowXml = rows
    .map((values, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = values
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowNumber}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  const zip = new JSZip();
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData>${rowXml}</sheetData></worksheet>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
```

- [ ] **Step 2: Write failing real-sample detection tests**

Create `scripts/test-import-detection.mjs` with the complete expected classification matrix:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { detectWorkbookBuffer } from "../src/lib/imports/xlsx-parser.js";

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
```

- [ ] **Step 3: Write failing normalization and failure-resolution tests**

Use `buildOpenXmlWorkbook` to cover line breaks, unsupported content, and ambiguity without relying on filenames:

```js
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
```

- [ ] **Step 4: Run the detector test and observe the expected failure**

Run:

```powershell
node --test scripts/test-import-detection.mjs
```

Expected: FAIL because `detectWorkbookBuffer` and `template-detector.js` do not exist.

- [ ] **Step 5: Implement exact signature matching**

Create `template-detector.js` with these signatures and no fuzzy fallback:

```js
const IMPORT_SIGNATURES = [
  {
    templateType: "isracard_bill",
    kind: "card",
    container: "open_xml",
    headers: ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב", "מס' שובר", "פירוט נוסף"],
  },
  {
    templateType: "max_bill",
    kind: "card",
    container: "open_xml",
    headers: ["תאריך עסקה", "שם בית העסק", "4 ספרות אחרונות של כרטיס האשראי", "סוג עסקה", "סכום חיוב", "מטבע חיוב", "סכום עסקה מקורי", "מטבע עסקה מקורי", "תאריך חיוב"],
  },
  {
    templateType: "cal_bill",
    kind: "card",
    container: "open_xml",
    headers: ["תאריך עסקה", "שם בית עסק", "סכום בש\"ח", "מועד חיוב"],
  },
  {
    templateType: "hapoalim_bank_account",
    kind: "bank",
    container: "open_xml",
    headers: ["תאריך", "הפעולה", "חובה", "זכות", "תאריך ערך"],
  },
  {
    templateType: "leumi_bank_account",
    kind: "bank",
    container: "html",
    headers: ["תאריך", "תאריך ערך", "תיאור", "אסמכתא", "בחובה", "בזכות"],
  },
];

function normalizeImportHeader(value) {
  return String(value ?? "")
    .replace(/[\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectImportTemplate(container, workbook) {
  const matches = new Map();
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const headers = new Set(
        (sheet.getRow(rowNumber).values ?? []).map(normalizeImportHeader)
      );
      for (const signature of IMPORT_SIGNATURES) {
        if (
          signature.container === container &&
          signature.headers.every((header) => headers.has(header))
        ) {
          matches.set(signature.templateType, signature);
        }
      }
    }
  }

  const resolved = [...matches.values()];
  if (resolved.length === 1) {
    return {
      ok: true,
      templateType: resolved[0].templateType,
      kind: resolved[0].kind,
    };
  }
  return {
    ok: false,
    code: resolved.length === 0 ? "unsupported" : "ambiguous",
    message:
      resolved.length === 0
        ? "Unsupported workbook format"
        : "Ambiguous workbook format",
    matches: resolved.map((entry) => entry.templateType),
  };
}

module.exports = {
  detectImportTemplate,
  normalizeImportHeader,
};
```

In `xlsx-parser.js`, load the detector with `const { detectImportTemplate } = require("./template-detector.js")`. Add content inspection that detects HTML table workbooks before trying Open XML, reuses `readHtmlWorkbook` and `readOpenXmlWorkbook`, and catches unreadable inputs:

```js
async function inspectWorkbookBuffer(buffer) {
  const prefix = new TextDecoder("utf-8")
    .decode(buffer.subarray(0, Math.min(buffer.length, 4096)))
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (/<(?:html|table|tr)\b/i.test(prefix)) {
    return { container: "html", workbook: readHtmlWorkbook(buffer) };
  }
  return { container: "open_xml", workbook: await readOpenXmlWorkbook(buffer) };
}

async function detectWorkbookBuffer(buffer) {
  try {
    const inspected = await inspectWorkbookBuffer(buffer);
    return detectImportTemplate(inspected.container, inspected.workbook);
  } catch {
    return {
      ok: false,
      code: "unreadable",
      message: "Workbook could not be read",
      matches: [],
    };
  }
}
```

Export `detectWorkbookBuffer`, add its discriminated union to `xlsx-parser.d.ts`, and add `scripts/test-import-detection.mjs` to `test:imports`.

- [ ] **Step 6: Run detector and existing import tests**

Run:

```powershell
node --test scripts/test-import-detection.mjs
npm run test:imports
```

Expected: detector tests PASS. If `test:imports` still fails only because old parser fixture names are absent, record that exact failure for Task 2 rather than weakening detector assertions.

- [ ] **Step 7: Commit deterministic classification**

```powershell
git add package.json scripts/import-workbook-test-helpers.mjs scripts/test-import-detection.mjs src/lib/imports/template-detector.js src/lib/imports/xlsx-parser.js src/lib/imports/xlsx-parser.d.ts
git commit -m "feat: detect transaction import providers"
```

---

### Task 2: Exact Row-Level Parser Diagnostics

**Files:**

- Modify: `src/lib/imports/xlsx-parser.js`
- Modify: `src/lib/imports/xlsx-parser.d.ts`
- Modify: `scripts/test-import-parsers.mjs`
- Test helper: `scripts/import-workbook-test-helpers.mjs`

**Interfaces:**

- Consumes `detectWorkbookBuffer(buffer)` from Task 1 for automatic integration tests.
- Changes parser output from `errors` to `rowIssues`.
- Produces `ParsedImportRowIssue` with `{ sheetName, rowNumber, problems }`.
- `rowNumber` is always the physical one-based Excel row number.

- [ ] **Step 1: Replace stale sample references with current fixtures**

Retain one integration test per provider using these files:

```js
const providerSamples = [
  ["2437_07_2026.xlsx", "isracard_bill"],
  ["transaction-details_export_1785570699131.xlsx", "max_bill"],
  ["פירוט עסקאות וזיכויים(1).xlsx", "cal_bill"],
  ["excelNewTransactions.xlsx", "hapoalim_bank_account"],
  ["תנועות בחשבון 1_8_2026.xls", "leumi_bank_account"],
];
```

For every case, assert at least one parsed transaction, exact provider-specific account or field behavior where stable, and `rowIssues` rather than the removed `errors` property.

Use this loop so the fixture migration has a concrete baseline:

```js
for (const [fileName, templateType] of providerSamples) {
  test(`parses current ${templateType} sample`, async () => {
    const result = await parseWorkbookBuffer(await readSample(fileName), {
      templateType,
      sourceLabel: templateType,
    });
    assert.equal(result.transactions.length > 0, true);
    assert.equal(Array.isArray(result.rowIssues), true);
    assert.equal("errors" in result, false);
  });
}
```

- [ ] **Step 2: Write a failing precise-diagnostics test**

Build a minimal Isracard workbook with a full signature, one invalid row, and one valid row. Define the fixture once and reuse it:

```js
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
```

- [ ] **Step 3: Write failing ignored-row tests**

Add blank, total, and explanatory rows after the valid row and assert they create no row issues:

```js
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
```

- [ ] **Step 4: Run parser tests and observe the expected failures**

Run:

```powershell
node --test scripts/test-import-parsers.mjs
```

Expected: FAIL because parsers return broad `errors` messages and do not return `problems` arrays.

- [ ] **Step 5: Add reusable exact field validators**

In `xlsx-parser.js`, add helpers that distinguish missing from malformed values:

```js
function quotedValue(value) {
  return `"${asText(value)}"`;
}

function requiredTextProblem(value, label) {
  return asText(value) ? null : `Missing ${label}`;
}

function requiredDateProblem(value, parsed, label, expected) {
  if (!asText(value)) return `Missing ${label}`;
  return parsed
    ? null
    : `Invalid ${label}: ${quotedValue(value)} (expected ${expected})`;
}

function requiredAmountProblem(value, parsed, label) {
  if (!asText(value)) return `Missing ${label}`;
  return parsed == null
    ? `Invalid ${label}: ${quotedValue(value)} is not a number`
    : null;
}

function addRowIssue(rowIssues, sheetName, rowNumber, problems) {
  const present = problems.filter(Boolean);
  if (present.length > 0) {
    rowIssues.push({ sheetName, rowNumber, problems: present });
    return true;
  }
  return false;
}
```

- [ ] **Step 6: Apply exact validation to every provider parser**

Use one issue per candidate transaction row with these required fields and labels:

| Parser | Required fields |
| --- | --- |
| Isracard | purchase date, merchant, original amount, charged amount |
| Max | transaction date, merchant, charged amount, original amount |
| CAL | transaction date, merchant, original amount, charged amount |
| Hapoalim | transaction date, action, at least one numeric debit or credit amount |
| Leumi | transaction date, description, at least one numeric debit or credit amount |

Use these expected date descriptions in messages: Isracard `DD.MM.YYYY`, Max `DD-MM-YYYY or DD/MM/YYYY`, CAL `Excel date`, Hapoalim `Excel date`, and Leumi `DD/MM/YYYY`.

For each parser, calculate all field problems before `continue`. A row is a candidate only if it has transaction evidence such as a description plus an amount, a date plus an amount, or provider-specific transaction columns. Continue ignoring blank rows, totals containing `סך` or `סה"כ`, and explanatory rows with no transaction amounts. Preserve raw column positions in Leumi rows so empty cells do not shift debit, credit, or memo fields.

The Isracard pattern must follow this structure, and the other four parsers must use the field mapping in the table:

```js
const rawDate = vals[0];
const description = asText(vals[1]);
const originalAmount = signedCardAmount(vals[2]);
const chargedAmount = signedCardAmount(vals[4]);
const hasTransactionEvidence = Boolean(
  description || asText(vals[2]) || asText(vals[4])
);
if (!hasTransactionEvidence) continue;

const problems = [
  requiredDateProblem(rawDate, date, "purchase date", "DD.MM.YYYY"),
  requiredTextProblem(description, "merchant"),
  requiredAmountProblem(vals[2], originalAmount, "original amount"),
  requiredAmountProblem(vals[4], chargedAmount, "charged amount"),
];
if (addRowIssue(rowIssues, sheet.name, rowNo, problems)) continue;
```

Rename parser-local `errors` arrays and public result properties to `rowIssues`. Update `xlsx-parser.d.ts`:

```ts
export interface ParsedImportRowIssue {
  sheetName: string;
  rowNumber: number;
  problems: string[];
}
```

- [ ] **Step 7: Run parser and detector tests**

Run:

```powershell
npm run test:imports
```

Expected: all detector, parser, and template tests PASS with zero failures.

- [ ] **Step 8: Commit precise row diagnostics**

```powershell
git add scripts/test-import-parsers.mjs src/lib/imports/xlsx-parser.js src/lib/imports/xlsx-parser.d.ts
git commit -m "feat: report exact import row errors"
```

---

### Task 3: Preview API and Commit Staging Without Manual Metadata

**Files:**

- Create: `src/lib/imports/import-types.ts`
- Modify: `src/app/api/imports/preview/route.ts`
- Modify: `src/lib/imports/batch-staging.ts`
- Modify: `scripts/test-setup-import-and-budget-suggestions.mjs`
- Modify: `src/lib/api.ts`
- Modify: `src/server/imports/import-transactions.ts`

**Interfaces:**

- Consumes `detectWorkbookBuffer` and precise `rowIssues` from Tasks 1 and 2.
- Produces `ImportPreviewFile` with nullable detection fields, valid rows, duplicate count, row issues, and optional file issue.
- Produces `ImportPreviewSummary` with `validRows`, `duplicates`, `skippedRows`, `fileErrors`, and `importableRows`.
- Produces `buildImportCommitFiles(files)` that excludes undetected files but preserves valid rows and existing duplicate handling.

- [ ] **Step 1: Write failing staging tests for metadata-free files**

Change the staging test to require only `id` and `file`:

```js
test("setup import staging stores files without manual provider metadata", () => {
  const staged = staging.appendSelectedImportFiles([], [
    { name: "aug.xlsx", lastModified: 1 },
  ]);
  assert.deepEqual(staged, [{
    id: "aug.xlsx-1-0",
    file: { name: "aug.xlsx", lastModified: 1 },
  }]);
});
```

- [ ] **Step 2: Write failing summary and commit-selection tests**

Use one detected file and one unsupported file:

```js
const previewFiles = [
  {
    fileName: "card.xlsx",
    kind: "card",
    templateType: "isracard_bill",
    rows: [
      { id: 1, duplicate: false },
      { id: 2, duplicate: true },
    ],
    duplicateCount: 1,
    rowIssues: [{ sheetName: "Sheet1", rowNumber: 7, problems: ["Missing merchant"] }],
    fileIssue: null,
  },
  {
    fileName: "unknown.xlsx",
    kind: null,
    templateType: null,
    rows: [],
    duplicateCount: 0,
    rowIssues: [],
    fileIssue: { code: "unsupported", message: "Unsupported workbook format", matches: [] },
  },
];

test("summarizes importable duplicate skipped and file-error counts", () => {
  assert.deepEqual(staging.summarizeImportPreviews(previewFiles), {
    validRows: 2,
    duplicates: 1,
    skippedRows: 1,
    fileErrors: 1,
    importableRows: 1,
  });
});

test("commits detected valid files and omits unsupported files", () => {
  assert.deepEqual(staging.buildImportCommitFiles(previewFiles), [{
    fileName: "card.xlsx",
    kind: "card",
    templateType: "isracard_bill",
    rows: previewFiles[0].rows,
  }]);
});
```

- [ ] **Step 3: Run the staging tests and observe the expected failures**

Run:

```powershell
npm run test:logic
```

Expected: FAIL because staged files still contain default `kind` and `templateType`, summaries expose `rows/errors`, and `buildImportCommitFiles` does not exist.

- [ ] **Step 4: Add shared preview types**

Create `src/lib/imports/import-types.ts`:

```ts
import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";

export interface ImportRowIssue {
  sheetName: string;
  rowNumber: number;
  problems: string[];
}

export interface ImportFileIssue {
  code: "unsupported" | "ambiguous" | "unreadable";
  message: string;
  matches: ImportTemplateType[];
}

export interface ImportPreviewRow {
  accountNumber: string;
  date: string;
  processedDate: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  description: string;
  memo?: string;
  type: "normal" | "installments";
  status: "completed" | "pending";
  identifier?: string | number;
  dedupHash: string;
  duplicate: boolean;
}

export interface ImportPreviewFile {
  fileName: string;
  kind: ImportSourceKind | null;
  templateType: ImportTemplateType | null;
  rows: ImportPreviewRow[];
  duplicateCount: number;
  rowIssues: ImportRowIssue[];
  fileIssue: ImportFileIssue | null;
}
```

Define the staging summary with the exact fields used by both screens:

```ts
export interface ImportPreviewSummary {
  validRows: number;
  duplicates: number;
  skippedRows: number;
  fileErrors: number;
  importableRows: number;
}
```

- [ ] **Step 5: Implement metadata-free staging and commit selection**

Change `ImportStagedFile` to contain only `id` and `file`. Remove default template imports and parameters from `appendSelectedImportFiles`.

Implement the summary and commit builder:

```ts
export function summarizeImportPreviews(files: ImportPreviewFile[]): ImportPreviewSummary {
  return files.reduce(
    (summary, file) => ({
      validRows: summary.validRows + file.rows.length,
      duplicates: summary.duplicates + file.duplicateCount,
      skippedRows: summary.skippedRows + file.rowIssues.length,
      fileErrors: summary.fileErrors + (file.fileIssue ? 1 : 0),
      importableRows:
        summary.importableRows + Math.max(0, file.rows.length - file.duplicateCount),
    }),
    { validRows: 0, duplicates: 0, skippedRows: 0, fileErrors: 0, importableRows: 0 }
  );
}

export function buildImportCommitFiles(files: ImportPreviewFile[]) {
  return files.flatMap((file) => {
    if (file.fileIssue || !file.kind || !file.templateType || file.rows.length === 0) return [];
    return [{
      fileName: file.fileName,
      kind: file.kind,
      templateType: file.templateType,
      rows: file.rows,
    }];
  });
}
```

Keep duplicate rows in detected commit files so the database remains authoritative for count-based deduplication and pending transaction updates.

- [ ] **Step 6: Rewrite the preview Route Handler around detection**

Remove the `MetadataItem` interface and the `metadata` form field. Read all `files`, then process each independently in input order:

```ts
const form = await request.formData();
const files = form.getAll("files").filter((file): file is File => file instanceof File);
if (files.length === 0) {
  return NextResponse.json(
    { success: false, message: "Choose at least one workbook" },
    { status: 400 }
  );
}

const previews: ImportPreviewFile[] = [];
for (const file of files) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const detection = await detectWorkbookBuffer(buffer);
  if (!detection.ok) {
    previews.push({
      fileName: file.name,
      kind: null,
      templateType: null,
      rows: [],
      duplicateCount: 0,
      rowIssues: [],
      fileIssue: {
        code: detection.code,
        message: detection.message,
        matches: detection.matches,
      },
    });
    continue;
  }

  const parsed = await parseWorkbookBuffer(buffer, {
    templateType: detection.templateType,
    sourceLabel: getImportTemplateLabel(detection.templateType),
  });
  const preview = previewImportRows(workspaceId, parsed.transactions);
  previews.push({
    fileName: file.name,
    kind: detection.kind,
    templateType: detection.templateType,
    rows: preview.rows,
    duplicateCount: preview.duplicateCount,
    rowIssues: parsed.rowIssues,
    fileIssue: null,
  });
}
```

Wrap the provider-specific parse call in a per-file `try/catch`. If parsing throws after successful detection, append a preview with the detected `kind` and `templateType`, empty rows, and `{ code: "unreadable", message: "Workbook could not be parsed", matches: [detection.templateType] }`. Do not return a batch-level 400 for unsupported, ambiguous, or unreadable files.

- [ ] **Step 7: Update the client API and commit flow**

Re-export shared import types from `src/lib/api.ts`. Change `previewImportFiles` to accept `Array<{ file: File }>` and append only `files` to `FormData`. Change `commitImportPreview` to send `buildImportCommitFiles(files)`.

Keep the commit endpoint's existing `isImportSourceKind`, `isImportTemplateType`, and `templateMatchesSourceKind` checks. In `src/server/imports/import-transactions.ts`, import and re-export `ImportPreviewRow` from `src/lib/imports/import-types.ts`, remove the now-duplicated local `ImportPreviewFile` interface, and keep `ImportCommitFile.kind` and `templateType` non-nullable.

- [ ] **Step 8: Run import, logic, lint, and type checks**

Run:

```powershell
npm run test:imports
npm run test:logic
npm run lint
npx tsc --noEmit
```

Expected: every command exits 0 with zero test failures, ESLint errors, or TypeScript errors.

- [ ] **Step 9: Commit server-authoritative preview metadata**

```powershell
git add src/lib/imports/import-types.ts src/app/api/imports/preview/route.ts src/lib/imports/batch-staging.ts scripts/test-setup-import-and-budget-suggestions.mjs src/lib/api.ts src/server/imports/import-transactions.ts
git commit -m "feat: detect import metadata during preview"
```

---

### Task 4: Shared Preview UI for Setup and Dashboard

**Files:**

- Create: `src/components/imports/import-preview-panel.tsx`
- Modify: `src/lib/imports/batch-staging.ts`
- Modify: `scripts/test-setup-import-and-budget-suggestions.mjs`
- Modify: `src/components/setup/setup-import-step.tsx`
- Modify: `src/components/dashboard/import-xlsx-button.tsx`

**Interfaces:**

- Consumes `ImportPreviewFile` and `ImportPreviewSummary` from Task 3.
- Produces `buildImportPreviewDisplay(files)` for exact labels and issue lines.
- Produces `<ImportPreviewPanel files={preview} />` for both screens.

- [ ] **Step 1: Write failing display-format tests**

Add tests for the exact detected label and physical-row issue line:

```js
test("formats detected providers and exact Excel row issues", () => {
  const display = staging.buildImportPreviewDisplay([{
    fileName: "card.xlsx",
    kind: "card",
    templateType: "isracard_bill",
    rows: [{ duplicate: false }],
    duplicateCount: 0,
    rowIssues: [{
      sheetName: "Sheet1",
      rowNumber: 21,
      problems: ["Missing merchant", "Missing charged amount"],
    }],
    fileIssue: null,
  }]);

  assert.deepEqual(display, [{
    fileName: "card.xlsx",
    providerLabel: "Isracard",
    sourceKindLabel: "Credit card",
    validRows: 1,
    duplicates: 0,
    skippedRows: 1,
    fileIssue: null,
    issueLines: [
      "Sheet1 | Excel row 21 | Missing merchant; Missing charged amount",
    ],
  }]);
});
```

Add a second case expecting `providerLabel: "Not detected"`, `sourceKindLabel: "Unknown source"`, and the unsupported file message.

Add an ambiguous case with `matches: ["isracard_bill", "max_bill"]` and expect the display message `Ambiguous workbook format: Isracard, Max`.

- [ ] **Step 2: Run the logic test and observe the expected failure**

Run:

```powershell
npm run test:logic
```

Expected: FAIL because `buildImportPreviewDisplay` does not exist.

- [ ] **Step 3: Implement the display view model**

In `batch-staging.ts`, import `getImportTemplateLabel` and implement:

```ts
export function buildImportPreviewDisplay(files: ImportPreviewFile[]) {
  return files.map((file) => ({
    fileName: file.fileName,
    providerLabel: file.templateType
      ? getImportTemplateLabel(file.templateType)
      : "Not detected",
    sourceKindLabel:
      file.kind === "bank"
        ? "Bank account"
        : file.kind === "card"
          ? "Credit card"
          : "Unknown source",
    validRows: file.rows.length,
    duplicates: file.duplicateCount,
    skippedRows: file.rowIssues.length,
    fileIssue: file.fileIssue
      ? [
          file.fileIssue.message,
          file.fileIssue.matches.length > 0
            ? file.fileIssue.matches.map(getImportTemplateLabel).join(", ")
            : null,
        ]
          .filter(Boolean)
          .join(": ")
      : null,
    issueLines: file.rowIssues.map(
      (issue) =>
        `${issue.sheetName} | Excel row ${issue.rowNumber} | ${issue.problems.join("; ")}`
    ),
  }));
}
```

- [ ] **Step 4: Build the shared preview panel**

Create a client-compatible presentation component without local state. It must show five batch metrics and a per-file section with detected provider, source kind, row counts, file issue, and every issue line:

```tsx
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { buildImportPreviewDisplay, summarizeImportPreviews } from "@/lib/imports/batch-staging";
import type { ImportPreviewFile } from "@/lib/imports/import-types";

export function ImportPreviewPanel({ files }: { files: ImportPreviewFile[] }) {
  const totals = summarizeImportPreviews(files);
  const displayFiles = buildImportPreviewDisplay(files);

  return (
    <div className="space-y-4 rounded-xl border border-border bg-background p-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <Metric label="Valid rows" value={totals.validRows} />
        <Metric label="New rows" value={totals.importableRows} />
        <Metric label="Duplicates" value={totals.duplicates} />
        <Metric label="Skipped" value={totals.skippedRows} />
        <Metric label="File errors" value={totals.fileErrors} />
      </div>
      <div className="space-y-3">
        {displayFiles.map((file, index) => (
          <section key={`${file.fileName}-${index}`} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{file.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {file.providerLabel} | {file.sourceKindLabel}
                </div>
              </div>
              {file.fileIssue ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {file.validRows} valid | {file.duplicates} duplicates | {file.skippedRows} skipped
            </div>
            {file.fileIssue && (
              <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {file.fileIssue}
              </div>
            )}
            {file.issueLines.length > 0 && (
              <ul className="mt-3 max-h-40 space-y-1 overflow-auto break-words text-xs text-destructive">
                {file.issueLines.map((line, index) => (
                  <li key={`${file.fileName}-${index}`}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
```

Implement the private `Metric` helper using the existing rounded muted card style. Do not add a client directive unless an imported dependency requires it.

- [ ] **Step 5: Replace manual selection in the setup wizard**

Remove `useMemo`, `ImportSourceKind`, `ImportTemplateType`, template option imports, `updateKind`, and `updateTemplate`. Keep file removal. Before Preview, each selected file row shows its filename and `Source detected during preview`.

Replace the local preview table with `<ImportPreviewPanel files={preview} />`. Use the new totals:

```tsx
const totals = preview
  ? summarizeImportPreviews(preview)
  : { validRows: 0, duplicates: 0, skippedRows: 0, fileErrors: 0, importableRows: 0 };

<Button
  onClick={handleImport}
  disabled={!preview || totals.importableRows === 0 || committing}
>
  {committing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
  {preview ? `Load ${totals.importableRows} valid rows` : "Load valid rows"}
</Button>
```

After commit, show `Imported ${result.added} new transactions. Skipped ${totals.skippedRows} invalid rows.` Add the file-error count when it is greater than zero.

- [ ] **Step 6: Replace manual selection in the dashboard dialog**

Use `ImportStagedFile` and `appendSelectedImportFiles` instead of the local selected-file metadata interface. Remove both selectors and show `Source detected during preview` before Preview. Render the same `ImportPreviewPanel`, use `totals.importableRows` for button state and label, and report skipped rows after commit.

Keep the dashboard behavior that replaces the current selection when a new file-picker batch is chosen. Keep setup behavior that appends later selections.

- [ ] **Step 7: Run automated frontend verification**

Run:

```powershell
npm run test:imports
npm run test:logic
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all commands exit 0. The build must complete without route, client-boundary, type, or rendering errors.

- [ ] **Step 8: Inspect both screens in the browser**

Start the app:

```powershell
npm run dev
```

Verify the setup wizard import step and the home page Load transactions dialog with these files:

- `transactions/2437_08_2026.xlsx` for Isracard detection and a row issue.
- `transactions/transaction-details_export_1785570692278.xlsx` for Max detection with invalid rows.
- `transactions/excelNewTransactions.xlsx` for Hapoalim detection.

Confirm in both light and dark themes, at desktop and narrow widths:

1. No provider or source-kind selector is visible.
2. Before Preview, the file says `Source detected during preview`.
3. After Preview, the provider and `Credit card` or `Bank account` are visible.
4. Every issue includes sheet, physical Excel row, and exact problems.
5. Error lists scroll without expanding the dialog beyond the viewport.
6. Load remains enabled when another row or file is invalid but at least one non-duplicate row is valid.
7. Completion feedback reports imported and skipped counts.

- [ ] **Step 9: Commit the shared import preview experience**

```powershell
git add src/components/imports/import-preview-panel.tsx src/lib/imports/batch-staging.ts scripts/test-setup-import-and-budget-suggestions.mjs src/components/setup/setup-import-step.tsx src/components/dashboard/import-xlsx-button.tsx
git commit -m "feat: show detected imports and row errors"
```

---

## Final Verification

- [ ] Run the complete verification set from a clean working tree:

```powershell
npm run test:imports
npm run test:logic
npm run lint
npx tsc --noEmit
npm run build
git status --short
```

Expected: every command exits 0 and `git status --short` prints no uncommitted files.

- [ ] Review the final diff against every acceptance criterion in `docs/superpowers/specs/2026-08-01-automatic-import-detection-design.md`.

- [ ] Confirm no workbook contents or transaction values were added to logs, snapshots, committed fixtures, or error telemetry.
