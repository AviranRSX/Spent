import assert from "node:assert/strict";
import test from "node:test";

const suggestions = await import("../src/server/lib/budget-suggestions.ts");
const staging = await import("../src/lib/imports/batch-staging.ts");
const classificationProgress = await import(
  "../src/lib/setup/classification-progress.ts"
);
const wizardFlow = await import("../src/lib/setup/wizard-flow.ts");
const categorizeReview = await import("../src/lib/categorize-review.ts");

test("budget suggestions use exactly the last 3 complete months", () => {
  assert.deepEqual(
    suggestions.getLastCompleteMonths(new Date("2026-05-23T12:00:00+03:00")),
    ["2026-02", "2026-03", "2026-04"]
  );
});

test("budget suggestions can use a larger complete-month window", () => {
  assert.deepEqual(
    suggestions.getLastCompleteMonths(new Date("2026-05-23T12:00:00+03:00"), 5),
    ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"]
  );
});

test("budget suggestion month count clamps to at least 3 and available data", () => {
  assert.equal(suggestions.resolveBudgetSuggestionMonthCount(null, 8), 3);
  assert.equal(suggestions.resolveBudgetSuggestionMonthCount(1, 8), 3);
  assert.equal(suggestions.resolveBudgetSuggestionMonthCount(6, 8), 6);
  assert.equal(suggestions.resolveBudgetSuggestionMonthCount(12, 8), 8);
});

test("budget suggestions require 3 complete months", () => {
  const result = suggestions.buildBudgetSuggestions({
    now: new Date("2026-05-23T12:00:00+03:00"),
    monthCount: 3,
    availableMonths: ["2026-03", "2026-04"],
    categoryMonthlySpend: [],
    bankMonthlySpend: [],
  });

  assert.equal(result.hasEnoughHistory, false);
  assert.equal(result.message, "there is not enoght month for satistic");
  assert.deepEqual(result.months, ["2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(result.categorySuggestions, []);
  assert.equal(result.totalBudgetSuggestion, null);
});

test("budget suggestions use category mean and total bank mean", () => {
  const result = suggestions.buildBudgetSuggestions({
    now: new Date("2026-05-23T12:00:00+03:00"),
    monthCount: 3,
    availableMonths: ["2026-02", "2026-03", "2026-04"],
    categoryMonthlySpend: [
      { month: "2026-02", categoryId: 1, categoryName: "Food", amount: 100 },
      { month: "2026-03", categoryId: 1, categoryName: "Food", amount: 900 },
      { month: "2026-04", categoryId: 1, categoryName: "Food", amount: 200 },
      { month: "2026-03", categoryId: 2, categoryName: "Transport", amount: 60 },
      { month: "2026-04", categoryId: 2, categoryName: "Transport", amount: 120 },
    ],
    bankMonthlySpend: [
      { month: "2026-02", amount: 7000 },
      { month: "2026-03", amount: 3000 },
      { month: "2026-04", amount: 5000 },
    ],
  });

  assert.equal(result.hasEnoughHistory, true);
  assert.equal(result.message, null);
  assert.deepEqual(result.months, ["2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(result.categorySuggestions, [
    {
      categoryId: 1,
      categoryName: "Food",
      mean: 400,
      median: 200,
      suggestedBudget: 400,
    },
    {
      categoryId: 2,
      categoryName: "Transport",
      mean: 60,
      median: 60,
      suggestedBudget: 60,
    },
  ]);
  assert.deepEqual(result.totalBudgetSuggestion, {
    mean: 5000,
    median: 5000,
    suggestedBudget: 5000,
  });
});

test("budget suggestion apply plan uses explicit user selections", () => {
  assert.deepEqual(
    suggestions.buildBudgetSuggestionApplyPlanFromSelections({
      categoryBudgets: [
        { categoryId: 1, amount: 220.4 },
        { categoryId: 2, amount: 0 },
        { categoryId: 3, amount: -1 },
        { categoryId: 4, amount: Number.NaN },
      ],
      monthlyTarget: 4200.6,
    }),
    {
      categoryBudgets: [
        { categoryId: 1, amount: 220.4 },
        { categoryId: 2, amount: 0 },
      ],
      monthlyTarget: 4200.6,
    }
  );
});

test("budget suggestions average over the selected month count", () => {
  const result = suggestions.buildBudgetSuggestions({
    now: new Date("2026-05-23T12:00:00+03:00"),
    monthCount: 4,
    availableMonths: ["2026-01", "2026-02", "2026-03", "2026-04"],
    categoryMonthlySpend: [
      { month: "2026-01", categoryId: 1, categoryName: "Food", amount: 100 },
      { month: "2026-02", categoryId: 1, categoryName: "Food", amount: 300 },
      { month: "2026-03", categoryId: 1, categoryName: "Food", amount: 500 },
      { month: "2026-04", categoryId: 1, categoryName: "Food", amount: 700 },
    ],
    bankMonthlySpend: [
      { month: "2026-01", amount: 1000 },
      { month: "2026-02", amount: 3000 },
      { month: "2026-03", amount: 5000 },
      { month: "2026-04", amount: 7000 },
    ],
  });

  assert.deepEqual(result.months, ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.equal(result.categorySuggestions[0]?.suggestedBudget, 400);
  assert.equal(result.totalBudgetSuggestion?.suggestedBudget, 4000);
});

test("setup import staging stores files without manual provider metadata", () => {
  const staged = staging.appendSelectedImportFiles([], [
    { name: "aug.xlsx", lastModified: 1 },
  ]);

  assert.deepEqual(staged, [
    {
      id: "aug.xlsx-1-0",
      file: { name: "aug.xlsx", lastModified: 1 },
    },
  ]);
});

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
    rowIssues: [
      { sheetName: "Sheet1", rowNumber: 7, problems: ["Missing merchant"] },
    ],
    fileIssue: null,
  },
  {
    fileName: "unknown.xlsx",
    kind: null,
    templateType: null,
    rows: [],
    duplicateCount: 0,
    rowIssues: [],
    fileIssue: {
      code: "unsupported",
      message: "Unsupported workbook format",
      matches: [],
    },
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
  assert.deepEqual(staging.buildImportCommitFiles(previewFiles), [
    {
      fileName: "card.xlsx",
      kind: "card",
      templateType: "isracard_bill",
      rows: previewFiles[0].rows,
    },
  ]);
});

test("formats detected providers and exact Excel row issues", () => {
  const display = staging.buildImportPreviewDisplay([
    {
      fileName: "card.xlsx",
      kind: "card",
      templateType: "isracard_bill",
      rows: [{ duplicate: false }],
      duplicateCount: 0,
      rowIssues: [
        {
          sheetName: "Sheet1",
          rowNumber: 21,
          problems: ["Missing merchant", "Missing charged amount"],
        },
      ],
      fileIssue: null,
    },
  ]);

  assert.deepEqual(display, [
    {
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
    },
  ]);
});

test("formats unsupported workbooks without a detected source", () => {
  const display = staging.buildImportPreviewDisplay([
    {
      fileName: "unknown.xlsx",
      kind: null,
      templateType: null,
      rows: [],
      duplicateCount: 0,
      rowIssues: [],
      fileIssue: {
        code: "unsupported",
        message: "Unsupported workbook format",
        matches: [],
      },
    },
  ]);

  assert.deepEqual(display, [
    {
      fileName: "unknown.xlsx",
      providerLabel: "Not detected",
      sourceKindLabel: "Unknown source",
      validRows: 0,
      duplicates: 0,
      skippedRows: 0,
      fileIssue: "Unsupported workbook format",
      issueLines: [],
    },
  ]);
});

test("formats ambiguous workbook matches with detected provider labels", () => {
  const display = staging.buildImportPreviewDisplay([
    {
      fileName: "ambiguous.xlsx",
      kind: null,
      templateType: null,
      rows: [],
      duplicateCount: 0,
      rowIssues: [],
      fileIssue: {
        code: "ambiguous",
        message: "Ambiguous workbook format",
        matches: ["isracard_bill", "max_bill"],
      },
    },
  ]);

  assert.equal(
    display[0]?.fileIssue,
    "Ambiguous workbook format: Isracard, Max"
  );
});

test("setup import progress advances after each file for file-sized batches", () => {
  const plan = staging.buildImportProgressPlan([
    {
      fileName: "feb.xlsx",
      rows: [{ id: 1 }, { id: 2 }],
      duplicateCount: 0,
      errors: [],
    },
    {
      fileName: "mar.xlsx",
      rows: [{ id: 3 }],
      duplicateCount: 0,
      errors: [],
    },
  ]);

  assert.equal(plan.mode, "file");
  assert.equal(plan.totalSteps, 2);
  assert.deepEqual(plan.steps.map((step) => step.completedRows), [2, 3]);
  assert.deepEqual(plan.steps.map((step) => step.label), [
    "Prepared feb.xlsx",
    "Prepared mar.xlsx",
  ]);
});

test("setup import progress advances every 10 rows for concatenated row batches", () => {
  const plan = staging.buildImportProgressPlan([
    {
      fileName: "may.xlsx",
      rows: Array.from({ length: 25 }, (_, id) => ({ id })),
      duplicateCount: 0,
      errors: [],
    },
  ]);

  assert.equal(plan.mode, "rows");
  assert.equal(plan.totalSteps, 3);
  assert.deepEqual(plan.steps.map((step) => step.completedRows), [10, 20, 25]);
  assert.deepEqual(plan.steps.map((step) => step.label), [
    "Prepared 10 of 25 rows",
    "Prepared 20 of 25 rows",
    "Prepared 25 of 25 rows",
  ]);
});

test("setup xlsx import shows progress for more than one selected file", () => {
  assert.equal(wizardFlow.shouldShowSetupImportProgress(2, 2), true);
});

test("setup xlsx import skips AI category review after importing", () => {
  assert.equal(wizardFlow.getStepAfterXlsxImport(), 9);
});

test("setup xlsx stepper excludes AI category review", () => {
  const steps = wizardFlow.getVisibleSetupStepNumbers("first-run", "xlsx");

  assert.deepEqual(steps, [6, 2, 7, 9, 5, 3, 4]);
});

test("setup xlsx statistics back button returns to import", () => {
  assert.equal(wizardFlow.getStepBeforeBudgetSuggestions("xlsx"), 7);
});

test("setup classification progress is visible only while AI preview is loading", () => {
  assert.deepEqual(classificationProgress.getClassificationProgressState(true, null), {
    visible: true,
    label: "Asking the AI to classify imported transactions",
    percent: null,
    valueLabel: "",
  });

  assert.deepEqual(classificationProgress.getClassificationProgressState(false, null), {
    visible: false,
    label: "",
    percent: null,
    valueLabel: "",
  });
});

test("setup classification progress reports classified rows and percent", () => {
  assert.deepEqual(
    classificationProgress.getClassificationProgressState(true, {
      processed: 50,
      total: 125,
    }),
    {
      visible: true,
      label: "Classified 50 of 125 rows",
      percent: 40,
      valueLabel: "40%",
    }
  );
});

test("setup classification progress reports the active row range", () => {
  assert.deepEqual(
    classificationProgress.getClassificationProgressState(true, {
      processed: 0,
      total: 23,
      currentStart: 1,
      currentEnd: 10,
    }),
    {
      visible: true,
      label: "Classifying rows 1-10 of 23",
      percent: 0,
      valueLabel: "0%",
    }
  );
});

test("category review payload redirects rejected proposals to existing categories", () => {
  const payload = categorizeReview.buildCategorizeApplyPayload({
    preview: {
      uncategorizedCount: 2,
      assignments: [
        {
          transactionId: 1,
          description: "market",
          categoryName: "Food Stores",
          isNew: true,
          kind: "expense",
          aiConfidence: 5,
        },
        {
          transactionId: 2,
          description: "bus",
          categoryName: "Transport",
          isNew: false,
          kind: "expense",
          aiConfidence: 6,
        },
      ],
      proposedCategories: [
        {
          name: "Food Stores",
          kind: "expense",
          transactionIds: [1],
          samples: ["market"],
        },
      ],
      existingCategoryUsage: { Transport: 1 },
    },
    approvedMap: { "Food Stores": false },
    fallbackMap: { "Food Stores": "Groceries" },
  });

  assert.deepEqual(payload.approvedNewCategoryNames, []);
  assert.deepEqual(payload.rejectionFallbacks, { "Food Stores": "Groceries" });
});
