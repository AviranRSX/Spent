import "server-only";

import type {
  ImportDetectionResult,
  ParsedImportTransaction,
  ParsedImportRowIssue,
} from "@/lib/imports/xlsx-parser";
import type { ImportTemplateType } from "@/lib/types";
import type {
  ImportPreviewFile,
  ImportPreviewRow,
} from "@/lib/imports/import-types";

export interface ImportPreviewWorkbook {
  fileName: string;
  buffer: Buffer;
}

export interface ImportUploadedWorkbook {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ImportPreviewDependencies {
  detectWorkbookBuffer(buffer: Buffer): Promise<ImportDetectionResult>;
  parseWorkbookBuffer(
    buffer: Buffer,
    options: { templateType: ImportTemplateType; sourceLabel: string }
  ): Promise<{
    transactions: ParsedImportTransaction[];
    rowIssues: ParsedImportRowIssue[];
  }>;
  getImportTemplateLabel(templateType: ImportTemplateType): string;
  previewImportRows(
    workspaceId: number,
    rows: ParsedImportTransaction[]
  ): { rows: ImportPreviewRow[]; duplicateCount: number };
}

export async function previewImportWorkbooks(
  workspaceId: number,
  files: ImportPreviewWorkbook[],
  dependencies: ImportPreviewDependencies
): Promise<ImportPreviewFile[]> {
  const previews: ImportPreviewFile[] = [];

  for (const file of files) {
    const detection = await dependencies.detectWorkbookBuffer(file.buffer);
    if (!detection.ok) {
      previews.push({
        fileName: file.fileName,
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

    let parsed: {
      transactions: ParsedImportTransaction[];
      rowIssues: ParsedImportRowIssue[];
    };
    try {
      parsed = await dependencies.parseWorkbookBuffer(file.buffer, {
        templateType: detection.templateType,
        sourceLabel: dependencies.getImportTemplateLabel(detection.templateType),
      });
    } catch {
      previews.push({
        fileName: file.fileName,
        kind: detection.kind,
        templateType: detection.templateType,
        rows: [],
        duplicateCount: 0,
        rowIssues: [],
        fileIssue: {
          code: "unreadable",
          message: "Workbook could not be parsed",
          matches: [detection.templateType],
        },
      });
      continue;
    }

    const preview = dependencies.previewImportRows(
      workspaceId,
      parsed.transactions
    );
    previews.push({
      fileName: file.fileName,
      kind: detection.kind,
      templateType: detection.templateType,
      rows: preview.rows,
      duplicateCount: preview.duplicateCount,
      rowIssues: parsed.rowIssues,
      fileIssue: null,
    });
  }

  return previews;
}

export async function previewImportUploadedWorkbooks(
  workspaceId: number,
  files: readonly ImportUploadedWorkbook[],
  dependencies: ImportPreviewDependencies
): Promise<ImportPreviewFile[]> {
  const previews: ImportPreviewFile[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePreviews = await previewImportWorkbooks(
      workspaceId,
      [{ fileName: file.name, buffer }],
      dependencies
    );
    previews.push(...filePreviews);
  }
  return previews;
}
