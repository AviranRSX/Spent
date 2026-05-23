import {
  getImportTemplatesForKind,
} from "./templates.js";
import type { ImportSourceKind, ImportTemplateType } from "../types";

export interface ImportStagedFile<FileLike = File> {
  id: string;
  file: FileLike;
  kind: ImportSourceKind;
  templateType: ImportTemplateType;
}

export interface ImportPreviewSummary {
  rows: number;
  duplicates: number;
  errors: number;
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
  files: FileLike[],
  defaults: {
    kind?: ImportSourceKind;
    templateType?: ImportTemplateType;
  } = {}
): ImportStagedFile<FileLike>[] {
  const kind = defaults.kind ?? "card";
  const templateType =
    defaults.templateType ?? getImportTemplatesForKind(kind)[0].templateType;
  return [
    ...current,
    ...files.map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${current.length + index}`,
      file,
      kind,
      templateType,
    })),
  ];
}

export function summarizeImportPreviews(
  files: Array<{
    rows: unknown[];
    duplicateCount: number;
    errors: unknown[];
  }>
): ImportPreviewSummary {
  return files.reduce(
    (summary, file) => ({
      rows: summary.rows + file.rows.length,
      duplicates: summary.duplicates + file.duplicateCount,
      errors: summary.errors + file.errors.length,
    }),
    { rows: 0, duplicates: 0, errors: 0 }
  );
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
