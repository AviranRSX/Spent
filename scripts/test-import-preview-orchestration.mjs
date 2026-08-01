import assert from "node:assert/strict";
import test from "node:test";

const { previewImportUploadedWorkbooks, previewImportWorkbooks } = await import(
  "../src/server/imports/preview-workbooks.ts"
);
const {
  createImportUploadLimitResponse,
  getImportRequestLimitViolation,
  getImportUploadLimitViolation,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILES,
  MAX_IMPORT_REQUEST_BYTES,
  MAX_IMPORT_TOTAL_BYTES,
} = await import("../src/server/imports/import-upload-limits.ts");

const parsedTransaction = {
  accountNumber: "1234",
  date: "2026-08-01",
  processedDate: "2026-08-02",
  originalAmount: 25,
  originalCurrency: "ILS",
  chargedAmount: 25,
  chargedCurrency: "ILS",
  description: "Coffee",
  type: "normal",
  status: "completed",
};

const previewRow = {
  ...parsedTransaction,
  dedupHash: "dedup-coffee",
  duplicate: false,
};

function createDependencies(overrides = {}) {
  return {
    detectWorkbookBuffer: async () => ({
      ok: true,
      kind: "card",
      templateType: "isracard_bill",
    }),
    parseWorkbookBuffer: async () => ({
      transactions: [parsedTransaction],
      rowIssues: [],
    }),
    getImportTemplateLabel: () => "Isracard",
    previewImportRows: () => ({ rows: [previewRow], duplicateCount: 0 }),
    ...overrides,
  };
}

test("previews file-only inputs without manual metadata", async () => {
  const previews = await previewImportWorkbooks(
    7,
    [{ fileName: "card.xlsx", buffer: Buffer.from("card") }],
    createDependencies()
  );

  assert.deepEqual(previews, [
    {
      fileName: "card.xlsx",
      kind: "card",
      templateType: "isracard_bill",
      rows: [previewRow],
      duplicateCount: 0,
      rowIssues: [],
      fileIssue: null,
    },
  ]);
});

test("preserves file order across detected and unsupported workbooks", async () => {
  const previews = await previewImportWorkbooks(
    7,
    [
      { fileName: "first.xlsx", buffer: Buffer.from("first") },
      { fileName: "unknown.xlsx", buffer: Buffer.from("unknown") },
      { fileName: "third.xlsx", buffer: Buffer.from("third") },
    ],
    createDependencies({
      detectWorkbookBuffer: async (buffer) => {
        if (buffer.toString() === "unknown") {
          return {
            ok: false,
            code: "unsupported",
            message: "Unsupported workbook format",
            matches: [],
          };
        }
        return {
          ok: true,
          kind: "card",
          templateType: "isracard_bill",
        };
      },
    })
  );

  assert.deepEqual(previews.map((preview) => preview.fileName), [
    "first.xlsx",
    "unknown.xlsx",
    "third.xlsx",
  ]);
  assert.deepEqual(previews[1], {
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
  });
});

test("converts a parser failure after detection into an unreadable file issue", async () => {
  const previews = await previewImportWorkbooks(
    7,
    [{ fileName: "damaged.xlsx", buffer: Buffer.from("damaged") }],
    createDependencies({
      parseWorkbookBuffer: async () => {
        throw new Error("Malformed cell");
      },
    })
  );

  assert.deepEqual(previews, [
    {
      fileName: "damaged.xlsx",
      kind: "card",
      templateType: "isracard_bill",
      rows: [],
      duplicateCount: 0,
      rowIssues: [],
      fileIssue: {
        code: "unreadable",
        message: "Workbook could not be parsed",
        matches: ["isracard_bill"],
      },
    },
  ]);
});

test("propagates dedup preview failures after successful parsing", async () => {
  await assert.rejects(
    previewImportWorkbooks(
      7,
      [{ fileName: "card.xlsx", buffer: Buffer.from("card") }],
      createDependencies({
        previewImportRows: () => {
          throw new Error("Database unavailable");
        },
      })
    ),
    /Database unavailable/
  );
});

test("copies and previews uploaded workbook buffers sequentially", async () => {
  let activeReads = 0;
  let maximumActiveReads = 0;
  const files = ["first", "second", "third"].map((fileName) => ({
    name: `${fileName}.xlsx`,
    size: fileName.length,
    async arrayBuffer() {
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      await new Promise((resolve) => setImmediate(resolve));
      activeReads -= 1;
      return Uint8Array.from(Buffer.from(fileName)).buffer;
    },
  }));

  const previews = await previewImportUploadedWorkbooks(
    7,
    files,
    createDependencies()
  );

  assert.equal(maximumActiveReads, 1);
  assert.deepEqual(
    previews.map((preview) => preview.fileName),
    ["first.xlsx", "second.xlsx", "third.xlsx"]
  );
});

test("rejects too many uploaded workbooks", () => {
  const files = Array.from({ length: MAX_IMPORT_FILES + 1 }, () => ({ size: 1 }));

  assert.deepEqual(getImportUploadLimitViolation(files), {
    code: "too_many_files",
    message: `Choose no more than ${MAX_IMPORT_FILES} workbooks at a time`,
  });
});

test("rejects an uploaded workbook above the compressed byte limit", () => {
  assert.deepEqual(
    getImportUploadLimitViolation([{ size: MAX_IMPORT_FILE_BYTES + 1 }]),
    {
      code: "file_too_large",
      message: "One or more workbooks exceed the upload size limit",
    }
  );
});

test("rejects uploads above the total compressed byte limit", () => {
  assert.deepEqual(
    getImportUploadLimitViolation([
      { size: MAX_IMPORT_TOTAL_BYTES / 4 },
      { size: MAX_IMPORT_TOTAL_BYTES / 4 },
      { size: MAX_IMPORT_TOTAL_BYTES / 4 },
      { size: MAX_IMPORT_TOTAL_BYTES / 4 + 1 },
    ]),
    {
      code: "upload_too_large",
      message: "The selected workbooks exceed the total upload size limit",
    }
  );
});

test("rejects request content lengths above the multipart byte limit", () => {
  assert.equal(
    getImportRequestLimitViolation(String(MAX_IMPORT_REQUEST_BYTES)),
    null
  );
  assert.deepEqual(
    getImportRequestLimitViolation(String(MAX_IMPORT_REQUEST_BYTES + 1)),
    {
      code: "request_too_large",
      message: "The upload request exceeds the size limit",
    }
  );
});

test("builds a 413 response before parsing an oversized request", async () => {
  const violation = {
    code: "request_too_large",
    message: "The upload request exceeds the size limit",
  };
  assert.equal(MAX_IMPORT_REQUEST_BYTES > MAX_IMPORT_TOTAL_BYTES, true);

  const response = createImportUploadLimitResponse(violation);

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "The upload request exceeds the size limit",
  });
});
