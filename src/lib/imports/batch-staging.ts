import type {
  ImportPreviewFile,
  ImportPreviewSummary,
  ImportPreviewRow,
} from "./import-types";
import { getImportTemplateLabel } from "./templates.js";

export type { ImportPreviewSummary } from "./import-types";

export interface ImportStagedFile<FileLike = File> {
  id: string;
  file: FileLike;
}

export interface ImportProgressStep {
  completedRows: number;
  label: string;
}

export interface ImportProgressPlan {
  mode: "file" | "rows";
  totalRows: number;
  totalSteps: number;
  steps: ImportProgressStep[];
}

export function appendSelectedImportFiles<
  FileLike extends { name: string; lastModified: number },
>(
  current: ImportStagedFile<FileLike>[],
  files: FileLike[]
): ImportStagedFile<FileLike>[] {
  return [
    ...current,
    ...files.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${current.length + index}`,
      file,
    })),
  ];
}

export function summarizeImportPreviews(
  files: ImportPreviewFile[]
): ImportPreviewSummary {
  return files.reduce(
    (summary, file) => ({
      validRows: summary.validRows + file.rows.length,
      duplicates: summary.duplicates + file.duplicateCount,
      skippedRows: summary.skippedRows + file.rowIssues.length,
      fileErrors: summary.fileErrors + (file.fileIssue ? 1 : 0),
      importableRows:
        summary.importableRows + Math.max(0, file.rows.length - file.duplicateCount),
    }),
    {
      validRows: 0,
      duplicates: 0,
      skippedRows: 0,
      fileErrors: 0,
      importableRows: 0,
    }
  );
}

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

export function buildImportCommitFiles(files: ImportPreviewFile[]): Array<{
  fileName: string;
  kind: NonNullable<ImportPreviewFile["kind"]>;
  templateType: NonNullable<ImportPreviewFile["templateType"]>;
  rows: ImportPreviewRow[];
}> {
  return files.flatMap((file) => {
    if (
      file.fileIssue ||
      !file.kind ||
      !file.templateType ||
      file.rows.length === 0
    ) {
      return [];
    }
    return [
      {
        fileName: file.fileName,
        kind: file.kind,
        templateType: file.templateType,
        rows: file.rows,
      },
    ];
  });
}

export function buildImportProgressPlan(
  files: Array<{ fileName: string; rows: unknown[] }>,
  rowChunkSize = 10
): ImportProgressPlan {
  const totalRows = files.reduce((sum, file) => sum + file.rows.length, 0);
  const mode = files.some((file) => file.rows.length > rowChunkSize)
    ? "rows"
    : "file";

  if (mode === "file") {
    let completedRows = 0;
    const steps = files.map((file) => {
      completedRows += file.rows.length;
      return {
        completedRows,
        label: `Prepared ${file.fileName}`,
      };
    });
    return {
      mode,
      totalRows,
      totalSteps: steps.length,
      steps,
    };
  }

  const steps: ImportProgressStep[] = [];
  for (
    let completedRows = rowChunkSize;
    completedRows < totalRows && totalRows > 0;
    completedRows += rowChunkSize
  ) {
    steps.push({
      completedRows,
      label: `Prepared ${completedRows} of ${totalRows} rows`,
    });
  }

  if (totalRows > 0) {
    steps.push({
      completedRows: totalRows,
      label: `Prepared ${totalRows} of ${totalRows} rows`,
    });
  }

  return {
    mode,
    totalRows,
    totalSteps: steps.length,
    steps,
  };
}
